/**
 * The 60-day close (owner Q77, 6 Nov; owner p4-5/p4-6, 7 Nov): every trader account (vendor or
 * not) that has not been logged into for 60 days closes automatically, for security ("X2F is for
 * active traders"). An open trade or dispute pauses the clock: an account with a trade not closed is
 * never due, and the 60 days count from the later of its last login and its last trade's close.
 * There is no warning notice (the rule is explained at sign-up and in the rules list). A vendor
 * can't switch back to trader: it opens a new account.
 *
 * "Logged into" is `accounts.last_login_at`, stamped by every login (`openSession`, any level; a
 * team member's login counts for the team account). Closing sets `disabled_at` (so login, every
 * session check, offer listing and push stop exactly as for a disabled account) together with
 * `closed_at` and `closed_reason = 'inactive'`, and revokes the account's sessions.
 *
 * - Each account is closed in its own transaction with its row locked and the rules checked again
 *   there, so a take that locks the same account (take.ts) can't race it.
 * - A wrong mass close can't happen by accident (lead vendor review item 4): the first pass after a
 *   gap in the schedule (or after a start) only records the time and closes nothing, no pass runs
 *   during maintenance, and one pass closes at most CLOSE_CAP accounts; when more were due the owner
 *   gets an alert.
 * - An account a moderator already disabled is left as it is; staff, owner and team-member logins
 *   are not trader accounts and never close here.
 * - Names stay taken, offers stay as rows, reviews and the ban list are untouched; the account's PGP
 *   keys are deleted so the person can reuse one (owner G14).
 */
import type pg from 'pg';
import { addOwnerAlert } from './alerts.js';
import type { RetentionJob } from './retention.js';

export const INACTIVE_MS = 60 * 86_400_000;
/** At most this many accounts close in one pass (lead vendor review item 4). */
export const CLOSE_CAP = 10;
/** A pass this long after the previous one is a gap (the scheduler runs every 10 minutes). */
export const INACTIVITY_GAP_MS = 60 * 60_000;

const DUE = `a.kind = 'trader' and a.disabled_at is null
  and greatest(coalesce(a.last_login_at, a.created_at),
               coalesce((select max(t.closed_at) from trades t where t.seller_account_id = a.id or t.buyer_account_id = a.id), '-infinity'::timestamptz)) <= $2
  and not exists (select 1 from trades t where (t.seller_account_id = a.id or t.buyer_account_id = a.id) and t.closed_at is null)`;

/** The job, with its own memory of the last pass (a restart counts as a gap). */
export function inactivityJob(): RetentionJob {
  let lastPass: number | null = null;
  return {
    name: 'closeInactiveAccounts',
    async run(db: pg.Pool, now: Date): Promise<number> {
      const previous = lastPass;
      lastPass = now.getTime();
      if (previous === null || now.getTime() - previous > INACTIVITY_GAP_MS) return 0;
      const { rows: flags } = await db.query<{ on: boolean }>('select maintenance_since is not null as on from site_flags');
      if (flags[0]?.on === true) return 0;
      return closeDueAccounts(db, now);
    },
  };
}

/** One pass: closes up to CLOSE_CAP due accounts, each under its own lock; alerts the owner when more were due. */
export async function closeDueAccounts(db: pg.Pool, now: Date): Promise<number> {
  const params = [now, new Date(now.getTime() - INACTIVE_MS)];
  const { rows: due } = await db.query<{ id: string }>(`select a.id from accounts a where $1::timestamptz is not null and ${DUE} order by a.id limit $3`, [...params, CLOSE_CAP + 1]);
  let closed = 0;
  for (const { id } of due.slice(0, CLOSE_CAP)) {
    const c = await db.connect();
    try {
      await c.query('begin');
      await c.query('select id from accounts where id = $1 for update', [id]);
      const r = await c.query(
        `update accounts a set disabled_at = $1, closed_at = $1, closed_reason = 'inactive' where a.id = $3 and ${DUE} returning a.id`,
        [...params, id],
      );
      if ((r.rowCount ?? 0) > 0) {
        await c.query('update sessions set revoked_at = $1 where account_id = $2 and revoked_at is null', [now, id]);
        // Owner G14 (7 Nov): the person may reuse their PGP key on a new account (a key's
        // fingerprint is unique across accounts); names stay taken. A closed account never logs in
        // again, so its keys go. Passkeys and security keys make a new credential for each account.
        await c.query('delete from pgp_keys where account_id = $1', [id]);
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
  if (due.length > CLOSE_CAP) await addOwnerAlert(db, 'auto-close-capped', { closed, cap: CLOSE_CAP }, now);
  return closed;
}

/** The scheduled instance (RETENTION_JOBS). */
export const closeInactiveAccounts: RetentionJob = inactivityJob();
