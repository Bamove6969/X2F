import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { normalizeLoginCode } from '@x2f/accounts';
import { keyCheckCode } from '@x2f/staff';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { assertNewNames, createAccount } from '../accounts.js';
import type { Deps } from '../app.js';
import { consumeChallenge } from '../auth/challenges.js';
import { COOKIE_ATTRS, ensureDeviceCookie } from '../auth/device.js';
import { withTx } from '../auth/hold.js';
import { ownerReady } from '../auth/methods.js';
import { checkTeamJoinCode, insertPgpKey, issueTeamJoinChallenge, PGP_BODY_LIMIT } from '../auth/pgp.js';
import { openSession } from '../auth/sessions.js';
import { verifyWebAuthnRegistrationOnly, webauthnRegistrationOptions, WEBAUTHN_TTL_MS } from '../auth/webauthn.js';
import { subkey } from '../config.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { appendLog } from '../log/append.js';

/** Global tries of the setup code per rolling hour (Plan 4 Task 6); the 11th is 429 `slow-down`. */
export const SETUP_TRIES_PER_HOUR = 10;
const HOUR_MS = 3600_000;
/** How long the pre-auth setup cookie lasts after a correct code. */
export const SETUP_SESSION_MS = 30 * 60_000;
export const SETUP_COOKIE = '__Host-x2f_setup';
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PUBLIC_SETUP = { perm: 'public-setup' } as const;

const sha256 = (s: string | Buffer): Buffer => createHash('sha256').update(s).digest();

/**
 * The setup code for `salt`: HMAC-SHA256 under the server key's `owner-setup` subkey, its first 12
 * bytes mapped to Crockford base32 (`newLoginCode`'s format, `XXXX-XXXX-XXXX`). Derived, so a
 * restart prints the same code while the database holds only its hash and the salt.
 */
function deriveCode(config: Deps['config'], salt: Buffer): string {
  const mac = createHmac('sha256', subkey(config, 'owner-setup')).update(salt).digest();
  let raw = '';
  for (let i = 0; i < 12; i++) raw += CODE_ALPHABET[mac[i]! & 0x1f];
  return normalizeLoginCode(raw)!;
}

interface SetupRow {
  code_hash: Buffer;
  code_salt: Buffer;
  locked_at: Date | null;
}

async function activeOwnerExists(q: Queryable): Promise<boolean> {
  const { rows } = await q.query("select 1 from accounts where kind = 'owner' and disabled_at is null");
  return rows.length > 0;
}

/**
 * `ensureSetupCode` (Plan 4 Task 6): while no owner has finished setup and the page is not locked,
 * the setup code (creating it on the first call); otherwise null. The same code comes back on
 * every call and restart until setup finishes (a new one only if the server key changed). Only its
 * SHA-256 and the salt it is derived from are stored. The caller prints it (staff/main.ts, to
 * stderr only); nothing here logs it.
 */
export async function ensureSetupCode(deps: Pick<Deps, 'db' | 'config' | 'clock'>): Promise<string | null> {
  if (await activeOwnerExists(deps.db)) return null;
  let { rows } = await deps.db.query<SetupRow>('select code_hash, code_salt, locked_at from owner_setup where id = 1');
  if (rows.length === 0) {
    const salt = randomBytes(32);
    await deps.db.query('insert into owner_setup (id, code_hash, code_salt, created_at) values (1, $1, $2, $3) on conflict (id) do nothing', [
      sha256(deriveCode(deps.config, salt)), salt, deps.clock(),
    ]);
    ({ rows } = await deps.db.query<SetupRow>('select code_hash, code_salt, locked_at from owner_setup where id = 1'));
  }
  const row = rows[0]!;
  if (row.locked_at !== null) return null;
  const code = deriveCode(deps.config, row.code_salt);
  if (sha256(code).equals(row.code_hash)) return code;
  // The server key changed since the code was made: a new salt, so a new code.
  const salt = randomBytes(32);
  const fresh = deriveCode(deps.config, salt);
  const r = await deps.db.query('update owner_setup set code_hash = $1, code_salt = $2 where id = 1 and locked_at is null', [sha256(fresh), salt]);
  return (r.rowCount ?? 0) > 0 ? fresh : null;
}

/** The line `staff/main.ts` writes to stderr, the only place a setup code is ever shown. */
export const setupCodeLine = (code: string): string => `X2F owner setup code: ${code} (valid until the owner account is created)\n`;

