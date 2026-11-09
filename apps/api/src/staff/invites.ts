import { createHash } from 'node:crypto';
import { inviteRegistrationChallenge, keyCheckCode } from '@x2f/staff';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { assertNewNames, createAccount } from '../accounts.js';
import { deviceHash, ensureDeviceCookie } from '../auth/device.js';
import { lockAccount, withTx } from '../auth/hold.js';
import { PGP_BODY_LIMIT, checkTeamJoinCode, insertPgpKey, issueTeamJoinChallenge } from '../auth/pgp.js';
import { verifyWebAuthnRegistrationOnly, webauthnRegistrationOptions, type CredentialKind } from '../auth/webauthn.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { appendLog } from '../log/append.js';
import type { StaffDeps } from './app.js';
import { requireStaff } from './guard.js';
import { THREE_METHOD_ROLES, holdsAllThree } from './login.js';
import { consumeKeyTap } from './keyTap.js';
import { attestedKeyCount, body, hoursOf, idParam, log, roleOf, tapIdOf, type InvitableRole } from './members.js';

// Plan 4 Task 7: staff invites (migration 205_staff_invites.sql).
//
// The owner's side (perm `staff.manage`):
// - `POST /staff/v1/invites { role, hours, inviteId, token, expiresAt, tapId }` → 201
//   `{ inviteId, link, expiresAt }`. The owner's browser makes the token (32 random bytes,
//   base64url), the invite id and the expiry (at most 24 hours ahead), because the owner's
//   `create-invite` tap must already be bound to the token's hash when the invite is created
//   (`{ kind: 'create-invite', inviteId, role, tokenHash, expiresAt }`, tokenHash = hex SHA-256 of
//   the token text). The server re-derives that intent from the request and consumes the tap in
//   the transaction that stores the invite. The token itself is never stored; the link is
//   `<staffOrigin>/invite/<token>`, shown once.
// - `DELETE /staff/v1/invites/:id` → 204 (404 when used, cancelled or unknown).
//
// The invitee's side (perm `public-invite`, no session; every step checks that the token's invite
// is unused, not cancelled and not expired, else 404 `invite-invalid`; only then does it spend the
// process-wide start or register budget, so made-up tokens cannot drain it for a real invitee):
// - `GET /staff/v1/invites/accept/:token` → `{ role, hours, expiresAt }`;
// - `POST …/:token/account { displayName, loginName }` → 201: the public name and the private login
//   name (FU-D), once (409 `wrong-state` after that). The account is created disabled: it cannot
//   log in until `finish`;
// - `POST …/:token/key/start { kind? }` → `{ options }`, challenge `inviteRegistrationChallenge(tokenHash)`
//   (default kind `security-key`, which must be attested; or `passkey`, PGP's partner for staff);
// - `POST …/:token/key/finish { kind?, response, label? }` → 201 `{ kind, keyCheckCode }`;
// - `POST …/:token/pgp/start { publicKey }` and `…/pgp/finish { challengeId, code }` → 201, from the
//   same browser (device cookie);
// - `POST …/:token/finish` → 201 `{ keyCheckCode }` (the first attested security key's, or null):
//   409 `security-key-required` for a senior or mod without an attested security key, 409
//   `two-factors-required` unless the account holds a staff login pair (PGP and a key or passkey,
//   or two PGP keys; spec 6.6); then the invite is used, the account enabled, the staff row
//   inserted and `staff.joined` logged, in one transaction.

/** An invite link works for 24 hours (spec 6.6). */
export const INVITE_TTL_MS = 24 * 3_600_000;
/** How far the owner's browser clock may run ahead when it sets the expiry. */
export const INVITE_CLOCK_SKEW_MS = 5 * 60_000;

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

/** Hex SHA-256 of the token text: what the owner's tap binds and the moderation gate re-derives. */
export const inviteTokenHash = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

const invalid = (): ApiError => new ApiError(404, 'invite-invalid');

interface OpenInvite {
  id: string;
  token_hash: string;
  role: InvitableRole;
  hours: unknown;
  expires_at: Date;
  account_id: string | null;
}

