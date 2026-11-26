/**
 * The login-method rule for trader accounts, shared by browser and server (owner, 26 Nov 2026:
 * no passwords).
 *
 * - There are no passwords. A trader account holds at least two different kinds of login method
 *   (`MIN_METHOD_KINDS`) from passkey, security key, PGP key and authenticator app (TOTP). It holds
 *   at most one authenticator app, and recovery codes never count.
 * - A passkey, a security key or a PGP key logs in on its own (`LOGIN_KEYS`). The authenticator app
 *   never does. Because there is only one authenticator app, two kinds always include a key, so
 *   every account can log in and can unlock its synced escrow keys.
 * - Staff, members and the owner keep their own two-factor pairs (api auth/methods.ts).
 */
import type { MethodType } from './confirmAction.js';

/** The methods that log in on their own. */
export const LOGIN_KEYS: ReadonlySet<MethodType> = new Set<MethodType>(['pgp', 'passkey', 'security-key']);

/** The kinds that count toward the rule (recovery codes never do). */
export const COUNTED_KINDS: readonly MethodType[] = ['pgp', 'passkey', 'security-key', 'totp'];

/** The fewest different kinds a trader account holds once sign-up ends. */
export const MIN_METHOD_KINDS = 2;

/** The different counted kinds in `has`. */
export function countedKinds(has: Iterable<MethodType>): Set<MethodType> {
  const out = new Set<MethodType>();
  for (const m of has) if (COUNTED_KINDS.includes(m)) out.add(m);
  return out;
}

/** True when `has` meets the rule: at least two counted kinds, one of them a login key. */
export function enoughMethods(has: Iterable<MethodType>): boolean {
  const kinds = countedKinds(has);
  if (kinds.size < MIN_METHOD_KINDS) return false;
  for (const m of kinds) if (LOGIN_KEYS.has(m)) return true;
  return false;
}
