/**
 * The password-login rules (owner, 2026-10-23, spec §6.3), mirroring the lead's FU-A exports from
 * `@x2f/auth-client` exactly (`PASSWORD_LOGIN_MISMATCH`, `MISSES_BEFORE_SENDING_AWAY`,
 * `shouldSendAway`). FU-A is not on the main line yet; `task30-tripwires.test.ts` fails once the
 * typed client exports these, and this file should then re-export them from there.
 *
 * The miss count comes from the server (per browser, never per name), carried as `misses` on a 401
 * `credentials-invalid`, so switching method or reloading the page never resets it.
 */
import { AuthApiError } from '@x2f/auth-client';
import { ApiCallError } from '../../api/client.js';
import { refusalText } from './refusals.js';

/** The one sentence for every failed password login: a guesser never learns which part was wrong. */
export const PASSWORD_LOGIN_MISMATCH = "That login name and password don't match";

/** After about this many password-login misses in a row, the page sends the visitor away from the site. */
export const MISSES_BEFORE_SENDING_AWAY = 10;

/** For a 429, a 5xx or a network failure: not a miss, and never worded like one. */
export const LOGIN_RETRY_LATER = 'X2F could not check that just now. Try again in a moment.';

function missesOf(e: unknown): number | null {
  if (e instanceof ApiCallError && e.code === 'credentials-invalid') {
    const m = e.extra.misses;
    return typeof m === 'number' && Number.isInteger(m) && m > 0 ? m : 0;
  }
  if (e instanceof AuthApiError && e.code === 'credentials-invalid') {
    const m = (e as { misses?: unknown }).misses;
    return typeof m === 'number' && Number.isInteger(m) && m > 0 ? m : 0;
  }
  return null;
}

/** True when a refused password login says this browser has missed `MISSES_BEFORE_SENDING_AWAY` times in a row. */
export function shouldSendAway(e: unknown): boolean {
  return (missesOf(e) ?? 0) >= MISSES_BEFORE_SENDING_AWAY;
}

/**
 * What the login screen says for a refused password login: the mismatch sentence; for too many
 * tries, how long to wait; else a neutral retry.
 */
export function loginFailure(e: unknown): string {
  return missesOf(e) === null ? refusalText(e, LOGIN_RETRY_LATER) : PASSWORD_LOGIN_MISMATCH;
}
