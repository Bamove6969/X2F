import { createHash, createHmac, randomBytes } from 'node:crypto';
import { checkPassword, checkUsername, normalizePassword, type AccountKind } from '@x2f/accounts';
import argon2 from 'argon2';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Deps } from '../app.js';
import type { Config } from '../config.js';
import { addAlert } from '../alerts.js';
import { assertTermsAccepted, assertUsername, createAccount } from '../accounts.js';
import { ApiError } from '../errors.js';
import { ARGON2_SLOTS } from '../limits.js';
import { parseConfirmAction } from './actionInput.js';
import { issueConfirmToken, requireConfirm } from './confirm.js';
import { ensureDeviceCookie } from './device.js';
import { methodAllowed, passwordAllowed } from './methods.js';
import { assertNotDisabled, requireSession, startSession } from './sessions.js';
import { throttleCheck, throttleFail, throttleKey, throttleReset } from './throttle.js';
import { hasTotp, issueSecondFactor, verifyTotp } from './totp.js';

/** Global Constraints: Argon2id, 64 MiB, 3 passes, 1 lane. */
const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 1 } as const;

/** Password routes refuse bigger bodies with 413 before any hashing. */
export const PASSWORD_BODY_LIMIT = 4 * 1024;

/**
 * What Argon2id hashes (FU-C, ASVS 2.4.5): HMAC-SHA-256 of the NFC password under the pepper
 * `pepperId` of `X2F_PASSWORD_PEPPERS`. A stolen database alone cannot be guessed against offline.
 * Throws when the ring no longer holds `pepperId`.
 */
export function pepperedPassword(config: Config, pepperId: number, pw: string): Buffer {
  const pepper = config.passwordPeppers.keys.get(pepperId);
  if (pepper === undefined) throw new Error(`password pepper ${pepperId} is not configured`);
  return createHmac('sha256', pepper).update(normalizePassword(pw), 'utf8').digest();
}

/** A stored password: the Argon2id string and the pepper it was made with (null = before FU-C, no pepper). */
export interface StoredPassword {
  hash: string;
  pepperId: number | null;
}

/** Argon2id of the peppered NFC form under the current pepper, inside `ARGON2_SLOTS` (503 `busy` when full). */
export async function hashPassword(config: Config, pw: string): Promise<{ hash: string; pepperId: number }> {
  const pepperId = config.passwordPeppers.current;
  const input = pepperedPassword(config, pepperId, pw);
  return { hash: await ARGON2_SLOTS.run(() => argon2.hash(input, ARGON2_OPTIONS)), pepperId };
}

/**
 * The Argon2 call that checks `pw` against `stored`, always exactly one verify: a legacy hash
 * (pepper null) gets the NFC password, a peppered one its peppered form; a hash whose pepper the
 * ring no longer holds, or a legacy hash with `X2F_LEGACY_SECRETS=off`, is checked as `DUMMY_HASH`
 * (always false), so it fails like a wrong password.
 */
function verifyStored(config: Config, stored: StoredPassword, pw: string): Promise<boolean> {
  if (stored.pepperId === null && config.legacySecrets) return argon2.verify(stored.hash, normalizePassword(pw));
  if (stored.pepperId === null || !config.passwordPeppers.keys.has(stored.pepperId)) {
    return argon2.verify(DUMMY_HASH, pepperedPassword(config, config.passwordPeppers.current, pw));
  }
  return argon2.verify(stored.hash, pepperedPassword(config, stored.pepperId, pw));
}

/** Checks `pw` against a stored password, inside `ARGON2_SLOTS` (503 `busy` when full). */
export function verifyPassword(config: Config, stored: StoredPassword, pw: string): Promise<boolean> {
  return ARGON2_SLOTS.run(() => verifyStored(config, stored, pw));
}

/**
 * Computed once at startup from a random password nobody knows. Verified in place of a real hash
 * when the account is unknown, has no password, or its kind may not use passwords, so the time a
 * login takes reveals none of these.
 */
