/**
 * Chat-key envelopes (J-23, S-075, phase 1 groundwork; docs/security/multi-device-2026-11-09.md
 * sections 3.1, 4.2 and 6.1): the courier between a person's own devices for the account chat key.
 *
 * - A device that holds the account chat key seals it (`crypto_box_seal`, @x2f/protocol `sealTo`)
 *   to another device's X25519 public key and posts the box here; the receiving device fetches it
 *   over its own session and opens it with its device secret. The API stores and serves the sealed
 *   bytes exactly as posted and can open nothing (it holds no chat secret).
 * - **Strong to strong, strictly** (section 3.1 rule 2): both the posting and the reading session
 *   must have `sessions.strength = 'strong'` as stored at login (`loginStrength`), not merely "not
 *   weak" (`weakOf` lets a sign-up's first 30 minutes through, which is right for logging out and
 *   wrong for handing over keys). Anything else is 403 `weak-session`. The approval view's
 *   `keysOffered` (approval.ts) is the same rule applied to the new login and its approver.
 * - Never during an account hold (403 `recovery-hold`, checked under the account lock, for the
 *   listing too: review F3), never a
 *   recovery session or a team member's session (`requireSession`: full trader sessions, the
 *   account owner only; section 3.1 rule 4).
 * - `POST /v1/account/chat-keys { recipientPublic, sealed, epoch }` → 201 `{ id, expiresAt }`.
 *   `recipientPublic` is 64 lower-case hex; `sealed` is base64url of 48 to 1024 bytes; `epoch` must
 *   be the account's current `chat_key_epoch` (400 `bad-request` with the current one otherwise).
 *   An open envelope to the same recipient is superseded; at most `MAX_OPEN_CHAT_KEY_ENVELOPES` are
 *   open per account (the oldest expire); each is open for `CHAT_KEY_ENVELOPE_TTL_MS`. Expired and
 *   collected rows of the account are deleted on the way.
 * - `GET /v1/account/chat-keys` → `{ epoch, envelopes: [{ id, recipientPublic, sealed, epoch,
 *   createdAt, expiresAt }] }`: the account's open envelopes (uncollected, unexpired), oldest first.
 *   Which device each box is for is the recipient key; a box sealed to another device is ciphertext
 *   to this one.
 * - `DELETE /v1/account/chat-keys/:id` → 204: the receiving device marks the envelope collected,
 *   after which it is served to no one; 404 `not-found` for an unknown, collected or expired id,
 *   or another account's.
 * - Classified in hold.ts (`LIVE_SESSION_ROUTES`, `HOLD_BLOCKED_ROUTES`, `WEAK_LIMITED_ROUTES`) and
 *   in the front door's own-data lists (frontDoor.ts). Nothing here logs a key or a ciphertext.
 *
 * Not here yet (waits for owner p12-5 and the boards): binding an envelope to a login approval and
 * the new device's key commit (the short-authentication-string flow, section 3.3), the identity
 * records sealed under the key (4.2 rule 2), rotation on removal (4.3, owner question 6).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { holdInTx, holdRefusal, requireLiveSessionInTx, settleOf, weakRefusal, withTx, type LiveSession } from './hold.js';
import { requireSession } from './sessions.js';
import type { LoginStrength } from './strength.js';

/** How long a posted envelope waits to be collected. */
export const CHAT_KEY_ENVELOPE_TTL_MS = 10 * 60_000;
/** Open envelopes per account; a new one beyond this expires the oldest. */
export const MAX_OPEN_CHAT_KEY_ENVELOPES = 10;
/** The sealed box's size bounds in bytes: `crypto_box_seal`'s 48-byte overhead alone, up to the table's cap. */
export const SEALED_MIN_BYTES = 48;
export const SEALED_MAX_BYTES = 1024;

const HEX_KEY = /^[0-9a-f]{64}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BODY_KEYS = ['recipientPublic', 'sealed', 'epoch'] as const;