// ---------------------------------------------------------------------------------------------
// Routes

const locked = (): ApiError => new ApiError(404, 'setup-locked');

/**
 * 404 `setup-locked` unless setup is open: the row exists, `locked_at` is unset and no owner is
 * live. With `lock`, takes the row lock (inside a transaction) so that setup writes serialise.
 */
async function assertOpen(q: Queryable, lock = false): Promise<SetupRow> {
  const { rows } = await q.query<SetupRow>(`select code_hash, code_salt, locked_at from owner_setup where id = 1${lock ? ' for update' : ''}`);
  const row = rows[0];
  if (!row || row.locked_at !== null || (await activeOwnerExists(q))) throw locked();
  return row;
}

interface SetupSession {
  id: string;
  ownerId: string | null;
}

/** The setup session the browser's setup cookie names (unused, unexpired), else 401 `not-authenticated`. */
async function setupSession(q: Queryable, req: FastifyRequest): Promise<SetupSession> {
  const token = req.cookies[SETUP_COOKIE];
  if (typeof token !== 'string' || token === '') throw new ApiError(401, 'not-authenticated');
  const { rows } = await q.query<{ id: string; account_id: string | null }>(
    `select id, account_id from challenges
      where purpose = 'owner-setup-session' and method = 'pair' and secret_hash = $1 and used_at is null and expires_at > $2`,
    [sha256(token), req.server.deps.clock()],
  );
  const row = rows[0];
  if (!row) throw new ApiError(401, 'not-authenticated');
  return { id: row.id, ownerId: row.account_id };
}

/** Setup open and a setup session that already has its pending owner account. */
async function ownerStep(q: Queryable, req: FastifyRequest, lock = false): Promise<{ setupId: string; ownerId: string }> {
  await assertOpen(q, lock);
  const s = await setupSession(q, req);
  if (s.ownerId === null) throw new ApiError(400, 'bad-request');
  return { setupId: s.id, ownerId: s.ownerId };
}

function body(req: FastifyRequest): Record<string, unknown> {
  const b = req.body ?? {};
  if (b === null || typeof b !== 'object' || Array.isArray(b)) throw new ApiError(400, 'bad-request');
  return b as Record<string, unknown>;
}

function str(b: Record<string, unknown>, key: string): string {
  const v = b[key];
  if (typeof v !== 'string') throw new ApiError(400, 'bad-request');
  return v;
}

/**
 * One try of the setup code against the global limit: serialised on the setup row, at most
 * `SETUP_TRIES_PER_HOUR` in any rolling hour, right or wrong; the try is recorded (and committed)
 * before the code is compared. 429 `slow-down` `{ retryAfterSeconds }` otherwise.
 */
async function takeTry(db: pg.Pool, now: Date): Promise<SetupRow> {
  return withTx(db, async (c) => {
    const row = await assertOpen(c, true);
    const since = new Date(now.getTime() - HOUR_MS);
    await c.query('delete from owner_setup_tries where at <= $1', [since]);
    const { rows } = await c.query<{ n: number; oldest: Date | null }>('select count(*)::int as n, min(at) as oldest from owner_setup_tries');
    const { n, oldest } = rows[0]!;
    if (n >= SETUP_TRIES_PER_HOUR && oldest) {
      throw new ApiError(429, 'slow-down', { retryAfterSeconds: Math.max(1, Math.ceil((oldest.getTime() + HOUR_MS - now.getTime()) / 1000)) });
    }
    await c.query('insert into owner_setup_tries (at) values ($1)', [now]);
    return row;
  });
}

/**
 * Plan 4 Task 6, owner first-run setup on the staff API (perm `public-setup`; every route answers
 * 404 `setup-locked` once setup has finished):
 * - `POST /staff/v1/setup/code { code }` → a 30-minute setup cookie (`__Host-x2f_setup`); 10 tries
 *   an hour, globally; a wrong code is 401 `code-invalid` and the code stays valid;
 * - `POST /staff/v1/setup/account { username, loginName }` → 201: the pending owner account
 *   (`kind 'owner'`, disabled, so it cannot log in yet), replacing an earlier pending one;
 * - `POST /staff/v1/setup/key/{start,finish}` → attested security keys only (`method-not-allowed`);
 * - `POST /staff/v1/setup/pgp/{start,finish}` → the owner's PGP key (required, A9);
 * - `POST /staff/v1/setup/finish { deviceLabel }` → `{ keyCheckCodes }`: in one transaction,
 *   `ownerReady`, the account enabled, its `staff_members` row (owner, hours "any"), `locked_at`,
 *   the owner's staff session, then `owner.setup-completed` last.
 * Every route but `code` needs the setup cookie (401 `not-authenticated`).
 */
