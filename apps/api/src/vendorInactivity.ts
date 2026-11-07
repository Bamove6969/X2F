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
 * - a vendor with a trade that is open or could still reopen is not closed (R42: open trades
 *   finish): any trade not closed, or closed within the last 30 days (a refund can be disputed for
 *   48 h, late funds escalate a released trade for 30 days; lead vendor review item 3);
 * - each account is closed in its own transaction with its row locked and the rules checked again
 *   there, so a take that locks the same account (take.ts) can't race it;
 * - a wrong mass close can't happen by accident (lead vendor review item 4): the first pass after a
 *   gap in the schedule (or after a start) only records the time and closes nothing, no pass runs
 *   during maintenance, and one pass closes at most VENDOR_CLOSE_CAP accounts; when more were due
 *   the owner gets an alert;
 * - held by the owner (G11, G12, 7 Nov): the lead is re-explaining the rule; nothing schedules a
 *   change to it here.
 * - an account a moderator already disabled is left as it is;
 * - no warning before the close, and nothing is deleted (names stay taken, offers stay as rows,
 *   reviews and the ban list are untouched).
 */
import type pg from 'pg';
import { addOwnerAlert } from './alerts.js';
import type { RetentionJob } from './retention.js';

export const VENDOR_INACTIVE_MS = 60 * 86_400_000;
/** A trade closed this recently could still reopen (late funds: 30 days). */
export const VENDOR_REOPEN_MS = 30 * 86_400_000;
/** At most this many vendor accounts close in one pass (lead vendor review item 4). */
export const VENDOR_CLOSE_CAP = 10;
/** A pass this long after the previous one is a gap (the scheduler runs every 10 minutes). */
export const VENDOR_GAP_MS = 60 * 60_000;

const DUE = `a.account_type = 'vendor' and a.kind = 'trader' and a.disabled_at is null
  and coalesce(a.last_login_at, a.created_at) <= $2
  and not exists (select 1 from trades t where (t.seller_account_id = a.id or t.buyer_account_id = a.id)
                   and (t.closed_at is null or t.closed_at > $3))`;

/** The job, with its own memory of the last pass (a restart counts as a gap). */
export function vendorInactivityJob(): RetentionJob {
  let lastPass: number | null = null;
  return {
    name: 'closeInactiveVendors',
    async run(db: pg.Pool, now: Date): Promise<number> {
      const previous = lastPass;
      lastPass = now.getTime();
      if (previous === null || now.getTime() - previous > VENDOR_GAP_MS) return 0;
      const { rows: flags } = await db.query<{ on: boolean }>('select maintenance_since is not null as on from site_flags');
      if (flags[0]?.on === true) return 0;
      return closeDueVendors(db, now);
    },
  };
}

/** One pass: closes up to VENDOR_CLOSE_CAP due vendors, each under its own lock; alerts the owner when more were due. */
export async function closeDueVendors(db: pg.Pool, now: Date): Promise<number> {
  const params = [now, new Date(now.getTime() - VENDOR_INACTIVE_MS), new Date(now.getTime() - VENDOR_REOPEN_MS)];
  const { rows: due } = await db.query<{ id: string }>(`select a.id from accounts a where $1::timestamptz is not null and ${DUE} order by a.id limit $4`, [...params, VENDOR_CLOSE_CAP + 1]);
  let closed = 0;
  for (const { id } of due.slice(0, VENDOR_CLOSE_CAP)) {
    const c = await db.connect();
    try {
      await c.query('begin');
      await c.query('select id from accounts where id = $1 for update', [id]);
      const r = await c.query(
        `update accounts a set disabled_at = $1, closed_at = $1, closed_reason = 'vendor-inactive' where a.id = $4 and ${DUE} returning a.id`,
        [...params, id],
      );
      if ((r.rowCount ?? 0) > 0) {
        await c.query('update sessions set revoked_at = $1 where account_id = $2 and revoked_at is null', [now, id]);
        closed++;
      }
      await c.query('commit');
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }
  if (due.length > VENDOR_CLOSE_CAP) await addOwnerAlert(db, 'vendor-auto-close-capped', { closed, cap: VENDOR_CLOSE_CAP }, now);
  return closed;
}

/** The scheduled instance (RETENTION_JOBS). */
export const closeInactiveVendors: RetentionJob = vendorInactivityJob();
