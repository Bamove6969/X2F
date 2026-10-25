/**
 * TOTP as a second factor and a backup (Task 9).
 *
 * - No patterns (owner, spec 6.2): each enrolment draws a fresh 20-byte secret from
 *   `crypto.randomBytes`, never derived from the username, account ID, time, a counter,
 *   `serverKey` or any shared seed.
 * - The secret is stored only sealed by the TOTP key store (`totpBox`: AES-256-GCM under the current
 *   `X2F_TOTP_KEYS` key, FU-C), both in `totp.secret_enc` and in the enrolment challenge's payload;
 *   the clear secret exists only in the start response. Secrets sealed before FU-C (format 0, under
 *   `subkey('totp')`) still open until `rewrapTotpSecrets` moves them.
 * - SHA-1, 6 digits, 30-second period, window ±1 step; a code is accepted only for a step later than
 *   the last accepted one, set in the same statement (no replay, even in parallel).
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Deps } from '../app.js';
import { addAlert } from '../alerts.js';
import { subkey, type Config } from '../config.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { consumeChallenge, takeStartBudgetUnlessOpen } from './challenges.js';
import { keyringBox, type SecretBox } from './keystore.js';
import { methodAllowed } from './methods.js';
import { requireConfirm } from './confirm.js';
import { deviceHash, ensureDeviceCookie } from './device.js';
import { assertNotDisabled, requireSession, startSession } from './sessions.js';
import { throttleCheck, throttleFail, throttleKey, throttleReset } from './throttle.js';

export const TOTP_SECRET_BYTES = 20;
const PERIOD_S = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGITS = 6;
const WINDOW = 1;
/** An enrolment challenge, and a password login waiting for its code, live 5 minutes. */
export const TOTP_ENROL_TTL_MS = 5 * 60_000;
export const SECOND_FACTOR_TTL_MS = 5 * 60_000;
/** Open enrolment challenges per session; a new start beyond this replaces the oldest. */
export const TOTP_OPEN_ENROLMENTS = 3;

// ---------------------------------------------------------------------------------------------
// Sealing

const context = (accountId: string) => `x2f/totp/${accountId}`;
const boxes = new WeakMap<Config, { ring: Config['totpKeys']; legacy: boolean; box: SecretBox }>();

/**
 * The TOTP key store: `X2F_TOTP_KEYS` (env or file), with `subkey('totp')` only to open format-0
 * blobs, and not even that with `X2F_LEGACY_SECRETS=off` (they then fail closed). Rebuilt if the
 * config's ring or that switch changes.
 */
export function totpBox(config: Config): SecretBox {
  const cached = boxes.get(config);
  if (cached && cached.ring === config.totpKeys && cached.legacy === config.legacySecrets) return cached.box;
  const box = keyringBox(config.totpKeys, config.legacySecrets ? subkey(config, 'totp') : undefined);
  boxes.set(config, { ring: config.totpKeys, legacy: config.legacySecrets, box });
  return box;
}

/**
 * Sealed by the key store under the current key, bound to the account (its ID is in the associated
 * data): a sealed secret copied to another account does not open.
 */
export function sealSecret(deps: Pick<Deps, 'config'>, accountId: string, secret: Uint8Array): Buffer {
  return totpBox(deps.config).seal(secret, context(accountId));
}

/** Throws when the sealed secret is malformed, tampered with, sealed for another account or its key is gone. */
export function openSecret(deps: Pick<Deps, 'config'>, accountId: string, sealed: Buffer): Uint8Array {
  return totpBox(deps.config).open(sealed, context(accountId));
}

/**
 * Reseals every TOTP secret not yet under the current key (format 0, or an older key id) with the
 * current key: run after migration 011 and after each `X2F_TOTP_KEYS` rotation, before an old key
 * leaves the ring (`npm run rewrap-totp -w @x2f/api`). Each row is written only if it still holds
 * the blob that was read, so a new enrolment in between wins. A blob that does not open is left as
 * it is and counted in `failed` (it never verified anyway). Returns counts only, never secrets.
 */
