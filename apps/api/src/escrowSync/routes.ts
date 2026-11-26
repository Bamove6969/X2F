/**
 * Escrow-key sync (Plan 3 Task 42, first part; migration 860). Owner 26 Nov 2026: "The keys should
 * be stored on our servers but encrypted and accessible only to the person they are assigned to
 * and the person who they are assigned to also assigns them to."
 *
 * What the browser does (apps/web/src/escrow/keySync.ts):
 * - Each person who may read keys has a reader key (X25519). Its secret leaves the browser only
 *   inside unlock envelopes: AES-256-GCM under HKDF(WebAuthn PRF output) of one of their passkeys
 *   or security keys (`prf`), or an OpenPGP message to their own PGP public key (`pgp`; decrypted
 *   in their own tool, the API never sees a private PGP key, R8). An authenticator (TOTP) code can
 *   never unlock: it makes no key, and the database refuses any other method.
 * - On every write of a trade's local escrow record, the holder's device encrypts the record and
 *   its wallet password under a fresh 32-byte content key, and seals that key (crypto_box_seal) to
 *   each reader: its own reader key and each assigned member's. Only ciphertext reaches the API.
 *
 * What the API checks (it can open nothing here; no server-held key, no key escrow):
 * - Readers: the account holder, and members the holder assigned. The assignment IS the member's
 *   `trades-escrow-keys` box ("Hold trade keys", team/abilities.ts row 67), set through the usual
 *   confirmed PATCH /v1/team/members/:id; unticking it deletes the member's wraps (members.ts).
 * - Only the holder's own session writes or deletes a trade's copy, and only for the account's
 *   own trades; a wrap may only go to the holder's reader or to a live member holding the box.
 * - Each reader reads only its own wrap. A member's read needs the box (requireSession `member`).
 * - The box grants no signing: `member-cannot-sign` (team/perms.ts) is unchanged. Whether an
 *   assigned member may release with the key is the owner's open question 'trades-release'
 *   (conservative default: no; row 22 stays owner-only, hard).
 *
 * Routes (JSON; bytes are base64url, the reader public key 64 lower-case hex):
 * - `GET /v1/escrow-keys/reader` → the caller's own reader `{ id, publicKey, unlocks: [{ id, method,
 *   ref, salt, envelope }] }`, or 404 `not-found` before one is registered.
 * - `PUT /v1/escrow-keys/reader { publicKey, unlocks }` → `{ id }`. Registers or replaces the
 *   caller's reader key and its unlock envelopes (1 to MAX_UNLOCKS). A new public key drops every
 *   wrap sealed to the old one (they would not open).
 * - `GET /v1/escrow-keys/readers` → the holder only: `{ readers: [{ id, memberId, memberName,
 *   publicKey }] }`, the holder's own reader and each live, assigned member's: whom to seal to.
 * - `GET /v1/escrow-keys/trades` → `{ trades: [{ code, version, updatedAt }] }`: the copies sealed
 *   to the caller's reader.
 * - `GET /v1/escrow-keys/trades/:code` → `{ code, version, ciphertext, wrapped, updatedAt }` with the
 *   caller's own wrap only; 404 `not-found` when none is sealed to the caller.
 * - `PUT /v1/escrow-keys/trades/:code { version, ciphertext, wraps: [{ readerId, wrapped }] }` →
 *   `{ version }`. The holder only. `version` must be above the stored one (409 `stale-version`
 *   `{ version }`). `wraps` must include the holder's own reader (400 `holder-wrap-missing`); any
 *   other reader must be an assigned member's (400 `reader-not-assigned`). Replaces every wrap.
 * - `DELETE /v1/escrow-keys/trades/:code` → 204 (also when there was none). The holder only.
 * - `GET /v1/escrow-keys/unlock-methods` → `{ keys: [{ kind, label, credentialId }], pgp: [{
 *   fingerprint, label, publicKey }] }`: the caller's own passkeys and security keys (the credential
 *   id, base64url, to ask the authenticator for its PRF output) and own PGP public keys (armored, to
 *   encrypt an unlock envelope to). The person's own login methods (a member's are their own
 *   login's); never an authenticator app (TOTP), which makes no key. Whether a passkey or security
 *   key supports PRF is not stored: the browser finds out when it asks (keySync.ts `no-prf`).
 */
