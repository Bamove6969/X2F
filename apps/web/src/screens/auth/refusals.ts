/**
 * What the login and security screens say when the server refuses something for a reason the
 * person can act on (Task 30 re-review, items 2 and 3). One helper so every screen words a wait, a
 * held backup session, a refused PGP key or an expired step the same way:
 *
 * - 403 `recovery-hold`: a backup login's changes wait until `holdUntil` (Plan 2's 24-hour hold);
 * - 429 `slow-down` / `locked`: how long to wait, from `retryAfterSeconds` (the TOTP backup's daily
 *   cap waits until midnight UTC, so a long wait is given as a clock time);
 * - 400 `key-expired` / `key-revoked`: the key is turned away with the reason (spec 6.2);
 * - a `detail` sentence about the pasted key: shown as the server wrote it;
 * - 400 `challenge-expired`: the step ran out of time and must start again;
 * - 409 `security-key-limit` / `login-name-set` (FU-A): the key cap, a login name already chosen.
 *
 * Anything else gets the caller's own fallback sentence.
 */
import { AuthApiError } from '@x2f/auth-client';
import { ApiCallError } from '../../api/client.js';

interface Refusal {
  status: number;
  code: string;
  detail?: string;
  retryAfterSeconds?: number;
  holdUntil?: string;
}

/** The refusal fields of an error from either client, or null for anything else (a network failure). */
function refusalOf(e: unknown): Refusal | null {
  if (e instanceof AuthApiError || e instanceof ApiCallError) return e;
  return null;
}

/** A clock time in the person's own time zone, e.g. "Tue 3:05 PM". */
export function localTime(at: Date): string {
  return at.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

/** The held-backup sentence, for `holdUntil` (an ISO time) or, if the server sent none, a day. */
export function holdSentence(holdUntil: string | null | undefined): string {
  const at = holdUntil ? new Date(holdUntil) : null;
  if (at === null || Number.isNaN(at.getTime())) return 'You logged in with a backup, so changes to your account wait for a day.';
  return `You logged in with a backup, so changes to your account wait until ${localTime(at)}.`;
}

/** How long to wait after too many tries: minutes up to an hour, else the clock time it ends. */
export function waitSentence(seconds: number | undefined, now: Date = new Date()): string {
  const s = seconds !== undefined && Number.isFinite(seconds) && seconds > 0 ? seconds : 60;
  if (s <= 3600) {
    const min = Math.max(1, Math.ceil(s / 60));
    return `Too many tries. Try again in ${min} ${min === 1 ? 'minute' : 'minutes'}.`;
  }
  return `Too many tries. Try again after ${localTime(new Date(now.getTime() + s * 1000))}.`;
}

export const KEY_EXPIRED = 'That key has expired. Extend it in your PGP app, then paste it again.';
// not-a-refusal: the pasted key itself is revoked
export const KEY_REVOKED = 'That key has been revoked, so it cannot be used to log in. Use a key that is still valid.';
export const STEP_EXPIRED = 'That step has expired. Start again.';
/** 409 `security-key-limit` (FU-A review I2): the account already holds the most security keys allowed. */
export const SECURITY_KEY_LIMIT = 'You already have 5 security keys, the most an account can hold. Remove one to add another.';
/** 409 `login-name-set`: the account's login name was already chosen and cannot be set again here. */
export const LOGIN_NAME_SET = 'Your login name is already set.';

/** True for a 400 `challenge-expired`: the screen should offer to start the step again. */
export function isExpired(e: unknown): boolean {
  return refusalOf(e)?.code === 'challenge-expired';
}

/** The sentence for a refusal the person can act on, else `fallback`. */
export function refusalText(e: unknown, fallback: string, o: { expired?: string; now?: Date } = {}): string {
  const r = refusalOf(e);
  if (r === null) return fallback;
  // cant-do-that-todo: shown inline by every security screen through refusalText
  if (r.code === 'recovery-hold') return holdSentence(r.holdUntil);
  if (r.status === 429) return waitSentence(r.retryAfterSeconds, o.now);
  if (r.code === 'key-expired') return KEY_EXPIRED;
  if (r.code === 'key-revoked') return KEY_REVOKED;
  if (r.code === 'challenge-expired') return o.expired ?? STEP_EXPIRED;
  // cant-do-that-todo: shown inline by Security (add a key) through refusalText
  if (r.code === 'security-key-limit') return SECURITY_KEY_LIMIT;
  // cant-do-that-todo: shown inline by the login and security screens through refusalText
  if (r.code === 'login-name-set') return LOGIN_NAME_SET;
  if (typeof r.detail === 'string' && r.detail.trim() !== '') return r.detail;
  return fallback;
}
