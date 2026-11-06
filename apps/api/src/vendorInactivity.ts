/**
 * Owner answer Q77 (6 Nov 2026): a vendor account that has not been logged into for 60 days closes
 * automatically; there is no switching back to trader (open a new account instead).
 *
 * "Logged into" is `accounts.last_login_at`, stamped by every login (`openSession`, any level; a
 * team member's login counts for the team account). Closing sets `disabled_at` (so login, every
 * session check, offer listing and push stop exactly as for a disabled account) together with
 * `closed_at` and `closed_reason = 'vendor-inactive'`, and revokes the account's sessions.
 *
 * Built conservatively, for the owner to confirm (lead report):
 * - a vendor with an open trade (`trades.closed_at is null`, disputed included) is not closed until
 *   it has none (R42: open trades finish);
 * - an account a moderator already disabled is left as it is;
 * - no warning before the close, and nothing is deleted (names stay taken, offers stay as rows,
 *   reviews and the ban list are untouched).
 */
import type pg from 'pg';
import type { RetentionJob } from './retention.js';

export const VENDOR_INACTIVE_MS = 60 * 86_400_000;

export const closeInactiveVendors: RetentionJob = {
  name: 'closeInactiveVendors',
  // One statement (atomic on its own): close, then revoke the closed accounts' sessions.
  async run(db: pg.Pool, now: Date): Promise<number> {
    const { rows } = await db.query<{ n: number }>(
      `with closed as (
         update accounts a set disabled_at = $1, closed_at = $1, closed_reason = 'vendor-inactive'
          where a.account_type = 'vendor' and a.kind = 'trader' and a.disabled_at is null
            and coalesce(a.last_login_at, a.created_at) <= $2
            and not exists (select 1 from trades t where t.closed_at is null and (t.seller_account_id = a.id or t.buyer_account_id = a.id))
          returning a.id
       ), revoked as (
         update sessions s set revoked_at = $1 where s.account_id in (select id from closed) and s.revoked_at is null returning 1
       )
       select (select count(*)::int from closed) as n, (select count(*) from revoked) as r`,
      [now, new Date(now.getTime() - VENDOR_INACTIVE_MS)],
    );
    return rows[0]!.n;
  },
};
