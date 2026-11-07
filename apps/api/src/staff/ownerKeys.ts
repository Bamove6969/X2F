import { createHash } from 'node:crypto';
import { keyCheckCode } from '@x2f/staff';
import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { consumeChallenge } from '../auth/challenges.js';
import { lockAccount, withTx } from '../auth/hold.js';
import { WEBAUTHN_TTL_MS, verifyWebAuthnRegistrationOnly, webauthnRegistrationOptions } from '../auth/webauthn.js';
import { ApiError } from '../errors.js';
import { requireStaff } from './guard.js';
import { consumeKeyTap } from './keyTap.js';
import { body, log, tapIdOf } from './members.js';

// Plan 4 Task 7: the owner's security keys (perm `self`, the owner only: anyone else 403 `forbidden`).
//
// - `GET /staff/v1/owner/keys` → `{ keys: [{ id, label, createdAt, lastUsedAt, keyCheckCode }] }`
//   (the attested security keys; `id` is what DELETE takes).
// - `POST /staff/v1/owner/keys/start` → `{ challengeId, options }` (an attested security key on the
//   owner's allowlist; 5 minutes).
// - `POST /staff/v1/owner/keys/finish { challengeId, response, tapId, label? }` → 201
//   `{ id, keyCheckCode }`: the registration is verified, then, in one transaction with the owner's
//   account row locked, the challenge is used, a tap `add-owner-key` by one of the owner's existing
//   keys is consumed (`credentialId` = the new key's base64url id, `publicKeySha256` = hex SHA-256 of
//   its COSE public key), the key is stored and `owner.key-added` logged. A refused tap rolls all
//   of it back, so the person can tap again.
// - Removing a key: `DELETE /staff/v1/account/methods/security-key/:id` (staff/account.ts), with a
//   tap, the two-key rule (409 `owner-needs-two-keys`), an alert and every other session ended
//   (lead review 7 Nov I-1: the untapped owner-only DELETE here is gone).

const ownerOnly: preHandlerAsyncHookHandler = async function (req: FastifyRequest) {
  if (req.staff.role !== 'owner') throw new ApiError(403, 'forbidden');
};

const PURPOSE = 'owner-add-key';

export function ownerKeyRoutes(app: FastifyInstance): void {
  const opts = { config: { perm: 'self' as const }, preHandler: [...requireStaff('self'), ownerOnly] };

  app.get('/staff/v1/owner/keys', opts, async (req) => {
    const { rows } = await req.server.deps.db.query<{ id: string; label: string; created_at: Date; last_used_at: Date | null; public_key: Buffer }>(
      `select id, label, created_at, last_used_at, public_key from webauthn_credentials
        where account_id = $1 and kind = 'security-key' and attested order by created_at, id`,
      [req.staff.accountId],
    );
    return {
      keys: rows.map((r) => ({
        id: r.id, label: r.label, createdAt: r.created_at.toISOString(), lastUsedAt: r.last_used_at?.toISOString() ?? null,
        keyCheckCode: keyCheckCode(new Uint8Array(r.public_key)),
      })),
    };
  });

  app.post('/staff/v1/owner/keys/start', opts, async (req) => {
    const deps = req.server.deps;
    req.server.budgets.start.take();
    const options = await webauthnRegistrationOptions(deps, req.staff.accountId, { kind: 'security-key' });
    const now = deps.clock();
    const { rows } = await deps.db.query<{ id: string }>(
      `insert into challenges (account_id, session_id, purpose, method, webauthn_challenge, payload, created_at, expires_at)
       values ($1, $2, $3, 'security-key', $4, '{}', $5, $6) returning id`,
      [req.staff.accountId, req.auth.sessionId, PURPOSE, options.challenge, now, new Date(now.getTime() + WEBAUTHN_TTL_MS)],
    );
    return { challengeId: rows[0]!.id, options };
  });

  app.post('/staff/v1/owner/keys/finish', opts, async (req, reply) => {
    const deps = req.server.deps;
    const b = body(req);
    const owner = req.staff.accountId;
    if (typeof b.challengeId !== 'string') throw new ApiError(400, 'challenge-expired');
    const challengeId = b.challengeId;
    const label = typeof b.label === 'string' ? b.label : undefined;
    const { rows: open } = await deps.db.query<{ webauthn_challenge: string }>(
      `select webauthn_challenge from challenges where id::text = $1 and account_id = $2 and session_id = $3 and purpose = $4
         and used_at is null and expires_at > $5`,
      [challengeId, owner, req.auth.sessionId, PURPOSE, deps.clock()],
    );
    if (!open[0]) throw new ApiError(400, 'challenge-expired');
    req.server.budgets.register.take();
    const cred = await verifyWebAuthnRegistrationOnly(deps, owner, b.response, open[0].webauthn_challenge, {
      kind: 'security-key', ...(label !== undefined ? { label } : {}),
    });
    const publicKeySha256 = createHash('sha256').update(cred.publicKey).digest('hex');
    const now = deps.clock();
    const id = await withTx(deps.db, async (c) => {
      await lockAccount(c, owner);
      const ch = await consumeChallenge(c, challengeId, now);
      if (!ch || ch.purpose !== PURPOSE || ch.account_id !== owner) throw new ApiError(400, 'challenge-expired');
      await consumeKeyTap(c, tapIdOf(b), owner, { kind: 'add-owner-key', credentialId: cred.credentialId, publicKeySha256 }, now, { sessionId: req.auth.sessionId });
      const rowId = await cred.store(c);
      await log(c, req, 'owner.key-added', { credentialId: rowId });
      return rowId;
    });
    return reply.code(201).send({ id, keyCheckCode: keyCheckCode(cred.publicKey) });
  });
}
