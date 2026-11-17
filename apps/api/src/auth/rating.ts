/**
 * The account's security rating (owner demo note #6, 16 Nov 2026, and his answers of 17 Nov;
 * docs/trade-wallet-note6.md): the one place that says whether an account is `weak`, `medium` or
 * `high`, from the login methods it holds. Every account has a login name and a display name.
 *
 * - `high`: a PGP key, a passkey or a security key, with or without a password (owner 17 Nov: "as long
 *   as they have a username, a display name, and either a passkey, PGP key, or security key, then
 *   their account is rated as highly secure"). Only `high` is offered a new payout address on the
 *   trade screen.
 * - `medium`: a password with the authenticator app ("User/pass/display name/otp is kinda like medium
 *   security but they still wouldn't qualify to avoid the 24 hour hold"). The app is only ever a
 *   password's second factor (owner 16 Nov), so without a password it counts for nothing.
 * - `weak`: anything less: a password alone, or with recovery codes (a recovery code is a backup way
 *   in, itself one weak way, never a second factor; Q6), or no method at all (fails closed).
 *
 * This is the rating of the account, shown to the person; it authorises nothing. How strong the login
 * behind a session was is strength.ts, and that, with the confirm method, still decides whether a
 * change from it waits (hold model v3, wallets/routes.ts).
 */
import type { MethodCounts } from '../routes/account.js';

export type AccountRating = 'weak' | 'medium' | 'high';

export function accountRating(c: MethodCounts): AccountRating {
  if (c.pgp > 0 || c.passkey > 0 || c.securityKey > 0) return 'high';
  if (c.password && c.totp) return 'medium';
  return 'weak';
}
