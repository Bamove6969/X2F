import { createHmac, randomBytes } from 'node:crypto';
import { checkPassword, normalizePassword, type AccountKind } from '@x2f/accounts';
import argon2 from 'argon2';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Deps } from '../app.js';
import { SIGNATURE_BODY_ALLOWANCE } from '../termsSignature.js';
import type { Config } from '../config.js';
import type { Queryable } from '../db/pool.js';
import { addAlert } from '../alerts.js';
import {
  assertDisplayNameFree, assertNewNames, assertTermsAccepted, createAccount, loginNameLookup, loginTagMatch, retagLoginName, type LoginTags,
} from '../accounts.js';
import { ApiError } from '../errors.js';
import { ARGON2_SLOTS } from '../limits.js';
import { parseConfirmAction } from './actionInput.js';
import { issueConfirmToken, requireConfirm } from './confirm.js';
import { deviceHash, ensureDeviceCookie } from './device.js';
import { methodAllowed, passwordAllowed } from './methods.js';
import { traderLogin } from './approval.js';
import { gateChange, heldReply, pushHoldStarted, requireNotHeld } from './hold.js';
import { assertNotDisabled, requireSession, startSession } from './sessions.js';
import {
  claimPasswordTry, passwordMiss, throttleCheck, throttleFail, throttleKey, throttleReset, visitorMiss, visitorReset,
} from './throttle.js';
import { hasTotp, issueSecondFactor, verifyTotp } from './totp.js';

/** Global Constraints: Argon2id, 64 MiB, 3 passes, 1 lane. */
const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 1 } as const;

/** Password routes refuse bigger bodies with 413 before any hashing. */
export const PASSWORD_BODY_LIMIT = 4 * 1024;
/**
 * Register carries the Terms signature too (owner, 8 Nov 2026), so its limit adds the signature's
 * room; the signature and the password (at most 256 characters, `checkPassword`) are both checked
 * before any hashing.
 */
export const REGISTER_PASSWORD_BODY_LIMIT = PASSWORD_BODY_LIMIT + SIGNATURE_BODY_ALLOWANCE;

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
const PASSWORD_BY_NAME = `select a.id, a.kind, a.login_tag_key_id, p.hash, p.pepper_id
  from accounts a left join passwords p on p.account_id = a.id where ${loginTagMatch('a', 1)}`;
const PASSWORD_BY_ID =
  'select a.id, a.kind, a.login_tag_key_id, p.hash, p.pepper_id from accounts a left join passwords p on p.account_id = a.id where a.id = $1';

type Found = { accountId: string | null; tagKeyId: number | null; stored: StoredPassword; real: boolean };

/** `DUMMY_HASH` checked under the current pepper: the path of every login that has no real hash. */
const dummyFor = (config: Config): StoredPassword => ({ hash: DUMMY_HASH, pepperId: config.passwordPeppers.current });

async function passwordFor(deps: Pick<Deps, 'db' | 'config'>, where: { login: LoginTags } | { accountId: string }): Promise<Found> {
  const { rows } = await deps.db.query<{
    id: string; kind: AccountKind; login_tag_key_id: number | null; hash: string | null; pepper_id: number | null;
  }>(
    'login' in where ? PASSWORD_BY_NAME : PASSWORD_BY_ID,
    'login' in where ? [where.login.ids, where.login.tags] : [where.accountId],
  );
  const row = rows[0];
  const real = row !== undefined && row.hash !== null && passwordAllowed(row.kind);
  return {
    accountId: row?.id ?? null,
    tagKeyId: row?.login_tag_key_id ?? null,
    stored: real ? { hash: row.hash!, pepperId: row.pepper_id } : dummyFor(deps.config),
    real,
  };
}

/**
 * FU-C migration, run in the Argon2 slot after a right password: a real hash stored without a
 * pepper or under an older one gets a new hash under the current pepper; otherwise null.
 */