export function ownerSetupRoutes(app: FastifyInstance): void {
  app.post('/staff/v1/setup/code', { config: PUBLIC_SETUP }, async (req, reply) => {
    const deps = req.server.deps;
    ensureDeviceCookie(req, reply);
    const raw = body(req).code;
    const now = deps.clock();
    const row = await takeTry(deps.db, now);
    const normalized = typeof raw === 'string' ? normalizeLoginCode(raw) : null;
    const given = sha256(normalized ?? '');
    if (normalized === null || !timingSafeEqual(given, row.code_hash)) throw new ApiError(401, 'code-invalid');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + SETUP_SESSION_MS);
    await deps.db.query(
      `insert into challenges (purpose, method, secret_hash, payload, created_at, expires_at)
       values ('owner-setup-session', 'pair', $1, '{}', $2, $3)`,
      [sha256(token), now, expiresAt],
    );
    void reply.setCookie(SETUP_COOKIE, token, { ...COOKIE_ATTRS, maxAge: SETUP_SESSION_MS / 1000 });
    return { ok: true, expiresAt: expiresAt.toISOString() };
  });

  app.post('/staff/v1/setup/account', { config: PUBLIC_SETUP }, async (req, reply) => {
    const deps = req.server.deps;
    const now = deps.clock();
    await withTx(deps.db, async (c) => {
      await assertOpen(c, true);
      const s = await setupSession(c, req);
      const b = body(req);
      // An earlier pending owner (another try, or this one) is replaced: setup still holds the
      // row lock and no owner is live, so this only ever removes an unfinished account.
      await c.query('update challenges set account_id = null where id = $1', [s.id]);
      await c.query("delete from accounts where kind = 'owner' and disabled_at is not null");
      const names = await assertNewNames(c, b.username, b.loginName);
      const ownerId = await createAccount(c, deps.config, { ...names, kind: 'owner', termsVersion: null, now });
      await c.query('update accounts set disabled_at = $2 where id = $1', [ownerId, now]);
      await c.query('update challenges set account_id = $2 where id = $1', [s.id, ownerId]);
    });
    return reply.code(201).send({ ok: true });
  });

  app.post('/staff/v1/setup/key/start', { config: PUBLIC_SETUP }, async (req) => {
    const deps = req.server.deps;
    const { setupId, ownerId } = await ownerStep(deps.db, req);
    const kind = body(req).kind ?? 'security-key';
    if (kind !== 'security-key' && kind !== 'passkey') throw new ApiError(400, 'bad-request');
    // An owner passkey is refused here (`registrationOptionsFor`, 403 method-not-allowed).
    const options = await webauthnRegistrationOptions(deps, ownerId, { kind });
    const now = deps.clock();
    const { rows } = await deps.db.query<{ id: string }>(
      `insert into challenges (account_id, purpose, method, webauthn_challenge, payload, created_at, expires_at)
       values ($1, 'owner-setup-key', 'security-key', $2, $3, $4, $5) returning id`,
      [ownerId, options.challenge, JSON.stringify({ setupId }), now, new Date(now.getTime() + WEBAUTHN_TTL_MS)],
    );
    return { challengeId: rows[0]!.id, options };
  });

  app.post('/staff/v1/setup/key/finish', { config: PUBLIC_SETUP }, async (req, reply) => {
    const deps = req.server.deps;
    const { setupId, ownerId } = await ownerStep(deps.db, req);
    const b = body(req);
    const label = b.label === undefined ? undefined : str(b, 'label');
    const ch = await consumeChallenge(deps.db, str(b, 'challengeId'), deps.clock());
    if (!ch || ch.purpose !== 'owner-setup-key' || ch.webauthn_challenge === null || ch.account_id !== ownerId || ch.payload.setupId !== setupId) {
      throw new ApiError(400, 'challenge-expired');
    }
    // Attested security keys only: an unattested one is 403 method-not-allowed (R1, P2-I5).
    const cred = await verifyWebAuthnRegistrationOnly(deps, ownerId, b.response, ch.webauthn_challenge, {
      kind: 'security-key', ...(label !== undefined ? { label } : {}),
    });
    if (!cred.attested) throw new ApiError(403, 'method-not-allowed');
    const keys = await withTx(deps.db, async (c) => {
      const step = await ownerStep(c, req, true);
      if (step.ownerId !== ownerId) throw new ApiError(400, 'challenge-expired');
      await cred.store(c);
      return attestedKeys(c, ownerId);
    });
    return reply.code(201).send({ keys: keys.length });
  });

  app.post('/staff/v1/setup/pgp/start', { config: PUBLIC_SETUP, bodyLimit: PGP_BODY_LIMIT }, async (req, reply) => {
    const deps = req.server.deps;
    const { setupId, ownerId } = await ownerStep(deps.db, req);
    ensureDeviceCookie(req, reply);
    const issued = await issueTeamJoinChallenge(deps, req, { accountId: ownerId, publicKey: str(body(req), 'publicKey'), payload: { setupId }, purpose: 'owner-setup' });
    return issued;
  });

  app.post('/staff/v1/setup/pgp/finish', { config: PUBLIC_SETUP }, async (req, reply) => {
    const deps = req.server.deps;
    const { setupId, ownerId } = await ownerStep(deps.db, req);
    const b = body(req);
    const proved = await checkTeamJoinCode(deps, req, str(b, 'challengeId'), str(b, 'code'), ownerId, 'owner-setup');
    if (proved.payload.setupId !== setupId) throw new ApiError(400, 'challenge-expired');
    const now = deps.clock();
    await withTx(deps.db, async (c) => {
      const step = await ownerStep(c, req, true);
      if (step.ownerId !== ownerId) throw new ApiError(400, 'challenge-expired');
      await insertPgpKey(c, deps.config, { accountId: ownerId, fingerprint: proved.fingerprint, armored: proved.armored, now });
    });
    return reply.code(201).send({ fingerprint: proved.fingerprint });
  });

  app.post('/staff/v1/setup/finish', { config: PUBLIC_SETUP }, finishSetup);
}

