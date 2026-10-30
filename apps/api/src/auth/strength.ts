/**
 * Login strength (Plan 2 Task 17; owner 2026-10-29 13:23 and 14:12, R42).
 *
 * The owner's no-wait combinations, exactly (14:12): a password with an authenticator code; a
 * password with a passkey or security key; a PGP key with a passkey or security key; a passkey or
 * security key alone (built-in two factors). A login is `strong` only when the factors it proved
 * include one of `STRONG_COMBOS`; there is no "any two kinds" rule, so a future path such as an
 * authenticator code with a recovery code, or a password with a PGP key, waits until the owner
 * adds it here. Everything else waits 24 hours: a PGP key alone is `pgp-single`, any other single
 * way (password, authenticator code, recovery code) `weak-single`. The hold itself is hold.ts.
 */

export type LoginFactorKind = 'pgp' | 'passkey' | 'security-key' | 'password' | 'totp' | 'recovery-code';
export type LoginStrength = 'strong' | 'weak-single' | 'pgp-single';

/** The owner's list of 2026-10-29 14:12. Changing it is an owner decision. */
export const STRONG_COMBOS: ReadonlyArray<readonly LoginFactorKind[]> = Object.freeze([
  ['passkey'],
  ['security-key'],
  ['password', 'totp'],
  ['password', 'passkey'],
  ['password', 'security-key'],
  ['pgp', 'passkey'],
  ['pgp', 'security-key'],
]);

export function loginStrength(factors: readonly LoginFactorKind[]): LoginStrength {
  const proven = new Set(factors);
  if (STRONG_COMBOS.some((combo) => combo.every((k) => proven.has(k)))) return 'strong';
  if (proven.size === 1 && proven.has('pgp')) return 'pgp-single';
  return 'weak-single';
}

/** A session's stored strength; null (a session from before migration 014) counts as weak. */
export const waits = (s: LoginStrength | null | undefined): boolean => s !== 'strong';