/**
 * The one rule of the handover (section 3.1 rule 2), for a stored strength: `'strong'` exactly.
 * Null (a session from before migration 014) and `'weak-single'` are not. Used for both ends: the
 * new login's strength on its approval row and the approving or reading session's own.
 */
export const strongForKeys = (s: LoginStrength | null | undefined): boolean => s === 'strong';

/** Both sides strong, strictly: whether a chat-key handover may be offered at all (approval.ts `keysOffered`). */
export const keysOffered = (newLogin: LoginStrength | null | undefined, approver: LoginStrength | null | undefined): boolean =>
  strongForKeys(newLogin) && strongForKeys(approver);

export interface ChatKeyEnvelopeView {
  id: string;
  /** The receiving device's X25519 public key, 64 lower-case hex. */
  recipientPublic: string;
  /** The sealed box, base64url, exactly as posted. */
  sealed: string;
  epoch: number;
  createdAt: string;
  expiresAt: string;
}

interface EnvelopeRow {
  id: string;
  recipient_public: Buffer;
  sealed: Buffer;
  epoch: number;
  created_at: Date;
  expires_at: Date;
}

const view = (r: EnvelopeRow): ChatKeyEnvelopeView => ({
  id: r.id,
  recipientPublic: r.recipient_public.toString('hex'),
  sealed: r.sealed.toString('base64url'),
  epoch: r.epoch,
  createdAt: r.created_at.toISOString(),
  expiresAt: r.expires_at.toISOString(),
});

function postBody(raw: unknown): { recipientPublic: Buffer; sealed: Buffer; epoch: number } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ApiError(400, 'bad-request');
  const b = raw as Record<string, unknown>;
  const keys = Object.keys(b);
  if (keys.length !== BODY_KEYS.length || !BODY_KEYS.every((k) => keys.includes(k))) throw new ApiError(400, 'bad-request');
  const { recipientPublic, sealed, epoch } = b;
  if (typeof recipientPublic !== 'string' || !HEX_KEY.test(recipientPublic)) throw new ApiError(400, 'bad-request');
  // base64url of 48..1024 bytes is 64..1366 characters; the decoded length is checked exactly.
  if (typeof sealed !== 'string' || sealed.length < 64 || sealed.length > 1366 || !B64URL.test(sealed)) throw new ApiError(400, 'bad-request');
  const bytes = Buffer.from(sealed, 'base64url');
  if (bytes.length < SEALED_MIN_BYTES || bytes.length > SEALED_MAX_BYTES || bytes.toString('base64url') !== sealed) throw new ApiError(400, 'bad-request');
  if (typeof epoch !== 'number' || !Number.isInteger(epoch) || epoch < 0 || epoch > 2_147_483_647) throw new ApiError(400, 'bad-request');
  return { recipientPublic: Buffer.from(recipientPublic, 'hex'), sealed: bytes, epoch };
}

/**
 * Deletes every chat-key envelope of the account, inside the caller's transaction (lead 10 Nov,
 * J-23): every account close calls it (the tripwire in test/chatKeys.test.ts scans for it). A
 * close that deletes the account row needs nothing more (the rows cascade).
 */
export async function eraseChatKeyEnvelopes(db: Queryable, accountId: string): Promise<void> {
  await db.query('delete from chat_key_envelopes where account_id = $1', [accountId]);
}

/** The account's current chat-key epoch. */
async function epochOf(db: Queryable, accountId: string): Promise<number> {
  const { rows } = await db.query<{ chat_key_epoch: number }>('select chat_key_epoch from accounts where id = $1', [accountId]);
  return rows[0]?.chat_key_epoch ?? 0;
}

