/**
 * The account's security rating (owner demo note #6, 16 Nov 2026; docs/trade-wallet-note6.md): the
 * one place that says whether an account is `weak` or `secure`, from the login methods it holds.
 *
 * Every account has a login name and a display name. On top of those, an account is `secure` when it
 * holds at least one way to log in other than a password alone: a PGP key, a passkey or a security
 * key (each stands alone, owner Q81 and 16 Nov), or an authenticator app together with a password
 * (owner 16 Nov: the app is only ever a password's second factor, so without a password it logs no one
 * in and does not count). Anything less is `weak`: a password alone, or a password with recovery codes
 * (a recovery code is a backup way in, itself one weak way, never a second factor; owner question Q6).
 * An account with no method at all is `weak` (fails closed).
 *
 * This is the rating of the account, not of a login: how strong the login behind a session was is
 * strength.ts, and that still decides whether a change from it waits (hold model v3).
 */
import type { MethodCounts } from '../routes/account.js';

export type AccountRating = 'weak' | 'secure';

export function accountRating(c: MethodCounts): AccountRating {
  if (c.pgp > 0 || c.passkey > 0 || c.securityKey > 0) return 'secure';
  if (c.password && c.totp) return 'secure';
  return 'weak';
}