export const DUMMY_HASH: string = await argon2.hash(randomBytes(32).toString('base64url'), ARGON2_OPTIONS);

/** 400 `password-weak` `{ missing }`, then 400 `password-leaked` (list on X2F's own server). */
export async function assertNewPassword(deps: Pick<Deps, 'leaked'>, pw: string): Promise<void> {
  const check = checkPassword(pw);
  if (!check.ok) throw new ApiError(400, 'password-weak', { missing: check.missing });
  if (await deps.leaked.has(pw)) throw new ApiError(400, 'password-leaked');
}

/** The listed string fields of a JSON body; anything missing or not a string → 400 `bad-request`. */
function strings<K extends string>(body: unknown, keys: readonly K[]): Record<K, string> {
  if (body === null || typeof body !== 'object') throw new ApiError(400, 'bad-request');
  const rec = body as Record<string, unknown>;
  const out = {} as Record<K, string>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v !== 'string') throw new ApiError(400, 'bad-request');
    out[k] = v;
  }
  return out;
}

/**
 * The stored hash to check a password against: the account's own when it exists, has a password
 * and its kind may use one; otherwise `DUMMY_HASH`, so every path runs exactly one Argon2 verify.
 */
const PASSWORD_BY_NAME =
  'select a.id, a.kind, p.hash, p.pepper_id from accounts a left join passwords p on p.account_id = a.id where a.username_key = $1';
const PASSWORD_BY_ID =
  'select a.id, a.kind, p.hash, p.pepper_id from accounts a left join passwords p on p.account_id = a.id where a.id = $1';

type Found = { accountId: string | null; stored: StoredPassword; real: boolean };

/** `DUMMY_HASH` checked under the current pepper: the path of every login that has no real hash. */
const dummyFor = (config: Config): StoredPassword => ({ hash: DUMMY_HASH, pepperId: config.passwordPeppers.current });

async function passwordFor(deps: Pick<Deps, 'db' | 'config'>, where: { usernameKey: string } | { accountId: string }): Promise<Found> {
  const { rows } = await deps.db.query<{ id: string; kind: AccountKind; hash: string | null; pepper_id: number | null }>(
    'usernameKey' in where ? PASSWORD_BY_NAME : PASSWORD_BY_ID,
    ['usernameKey' in where ? where.usernameKey : where.accountId],
  );
  const row = rows[0];
  const real = row !== undefined && row.hash !== null && passwordAllowed(row.kind);
  return {
    accountId: row?.id ?? null,
    stored: real ? { hash: row.hash!, pepperId: row.pepper_id } : dummyFor(deps.config),
    real,
  };
}

/**
 * Throttled password check on one account's (or unknown name's) `password` key: one Argon2 verify,
 * a failure counted and answered 401 `credentials-invalid`. The throttle check runs only once an
 * Argon2 slot is held, so a 503 `busy` refusal never claims (and so never wastes) a throttle try;
 * a 429 refusal releases the slot without verifying.
 *
 * FU-C migration: a right password stored without a pepper or under an older one is hashed again
 * under the current pepper in the same slot and written back only if the stored hash is still the
 * one just checked (a password change in between wins). `updated_at` stays: it is not a new password.
 */
async function checkCredentials(deps: Deps, req: FastifyRequest, found: Found, nameKey: string, password: string): Promise<string> {
  const key = await throttleKey(deps, req, 'password', found.accountId ? { id: found.accountId } : { usernameKey: nameKey });
  const current = deps.config.passwordPeppers.current;
  const { verified, rehash } = await ARGON2_SLOTS.run(async () => {
    await throttleCheck(deps, key);
    const ok = await verifyStored(deps.config, found.stored, password);
    const stale = ok && found.real && found.stored.pepperId !== current;
    return {
      verified: ok,
      rehash: stale ? await argon2.hash(pepperedPassword(deps.config, current, password), ARGON2_OPTIONS) : null,
    };
  });
  if (!verified || !found.real || found.accountId === null) {
    await throttleFail(deps, key, found.accountId);
    throw new ApiError(401, 'credentials-invalid');
  }
  await throttleReset(deps, key);
  if (rehash !== null) {
    await deps.db.query('update passwords set hash = $2, pepper_id = $3 where account_id = $1 and hash = $4', [
      found.accountId, rehash, current, found.stored.hash,
    ]);
  }
  return found.accountId;
}

