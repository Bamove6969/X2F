import type { RulingOutcome } from '@x2f/staff';
import { purgedSql } from './stage.js';

/**
 * R-011 and R-012 (owner Q40 and Q41, 6 Nov 2026; replacing R-010's "overturned erases"): feedback
 * and totals follow the trade's FINAL binding outcome.
 *
 * - Reversed ("like no trade happens at all, all moneys are reversed"): no feedback, and the trade is
 *   not in the trader's completed count or traded totals.
 * - Settled ("they let it settle like a trade happened"): the feedback stays and the trade counts.
 * - An appeal holds the feedback (removed temporarily) until its result decides (`reviewHeldSql`).
 *
 * For a single round, which outcome is which is the same split as X2F's 1% after a ruling
 * (@x2f/staff `rulingFee`, owner g63): an outcome that completes the trade ("poster pays") is a sale,
 * a full reversal is not. The two part on an appeal that overturns a ruling whose coins already moved
 * (round 1 releases to the buyer, round 2 refunds the seller): for the fee that is a lien and the
 * poster pays (owner Q37), for reputation it is a reversal, read from the round in force (D-006: a
 * won appeal fixes the record). apps/api/test/finalOutcome.test.ts pins both.
 */
export const SALE_OUTCOMES = ['release-to-buyer', 'seller-sends-xmr'] as const satisfies readonly RulingOutcome[];
export const REVERSAL_OUTCOMES = ['refund-to-seller', 'seller-returns-fiat', 'no-action'] as const satisfies readonly RulingOutcome[];

/** A dispute status that is final and binding: no appeal is possible any more (@x2f/staff DisputeStatus). */
export const DECIDED_STATUSES = ['final', 'complying', 'closed'] as const;

export type DisputeOutcome = 'pending' | 'sale' | 'reversed';

const list = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(', ');

/**
 * SQL (text, or null when the trade alias `t` never had a dispute): how the trade's disputes ended.
 * - 'pending' while any of its disputes is not decided yet (open, awaiting a second approval, round 1
 *   published inside its appeal window, or appealed);
 * - otherwise the deciding outcome of its LATEST dispute (the highest seq; a later dispute on the
 *   same trade is about where its coins ended up last): the outcome of the round in force (round 2's
 *   when there was an appeal), from the machine's `disputes.ruling`, else the trader-facing
 *   `dispute_rulings` row of the highest round. 'sale' for SALE_OUTCOMES, 'reversed' for
 *   REVERSAL_OUTCOMES;
 * - a decided dispute with no ruling at all (closed by the system, e.g. the parties settled it
 *   between themselves) follows the trade's own end: released is a sale, refunded or cancelled a
 *   reversal, still open is pending.
 */
export const disputeOutcomeSql = (t: string): string => `(case
  when not exists (select 1 from disputes d where d.code = ${t}.code) then null
  when exists (select 1 from disputes d where d.code = ${t}.code and d.status not in (${list(DECIDED_STATUSES)})) then 'pending'
  else (select case
      when o.outcome in (${list(SALE_OUTCOMES)}) then 'sale'
      when o.outcome in (${list(REVERSAL_OUTCOMES)}) then 'reversed'
      when ${t}.state = 'released' then 'sale'
      when ${t}.state in ('refunded', 'cancelled') then 'reversed'
      else 'pending' end
    from (select coalesce(d.ruling ->> 'outcome',
                   (select r.outcome from dispute_rulings r where r.code = d.code and r.seq = d.seq order by r.round desc limit 1)) as outcome
            from disputes d where d.code = ${t}.code order by d.seq desc limit 1) o)
end)`;

/**
 * SQL (boolean): the trade (alias `t`) is a real completed sale by its final binding outcome (R-012):
 * released with no dispute ever, or its disputes decided as a sale. A trade whose dispute is still
 * pending is not counted yet.
 */
export const isFinalSaleSql = (t: string): string =>
  `coalesce(coalesce(${disputeOutcomeSql(t)}, case when ${t}.state = 'released' then 'sale' end) = 'sale', false)`;

/**
 * SQL (bigint): the completed trades of account `a.id` by the final binding outcome (R-012), for the
 * trader's public count and the badges that read it. The starter stage and the offers' minimum-trades
 * filter still count R38's way (`COMPLETED_TRADES_SQL`: a settled dispute counts whoever won, with no
 * automatic stage drop): which count drives the stage is an owner question (R-012 vs D-048).
 * A trade counted before (its 'completed' mark, traders/tradedTotal.ts) whose later dispute or appeal
 * is still pending stays in, matching the running totals until the result decides (review m2).
 */
export const FINAL_SALES_SQL = `(${finalSalesLiveSql()} + ${purgedSql('purged_sales')})`;

/** FINAL_SALES_SQL's live part alone, with `extra` added to its WHERE (trade alias `t`; see completedTradesLiveSql). */
export function finalSalesLiveSql(extra = ''): string {
  return `(select count(*) from trades t
   cross join lateral (select ${disputeOutcomeSql('t')} as o) x
   where (t.buyer_account_id = a.id or t.seller_account_id = a.id)
     and (coalesce(x.o, case when t.state = 'released' then 'sale' end) = 'sale'
       or (x.o = 'pending' and exists (select 1 from trade_totals_counted c where c.trade_code = t.code and c.kind = 'completed'))) ${extra})`;
}

/**
 * SQL (boolean): the dispute row (alias `d`, a `disputes` row) has an appeal PENDING: `appealed`, or
 * round 2 awaiting a second approval. The one definition of "the appeal is not decided yet" that
 * feedback (`reviewHeldSql`) and the dispute counts (`rulingCountsSql`) share.
 */
export const appealPendingSql = (d: string): string => `(${d}.status = 'appealed' or (${d}.round = 2 and ${d}.status = 'awaiting-approval'))`;

/**
 * SQL (boolean): a published ruling of dispute (`code`, `seq`) may count toward a trader's dispute
 * record (R-011 / R-012, J-21 review F1): not while that dispute's appeal is pending, since round 1
 * is not the final outcome then; once the appeal is decided, its round 2 counts (the caller picks
 * the latest round). The shared predicate for the lost count behind Clean record
 * (traders/summary.ts LOST_DISPUTES_SQL) and for J-21's public "N won, M lost" counts: a won count
 * must use this same helper.
 */
export const rulingCountsSql = (code: string, seq: string): string =>
  `(not exists (select 1 from disputes dp where dp.code = ${code} and dp.seq = ${seq} and ${appealPendingSql('dp')}))`;

/**
 * SQL (boolean): the review (alias `r`) is ON HOLD (R-011: "if an appeal happens, then that feedback
 * will be put on hold and removed temporarily"): its trade has a dispute whose appeal is pending
 * (`appealed`, or round 2 awaiting a second approval). A held review is shown to nobody but its own
 * writer and counts in no figure; when the appeal is decided the result settles it (a reversal
 * erases it, `eraseReversedReviews`; a sale brings it back). A review whose trade was purged
 * (trade_code null) is never held.
 */
export const reviewHeldSql = (r: string): string => `(${r}.trade_code is not null and exists (
    select 1 from disputes d where d.code = ${r}.trade_code and ${appealPendingSql('d')}))`;
