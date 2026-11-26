/**
 * TOTP, the authenticator app (Task 9).
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
 * - Owner, 26 Nov 2026 (no passwords): one authenticator app per account (a new enrolment replaces
 *   the old one). It counts as one of the two kinds of login method a trader account holds
 *   (`@x2f/accounts` `enoughMethods`) but never logs in on its own.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Deps } from '../app.js';
import { addAlert } from '../alerts.js';
import { subkey, type Config } from '../config.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { consumeChallenge } from './challenges.js';
import { keyringBox, type SecretBox } from './keystore.js';
import { methodAllowed } from './methods.js';
import { onlyIfNew, passedOnWindow, recheckWindowInTx, requireConfirm } from './confirm.js';
import { requireLiveSessionInTx } from './liveSession.js';
import { requireSession } from './sessions.js';
import { throttleCheck, throttleFail, throttleKey, throttleReset } from './throttle.js';

export const TOTP_SECRET_BYTES = 20;
const PERIOD_S = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGITS = 6;
const WINDOW = 1;
/** An enrolment challenge lives 5 minutes. */
export const TOTP_ENROL_TTL_MS = 5 * 60_000;
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

/** `label` is the public Trade Tag, never the login name. */
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
  const { rows } = await deps.db.query<{ trade_tag: string }>('select trade_tag from accounts where id = $1', [req.auth.accountId]);
  const tradeTag = rows[0]?.trade_tag;
  if (tradeTag === undefined) throw new ApiError(401, 'not-authenticated');
  // A fresh secret per enrolment, from the OS CSPRNG only (R9).
  const bytes = new Uint8Array(randomBytes(TOTP_SECRET_BYTES));
  const { rows: ch } = await deps.db.query<{ id: string }>(
    // `n` numbers this session's enrolments in order (the server clock may not move between starts).
    `insert into challenges (account_id, session_id, purpose, method, payload, created_at, expires_at)
     select $1, $2, 'add-totp', 'totp',
            jsonb_build_object('secretEnc', $3::text, 'n', coalesce(max((c.payload->>'n')::bigint), 0) + 1, 'window', $6::boolean), $4, $5
       from challenges c where c.session_id = $2 and c.purpose = 'add-totp'
     returning id`,
    [
      req.auth.accountId, req.auth.sessionId, sealSecret(deps, req.auth.accountId, bytes).toString('base64'),
      now, new Date(now.getTime() + TOTP_ENROL_TTL_MS), passedOnWindow(req),
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
  const totp = totpOf(bytes, tradeTag);
  return { challengeId: ch[0]!.id, otpauthUri: totp.toString(), secret: totp.secret.base32 };
}

/**
 * Proves the authenticator app holds the new secret, then enrols it (replacing an earlier one).
 * A wrong code answers 401 `code-invalid` and may be retried on the same challenge until it
 * expires (the person only proves they copied a secret they were just shown), but each one counts
 * on the account's `totp` throttle key. The throttle is checked
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
  const onWindow = rows[0]?.payload.window === true;
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

  // Sealed again with a fresh nonce; the enrolment code's step counts as used.
  const sealedNow = sealSecret(deps, req.auth.accountId, bytes);
  const client = await deps.db.connect();
  try {
    await client.query('begin');
    try {
      // The session must still be live, under the account lock.
      await requireLiveSessionInTx(client, req.auth, now);
      // Re-verify R1: a start let through on the window may add the first app only, never replace one.
      if (onWindow) await recheckWindowInTx(client, req, 'totp', 'add-method');
      await applyTotp(client, req.auth.accountId, sealedNow, step, now);
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

/** The write of a TOTP enrolment; replaces an earlier one (one authenticator app per account). */
export async function applyTotp(db: Queryable, accountId: string, secretEnc: Buffer, step: number, now: Date): Promise<void> {
  await db.query(
    `insert into totp (account_id, secret_enc, last_step, created_at) values ($1, $2, $3, $4)
     on conflict (account_id) do update set secret_enc = excluded.secret_enc, last_step = excluded.last_step,
       created_at = excluded.created_at`,
    [accountId, secretEnc, step, now],
  );
  await addAlert(db, accountId, 'login-method-added', { method: 'totp' }, now);
}

/**
 * `POST /v1/account/totp/start|finish` (full session; a confirm token for `add-method:totp`
 * outside onboarding; `assertMethodAllowed` first, so staff and the owner are refused before any
 * token is spent, R2).
 */
export function totpRoutes(app: FastifyInstance): void {
  app.post(
    '/v1/account/totp/start',
    { preHandler: [requireSession(), methodAllowed('totp'), requireConfirm({ kind: 'add-method', method: 'totp' }, { onboarding: onlyIfNew('totp') })] },
    enrolStart,
  );
  app.post('/v1/account/totp/finish', { preHandler: [requireSession(), methodAllowed('totp')] }, enrolFinish);
}
