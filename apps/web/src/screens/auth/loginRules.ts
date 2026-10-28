/**
 * The password-login rules (owner, 2026-10-23, spec §6.3): FU-A's exports from `@x2f/auth-client`
 * (`PASSWORD_LOGIN_MISMATCH`, `MISSES_BEFORE_SENDING_AWAY`, `shouldSendAway`), re-exported, plus the
 * screen's wording for a refused login. (This file mirrored them until FU-A reached the main line
 * on 2026-10-27; `task30-tripwires.test.ts` fired on that merge and was retired.)
 *
 * The miss count comes from the server (per browser, never per name), carried as `misses` on a 401
 * `credentials-invalid`, so switching method or reloading the page never resets it.
 */
import { AuthApiError, MISSES_BEFORE_SENDING_AWAY, PASSWORD_LOGIN_MISMATCH, shouldSendAway } from '@x2f/auth-client';
import { refusalText } from './refusals.js';

export { MISSES_BEFORE_SENDING_AWAY, PASSWORD_LOGIN_MISMATCH, shouldSendAway };

/** For a 429, a 5xx or a network failure: not a miss, and never worded like one. */
export const LOGIN_RETRY_LATER = 'X2F could not check that just now. Try again in a moment.';

/** A refused password login: 401 `credentials-invalid` from the typed client. */
function isMismatch(e: unknown): boolean {
  return e instanceof AuthApiError && e.code === 'credentials-invalid';
}

/**
 * What the login screen says for a refused password login: the mismatch sentence; for too many
 * tries, how long to wait; else a neutral retry.
 */
export function loginFailure(e: unknown): string {
  return isMismatch(e) ? PASSWORD_LOGIN_MISMATCH : refusalText(e, LOGIN_RETRY_LATER);
}
