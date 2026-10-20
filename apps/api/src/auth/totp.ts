/**
 * TOTP as a second factor and a backup (Task 9).
 *
 * - No patterns (owner, spec 6.2): each enrolment draws a fresh 20-byte secret from
 *   `crypto.randomBytes`, never derived from the username, account ID, time, a counter,
 *   `serverKey` or any shared seed.
 * - The secret is stored only sealed (AES-256-GCM under `subkey('totp')`), both in `totp.secret_enc`
 *   and in the enrolment challenge's payload; the clear secret exists only in the start response.
 * - SHA-1, 6 digits, 30-second period, window ±1 step; a code is accepted only for a step later than
 *   the last accepted one, set in the same statement (no replay, even in parallel).
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Deps } from '../app.js';
import { addAlert } from '../alerts.js';
import { subkey } from '../config.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { consumeChallenge } from './challenges.js';
import { requireConfirm } from './confirm.js';
import { deviceHash, ensureDeviceCookie } from './device.js';
import { assertNotDisabled, requireSession, startSession } from './sessions.js';
import { throttleCheck, throttleFail, throttleKey, throttleReset } from './throttle.js';

export const TOTP_SECRET_BYTES = 20;
const PERIOD_S = 30;
const DIGITS = 6;
const WINDOW = 1;
/** An enrolment challenge, and a password login waiting for its code, live 5 minutes. */
export const TOTP_ENROL_TTL_MS = 5 * 60_000;
export const SECOND_FACTOR_TTL_MS = 5 * 60_000;

// ---------------------------------------------------------------------------------------------
// Sealing

/** AES-256-GCM under `subkey('totp')`: nonce (12) ‖ ciphertext ‖ tag (16). */
export function sealSecret(deps: Pick<Deps, 'config'>, secret: Uint8Array): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', subkey(deps.config, 'totp'), nonce, { authTagLength: 16 });
  const body = Buffer.concat([cipher.update(secret), cipher.final()]);
  return Buffer.concat([nonce, body, cipher.getAuthTag()]);
}

export function openSecret(deps: Pick<Deps, 'config'>, sealed: Buffer): Uint8Array {
  if (sealed.length < 12 + 16) throw new Error('sealed TOTP secret is malformed');
  const decipher = createDecipheriv('aes-256-gcm', subkey(deps.config, 'totp'), sealed.subarray(0, 12), { authTagLength: 16 });
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  return new Uint8Array(Buffer.concat([decipher.update(sealed.subarray(12, sealed.length - 16)), decipher.final()]));
}

// ---------------------------------------------------------------------------------------------
// Codes

/** otpauth wants an ArrayBuffer of exactly the secret's bytes (a Buffer may sit in a shared pool). */
const secretOf = (bytes: Uint8Array) => new Secret({ buffer: new Uint8Array(bytes).buffer });

function totpOf(bytes: Uint8Array, username: string): TOTP {
  return new TOTP({ issuer: 'X2F', label: username, algorithm: 'SHA1', digits: DIGITS, period: PERIOD_S, secret: secretOf(bytes) });
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
  const step = matchStep(openSecret(deps, row.secret_enc), code, now);
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

/**
 * Until Task 10's `assertMethodAllowed`, TOTP and recovery codes are for traders only: staff and the
 * owner have no backup login and no reset (R2). Runs before `requireConfirm`, so a refusal never
 * uses up a confirm token.
 */
// TODO(Task 10): replace with `assertMethodAllowed(req.auth.kind, method)`.
export const tradersOnly: preHandlerAsyncHookHandler = async function (req) {
  if (req.auth.kind !== 'trader') throw new ApiError(403, 'method-not-allowed');
};

async function enrolStart(req: FastifyRequest) {
  const deps = req.server.deps;
  const now = deps.clock();
  const { rows } = await deps.db.query<{ username: string }>('select username from accounts where id = $1', [req.auth.accountId]);
  const username = rows[0]?.username;
  if (username === undefined) throw new ApiError(401, 'not-authenticated');
  // A fresh secret per enrolment, from the OS CSPRNG only (R9).
  const bytes = new Uint8Array(randomBytes(TOTP_SECRET_BYTES));
  const { rows: ch } = await deps.db.query<{ id: string }>(
    `insert into challenges (account_id, session_id, purpose, method, payload, created_at, expires_at)
     values ($1, $2, 'add-totp', 'totp', $3, $4, $5) returning id`,
    [
      req.auth.accountId, req.auth.sessionId, JSON.stringify({ secretEnc: sealSecret(deps, bytes).toString('base64') }),
      now, new Date(now.getTime() + TOTP_ENROL_TTL_MS),
    ],
  );
  const totp = totpOf(bytes, username);
  return { challengeId: ch[0]!.id, otpauthUri: totp.toString(), secret: totp.secret.base32 };
}

/**
 * Proves the authenticator app holds the new secret, then enrols it (replacing an earlier one).
 * The challenge is single-use: a wrong code answers 401 `code-invalid` and the person starts again.
 */
async function enrolFinish(req: FastifyRequest) {
  const deps = req.server.deps;
  const b = body(req);
  const now = deps.clock();
  const row = await consumeChallenge(deps.db, str(b, 'challengeId'), now);
  if (!row || row.purpose !== 'add-totp' || row.account_id !== req.auth.accountId || row.session_id !== req.auth.sessionId) {
    throw new ApiError(400, 'challenge-expired');
  }
  const sealed = row.payload.secretEnc;
  if (typeof sealed !== 'string') throw new ApiError(400, 'challenge-expired');
  const bytes = openSecret(deps, Buffer.from(sealed, 'base64'));
  const step = matchStep(bytes, b.code, now);
  if (step === null) throw new ApiError(401, 'code-invalid');

  const client = await deps.db.connect();
  try {
    await client.query('begin');
    try {
      // Sealed again with a fresh nonce; the enrolment code's step counts as used.
      await client.query(
        `insert into totp (account_id, secret_enc, last_step, created_at) values ($1, $2, $3, $4)
         on conflict (account_id) do update set secret_enc = excluded.secret_enc, last_step = excluded.last_step,
           created_at = excluded.created_at`,
        [req.auth.accountId, sealSecret(deps, bytes), step, now],
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
 * (with Task 4's device scoping) and answer 401 `code-invalid`.
 */
async function secondFactor(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  ensureDeviceCookie(req, reply);
  req.server.budgets.start.take();
  const b = body(req);
  const pendingId = str(b, 'pendingId');
  const code = str(b, 'code');
  const now = deps.clock();
  const device = deviceHash(req);
  const row = await consumeChallenge(deps.db, pendingId, now);
  if (
    !row || row.purpose !== 'second-factor' || row.method !== 'totp' || row.account_id === null ||
    row.device_hash === null || device === null || !row.device_hash.equals(device)
  ) {
    throw new ApiError(400, 'challenge-expired');
  }
  const accountId = row.account_id;
  const key = await throttleKey(deps, req, 'totp', { id: accountId });
  await throttleCheck(deps, key);
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
 * outside onboarding) and `POST /v1/login/second-factor`.
 */
export function totpRoutes(app: FastifyInstance): void {
  app.post(
    '/v1/account/totp/start',
    { preHandler: [requireSession(), tradersOnly, requireConfirm({ kind: 'add-method', method: 'totp' }, { onboarding: true })] },
    enrolStart,
  );
  app.post('/v1/account/totp/finish', { preHandler: [requireSession(), tradersOnly] }, enrolFinish);
  app.post('/v1/login/second-factor', secondFactor);
}