import { normalizeTradeCode } from '@x2f/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withTx } from '../auth/liveSession.js';
import { openKey } from '../auth/pgp.js';
import { personAccountId, requireSession } from '../auth/sessions.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { ESCROW_KEYS_ABILITY } from './store.js';

export const ESCROW_SYNC_ROUTES = [
  'GET /v1/escrow-keys/reader',
  'PUT /v1/escrow-keys/reader',
  'GET /v1/escrow-keys/readers',
  'GET /v1/escrow-keys/trades',
  'GET /v1/escrow-keys/trades/:code',
  'PUT /v1/escrow-keys/trades/:code',
  'DELETE /v1/escrow-keys/trades/:code',
  'GET /v1/escrow-keys/unlock-methods',
] as const;

/** The only unlock methods: a passkey or security key's PRF output, or the person's PGP key. Never TOTP. */
export const UNLOCK_METHODS = ['prf', 'pgp'] as const;
export type UnlockMethod = (typeof UNLOCK_METHODS)[number];
/** Engineering default: unlock envelopes per reader (one per passkey, key or PGP key). */
export const MAX_UNLOCKS = 10;
/** Engineering defaults matching migration 860's checks. */
export const CIPHERTEXT_MAX_BYTES = 262_144;
export const ENVELOPE_MAX_BYTES = 16_384;
/** The holder's readers: itself and up to MAX_TEAM_MEMBERS members; a little room on top. */
const MAX_WRAPS = 8;

const HEX_KEY = /^[0-9a-f]{64}$/;
const B64URL = /^[A-Za-z0-9_-]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function exactKeys(o: Record<string, unknown>, keys: readonly string[], optional: readonly string[] = []): void {
  const got = Object.keys(o);
  for (const k of keys) if (!got.includes(k)) throw new ApiError(400, 'bad-request');
  for (const k of got) if (!keys.includes(k) && !optional.includes(k)) throw new ApiError(400, 'bad-request');
}

function bytes(v: unknown, min: number, max: number): Buffer {
  if (typeof v !== 'string' || !B64URL.test(v) || v.length > Math.ceil((max * 4) / 3) + 4) throw new ApiError(400, 'bad-request');
  const b = Buffer.from(v, 'base64url');
  if (b.length < min || b.length > max || b.toString('base64url') !== v) throw new ApiError(400, 'bad-request');
  return b;
}

const b64 = (b: Buffer): string => b.toString('base64url');

function codeOf(req: FastifyRequest): string {
  const raw = (req.params as { code?: unknown }).code;
  const code = typeof raw === 'string' ? normalizeTradeCode(raw) : null;
  if (code === null) throw new ApiError(404, 'not-found');
  return code;
}

interface Unlock {
  method: UnlockMethod;
  ref: string;
  salt: Buffer | null;
  envelope: Buffer;
}

function parseUnlock(raw: unknown): Unlock {
  if (!isObject(raw)) throw new ApiError(400, 'bad-request');
  exactKeys(raw, ['method', 'ref', 'envelope'], ['salt']);
  const { method, ref } = raw;
  // An authenticator code (or any other way) is refused by name: it makes no key.
  if (typeof method !== 'string' || !(UNLOCK_METHODS as readonly string[]).includes(method)) throw new ApiError(400, 'unlock-method-not-allowed');
  if (typeof ref !== 'string' || ref.length < 1 || ref.length > 512 || /[\p{Cc}]/u.test(ref)) throw new ApiError(400, 'bad-request');
  const salt = method === 'prf' ? bytes(raw.salt, 32, 32) : raw.salt === undefined || raw.salt === null ? null : (() => { throw new ApiError(400, 'bad-request'); })();
  return { method: method as UnlockMethod, ref, salt, envelope: bytes(raw.envelope, 28, ENVELOPE_MAX_BYTES) };
}

