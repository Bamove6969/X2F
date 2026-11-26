/**
 * The account's security rating (owner demo note #6, 16 Nov 2026, and his answers of 17 Nov;
 * docs/trade-wallet-note6.md): the one place that says whether an account is `weak`, `medium` or
 * `high`, from the login methods it holds. Every account has a login name and a display name.
 *
 * - `high`: a PGP key, a passkey or a security key (owner 17 Nov: "as long as they have a username,
 *   a display name, and either a passkey, PGP key, or security key, then their account is rated as
 *   highly secure"). Only `high` is offered a new payout address on the trade screen. Since owner
 *   26 Nov 2026 (no passwords) every trader account that may trade holds one.
 * - `medium`: never given now (it was a password with the authenticator app); kept in the type so
 *   older clients still read it.
 * - `weak`: anything less (the authenticator app or recovery codes alone), or no method at all
 *   (fails closed).
 *
 * This is the rating of the account, shown to the person; it authorises nothing.
 */
import type { MethodCounts } from '../routes/account.js';

export type AccountRating = 'weak' | 'medium' | 'high';

export function accountRating(c: MethodCounts): AccountRating {
  if (c.pgp > 0 || c.passkey > 0 || c.securityKey > 0) return 'high';
  return 'weak';
}
