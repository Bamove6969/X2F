import type { FastifyRequest } from 'fastify';
import type { Deps } from '../app.js';
import { ApiError } from '../errors.js';
import { deviceHash, isTrusted } from './device.js';

/**
 * Only guessable secrets are throttled (P2-C1). PGP codes (60-bit, single-use) and WebAuthn are
 * never subject to these keys, so a flood of bad passwords cannot lock those methods out.
 */
export type ThrottledMethod = 'password' | 'password-login' | 'totp' | 'recovery-code';

/** Match no row: the stand-ins for "no account" and "no device cookie" in lookups that must always run. */
export const NIL_UUID = '00000000-0000-0000-0000-000000000000';
export const NO_DEVICE: Buffer = Buffer.alloc(32);

/**
 * The alert for a streak that reached its lock, with the same SQL when there is no account or the
 * streak was already alerted (I-1): one update flips `alerted`, then one insert into `alerts` that
 * adds the row only for a real account whose streak this call flipped (else it inserts nothing).
 */
async function lockAlert(deps: Pick<Deps, 'db' | 'clock'>, key: string, accountId: string | null, method: string): Promise<void> {
  const flipped = await deps.db.query('update login_throttle set alerted = true where key = $1 and alerted = false', [key]);
  const add = (flipped.rowCount ?? 0) > 0 && accountId !== null;
  await deps.db.query(
    `insert into alerts (account_id, kind, detail, created_at) select $1::uuid, $2::text, $3::jsonb, $4::timestamptz where $5::boolean`,
    [accountId ?? NIL_UUID, 'login-locked', JSON.stringify({ method }), deps.clock(), add],
  );
}

const FREE_FAILURES = 3;
const LOCK_AT = 10;
const MAX_WAIT_MS = 30_000;
const STREAK_MS = 15 * 60_000;

/**
 * `<method>:<accountId | name:<name tag>>:<dev:<hex device hash> | anon>`. The device part is
 * used only when this browser's device is trusted for that account, so failures from unknown
 * browsers never slow down or lock a known one. A `name:` key (no account) is always `anon`; its
 * tag is `loginNameLookup(...).tag`, an HMAC, never the typed name.
 */
export async function throttleKey(
  deps: Pick<Deps, 'db' | 'clock'>,
  req: FastifyRequest,
  method: ThrottledMethod,
  account: { id: string } | { nameTag: string },
): Promise<string> {
  // The trusted-device lookup always runs, for no account and no cookie too, so the query count
  // never tells a known login name from an unknown one (I-1).
  const hash = deviceHash(req);
  const found = await isTrusted(deps, 'id' in account ? account.id : NIL_UUID, hash ?? NO_DEVICE);
  if (!('id' in account)) return `${method}:name:${account.nameTag}:anon`;
  const trusted = hash !== null && found;
  return `${method}:${account.id}:${trusted ? `dev:${hash.toString('hex')}` : 'anon'}`;
}

/** Wait after the n-th failure in a streak: none for 1-3, then 2, 4, 8, 16, 30, 30 s; from the 10th a 30 s lock. */
function waitMs(failures: number): number {
  if (failures <= FREE_FAILURES) return 0;
  if (failures >= LOCK_AT) return MAX_WAIT_MS;
  return Math.min(2 ** (failures - FREE_FAILURES) * 1000, MAX_WAIT_MS);
}

/**
 * Throws 429 `slow-down` (4th-9th failure) or `locked` (10th on) with `retryAfterSeconds` while
 * the wait after the last failure runs. Call it before checking the credential; a refused check
 * adds no failure.
 *
 * Once a streak is past the free failures, a passing check claims the try: it moves
 * `last_failure_at` to now with a compare-and-set, so of a parallel burst arriving when a wait
 * ends exactly one gets through and the rest see a fresh wait (R28). The burst within the first
 * 3 free failures is accepted.
 */
export async function throttleCheck(deps: Pick<Deps, 'db' | 'clock'>, key: string): Promise<void> {
  const { rows } = await deps.db.query<{ failures: number; last_failure_at: Date }>(
    'select failures, last_failure_at from login_throttle where key = $1',
    [key],
  );
  const row = rows[0];
  if (!row) return;
  const now = deps.clock();
  const elapsed = now.getTime() - row.last_failure_at.getTime();
  if (elapsed >= STREAK_MS) return;
  const wait = waitMs(row.failures);
  const refuse = (ms: number) =>
    new ApiError(429, row.failures >= LOCK_AT ? 'locked' : 'slow-down', { retryAfterSeconds: Math.max(1, Math.ceil(ms / 1000)) });
  if (elapsed < wait) throw refuse(Math.min(wait - elapsed, wait));
  if (row.failures <= FREE_FAILURES) return;
  const claimed = await deps.db.query('update login_throttle set last_failure_at = $3 where key = $1 and last_failure_at = $2', [
    key, row.last_failure_at, now,
  ]);
  if ((claimed.rowCount ?? 0) === 0) throw refuse(wait);
}

