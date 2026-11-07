/**
 * Login strength (Plan 2 Task 17; owner 2026-10-29 13:23 and 14:12, R42; owner 6 Nov 2026, Q81).
 *
 * The owner's no-wait combinations, exactly (14:12): a password with an authenticator code; a
 * password with a passkey or security key; a PGP key with a passkey or security key; a passkey or
 * security key alone (built-in two factors). Q81 (6 Nov 2026) adds a PGP key alone: "PGP will
 * include a username and PGP, so it will be considered strong. Therefore, it won't have a hold
 * time." A login is `strong` only when the factors it proved include one of `STRONG_COMBOS`; there
 * is no "any two kinds" rule, so a future path such as an authenticator code with a recovery code
 * waits until the owner adds it here. Everything else waits 24 hours (`weak-single`: a username and
 * password, or a recovery code). The hold itself is hold.ts.
 *
 * Migration 016 turned every stored `pgp-single` (a PGP key alone before Q81) into `strong` and no
 * longer accepts it, so the SQL checks (`strength = 'strong'`) and `waits` agree.
 */

export type LoginFactorKind = 'pgp' | 'passkey' | 'security-key' | 'password' | 'totp' | 'recovery-code';
export type LoginStrength = 'strong' | 'weak-single';

/** The owner's list of 2026-10-29 14:12, plus a PGP key alone (Q81, 6 Nov 2026). Changing it is an owner decision. */
export const STRONG_COMBOS: ReadonlyArray<readonly LoginFactorKind[]> = Object.freeze([
  ['passkey'],
  ['security-key'],
  ['pgp'],
  ['password', 'totp'],
  ['password', 'passkey'],
  ['password', 'security-key'],
  ['pgp', 'passkey'],
  ['pgp', 'security-key'],
]);

export function loginStrength(factors: readonly LoginFactorKind[]): LoginStrength {
  const proven = new Set(factors);
  if (STRONG_COMBOS.some((combo) => combo.every((k) => proven.has(k)))) return 'strong';
  return 'weak-single';
}

/** A session's stored strength; null (a session from before migration 014) counts as weak. */
export const waits = (s: LoginStrength | null | undefined): boolean => s !== 'strong';