async function staleRehash(config: Config, found: Found, password: string): Promise<string | null> {
  const current = config.passwordPeppers.current;
  if (!found.real || found.stored.pepperId === current) return null;
  return argon2.hash(pepperedPassword(config, current, password), ARGON2_OPTIONS);
}

/**
 * Writes a `staleRehash` result back only if the stored hash is still the one just checked (a
 * password change in between wins). `updated_at` stays: it is not a new password.
 */
async function storeRehash(deps: Pick<Deps, 'db' | 'config'>, accountId: string, found: Found, rehash: string | null): Promise<void> {
  if (rehash === null) return;
  await deps.db.query('update passwords set hash = $2, pepper_id = $3 where account_id = $1 and hash = $4', [
    accountId, rehash, deps.config.passwordPeppers.current, found.stored.hash,
  ]);
}

/**
 * The confirm path's throttled password check on the signed-in account's `password` key: one
 * Argon2 verify, a failure counted and answered 401 `credentials-invalid`. The throttle check runs
 * only once an Argon2 slot is held, so a 503 `busy` refusal never claims (and so never wastes) a
 * throttle try; a 429 refusal releases the slot without verifying. A right password under a stale
 * pepper is hashed again in the same slot (`staleRehash`) and written back by `storeRehash`.
 */
async function checkCredentials(deps: Deps, req: FastifyRequest, found: Found, accountId: string, password: string): Promise<string> {
  const key = await throttleKey(deps, req, 'password', { id: accountId });
  const { verified, rehash } = await ARGON2_SLOTS.run(async () => {
    await throttleCheck(deps, key);
    const ok = await verifyStored(deps.config, found.stored, password);
    return { verified: ok, rehash: ok ? await staleRehash(deps.config, found, password) : null };
  });
  if (!verified || !found.real || found.accountId !== accountId) {
    await throttleFail(deps, key, accountId);
    throw new ApiError(401, 'credentials-invalid');
  }
  await throttleReset(deps, key);
  await storeRehash(deps, accountId, found, rehash);
  return accountId;
}

/**
 * The one answer to every failed password login (owner, 2026-10-23): an unknown login name, a
 * wrong password, a name that may not use a password and a quietly locked name all get 401
 * `credentials-invalid` ("That login name and password don't match") with `misses`, this
 * browser's misses in a row, so the page can send the visitor away after about 10. No wait, lock
 * or retry time is ever shown.
 */
async function loginMiss(deps: Deps, req: FastifyRequest): Promise<never> {
  const misses = await visitorMiss(deps, deviceHash(req));
  throw new ApiError(401, 'credentials-invalid', { misses });
}