/**
 * Records a failure. The streak restarts 15 minutes after its last failure. The first failure that
 * reaches the lock adds one `login-locked` alert per streak (only when there is an account).
 */
export async function throttleFail(deps: Pick<Deps, 'db' | 'clock'>, key: string, accountId: string | null): Promise<void> {
  const now = deps.clock();
  const since = new Date(now.getTime() - STREAK_MS);
  const { rows } = await deps.db.query<{ failures: number }>(
    `insert into login_throttle (key, failures, last_failure_at) values ($1, 1, $2)
     on conflict (key) do update set
       failures = case when login_throttle.last_failure_at <= $3 then 1 else login_throttle.failures + 1 end,
       alerted = case when login_throttle.last_failure_at <= $3 then false else login_throttle.alerted end,
       last_failure_at = $2
     returning failures`,
    [key, now, since],
  );
  if ((rows[0]?.failures ?? 0) < LOCK_AT) return;
  // Only the caller that flips `alerted` adds the alert, so parallel failures add one.
  await lockAlert(deps, key, accountId, key.slice(0, key.indexOf(':')));
}

/** Clears the streak after a success. */
export async function throttleReset(deps: Pick<Deps, 'db'>, key: string): Promise<void> {
  await deps.db.query('delete from login_throttle where key = $1', [key]);
}

/** Counts one use for the UTC day; above `limit` throws 429 `slow-down` with the seconds until 00:00 UTC. */
export async function dailyCap(deps: Pick<Deps, 'db' | 'clock'>, key: string, limit: number): Promise<void> {
  const now = deps.clock();
  const day = now.toISOString().slice(0, 10);
  const { rows } = await deps.db.query<{ count: number }>(
    `insert into daily_counts (key, day, count) values ($1, $2, 1)
     on conflict (key, day) do update set count = daily_counts.count + 1
     returning count`,
    [key, day],
  );
  if ((rows[0]?.count ?? 0) <= limit) return;
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  throw new ApiError(429, 'slow-down', { retryAfterSeconds: Math.ceil((midnight - now.getTime()) / 1000) });
}

// ---------------------------------------------------------------------------------------------
// Password login (owner, 2026-10-23): no visible waits, a quiet lock.

/** Misses in a row (on one `password-login` key) after which the name is quietly not checked. */
export const QUIET_LOCK_AT = 10;
/** How long the quiet lock lasts after the miss that reached it; a streak also ends this long after its last miss. */
export const QUIET_LOCK_MS = 15 * 60_000;

/**
 * Claims one password-login try on `key` (a `password-login` throttle key) and says whether the
 * password may be checked. Atomic: the try is counted before the password is checked (a right
 * password then clears the streak with `throttleReset`), so a parallel burst gets at most
 * `QUIET_LOCK_AT` checks. Once `QUIET_LOCK_AT` tries in a row have been counted, every try within
 * `QUIET_LOCK_MS` of the last counted one is refused without being counted (so the lock ends 15
 * minutes after it began, however many robots keep trying), and the caller answers exactly as for a
 * wrong password, after a dummy Argon2 verify. Returns the try's number in the streak, or null
 * while locked.
 */
export async function claimPasswordTry(deps: Pick<Deps, 'db' | 'clock'>, key: string): Promise<number | null> {
  const now = deps.clock();
  const since = new Date(now.getTime() - QUIET_LOCK_MS);
  const { rows } = await deps.db.query<{ failures: number }>(
    `insert into login_throttle (key, failures, last_failure_at) values ($1, 1, $2)
     on conflict (key) do update set
       failures = case when login_throttle.last_failure_at <= $3 then 1 else login_throttle.failures + 1 end,
       alerted = case when login_throttle.last_failure_at <= $3 then false else login_throttle.alerted end,
       last_failure_at = $2
     where login_throttle.last_failure_at <= $3 or login_throttle.failures < $4
     returning failures`,
    [key, now, since, QUIET_LOCK_AT],
  );
  return rows[0]?.failures ?? null;
}

/**
 * After a wrong password on a claimed try: the try that reaches the quiet lock adds one
 * `login-locked` alert per streak (only when there is an account). Nothing is visible to the
 * person who typed it.
 */