interface ReaderRow {
  id: string;
  public_key: Buffer;
}

async function ownReader(db: Queryable, req: FastifyRequest): Promise<ReaderRow | null> {
  const { rows } = await db.query<ReaderRow>(
    req.auth.memberId === null
      ? 'select id, public_key from escrow_readers where account_id = $1 and member_id is null'
      : 'select id, public_key from escrow_readers where account_id = $1 and member_id = $2',
    req.auth.memberId === null ? [req.auth.accountId] : [req.auth.accountId, req.auth.memberId],
  );
  return rows[0] ?? null;
}

/** The holder's reader and every live member's who holds the box: the readers a trade may be sealed to. */
async function allowedReaders(db: Queryable, accountId: string): Promise<{ id: string; member_id: string | null; trade_tag: string | null; public_key: Buffer }[]> {
  const { rows } = await db.query<{ id: string; member_id: string | null; trade_tag: string | null; public_key: Buffer }>(
    `select r.id, r.member_id, m.trade_tag, r.public_key
       from escrow_readers r left join team_members m on m.id = r.member_id
      where r.account_id = $1
        and (r.member_id is null
             or (m.account_id = $1 and m.joined_at is not null and m.removed_at is null and $2 = any (m.abilities)))
      order by r.member_id nulls first, r.created_at`,
    [accountId, ESCROW_KEYS_ABILITY],
  );
  return rows;
}