/** The open invite a token names (`lock`: `for update`, in a transaction); else 404 `invite-invalid`. */
async function openInvite(q: Queryable, token: unknown, now: Date, lock = false): Promise<OpenInvite> {
  if (typeof token !== 'string' || !TOKEN.test(token)) throw invalid();
  const { rows } = await q.query<OpenInvite>(
    `select id, token_hash, role, hours, expires_at, account_id from staff_invites
      where token_hash = $1 and used_at is null and cancelled_at is null and expires_at > $2
      ${lock ? 'for update' : ''}`,
    [inviteTokenHash(token), now],
  );
  if (!rows[0]) throw invalid();
  return rows[0];
}

const tokenOf = (req: FastifyRequest): unknown => (req.params as { token?: unknown }).token;

/** The invitee's account (picked at `account`); 409 `wrong-state` before that. */
function accountOfInvite(i: OpenInvite): string {
  if (i.account_id === null) throw new ApiError(409, 'wrong-state');
  return i.account_id;
}

/** The invite again, locked, with the same account, then the account row locked: every write's start. */
async function lockInvite(c: Queryable, req: FastifyRequest, accountId: string): Promise<OpenInvite> {
  const i = await openInvite(c, tokenOf(req), req.server.deps.clock(), true);
  if (i.account_id !== accountId) throw invalid();
  await lockAccount(c, accountId);
  return i;
}

function str(b: Record<string, unknown>, key: string): string {
  const v = b[key];
  if (typeof v !== 'string') throw new ApiError(400, 'bad-request');
  return v;
}

function credentialKind(v: unknown): CredentialKind {
  if (v === undefined) return 'security-key';
  if (v !== 'security-key' && v !== 'passkey') throw new ApiError(400, 'bad-request');
  return v;
}

/** The checked fields of a new invite; 400 `bad-request` otherwise. */
function newInviteOf(b: Record<string, unknown>, now: Date) {
  const role = roleOf(b.role);
  const hours = hoursOf(b.hours);
  const inviteId = typeof b.inviteId === 'string' && UUID.test(b.inviteId) ? b.inviteId.toLowerCase() : null;
  const token = typeof b.token === 'string' && TOKEN.test(b.token) && Buffer.from(b.token, 'base64url').length === 32 ? b.token : null;
  const expiresAt = typeof b.expiresAt === 'string' && ISO_UTC.test(b.expiresAt) ? b.expiresAt : null;
  const at = expiresAt === null ? NaN : Date.parse(expiresAt);
  if (inviteId === null || token === null || !Number.isFinite(at)) throw new ApiError(400, 'bad-request');
  if (at <= now.getTime() || at > now.getTime() + INVITE_TTL_MS + INVITE_CLOCK_SKEW_MS) throw new ApiError(400, 'bad-request');
  return { role, hours, inviteId, token, expiresAt: expiresAt!, at: new Date(at), tapId: tapIdOf(b) };
}