async function registerHandler(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  ensureDeviceCookie(req, reply);
  req.server.budgets.register.take();
  const body = req.body as Record<string, unknown> | null;
  const terms = assertTermsAccepted(
    deps,
    body !== null && typeof body === 'object' ? body.acceptedTerms : undefined,
    body !== null && typeof body === 'object' ? body.termsSignature : undefined,
  );
  const { displayName: rawDisplay, loginName: rawLogin, password, deviceLabel } = strings(
    body, ['displayName', 'loginName', 'password', 'deviceLabel'] as const,
  );
  const names = await assertNewNames(deps.db, rawDisplay, rawLogin);
  await assertNewPassword(deps, password);
  // A taken display name answers before the expensive hash; a taken login name only at create.
  await assertDisplayNameFree(deps.db, names);
  const { hash, pepperId } = await hashPassword(deps.config, password);

  const now = deps.clock();
  const client = await deps.db.connect();
  let accountId: string;
  try {
    await client.query('begin');
    try {
      accountId = await createAccount(client, deps.config, { ...names, kind: 'trader', termsVersion: terms.version, termsSignature: terms.signature, now });
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
  return reply.code(201).send({ displayName: names.displayName });
}

/**
 * `POST /v1/login/password { loginName, password, deviceLabel }`. Every path runs exactly one Argon2
 * verify: the account's own hash when the login name exists, may use a password, has one and is not
 * quietly locked (`claimPasswordTry`); otherwise `DUMMY_HASH`. Every failure is `loginMiss`.
 */
async function loginHandler(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  ensureDeviceCookie(req, reply);
  req.server.budgets.start.take();
  const { loginName, password, deviceLabel } = strings(req.body, ['loginName', 'password', 'deviceLabel'] as const);
  const name = loginNameLookup(deps.config, loginName);
  // A malformed name cannot match an account: it takes the unknown-account path (dummy verify).
  // Always one lookup under every key of the ring (FU-D), so a malformed name costs the same queries and HMACs.
  const found = await passwordFor(deps, { login: name.candidates });
  const key = await throttleKey(deps, req, 'password-login', found.accountId !== null ? { id: found.accountId } : { nameTag: name.tag });
  // The try is claimed only once an Argon2 slot is held, so a 503 `busy` never uses one up.
  const outcome = await ARGON2_SLOTS.run(async () => {
    const tryNumber = await claimPasswordTry(deps, key);
    const stored = tryNumber !== null ? found.stored : dummyFor(deps.config);
    const verified = await verifyStored(deps.config, stored, password);
    const ok = verified && tryNumber !== null && found.real;
    return { tryNumber, ok, rehash: ok ? await staleRehash(deps.config, found, password) : null };
  });
  if (!outcome.ok || found.accountId === null) {
    if (outcome.tryNumber !== null) await passwordMiss(deps, key, outcome.tryNumber, found.accountId);
    return loginMiss(deps, req);
  }
  const accountId = found.accountId;
  await throttleReset(deps, key);
  await visitorReset(deps, deviceHash(req));
  await storeRehash(deps, accountId, found, outcome.rehash);
  // Only after the password checks out, so a disabled account is not revealed to anyone else.
  await assertNotDisabled(deps.db, accountId);
  // FU-D: a row tagged under an older key moves to the current one (the password is proved).
  if (found.tagKeyId !== null) await retagLoginName(deps, { id: accountId, login_tag_key_id: found.tagKeyId }, name.candidates.current);
  // With TOTP enrolled, no session until `POST /v1/login/second-factor` accepts the code.
  if (await hasTotp(deps.db, accountId)) {
    const pendingId = await issueSecondFactor(deps, req, { accountId, deviceLabel });
    return { status: 'second-factor' as const, pendingId, needs: ['totp'] };
  }
  // Task 16: a session now, or an approval from a logged-in device first.
  return traderLogin(deps, req, reply, { accountId, method: 'password', deviceLabel, factors: ['password'] });
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
  await checkCredentials(deps, req, found, req.auth.accountId, password);
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
  // A password, with or without its TOTP code, is the weak kind of proof (a new wallet waits 24 hours).
  const confirmToken = await issueConfirmToken(deps, {
    sessionId: req.auth.sessionId, accountId: req.auth.accountId, action, method: 'password',
  });
  return { confirmToken };
}

/** The new password of `PUT /v1/account/password`, checked before `requireConfirm` so a refusal never uses up a token. */
const checkedPassword = new WeakMap<FastifyRequest, string>();

/** 429 `slow-down` `{ retryAfterSeconds }` once the calling session has used its `SECURITY_CHANGE_BUCKET`. */
const throttlePasswordChange: preHandlerAsyncHookHandler = async function (req) {
  req.server.budgets.securityChange.take(req.auth.sessionId);
};

const checkNewPassword: preHandlerAsyncHookHandler = async function (req) {
  const { password } = strings(req.body, ['password'] as const);
  await assertNewPassword(req.server.deps, password);
  checkedPassword.set(req, password);
};

/**
 * `PUT /v1/account/password { password, confirmToken? }`: sets or replaces the account's password.
 * Behind `requireSession({ allowRecovery: true })` (a held TOTP backup session is refused by
 * `requireSession` until its hold ends), a per-session throttle (`SECURITY_CHANGE_BUCKET`, 429 `slow-down`), `assertMethodAllowed` (staff and the owner never get one,
 * R2), the password checks, then `requireConfirm({ kind: 'set-password' })` with the onboarding and
 * recovery exemptions. In one transaction: the new hash, alert `login-method-added`, every other
 * session of the account ended and alert `sessions-ended` when any were; the calling session goes on.
 */
async function setPasswordHandler(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  const password = checkedPassword.get(req);
  if (password === undefined) throw new ApiError(400, 'bad-request');
  const { hash, pepperId } = await hashPassword(deps.config, password);
  const now = deps.clock();
  const { accountId, sessionId } = req.auth;
  const client = await deps.db.connect();
  let held: { holdUntil: Date } | null = null;
  let ended = 0;
  try {
    await client.query('begin');
    try {
      // Task 17: a waiting login's change starts the hold and waits in it (in this transaction).
      held = await gateChange(client, req, { kind: 'password', hash, pepperId });
      if (held === null) ended = await applyPassword(client, accountId, { hash, pepperId }, sessionId, now);
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  } finally {
    client.release();
  }
  if (held !== null) {
    pushHoldStarted(req, accountId);
    return reply.code(202).send(heldReply(held));
  }
  // The other sessions are revoked: end their live streams now, not at the stream lifetime.
  if (ended > 0) req.server.events.closeAccount(accountId, sessionId);
  return { ok: true };
}

/**
 * The write of a password change (the route's, or a pending one when the hold ends by time): the
 * new hash, alert `login-method-added`, every session but `keepSessionId` ended and alert
 * `sessions-ended` when any were. Returns how many sessions it ended.
 */
export async function applyPassword(
  db: Queryable,
  accountId: string,
  p: { hash: string; pepperId: number },
  keepSessionId: string | null,
  now: Date,
): Promise<number> {
  await db.query(
    `insert into passwords (account_id, hash, pepper_id, updated_at) values ($1, $2, $3, $4)
     on conflict (account_id) do update set hash = excluded.hash, pepper_id = excluded.pepper_id, updated_at = excluded.updated_at`,
    [accountId, p.hash, p.pepperId, now],
  );
  await addAlert(db, accountId, 'login-method-added', { method: 'password' }, now);
  const ended = await db.query(
    'update sessions set revoked_at = $3 where account_id = $1 and id is distinct from $2 and revoked_at is null',
    [accountId, keepSessionId, now],
  );
  const count = ended.rowCount ?? 0;
  if (count > 0) await addAlert(db, accountId, 'sessions-ended', { count, reason: 'password-set' }, now);
  return count;
}

/**
 * `POST /v1/register/password`, `POST /v1/login/password`, `POST /v1/confirm/password` and
 * `PUT /v1/account/password`. All refuse bodies over 4 KiB (register: 4 KiB plus the Terms
 * signature's room, `REGISTER_PASSWORD_BODY_LIMIT`) with 413 before hashing; the public
 * routes set the device cookie; register draws on the register budget, login on the start budget.
 * Register takes `{ displayName, loginName, password, deviceLabel, acceptedTerms, termsSignature }` and answers
 * `{ displayName }` only: the login name is never sent back.
 */
export function passwordRoutes(app: FastifyInstance): void {
  const opts = { bodyLimit: PASSWORD_BODY_LIMIT };
  app.post('/v1/register/password', { bodyLimit: REGISTER_PASSWORD_BODY_LIMIT }, registerHandler);
  app.post('/v1/login/password', opts, loginHandler);
  app.post('/v1/confirm/password', { ...opts, preHandler: requireSession() }, confirmHandler);
  app.put(
    '/v1/account/password',
    {
      ...opts,
      preHandler: [
        requireSession({ allowRecovery: true }),
        // Review round 3 R3-I1: tries per session, refused ones included (a loop against the hold runs dry).
        throttlePasswordChange,
        methodAllowed('password'),
        // Task 17: refused during the hold before a confirm token is spent (the gate checks again).
        requireNotHeld,
        checkNewPassword,
        requireConfirm({ kind: 'set-password' }, { onboarding: true, recovery: true }),
      ],
    },
    setPasswordHandler,
  );
}