export async function rewrapTotpSecrets(deps: Pick<Deps, 'db' | 'config'>): Promise<{ rewrapped: number; failed: number }> {
  const box = totpBox(deps.config);
  const { rows } = await deps.db.query<{ account_id: string; secret_enc: Buffer }>('select account_id, secret_enc from totp');
  let rewrapped = 0;
  let failed = 0;
  for (const row of rows) {
    if (box.isCurrent(row.secret_enc)) continue;
    let sealed: Buffer;
    try {
      sealed = box.seal(box.open(row.secret_enc, context(row.account_id)), context(row.account_id));
    } catch {
      failed++;
      continue;
    }
    const r = await deps.db.query('update totp set secret_enc = $3 where account_id = $1 and secret_enc = $2', [
      row.account_id, row.secret_enc, sealed,
    ]);
    rewrapped += r.rowCount ?? 0;
  }
  return { rewrapped, failed };
}

// ---------------------------------------------------------------------------------------------
// Codes

/** otpauth wants an ArrayBuffer of exactly the secret's bytes (a Buffer may sit in a shared pool). */
const secretOf = (bytes: Uint8Array) => new Secret({ buffer: new Uint8Array(bytes).buffer });

/** `label` is the public display name, never the login name. */
function totpOf(bytes: Uint8Array, label: string): TOTP {
  return new TOTP({ issuer: 'X2F', label, algorithm: 'SHA1', digits: DIGITS, period: PERIOD_S, secret: secretOf(bytes) });
}

/**
 * The step (within ±1 of `now`) whose code equals `code`, or null. Every step in the window is
 * compared in constant time; no early exit.
 */
function matchStep(bytes: Uint8Array, code: unknown, now: Date): number | null {
  if (typeof code !== 'string' || code.length > 16) return null;
  const digits = code.replace(/\s/g, '');
  const valid = /^\d{6}$/.test(digits);
  const given = Buffer.from(valid ? digits : '------', 'utf8');
  const secret = secretOf(bytes);
  const current = Math.floor(now.getTime() / (PERIOD_S * 1000));
  let found: number | null = null;
  for (let d = -WINDOW; d <= WINDOW; d++) {
    const expected = TOTP.generate({
      secret, algorithm: 'SHA1', digits: DIGITS, period: PERIOD_S, timestamp: (current + d) * PERIOD_S * 1000,
    });
    if (timingSafeEqual(Buffer.from(expected, 'utf8'), given) && valid) found = current + d;
  }
  return found;
}

/** Runs the same comparisons against a throwaway secret, so an account without TOTP costs the same. */
export function dummyTotpCheck(code: unknown, now: Date): false {
  matchStep(randomBytes(TOTP_SECRET_BYTES), code, now);
  return false;
}

/**
 * True when `code` matches a step within ±1 of now that is later than the account's last accepted
 * step; that step becomes the last accepted one in the same statement, so a code works once.
 */
export async function verifyTotp(deps: Pick<Deps, 'db' | 'clock' | 'config'>, accountId: string, code: string): Promise<boolean> {
  const now = deps.clock();
  const { rows } = await deps.db.query<{ secret_enc: Buffer }>('select secret_enc from totp where account_id = $1', [accountId]);
  const row = rows[0];
  if (!row) return dummyTotpCheck(code, now);
  let bytes: Uint8Array;
  try {
    bytes = openSecret(deps, accountId, row.secret_enc);
  } catch {
    return dummyTotpCheck(code, now); // fails closed: a secret that does not open never matches
  }
  const step = matchStep(bytes, code, now);
  if (step === null) return false;
  const r = await deps.db.query('update totp set last_step = $2 where account_id = $1 and last_step < $2', [accountId, step]);
  return (r.rowCount ?? 0) > 0;
}

export async function hasTotp(db: Queryable, accountId: string): Promise<boolean> {
  const { rows } = await db.query('select 1 from totp where account_id = $1', [accountId]);
  return rows.length > 0;
}

// ---------------------------------------------------------------------------------------------
// Password login's second factor

/**
 * A password login of an account with TOTP stops here: a `challenges` row (purpose
 * `second-factor`, method `totp`, this account and device, 5 minutes) that
 * `POST /v1/login/second-factor` finishes. No session exists until then.
 */