export function staffInviteRoutes(app: FastifyInstance): void {
  const perm = 'staff.manage' as const;
  const opts = { config: { perm }, preHandler: requireStaff(perm) };
  const pub = { config: { perm: 'public-invite' as const } };

  app.post('/staff/v1/invites', opts, async (req, reply) => {
    const { db, clock } = req.server.deps;
    const now = clock();
    const n = newInviteOf(body(req), now);
    const tokenHash = inviteTokenHash(n.token);
    await withTx(db, async (c) => {
      const tap = await consumeKeyTap(c, n.tapId, req.staff.accountId, { kind: 'create-invite', inviteId: n.inviteId, role: n.role, tokenHash, expiresAt: n.expiresAt }, now, { sessionId: req.auth.sessionId });
      const r = await c.query(
        `insert into staff_invites (id, token_hash, role, hours, created_by, created_at, expires_at, tap_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict do nothing`,
        [n.inviteId, tokenHash, n.role, JSON.stringify(n.hours), req.staff.accountId, now, n.at, tap.id],
      );
      if ((r.rowCount ?? 0) === 0) throw new ApiError(400, 'bad-request'); // the id or the token is taken
      await log(c, req, 'staff.invite-created', { inviteId: n.inviteId, role: n.role });
    });
    const origin = (req.server.deps as StaffDeps).staffOrigin;
    return reply.code(201).send({ inviteId: n.inviteId, link: `${origin}/invite/${n.token}`, expiresAt: n.at.toISOString() });
  });

  app.delete('/staff/v1/invites/:id', opts, async (req, reply) => {
    const id = idParam(req);
    const { db, clock } = req.server.deps;
    await withTx(db, async (c) => {
      const r = await c.query('update staff_invites set cancelled_at = $2 where id = $1 and used_at is null and cancelled_at is null', [id, clock()]);
      if ((r.rowCount ?? 0) === 0) throw new ApiError(404, 'not-found');
      await log(c, req, 'staff.invite-cancelled', { inviteId: id });
    });
    return reply.code(204).send();
  });

  // ------------------------------------------------------------------------------------------
  // The invitee

  app.get('/staff/v1/invites/accept/:token', pub, async (req) => {
    const i = await openInvite(req.server.deps.db, tokenOf(req), req.server.deps.clock());
    req.server.budgets.start.take();
    return { role: i.role, hours: i.hours, expiresAt: i.expires_at.toISOString() };
  });

  app.post('/staff/v1/invites/accept/:token/account', pub, async (req, reply) => {
    const deps = req.server.deps;
    const open = await openInvite(deps.db, tokenOf(req), deps.clock());
    if (open.account_id !== null) throw new ApiError(409, 'wrong-state');
    req.server.budgets.register.take();
    const b = body(req);
    const names = await assertNewNames(deps.db, b.displayName, b.loginName);
    const now = deps.clock();
    await withTx(deps.db, async (c) => {
      const i = await openInvite(c, tokenOf(req), now, true);
      if (i.account_id !== null) throw new ApiError(409, 'wrong-state');
      const accountId = await createAccount(c, deps.config, { ...names, kind: 'staff', termsVersion: null, now });
      // Disabled until `finish`: a half-made staff login can never log in.
      await c.query('update accounts set disabled_at = $2 where id = $1', [accountId, now]);
      await c.query('update staff_invites set account_id = $2 where id = $1', [i.id, accountId]);
    });
    return reply.code(201).send({ ok: true });
  });

  app.post('/staff/v1/invites/accept/:token/key/start', pub, async (req) => {
    const deps = req.server.deps;
    const i = await openInvite(deps.db, tokenOf(req), deps.clock());
    const accountId = accountOfInvite(i);
    req.server.budgets.start.take();
    const kind = credentialKind(body(req).kind);
    const options = await webauthnRegistrationOptions(deps, accountId, { kind, challenge: inviteRegistrationChallenge(i.token_hash) });
    return { options };
  });

  app.post('/staff/v1/invites/accept/:token/key/finish', pub, async (req, reply) => {
    const deps = req.server.deps;
    const i = await openInvite(deps.db, tokenOf(req), deps.clock());
    const accountId = accountOfInvite(i);
    req.server.budgets.register.take();
    const b = body(req);
    const kind = credentialKind(b.kind);
    const label = b.label === undefined ? undefined : str(b, 'label');
    const cred = await verifyWebAuthnRegistrationOnly(deps, accountId, b.response, inviteRegistrationChallenge(i.token_hash), {
      kind, ...(label !== undefined ? { label } : {}),
    });
    await withTx(deps.db, async (c) => {
      await lockInvite(c, req, accountId);
      await cred.store(c);
    });
    const attestedKey = cred.kind === 'security-key' && cred.attested;
    return reply.code(201).send({ kind: cred.kind, keyCheckCode: attestedKey ? keyCheckCode(cred.publicKey) : null });
  });

  app.post('/staff/v1/invites/accept/:token/pgp/start', { ...pub, bodyLimit: PGP_BODY_LIMIT }, async (req, reply) => {
    ensureDeviceCookie(req, reply);
    const deps = req.server.deps;
    const i = await openInvite(deps.db, tokenOf(req), deps.clock());
    const accountId = accountOfInvite(i);
    req.server.budgets.start.take();
    const publicKey = str(body(req), 'publicKey');
    const issued = await issueTeamJoinChallenge(deps, req, { accountId, publicKey, payload: { inviteId: i.id }, purpose: 'staff-join' });
    return { challengeId: issued.challengeId, encryptedMessage: issued.encryptedMessage, expiresAt: issued.expiresAt };
  });

  app.post('/staff/v1/invites/accept/:token/pgp/finish', pub, async (req, reply) => {
    ensureDeviceCookie(req, reply);
    const deps = req.server.deps;
    const i = await openInvite(deps.db, tokenOf(req), deps.clock());
    const accountId = accountOfInvite(i);
    req.server.budgets.register.take();
    const b = body(req);
    if (deviceHash(req) === null) throw new ApiError(400, 'challenge-expired');
    const proved = await checkTeamJoinCode(deps, req, str(b, 'challengeId'), str(b, 'code'), accountId, 'staff-join');
    if (proved.payload.inviteId !== i.id) throw new ApiError(400, 'challenge-expired');
    const now = deps.clock();
    await withTx(deps.db, async (c) => {
      await lockInvite(c, req, accountId);
      await insertPgpKey(c, deps.config, { accountId, fingerprint: proved.fingerprint, armored: proved.armored, now, proved: proved.proved });
    });
    return reply.code(201).send({ ok: true });
  });

  app.post('/staff/v1/invites/accept/:token/finish', pub, async (req, reply) => {
    const deps = req.server.deps;
    const now = deps.clock();
    const first = await openInvite(deps.db, tokenOf(req), now);
    const accountId = accountOfInvite(first);
    req.server.budgets.register.take();
    const code = await withTx(deps.db, async (c) => {
      const i = await lockInvite(c, req, accountId);
      const keys = await attestedKeyCount(c, accountId);
      const { rows } = await c.query<{ webauthn: number; pgp: number }>(
        `select (select count(*)::int from webauthn_credentials w
                  where w.account_id = $1 and ((w.kind = 'security-key' and w.attested) or w.kind = 'passkey')) as webauthn,
                (select count(*)::int from pgp_keys p where p.account_id = $1) as pgp`,
        [accountId],
      );
      const { webauthn, pgp } = rows[0]!;
      if ((i.role === 'mod' || i.role === 'senior') && keys === 0) throw new ApiError(409, 'security-key-required');
      if (!((pgp >= 1 && webauthn >= 1) || pgp >= 2)) throw new ApiError(409, 'two-factors-required');
      // Owner G3 (7 Nov): a moderator holds all three: a security key, a PGP key and a passkey.
      if (THREE_METHOD_ROLES.includes(i.role) && !(await holdsAllThree(c, accountId))) throw new ApiError(409, 'all-three-methods-required');
      await c.query('update staff_invites set used_at = $2 where id = $1', [i.id, now]);
      await c.query('update accounts set disabled_at = null where id = $1', [accountId]);
      await c.query(
        `insert into staff_members (account_id, role, hours, grants, has_security_key, switched_off_at, joined_at)
         values ($1, $2, $3, '{}', $4, null, $5)`,
        [accountId, i.role, JSON.stringify(i.hours), keys > 0, now],
      );
      const { rows: k } = await c.query<{ public_key: Buffer }>(
        `select public_key from webauthn_credentials where account_id = $1 and kind = 'security-key' and attested order by created_at, id limit 1`,
        [accountId],
      );
      await appendLog(c, {
        at: now, actor: { kind: 'staff', id: accountId, role: i.role }, tradeCode: null, action: 'staff.joined', detail: { staffId: accountId, role: i.role },
      });
      return k[0] ? keyCheckCode(new Uint8Array(k[0].public_key)) : null;
    });
    return reply.code(201).send({ keyCheckCode: code });
  });
}
