/**
 * Plan 4 Task 23 (R6/R36): the dispute half of the whole-trade purge. Revision 2026-10-29 (owner)
 * replaced the task's "bare record after 30 days" with Plan 7 Task 2's rule: a disputed trade is
 * deleted WHOLE, dispute records included, DISPUTE_KEEP_DAYS (90) days after its last dispute
 * closed (owner p11-11: from the dispute closing, `disputes.closed_at`), and never while any of its
 * disputes is open (an appeal, or a payout or payment still owed, included). Revision 2026-10-29b
 * dropped the anonymized training copies (`purgeTrainingCopies` is not built: there is nothing to
 * purge), so Task 19's "Mark as training case" record goes with the dispute here.
 *
 * The job itself is `purgeTradesJob` (apps/api/src/retention/tradePurge.ts): it reads each trade's
 * dispute facts with DISPUTE_FACTS_SQL and, in the trade's own transaction and as x2f_purge, calls
 * `deleteDisputeRecords` before it deletes the trade row. What a dispute leaves on an ACCOUNT is
 * never deleted here: liens and owed fees (400, account records with no foreign key, refused a
 * delete by their own triggers), freezes (`trading_holds.dispute_code`, 208), staff pay items
 * (`trade_code` set null, 420) and the activity log (201).
 */
import { DISPUTE_KEEP_DAYS } from '@x2f/trade';
import type { Queryable } from '../db/pool.js';

export { DISPUTE_KEEP_DAYS };

/**
 * Every table that hangs from a dispute (code, seq) or names a trade's dispute ruling, in the order
 * they are deleted: appeals, drafts and rulings before the dispute rows they reference (108, 401;
 * none has a cascade), then the moderation service's signed ruling statement (550).
 */
export const DISPUTE_CHILD_TABLES = ['dispute_appeals', 'ruling_drafts', 'dispute_rulings', 'disputes', 'ruling_statements'] as const;

/**
 * SQL (a lateral subquery over `disputes`, for the trade alias `t`): how many disputes the trade
 * has, how many are not yet `closed`, and when the latest closed. `closed` is the machine's last
 * status and the only one with a closed_at (110); every other status counts as open, `published`
 * (the 48-hour appeal window, on a trade that has already closed) included.
 */
export const DISPUTE_FACTS_SQL = (t: string): string => `(select count(*)::int as total,
         (count(*) filter (where x.status <> 'closed'))::int as still_open,
         max(x.closed_at) as last_closed
    from disputes x where x.code = ${t}.code)`;

/**
 * Deletes every dispute record of trade `code`, in DISPUTE_CHILD_TABLES order. Runs inside the
 * trade purge's transaction, after its `set local role x2f_purge` and its last check under the
 * trade's lock (the caller never calls it for a trade with an open dispute). Returns the rows
 * deleted per table.
 */
export async function deleteDisputeRecords(q: Queryable, code: string): Promise<Record<(typeof DISPUTE_CHILD_TABLES)[number], number>> {
  const out = {} as Record<(typeof DISPUTE_CHILD_TABLES)[number], number>;
  for (const table of DISPUTE_CHILD_TABLES) {
    // The table names are the constant list above, never input.
    const r = await q.query(`delete from ${table} where code = $1`, [code]);
    out[table] = r.rowCount ?? 0;
  }
  return out;
}