export async function passwordMiss(deps: Pick<Deps, 'db' | 'clock'>, key: string, tryNumber: number, accountId: string | null): Promise<void> {
  if (tryNumber < QUIET_LOCK_AT) return;
  await lockAlert(deps, key, accountId, 'password');
}

/** After about this many password-login misses in a row, the page sends the visitor away (Plan 3 builds the redirect). */
export const VISITOR_MISSES_BEFORE_LEAVING = 10;

/**
 * This browser's password-login misses in a row (any login names), for the page's send-away rule.
 * Counted on the device cookie's hash (`password-visitor:<hex>`), never per name, so it says nothing
 * about any account and nothing about other visitors. It is a courtesy for people, not a defence: a
 * script can drop the cookie. The streak ends `QUIET_LOCK_MS` after its last miss or on a success
 * from this browser. Returns the new count (1 when the browser has no device cookie).
 */
export async function visitorMiss(deps: Pick<Deps, 'db' | 'clock'>, device: Buffer | null): Promise<number> {
  if (device === null) return 1;
  const now = deps.clock();
  const { rows } = await deps.db.query<{ failures: number }>(
    `insert into login_throttle (key, failures, last_failure_at) values ($1, 1, $2)
     on conflict (key) do update set
       failures = case when login_throttle.last_failure_at <= $3 then 1 else login_throttle.failures + 1 end,
       last_failure_at = $2
     returning failures`,
    [`password-visitor:${device.toString('hex')}`, now, new Date(now.getTime() - QUIET_LOCK_MS)],
  );
  return rows[0]?.failures ?? 1;
}

/** Clears this browser's miss count after a password login that succeeded. */
export async function visitorReset(deps: Pick<Deps, 'db'>, device: Buffer | null): Promise<void> {
  if (device !== null) await deps.db.query('delete from login_throttle where key = $1', [`password-visitor:${device.toString('hex')}`]);
}

// ---------------------------------------------------------------------------------------------
// Shared token buckets (signup-team review F2, 8 Nov 2026): a request budget kept in Postgres, so
// every API process and every restart draws on the same count (an in-memory `TokenBucket` is per
// process: N processes would give N times the budget, and a restart refilled it).

/** Thousandths of a token: `login_throttle.failures` is an integer column. */
const MILLI = 1000;

/**
 * Takes one token from the shared bucket `key` (a `login_throttle` row: `failures` holds the
 * bucket's level in thousandths of a token, `last_failure_at` when it was last refilled), or
 * throws `refusal` with `retryAfterSeconds` when it has less than one. One atomic upsert: a
 * parallel burst never takes more tokens than the bucket holds. A missing row is a full bucket, so
 * `purgeExpired` deleting a row an hour after its last use changes nothing, provided the bucket
 * refills completely within the hour (asserted here).
 */
export async function takeSharedBucket(
  deps: Pick<Deps, 'db' | 'clock'>,
  key: string,
  size: { capacity: number; perMinute: number },
  refusal: { status: 429 | 503; code: 'slow-down' | 'busy' },
): Promise<void> {
  if (size.capacity / size.perMinute > 60) throw new Error(`shared bucket ${key} takes longer than the purge hour to refill`);
  const now = deps.clock();
  const capacity = size.capacity * MILLI;
  const perSecond = (size.perMinute * MILLI) / 60;
  const level = `least($2::int, t.failures + floor(greatest(0, extract(epoch from ($3::timestamptz - t.last_failure_at))) * $4::float8))`;
  const { rows } = await deps.db.query(
    `insert into login_throttle as t (key, failures, last_failure_at) values ($1, $2::int - ${MILLI}, $3)
     on conflict (key) do update set failures = (${level} - ${MILLI})::int, last_failure_at = greatest(t.last_failure_at, $3::timestamptz)
     where ${level} >= ${MILLI}
     returning failures`,
    [key, capacity, now, perSecond],
  );
  if (rows.length > 0) return;
  const { rows: held } = await deps.db.query<{ failures: number; last_failure_at: Date }>(
    'select failures, last_failure_at from login_throttle where key = $1',
    [key],
  );
  const row = held[0];
  const have = row ? Math.min(capacity, row.failures + Math.max(0, (now.getTime() - row.last_failure_at.getTime()) / 1000) * perSecond) : capacity;
  const retryAfterSeconds = Math.max(1, Math.ceil((MILLI - have) / perSecond));
  throw new ApiError(refusal.status, refusal.code, { retryAfterSeconds });
}