/**
 * The name a malformed username is throttled under: `~` + SHA-256 hex of its first 64 code units.
 * Never the raw input (a NUL would make Postgres refuse the key), and `~` cannot start a valid
 * username key, so it never shares a key with a real name.
 */
export function nameKeyOf(username: string): string {
  return `~${createHash('sha256').update(username.slice(0, 64)).digest('hex')}`;
}

async function registerHandler(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  ensureDeviceCookie(req, reply);
  req.server.budgets.register.take();
  const body = req.body as Record<string, unknown> | null;
  const terms = assertTermsAccepted(deps, body !== null && typeof body === 'object' ? body.acceptedTerms : undefined);
  const { username: rawName, password, deviceLabel } = strings(body, ['username', 'password', 'deviceLabel'] as const);
  const { username, key } = assertUsername(rawName);
  await assertNewPassword(deps, password);
  // Taken names answer before the expensive hash; the unique index still decides races.
  const taken = await deps.db.query('select 1 from accounts where username_key = $1', [key]);
  if (taken.rows.length > 0) throw new ApiError(409, 'username-taken');
  const { hash, pepperId } = await hashPassword(deps.config, password);

  const now = deps.clock();
  const client = await deps.db.connect();
  let accountId: string;
  try {
    await client.query('begin');
    try {
      accountId = await createAccount(client, { username, key, kind: 'trader', termsVersion: terms, now });
      await client.query('insert into passwords (account_id, hash, pepper_id, updated_at) values ($1, $2, $3, $4)', [
        accountId, hash, pepperId, now,
      ]);
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  } finally {
    client.release();
  }

  await startSession(deps, req, reply, { accountId, level: 'full', deviceLabel, method: 'password', firstSession: true });
  return reply.code(201).send({ username });
}

async function loginHandler(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  ensureDeviceCookie(req, reply);
  req.server.budgets.start.take();
  const { username: rawName, password, deviceLabel } = strings(req.body, ['username', 'password', 'deviceLabel'] as const);
  const name = checkUsername(rawName);
  // A malformed name cannot match an account: it takes the unknown-account path (dummy verify).
  const nameKey = name.ok ? name.key : nameKeyOf(rawName);
  const found: Found = name.ok
    ? await passwordFor(deps, { usernameKey: name.key })
    : { accountId: null, stored: dummyFor(deps.config), real: false };
  const accountId = await checkCredentials(deps, req, found, nameKey, password);
  // Only after the password checks out, so a disabled account is not revealed to anyone else.
  await assertNotDisabled(deps.db, accountId);
  // With TOTP enrolled, no session until `POST /v1/login/second-factor` accepts the code.
  if (await hasTotp(deps.db, accountId)) {
    const pendingId = await issueSecondFactor(deps, req, { accountId, deviceLabel });
    return { status: 'second-factor' as const, pendingId, needs: ['totp'] };
  }
  await startSession(deps, req, reply, { accountId, level: 'full', deviceLabel, method: 'password', firstSession: false });
  return { status: 'ok' as const };
}

async function confirmHandler(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  ensureDeviceCookie(req, reply);
  const { password } = strings(req.body, ['password'] as const);
  const action = parseConfirmAction((req.body as Record<string, unknown>).action);
  const totp = (req.body as Record<string, unknown>).totp;
  if (totp !== undefined && typeof totp !== 'string') throw new ApiError(400, 'bad-request');
  const enrolled = await hasTotp(deps.db, req.auth.accountId);
  if (enrolled && totp === undefined) {
    // Refused before any Argon2 work and counted as a password failure, so neither the answer nor
    // the throttle tells whether the password was right.
    const key = await throttleKey(deps, req, 'password', { id: req.auth.accountId });
    await throttleCheck(deps, key);
    await throttleFail(deps, key, req.auth.accountId);
    throw new ApiError(401, 'credentials-invalid');
  }
  const found = await passwordFor(deps, { accountId: req.auth.accountId });
  await checkCredentials(deps, req, found, '', password);
  // Once TOTP is enrolled, a confirm needs the current code too; a wrong one counts on the `totp` key.
  if (enrolled && totp !== undefined) {
    const key = await throttleKey(deps, req, 'totp', { id: req.auth.accountId });
    await throttleCheck(deps, key);
    if (!(await verifyTotp(deps, req.auth.accountId, totp))) {
      await throttleFail(deps, key, req.auth.accountId);
      throw new ApiError(401, 'credentials-invalid');
    }
    await throttleReset(deps, key);
  }
  const confirmToken = await issueConfirmToken(deps, { sessionId: req.auth.sessionId, accountId: req.auth.accountId, action });
  return { confirmToken };
}

/** The new password of `PUT /v1/account/password`, checked before `requireConfirm` so a refusal never uses up a token. */
const checkedPassword = new WeakMap<FastifyRequest, string>();

const checkNewPassword: preHandlerAsyncHookHandler = async function (req) {
  const { password } = strings(req.body, ['password'] as const);
  await assertNewPassword(req.server.deps, password);
  checkedPassword.set(req, password);
};

/**
 * `PUT /v1/account/password { password, confirmToken? }`: sets or replaces the account's password.
 * Behind `requireSession({ allowRecovery: true })` (a held TOTP backup session is refused by
 * `requireSession` until its hold ends), `assertMethodAllowed` (staff and the owner never get one,
 * R2), the password checks, then `requireConfirm({ kind: 'set-password' })` with the onboarding and
 * recovery exemptions. In one transaction: the new hash, alert `login-method-added`, every other
 * session of the account ended and alert `sessions-ended` when any were; the calling session goes on.
 */
async function setPasswordHandler(req: FastifyRequest) {
  const deps = req.server.deps;
  const password = checkedPassword.get(req);
  if (password === undefined) throw new ApiError(400, 'bad-request');
  const { hash, pepperId } = await hashPassword(deps.config, password);
  const now = deps.clock();
  const { accountId, sessionId } = req.auth;
  const client = await deps.db.connect();
  try {
    await client.query('begin');
    try {
      await client.query(
        `insert into passwords (account_id, hash, pepper_id, updated_at) values ($1, $2, $3, $4)
         on conflict (account_id) do update set hash = excluded.hash, pepper_id = excluded.pepper_id, updated_at = excluded.updated_at`,
        [accountId, hash, pepperId, now],
      );
      await addAlert(client, accountId, 'login-method-added', { method: 'password' }, now);
      const ended = await client.query(
        'update sessions set revoked_at = $3 where account_id = $1 and id <> $2 and revoked_at is null',
        [accountId, sessionId, now],
      );
      const count = ended.rowCount ?? 0;
      if (count > 0) await addAlert(client, accountId, 'sessions-ended', { count, reason: 'password-set' }, now);
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
 * `POST /v1/register/password`, `POST /v1/login/password`, `POST /v1/confirm/password` and
 * `PUT /v1/account/password`. All refuse bodies over 4 KiB with 413 before hashing; the public
 * routes set the device cookie; register draws on the register budget, login on the start budget.
 */
export function passwordRoutes(app: FastifyInstance): void {
  const opts = { bodyLimit: PASSWORD_BODY_LIMIT };
  app.post('/v1/register/password', opts, registerHandler);
  app.post('/v1/login/password', opts, loginHandler);
  app.post('/v1/confirm/password', { ...opts, preHandler: requireSession() }, confirmHandler);
  app.put(
    '/v1/account/password',
    {
      ...opts,
      preHandler: [
        requireSession({ allowRecovery: true }),
        methodAllowed('password'),
        checkNewPassword,
        requireConfirm({ kind: 'set-password' }, { onboarding: true, recovery: true }),
      ],
    },
    setPasswordHandler,
  );
}
