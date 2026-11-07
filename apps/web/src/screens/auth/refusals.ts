/**
 * What the login and security screens say when the server refuses something for a reason the
 * person can act on (Task 30 re-review, items 2 and 3). One helper so every screen words a wait, a
 * held backup session, a refused PGP key or an expired step the same way:
 *
 * - 403 `recovery-hold`: a held backup session or the account's 24-hour hold, until `holdUntil` (Plan 2 Tasks 9 and 17);
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
import { utcDateTime } from '../../ui/dates.js';
import {
  HOLD_CODE, TOO_MANY_APPROVALS, TOO_MANY_APPROVALS_CODE,
  WEAK_SESSION_CODE, WEAK_SESSION_TEXT, holdApproveText, holdLoginText, holdText, type CantDoCode,
} from '../../ui/cantDoCodes.js';

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

/** Design X5: the time as "6 Nov 2026, 15:00 UTC", the same for every viewer (was "Tue 3:05 PM", local). */
export function localTime(at: Date): string {
  return utcDateTime(at);
}

/** "until 6 Nov 2026, 15:00 UTC" for `holdUntil` (an ISO time), or "for a day" if the server sent none. */
function untilWords(holdUntil: string | null | undefined): string {
  const at = holdUntil ? new Date(holdUntil) : null;
  return at === null || Number.isNaN(at.getTime()) ? 'for a day' : `until ${localTime(at)}`;
}

/**
 * 403 `recovery-hold` (Plan 2 Task 17): one sentence for a held backup session and for the
 * account's 24-hour hold, from the refusal text map (`holdText`).
 */
export function holdSentence(holdUntil: string | null | undefined): string {
  return holdText(untilWords(holdUntil));
}

/** 403 `recovery-hold` on the login screen: this login cannot get in until the hold ends (review round 3 R3-M3). */
export function holdLoginSentence(holdUntil: string | null | undefined): string {
  return holdLoginText(untilWords(holdUntil));
}

/** 403 `recovery-hold` when approving a new device: the hold sentence, and that blocking still works. */
export function holdApproveSentence(holdUntil: string | null | undefined): string {
  return holdApproveText(untilWords(holdUntil));
}

/**
 * What a login, or a logged-in device's answer to a new login, shows in CantDoThat (Plan 2 Task 16,
 * Plan 5 Task 21): the hourly cap on approvals, the hold, a weak session. Null for anything else
 * (the caller words it inline as before). The device limit is never one: approving opens the
 * chooser instead (C2-D1, LoginApprove board), and a login is never refused by it since Task 17
 * review round 2.
 */
export function loginCantDo(e: unknown, where: 'login' | 'approve'): { code: CantDoCode; text: string } | null {
  if (!(e instanceof AuthApiError)) return null;
  if (e.status === 429 && e.reason === 'approvals') return { code: TOO_MANY_APPROVALS_CODE, text: TOO_MANY_APPROVALS };
  if (e.code === HOLD_CODE) return { code: HOLD_CODE, text: where === 'login' ? holdLoginSentence(e.holdUntil) : holdApproveSentence(e.holdUntil) };
  if (e.code === WEAK_SESSION_CODE) return { code: WEAK_SESSION_CODE, text: WEAK_SESSION_TEXT };
  return null;
}

/** 403 `weak-session` (Plan 2 Task 17 review round 2) from either client, for CantDoThat; else null. */
export function weakSessionCantDo(e: unknown): { code: CantDoCode; text: string } | null {
  return refusalOf(e)?.code === WEAK_SESSION_CODE ? { code: WEAK_SESSION_CODE, text: WEAK_SESSION_TEXT } : null;
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
// cant-do-that-todo: shown inline by Security (add a key) through refusalText
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
