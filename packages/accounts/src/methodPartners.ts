/**
 * Login methods that an account has only together with another one, shared by browser and server.
 *
 * Owner decision, 16 Nov 2026: every account has a username and a display name; to use the
 * authenticator app (TOTP) as the second factor the account must also have a password. TOTP is the
 * password login's second step (a PGP key, passkey or security key login never asks for it), so it
 * is offered, enrolled and kept only with a password. This reverses signup round 3 behaviour 1
 * (TOTP with a PGP key, passkey or security key and no password).
 */
import type { MethodType } from './confirmAction.js';

/** Each method that goes only with another, and that other. */
export const METHOD_PARTNERS: Readonly<Partial<Record<MethodType, MethodType>>> = Object.freeze({ totp: 'password' });

/** The method `m` needs that `has` lacks, or null (adding `m` is then fine as far as partners go). */
export function partnerMissing(m: MethodType, has: Iterable<MethodType>): MethodType | null {
  const partner = METHOD_PARTNERS[m];
  if (partner === undefined) return null;
  return new Set(has).has(partner) ? null : partner;
}

/** A method in `has` that goes only with `m`, so `m` cannot be removed while it is there; or null. */
export function partnerNeededBy(m: MethodType, has: Iterable<MethodType>): MethodType | null {
  const set = new Set(has);
  for (const [dependent, partner] of Object.entries(METHOD_PARTNERS) as Array<[MethodType, MethodType]>) {
    if (partner === m && set.has(dependent)) return dependent;
  }
  return null;
}

/**
 * Owner decision, 16 Nov 2026 (login methods): a PGP key, a passkey and a security key each stand
 * alone (the passkey and the security key with user verification required, webauthn.ts). A password
 * does not: it needs TOTP, its second factor, or one of these.
 */
export const STANDS_ALONE: ReadonlySet<MethodType> = new Set<MethodType>(['pgp', 'passkey', 'security-key']);

/** True when `has` holds a password with neither TOTP nor a method that stands alone. */
export function passwordAlone(has: Iterable<MethodType>): boolean {
  const set = new Set(has);
  if (!set.has('password') || set.has('totp')) return false;
  for (const m of STANDS_ALONE) if (set.has(m)) return false;
  return true;
}
