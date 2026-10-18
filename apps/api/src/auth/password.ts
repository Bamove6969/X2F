import { randomBytes } from 'node:crypto';
import { checkPassword, checkUsername, normalizePassword, type AccountKind } from '@x2f/accounts';
import argon2 from 'argon2';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Deps } from '../app.js';
import { assertTermsAccepted, assertUsername, createAccount } from '../accounts.js';
import { ApiError } from '../errors.js';
import { ARGON2_SLOTS } from '../limits.js';
import { parseConfirmAction } from './actionInput.js';
import { issueConfirmToken } from './confirm.js';
import { ensureDeviceCookie } from './device.js';
import { assertNotDisabled, requireSession, startSession } from './sessions.js';
import { throttleCheck, throttleFail, throttleKey, throttleReset } from './throttle.js';

/** Global Constraints: Argon2id, 64 MiB, 3 passes, 1 lane. */
const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 1 } as const;

/** Password routes refuse bigger bodies with 413 before any hashing. */
export const PASSWORD_BODY_LIMIT = 4 * 1024;

/** Argon2id of the NFC form, inside `ARGON2_SLOTS` (503 `busy` when full). */
export function hashPassword(pw: string): Promise<string> {
  return ARGON2_SLOTS.run(() => argon2.hash(normalizePassword(pw), ARGON2_OPTIONS));
}

/** Checks `pw` against an Argon2 hash, inside `ARGON2_SLOTS` (503 `busy` when full). */
export function verifyPassword(hash: string, pw: string): Promise<boolean> {
  return ARGON2_SLOTS.run(() => argon2.verify(hash, normalizePassword(pw)));
}

/**
 * Computed once at startup from a random password nobody knows. Verified in place of a real hash
 * when the account is unknown, has no password, or its kind may not use passwords, so the time a
 * login takes reveals none of these.
 */
export const DUMMY_HASH: string = await argon2.hash(randomBytes(32).toString('base64url'), ARGON2_OPTIONS);

/** Until Task 10's `passwordAllowed(kind)`, only traders use passwords. */
function passwordAllowed(kind: AccountKind): boolean {
  return kind === 'trader';
}

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
  'select a.id, a.kind, p.hash from accounts a left join passwords p on p.account_id = a.id where a.username_key = $1';
const PASSWORD_BY_ID = 'select a.id, a.kind, p.hash from accounts a left join passwords p on p.account_id = a.id where a.id = $1';

async function passwordFor(deps: Pick<Deps, 'db'>, where: { usernameKey: string } | { accountId: string }) {
  const { rows } = await deps.db.query<{ id: string; kind: AccountKind; hash: string | null }>(
    'usernameKey' in where ? PASSWORD_BY_NAME : PASSWORD_BY_ID,
    ['usernameKey' in where ? where.usernameKey : where.accountId],
  );
  const row = rows[0];
  const real = row !== undefined && row.hash !== null && passwordAllowed(row.kind);
  return { accountId: row?.id ?? null, hash: real ? row.hash! : DUMMY_HASH, real };
}

/**
 * Throttled password check on one account's (or unknown name's) `password` key: 429 while the key
 * waits, otherwise one Argon2 verify; a failure is counted and answered 401 `credentials-invalid`.
 */
async function checkCredentials(
  deps: Deps,
  req: FastifyRequest,
  found: { accountId: string | null; hash: string; real: boolean },
  nameKey: string,
  password: string,
): Promise<string> {
  const key = await throttleKey(deps, req, 'password', found.accountId ? { id: found.accountId } : { usernameKey: nameKey });
  await throttleCheck(deps, key);
  const verified = await verifyPassword(found.hash, password);
  if (!verified || !found.real || found.accountId === null) {
    await throttleFail(deps, key, found.accountId);
    throw new ApiError(401, 'credentials-invalid');
  }
  await throttleReset(deps, key);
  return found.accountId;
}

/**
 * The name an unknown or malformed username is throttled under. Raw input over 64 code units is
 * cut (checkUsername refuses it anyway), so a key never grows with the request.
 */
function nameKeyOf(username: string): string {
  return username.slice(0, 64).toLowerCase();
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
  const hash = await hashPassword(password);

  const now = deps.clock();
  const client = await deps.db.connect();
  let accountId: string;
  try {
    await client.query('begin');
    try {
      accountId = await createAccount(client, { username, key, kind: 'trader', termsVersion: terms, now });
      await client.query('insert into passwords (account_id, hash, updated_at) values ($1, $2, $3)', [accountId, hash, now]);
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
  const found = name.ok ? await passwordFor(deps, { usernameKey: name.key }) : { accountId: null, hash: DUMMY_HASH, real: false };
  const accountId = await checkCredentials(deps, req, found, nameKey, password);
  // Only after the password checks out, so a disabled account is not revealed to anyone else.
  await assertNotDisabled(deps.db, accountId);
  // TODO(Task 9): an account with TOTP answers { status: 'second-factor', pendingId } here.
  await startSession(deps, req, reply, { accountId, level: 'full', deviceLabel, method: 'password', firstSession: false });
  return { status: 'ok' as const };
}

async function confirmHandler(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  ensureDeviceCookie(req, reply);
  const { password } = strings(req.body, ['password'] as const);
  const action = parseConfirmAction((req.body as Record<string, unknown>).action);
  // TODO(Task 9): `totp` is checked here when the account has TOTP.
  const found = await passwordFor(deps, { accountId: req.auth.accountId });
  await checkCredentials(deps, req, found, '', password);
  const confirmToken = await issueConfirmToken(deps, { sessionId: req.auth.sessionId, accountId: req.auth.accountId, action });
  return { confirmToken };
}

/**
 * `POST /v1/register/password`, `POST /v1/login/password` and `POST /v1/confirm/password`. All set
 * the device cookie and refuse bodies over 4 KiB with 413 before hashing; register draws on the
 * register budget, login on the start budget.
 */
export function passwordRoutes(app: FastifyInstance): void {
  const opts = { bodyLimit: PASSWORD_BODY_LIMIT };
  app.post('/v1/register/password', opts, registerHandler);
  app.post('/v1/login/password', opts, loginHandler);
  app.post('/v1/confirm/password', { ...opts, preHandler: requireSession() }, confirmHandler);
}
