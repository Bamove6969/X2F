import type { FastifyRequest } from 'fastify';
import type { Deps } from '../app.js';
import { addAlert } from '../alerts.js';
import { ApiError } from '../errors.js';
import { deviceHash, isTrusted } from './device.js';

/**
 * Only guessable secrets are throttled (P2-C1). PGP codes (60-bit, single-use) and WebAuthn are
 * never subject to these keys, so a flood of bad passwords cannot lock those methods out.
 */
export type ThrottledMethod = 'password' | 'totp' | 'recovery-code';

const FREE_FAILURES = 3;
const LOCK_AT = 10;
const MAX_WAIT_MS = 30_000;
const STREAK_MS = 15 * 60_000;

/**
 * `<method>:<accountId | name:<username_key>>:<dev:<hex device hash> | anon>`. The device part is
 * used only when this browser's device is trusted for that account, so failures from unknown
 * browsers never slow down or lock a known one. A `name:` key (no account) is always `anon`.
 */
export async function throttleKey(
  deps: Pick<Deps, 'db' | 'clock'>,
  req: FastifyRequest,
  method: ThrottledMethod,
  account: { id: string } | { usernameKey: string },
): Promise<string> {
  if (!('id' in account)) return `${method}:name:${account.usernameKey}:anon`;
  const hash = deviceHash(req);
  const trusted = hash !== null && (await isTrusted(deps, account.id, hash));
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
  if ((rows[0]?.failures ?? 0) < LOCK_AT || accountId === null) return;
  // Only the caller that flips `alerted` adds the alert, so parallel failures add one.
  const flipped = await deps.db.query('update login_throttle set alerted = true where key = $1 and alerted = false', [key]);
  if ((flipped.rowCount ?? 0) > 0) {
    await addAlert(deps.db, accountId, 'login-locked', { method: key.slice(0, key.indexOf(':')) }, now);
  }
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