export async function issueSecondFactor(
  deps: Pick<Deps, 'db' | 'clock'>,
  req: FastifyRequest,
  a: { accountId: string; deviceLabel: string },
): Promise<string> {
  const now = deps.clock();
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into challenges (account_id, device_hash, purpose, method, payload, created_at, expires_at)
     values ($1, $2, 'second-factor', 'totp', $3, $4, $5) returning id`,
    [a.accountId, deviceHash(req), JSON.stringify({ deviceLabel: a.deviceLabel }), now, new Date(now.getTime() + SECOND_FACTOR_TTL_MS)],
  );
  return rows[0]!.id;
}

// ---------------------------------------------------------------------------------------------
// Routes

function body(req: FastifyRequest): Record<string, unknown> {
  const b = req.body;
  if (b === null || typeof b !== 'object' || Array.isArray(b)) throw new ApiError(400, 'bad-request');
  return b as Record<string, unknown>;
}

function str(b: Record<string, unknown>, key: string): string {
  const v = b[key];
  if (typeof v !== 'string') throw new ApiError(400, 'bad-request');
  return v;
}

async function enrolStart(req: FastifyRequest) {
  const deps = req.server.deps;
  const now = deps.clock();
  const { rows } = await deps.db.query<{ display_name: string }>('select display_name from accounts where id = $1', [req.auth.accountId]);
  const displayName = rows[0]?.display_name;
  if (displayName === undefined) throw new ApiError(401, 'not-authenticated');
  // A fresh secret per enrolment, from the OS CSPRNG only (R9).
  const bytes = new Uint8Array(randomBytes(TOTP_SECRET_BYTES));
  const { rows: ch } = await deps.db.query<{ id: string }>(
    // `n` numbers this session's enrolments in order (the server clock may not move between starts).
    `insert into challenges (account_id, session_id, purpose, method, payload, created_at, expires_at)
     select $1, $2, 'add-totp', 'totp',
            jsonb_build_object('secretEnc', $3::text, 'n', coalesce(max((c.payload->>'n')::bigint), 0) + 1), $4, $5
       from challenges c where c.session_id = $2 and c.purpose = 'add-totp'
     returning id`,
    [
      req.auth.accountId, req.auth.sessionId, sealSecret(deps, req.auth.accountId, bytes).toString('base64'),
      now, new Date(now.getTime() + TOTP_ENROL_TTL_MS),
    ],
  );
  // At most 3 open enrolments per session: older ones beyond that are marked used.
  await deps.db.query(
    `update challenges set used_at = $3
      where id in (
        select id from challenges
         where session_id = $1 and purpose = 'add-totp' and used_at is null and expires_at > $3
         order by (payload->>'n')::bigint desc offset $2)`,
    [req.auth.sessionId, TOTP_OPEN_ENROLMENTS, now],
  );
  const totp = totpOf(bytes, displayName);
  return { challengeId: ch[0]!.id, otpauthUri: totp.toString(), secret: totp.secret.base32 };
}

/**
 * Proves the authenticator app holds the new secret, then enrols it (replacing an earlier one).
 * A wrong code answers 401 `code-invalid` and may be retried on the same challenge until it
 * expires (the person only proves they copied a secret they were just shown), but each one counts
 * on the account's `totp` throttle key, as at `login/second-factor`. The throttle is checked
 * before the code and nothing is used up first, so a 429 leaves the challenge for a retry; the
 * right code clears the streak and uses the challenge up with `consumeChallenge`, so it enrols
 * once even in parallel.
 */
async function enrolFinish(req: FastifyRequest) {
  const deps = req.server.deps;
  const b = body(req);
  const challengeId = str(b, 'challengeId');
  const now = deps.clock();
  const expired = () => new ApiError(400, 'challenge-expired');
  if (!UUID.test(challengeId)) throw expired();
  // Read without using it up; this session's own open enrolment only.
  const { rows } = await deps.db.query<{ payload: Record<string, unknown> }>(
    `select payload from challenges
      where id = $1 and purpose = 'add-totp' and account_id = $2 and session_id = $3 and used_at is null and expires_at > $4`,
    [challengeId, req.auth.accountId, req.auth.sessionId, now],
  );
  const sealed = rows[0]?.payload.secretEnc;
  if (typeof sealed !== 'string') throw expired();
  const bytes = openSecret(deps, req.auth.accountId, Buffer.from(sealed, 'base64'));
  const key = await throttleKey(deps, req, 'totp', { id: req.auth.accountId });
  await throttleCheck(deps, key);
  const step = matchStep(bytes, b.code, now);
  if (step === null) {
    await throttleFail(deps, key, req.auth.accountId);
    throw new ApiError(401, 'code-invalid');
  }
  await throttleReset(deps, key);
  const row = await consumeChallenge(deps.db, challengeId, now);
  if (!row || row.purpose !== 'add-totp' || row.account_id !== req.auth.accountId || row.session_id !== req.auth.sessionId) {
    throw expired();
  }

  const client = await deps.db.connect();
  try {
    await client.query('begin');
    try {
      // Sealed again with a fresh nonce; the enrolment code's step counts as used.
      await client.query(
        `insert into totp (account_id, secret_enc, last_step, created_at) values ($1, $2, $3, $4)
         on conflict (account_id) do update set secret_enc = excluded.secret_enc, last_step = excluded.last_step,
           created_at = excluded.created_at`,
        [req.auth.accountId, sealSecret(deps, req.auth.accountId, bytes), step, now],
      );
      await addAlert(client, req.auth.accountId, 'login-method-added', { method: 'totp' }, now);
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  } finally {
    client.release();
  }
  return { ok: true };
}

/**
 * Finishes a password login that answered `second-factor`. The pending login is single-use and
 * bound to the browser that started it; wrong codes count on the account's `totp` throttle key
 * (with Task 4's device scoping), use the pending login up and answer 401 `code-invalid`. The
 * throttle is checked before the pending login is used up, so a 429 leaves it for a retry.
 */
async function secondFactor(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  ensureDeviceCookie(req, reply);
  const b = body(req);
  // F1: a started password login can always finish its second factor.
  await takeStartBudgetUnlessOpen(req, b.pendingId, { purpose: 'second-factor', methods: ['totp'] });
  const pendingId = str(b, 'pendingId');
  const code = str(b, 'code');
  const now = deps.clock();
  const device = deviceHash(req);
  const expired = () => new ApiError(400, 'challenge-expired');
  const matches = (r: { purpose: string; method: string; account_id: string | null; device_hash: Buffer | null }) =>
    r.purpose === 'second-factor' && r.method === 'totp' && r.account_id !== null &&
    r.device_hash !== null && device !== null && r.device_hash.equals(device);
  if (!UUID.test(pendingId)) throw expired();
  // Look first (nothing used up), so a throttle refusal leaves the pending login in place.
  const { rows: peek } = await deps.db.query<{ purpose: string; method: string; account_id: string | null; device_hash: Buffer | null }>(
    'select purpose, method, account_id, device_hash from challenges where id = $1 and used_at is null and expires_at > $2',
    [pendingId, now],
  );
  const pending = peek[0];
  if (!pending || !matches(pending)) throw expired();
  const accountId = pending.account_id!;
  const key = await throttleKey(deps, req, 'totp', { id: accountId });
  await throttleCheck(deps, key);
  const row = await consumeChallenge(deps.db, pendingId, now);
  if (!row || !matches(row) || row.account_id !== accountId) throw expired();
  if (!(await verifyTotp(deps, accountId, code))) {
    await throttleFail(deps, key, accountId);
    throw new ApiError(401, 'code-invalid');
  }
  await throttleReset(deps, key);
  await assertNotDisabled(deps.db, accountId);
  const deviceLabel = typeof row.payload.deviceLabel === 'string' ? row.payload.deviceLabel : '';
  await startSession(deps, req, reply, { accountId, level: 'full', deviceLabel, method: 'password', firstSession: false });
  return { status: 'ok' as const };
}

/**
 * `POST /v1/account/totp/start|finish` (full session; a confirm token for `add-method:totp`
 * outside onboarding; `assertMethodAllowed` first, so staff and the owner are refused before any
 * token is spent, R2) and `POST /v1/login/second-factor`.
 */
export function totpRoutes(app: FastifyInstance): void {
  app.post(
    '/v1/account/totp/start',
    { preHandler: [requireSession(), methodAllowed('totp'), requireConfirm({ kind: 'add-method', method: 'totp' }, { onboarding: true })] },
    enrolStart,
  );
  app.post('/v1/account/totp/finish', { preHandler: [requireSession(), methodAllowed('totp')] }, enrolFinish);
  app.post('/v1/login/second-factor', secondFactor);
}
