/**
 * The login screens' shared wording and checks. Owner, 26 Nov 2026: no passwords, so the
 * password-login rules (mismatch sentence, misses before sending away) are gone.
 */

/** For a 429, a 5xx or a network failure: not a miss, and never worded like one. */
export const LOGIN_RETRY_LATER = 'X2F could not check that just now. Try again in a moment.';

/**
 * Owner demo note #219 (25 Nov 2026): a full authenticator code, read as the server reads it (api
 * totp.ts `matchStep`: whitespace dropped, then exactly six digits). Buttons that send one stay
 * disabled until this holds; whether the code is right is still the server's answer.
 */
export function isTotpCode(code: string): boolean {
  return /^\d{6}$/.test(code.replace(/\s/g, ''));
}