export function escrowSyncRoutes(app: FastifyInstance): void {
  // Readers: the holder, and members holding "Hold trade keys" (the holder's assignment).
  const reader = requireSession({ kinds: ['trader'], member: ESCROW_KEYS_ABILITY });
  // Writers: the holder's own session only (a member's gets 403 owner-only).
  const holder = requireSession({ kinds: ['trader'] });

  app.get('/v1/escrow-keys/reader', { preHandler: reader }, async (req) => {
    const db = req.server.deps.db;
    const r = await ownReader(db, req);
    if (r === null) throw new ApiError(404, 'not-found');
    const { rows } = await db.query<{ id: string; method: UnlockMethod; ref: string; salt: Buffer | null; envelope: Buffer }>(
      'select id, method, ref, salt, envelope from escrow_reader_unlocks where reader_id = $1 order by position',
      [r.id],
    );
    return {
      id: r.id,
      publicKey: r.public_key.toString('hex'),
      unlocks: rows.map((u) => ({ id: u.id, method: u.method, ref: u.ref, salt: u.salt === null ? null : b64(u.salt), envelope: b64(u.envelope) })),
    };
  });

  app.put('/v1/escrow-keys/reader', { preHandler: reader }, async (req) => {
    const b = req.body;
    if (!isObject(b)) throw new ApiError(400, 'bad-request');
    exactKeys(b, ['publicKey', 'unlocks']);
    if (typeof b.publicKey !== 'string' || !HEX_KEY.test(b.publicKey)) throw new ApiError(400, 'bad-request');
    if (!Array.isArray(b.unlocks) || b.unlocks.length < 1 || b.unlocks.length > MAX_UNLOCKS) throw new ApiError(400, 'bad-request');
    const unlocks = b.unlocks.map(parseUnlock);
    if (new Set(unlocks.map((u) => `${u.method}\0${u.ref}`)).size !== unlocks.length) throw new ApiError(400, 'bad-request');
    const publicKey = Buffer.from(b.publicKey, 'hex');
    const deps = req.server.deps;
    const now = deps.clock();
    const id = await withTx(deps.db, async (c) => {
      // One writer per account at a time (the holder's and its members' readers alike).
      await c.query('select 1 from accounts where id = $1 for update', [req.auth.accountId]);
      let r = await ownReader(c, req);
      if (r === null) {
        const ins = await c.query<ReaderRow>(
          'insert into escrow_readers (account_id, member_id, public_key, created_at, updated_at) values ($1, $2, $3, $4, $4) returning id, public_key',
          [req.auth.accountId, req.auth.memberId, publicKey, now],
        );
        r = ins.rows[0]!;
      } else if (!r.public_key.equals(publicKey)) {
        // A new reader key: what was sealed to the old one would not open; the holder's device seals again.
        await c.query('delete from escrow_blob_wraps where reader_id = $1', [r.id]);
        await c.query('update escrow_readers set public_key = $2, updated_at = $3 where id = $1', [r.id, publicKey, now]);
      } else {
        await c.query('update escrow_readers set updated_at = $2 where id = $1', [r.id, now]);
      }
      await c.query('delete from escrow_reader_unlocks where reader_id = $1', [r.id]);
      for (const [i, u] of unlocks.entries()) {
        await c.query('insert into escrow_reader_unlocks (reader_id, method, ref, salt, envelope, created_at, position) values ($1, $2, $3, $4, $5, $6, $7)', [r.id, u.method, u.ref, u.salt, u.envelope, now, i]);
      }
      return r.id;
    });
    return { id };
  });

  app.get('/v1/escrow-keys/readers', { preHandler: holder }, async (req) => {
    const rows = await allowedReaders(req.server.deps.db, req.auth.accountId);
    return { readers: rows.map((r) => ({ id: r.id, memberId: r.member_id, memberName: r.trade_tag, publicKey: r.public_key.toString('hex') })) };
  });

  app.get('/v1/escrow-keys/trades', { preHandler: reader }, async (req) => {
    const db = req.server.deps.db;
    const r = await ownReader(db, req);
    if (r === null) return { trades: [] };
    const { rows } = await db.query<{ trade_code: string; version: string; updated_at: Date }>(
      `select b.trade_code, b.version, b.updated_at from escrow_blobs b
         join escrow_blob_wraps w on w.account_id = b.account_id and w.trade_code = b.trade_code and w.reader_id = $2
        where b.account_id = $1 order by b.updated_at, b.trade_code`,
      [req.auth.accountId, r.id],
    );
    return { trades: rows.map((x) => ({ code: x.trade_code, version: Number(x.version), updatedAt: x.updated_at.toISOString() })) };
  });

  app.get('/v1/escrow-keys/trades/:code', { preHandler: reader }, async (req) => {
    const code = codeOf(req);
    const db = req.server.deps.db;
    const r = await ownReader(db, req);
    if (r === null) throw new ApiError(404, 'not-found');
    const { rows } = await db.query<{ ciphertext: Buffer; version: string; updated_at: Date; wrapped: Buffer }>(
      `select b.ciphertext, b.version, b.updated_at, w.wrapped from escrow_blobs b
         join escrow_blob_wraps w on w.account_id = b.account_id and w.trade_code = b.trade_code and w.reader_id = $3
        where b.account_id = $1 and b.trade_code = $2`,
      [req.auth.accountId, code, r.id],
    );
    const x = rows[0];
    if (!x) throw new ApiError(404, 'not-found');
    return { code, version: Number(x.version), ciphertext: b64(x.ciphertext), wrapped: b64(x.wrapped), updatedAt: x.updated_at.toISOString() };
  });

  app.put('/v1/escrow-keys/trades/:code', { preHandler: holder, bodyLimit: CIPHERTEXT_MAX_BYTES * 2 }, async (req) => {
    const code = codeOf(req);
    const b = req.body;
    if (!isObject(b)) throw new ApiError(400, 'bad-request');
    exactKeys(b, ['version', 'ciphertext', 'wraps']);
    const { version } = b;
    if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) throw new ApiError(400, 'bad-request');
    const ciphertext = bytes(b.ciphertext, 28, CIPHERTEXT_MAX_BYTES);
    if (!Array.isArray(b.wraps) || b.wraps.length < 1 || b.wraps.length > MAX_WRAPS) throw new ApiError(400, 'bad-request');
    const wraps = b.wraps.map((w: unknown) => {
      if (!isObject(w)) throw new ApiError(400, 'bad-request');
      exactKeys(w, ['readerId', 'wrapped']);
      if (typeof w.readerId !== 'string' || !UUID.test(w.readerId)) throw new ApiError(400, 'bad-request');
      return { readerId: w.readerId.toLowerCase(), wrapped: bytes(w.wrapped, 80, 80) };
    });
    if (new Set(wraps.map((w) => w.readerId)).size !== wraps.length) throw new ApiError(400, 'bad-request');
    const deps = req.server.deps;
    const now = deps.clock();
    return withTx(deps.db, async (c) => {
      await c.query('select 1 from accounts where id = $1 for update', [req.auth.accountId]);
      // Only the account's own trades, open or within the keep after their close.
      const t = await c.query('select 1 from trades where code = $1 and (seller_account_id = $2 or buyer_account_id = $2)', [code, req.auth.accountId]);
      if (t.rows.length === 0) throw new ApiError(404, 'not-found');
      const allowed = await allowedReaders(c, req.auth.accountId);
      const holderReader = allowed.find((r) => r.member_id === null);
      if (holderReader === undefined || !wraps.some((w) => w.readerId === holderReader.id)) throw new ApiError(400, 'holder-wrap-missing');
      for (const w of wraps) if (!allowed.some((r) => r.id === w.readerId)) throw new ApiError(400, 'reader-not-assigned');
      const prev = await c.query<{ version: string }>('select version from escrow_blobs where account_id = $1 and trade_code = $2', [req.auth.accountId, code]);
      const had = prev.rows[0] ? Number(prev.rows[0].version) : 0;
      if (version <= had) throw new ApiError(409, 'stale-version', { version: had });
      await c.query(
        `insert into escrow_blobs (account_id, trade_code, ciphertext, version, updated_at) values ($1, $2, $3, $4, $5)
         on conflict (account_id, trade_code) do update set ciphertext = excluded.ciphertext, version = excluded.version, updated_at = excluded.updated_at`,
        [req.auth.accountId, code, ciphertext, version, now],
      );
      await c.query('delete from escrow_blob_wraps where account_id = $1 and trade_code = $2', [req.auth.accountId, code]);
      for (const w of wraps) {
        await c.query('insert into escrow_blob_wraps (account_id, trade_code, reader_id, wrapped) values ($1, $2, $3, $4)', [req.auth.accountId, code, w.readerId, w.wrapped]);
      }
      return { version };
    });
  });

  app.get('/v1/escrow-keys/unlock-methods', { preHandler: reader }, async (req) => {
    const deps = req.server.deps;
    const person = await personAccountId(deps.db, req.auth);
    const creds = await deps.db.query<{ kind: 'passkey' | 'security-key'; label: string; credential_id: Buffer }>(
      'select kind, label, credential_id from webauthn_credentials where account_id = $1 order by created_at, id',
      [person],
    );
    const pgp = await deps.db.query<{ fingerprint: string; armored_enc: Buffer }>(
      'select fingerprint, armored_enc from pgp_keys where account_id = $1 order by created_at, id',
      [person],
    );
    return {
      keys: creds.rows.map((c) => ({ kind: c.kind, label: c.label, credentialId: b64(c.credential_id) })),
      pgp: pgp.rows.map((k) => ({
        fingerprint: k.fingerprint.toUpperCase(),
        label: k.fingerprint.slice(-16),
        publicKey: openKey(deps.config, k.armored_enc, k.fingerprint),
      })),
    };
  });

  app.delete('/v1/escrow-keys/trades/:code', { preHandler: holder }, async (req, reply) => {
    const code = codeOf(req);
    await req.server.deps.db.query('delete from escrow_blobs where account_id = $1 and trade_code = $2', [req.auth.accountId, code]);
    return reply.code(204).send();
  });
}