/** Inside a write's transaction: the live caller under the account lock, strong strictly, and no hold running. */
async function strongCallerInTx(db: Queryable, req: FastifyRequest, now: Date): Promise<LiveSession> {
  const caller = await requireLiveSessionInTx(db, req.auth, now);
  if (!strongForKeys(caller.strength)) throw weakRefusal();
  const hold = await holdInTx(db, settleOf(req), req.auth.accountId, now);
  if (hold !== null) throw holdRefusal(hold.holdUntil);
  return caller;
}

export function chatKeyRoutes(app: FastifyInstance): void {
  // Full trader sessions of the account owner only: no recovery session, no team member (the default).
  const trader = requireSession({ kinds: ['trader'] });

  app.get('/v1/account/chat-keys', { preHandler: trader }, async (req) => {
    const deps = req.server.deps;
    const now = deps.clock();
    const { accountId } = req.auth;
    // Review F3: the listing hands the boxes over, so it is checked as the writes are: the live
    // caller under the account lock, strong strictly, and never during an account hold.
    return withTx(deps.db, async (db) => {
      await strongCallerInTx(db, req, now);
      const { rows } = await db.query<EnvelopeRow>(
        `select id, recipient_public, sealed, epoch, created_at, expires_at from chat_key_envelopes
          where account_id = $1 and collected_at is null and expires_at > $2 order by created_at, id`,
        [accountId, now],
      );
      return { epoch: await epochOf(db, accountId), envelopes: rows.map(view) };
    });
  });

  app.post('/v1/account/chat-keys', { preHandler: trader }, async (req, reply) => {
    const deps = req.server.deps;
    const body = postBody(req.body);
    const now = deps.clock();
    const { accountId, sessionId } = req.auth;
    const out = await withTx(deps.db, async (db) => {
      await strongCallerInTx(db, req, now);
      const epoch = await epochOf(db, accountId);
      if (body.epoch !== epoch) throw new ApiError(400, 'bad-request', { epoch });
      // Housekeeping for this account: what was collected or ran out is gone.
      await db.query('delete from chat_key_envelopes where account_id = $1 and (collected_at is not null or expires_at <= $2)', [accountId, now]);
      // A newer box to the same device replaces the open one.
      await db.query(
        'update chat_key_envelopes set expires_at = $3 where account_id = $1 and recipient_public = $2 and collected_at is null and expires_at > $3',
        [accountId, body.recipientPublic, now],
      );
      await db.query(
        `update chat_key_envelopes set expires_at = $2
          where id in (select id from chat_key_envelopes where account_id = $1 and collected_at is null and expires_at > $2
                        order by created_at desc, id desc offset $3)`,
        [accountId, now, MAX_OPEN_CHAT_KEY_ENVELOPES - 1],
      );
      const expiresAt = new Date(now.getTime() + CHAT_KEY_ENVELOPE_TTL_MS);
      const ins = await db.query<{ id: string }>(
        `insert into chat_key_envelopes (account_id, recipient_public, sealed, epoch, created_by, created_at, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [accountId, body.recipientPublic, body.sealed, body.epoch, sessionId, now, expiresAt],
      );
      return { id: ins.rows[0]!.id, expiresAt: expiresAt.toISOString() };
    });
    return reply.code(201).send(out);
  });

  app.delete('/v1/account/chat-keys/:id', { preHandler: trader }, async (req, reply) => {
    const deps = req.server.deps;
    const id = (req.params as { id?: unknown }).id;
    if (typeof id !== 'string' || !UUID.test(id)) throw new ApiError(404, 'not-found');
    const now = deps.clock();
    const { accountId } = req.auth;
    await withTx(deps.db, async (db) => {
      await strongCallerInTx(db, req, now);
      const { rowCount } = await db.query(
        'update chat_key_envelopes set collected_at = $3 where id = $1 and account_id = $2 and collected_at is null and expires_at > $3',
        [id.toLowerCase(), accountId, now],
      );
      if (rowCount === 0) throw new ApiError(404, 'not-found');
    });
    return reply.code(204).send();
  });
}