async function attestedKeys(q: Queryable, ownerId: string): Promise<Buffer[]> {
  const { rows } = await q.query<{ public_key: Buffer }>(
    `select public_key from webauthn_credentials where account_id = $1 and kind = 'security-key' and attested order by created_at, id`,
    [ownerId],
  );
  return rows.map((r) => r.public_key);
}

async function finishSetup(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  const now = deps.clock();
  let after: () => void = () => undefined;
  const keyCheckCodes = await withTx(deps.db, async (c) => {
    // The row lock makes a parallel finish wait, then see `locked_at` and answer setup-locked.
    const { setupId, ownerId } = await ownerStep(c, req, true);
    const deviceLabel = str(body(req), 'deviceLabel');
    await c.query('select 1 from accounts where id = $1 for update', [ownerId]);
    const keys = await attestedKeys(c, ownerId);
    if (keys.length < 2) throw new ApiError(409, 'owner-needs-two-keys');
    // Keys are written only under the setup row lock this transaction holds, so this read (on
    // another connection) sees exactly what this transaction sees.
    if (!(await ownerReady(deps, ownerId))) throw new ApiError(409, 'owner-needs-pgp');
    await c.query('update accounts set disabled_at = null where id = $1', [ownerId]);
    await c.query(
      `insert into staff_members (account_id, role, hours, has_security_key, joined_at) values ($1, 'owner', '"any"', true, $2)`,
      [ownerId, now],
    );
    await c.query('update owner_setup set locked_at = $1 where id = 1', [now]);
    await c.query('update challenges set used_at = $2 where id = $1', [setupId, now]);
    await c.query('delete from owner_setup_tries');
    const opened = await openSession(c, deps, req, reply, {
      accountId: ownerId, level: 'full', deviceLabel, method: 'security-key', firstSession: true, strength: 'strong',
    });
    after = opened.after;
    // Last, just before the commit (the log lock rule).
    await appendLog(c, { at: now, actor: { kind: 'staff', id: ownerId, role: 'owner' }, tradeCode: null, action: 'owner.setup-completed', detail: {} });
    return keys.map((k) => keyCheckCode(k));
  });
  after();
  void reply.clearCookie(SETUP_COOKIE, { ...COOKIE_ATTRS });
  return { keyCheckCodes };
}
