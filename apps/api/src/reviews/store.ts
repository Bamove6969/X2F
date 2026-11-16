import { reviewMonth, type ReviewInput, type Side } from '@x2f/reputation';
import type { Queryable } from '../db/pool.js';
import { PURGE_ROLE } from '../trades/purge.js';
import { getMethod } from '../methods/profiles.js';
import { disputeOutcomeSql, reviewHeldSql } from '../traders/finalOutcome.js';

/**
 * Plan 5 Task 3: the reviews table (301_reviews.sql), Skip review (review_skips) and when a trade
 * can be reviewed.
 *
 * A review is permanent and anonymous in public (spec 5.1, owner 2026-10-29 and 2026-10-29b). It is
 * stars, trade badges, phrases or a note, nothing else (owner 2026-11-01: no weight, no amount), and
 * holds its own method and date, so it needs nothing from `trades` once the trade is purged. It
 * shows as soon as it is submitted (owner 2026-11-02: no blind reveal).
 */

/**
 * When the trade (alias `t`) became reviewable, as SQL (timestamptz, null while it is not), P5-A3 and
 * P5-A5:
 * - a trade that never had a dispute: only `released`, from its close;
 * - a trade that has EVER had a dispute (trades.dispute_by, or any row in `disputes`, including a
 *   dispute after a refund): only once the trade has ended again and every dispute on it is done
 *   (`final` or `closed`) AS A SALE; from the later of the trade's close and the last dispute's end
 *   (`disputes.closed_at`, else its latest ruling's time).
 * A dispute still `ruled` inside or after its appeal window is not done: Plan 4 moves it to `final`
 * (fail-safe: not reviewable, so it blocks nothing, until then).
 * A REVERSED trade (R-011, owner Q40: "if the trade is reversed, there is no feedback"; traders/
 * finalOutcome.ts `disputeOutcomeSql`) is never reviewable: its reviews are erased
 * (`eraseReversedReviews`) and the gate does not count it. A dispute that ends as a sale, even an
 * appeal that overturned round 1's reversal, is reviewable ("if they let it settle like a trade
 * happened, then the feedback stays").
 */
export const reviewableSinceSql = (t: string): string => `(case
  when ${t}.closed_at is null or ${t}.state = 'disputed' then null
  when ${disputeOutcomeSql(t)} = 'reversed' then null
  when ${t}.dispute_by is null and not exists (select 1 from disputes d where d.code = ${t}.code)
    then case when ${t}.state = 'released' then ${t}.closed_at end
  when exists (select 1 from disputes d where d.code = ${t}.code)
   and not exists (select 1 from disputes d where d.code = ${t}.code and d.status not in ('final', 'closed'))
    then greatest(${t}.closed_at, (
      select max(coalesce(d.closed_at, (select max(r.ruled_at) from dispute_rulings r where r.code = d.code and r.seq = d.seq)))
        from disputes d where d.code = ${t}.code))
  else null
end)`;

/** When the trade became reviewable (null: not reviewable, or no such trade). */
export async function reviewableSince(db: Queryable, code: string): Promise<Date | null> {
  const { rows } = await db.query<{ since: Date | null }>(`select ${reviewableSinceSql('t')} as since from trades t where t.code = $1`, [code]);
  return rows[0]?.since ?? null;
}

export interface ReviewRow {
  id: string;
  trade_code: string | null;
  reviewer_id: string | null;
  subject_id: string;
  reviewer_role: Side;
  neutral: boolean;
  stars: number | null;
  phrases: string[];
  trade_badges: string[];
  note: string | null;
  method_id: string;
  created_at: Date;
}

/**
 * What anyone may see of a review (P5-A10 as revised 2026-10-29b): stars or Neutral, the phrases,
 * the trade badges, the note, the method's name and the month. Never the reviewer, the trade, an
 * amount or an exact time.
 */
export interface PublicReview {
  neutral: boolean;
  stars: number | null;
  phrases: string[];
  tradeBadges: string[];
  note: string | null;
  method: string;
  /** Month and year only, "Mar 2026" (UTC). */
  age: string;
}

export function toPublicReview(r: ReviewRow): PublicReview {
  return {
    neutral: r.neutral,
    stars: r.stars,
    phrases: [...r.phrases],
    tradeBadges: [...r.trade_badges],
    note: r.note,
    method: getMethod(r.method_id)?.name ?? r.method_id,
    age: reviewMonth(r.created_at),
  };
}

/** Both sides' reviews of a trade (while its code is still on them). */
export async function reviewsOfTrade(db: Queryable, code: string): Promise<{ buyer: ReviewRow | null; seller: ReviewRow | null }> {
  const { rows } = await db.query<ReviewRow>('select * from reviews where trade_code = $1', [code]);
  return { buyer: rows.find((r) => r.reviewer_role === 'buyer') ?? null, seller: rows.find((r) => r.reviewer_role === 'seller') ?? null };
}

/**
 * Whether the trade's feedback is on hold (R-011: an appeal is pending, traders/finalOutcome.ts
 * `reviewHeldSql`): its reviews are shown to nobody but their writer and count in no figure until the
 * appeal's result decides.
 */
export async function reviewsHeld(db: Queryable, code: string): Promise<boolean> {
  const { rows } = await db.query<{ held: boolean }>(`select ${reviewHeldSql('r')} as held from (select $1::text as trade_code) r`, [code]);
  return rows[0]?.held === true;
}

/** Whether `side` skipped reviewing the trade (review_skips, owner 2026-11-01 item 28). */
export async function hasSkipped(db: Queryable, code: string, side: Side): Promise<boolean> {
  const { rowCount } = await db.query('select 1 from review_skips where trade_code = $1 and side = $2', [code, side]);
  return (rowCount ?? 0) > 0;
}

/** Records a Skip review for one side; it leaves no review (nothing shows, nothing counts). */
export async function insertSkip(q: Queryable, code: string, side: Side): Promise<void> {
  await q.query('insert into review_skips (trade_code, side) values ($1, $2)', [code, side]);
}

export interface NewReview {
  tradeCode: string;
  reviewerId: string;
  subjectId: string;
  reviewerRole: Side;
  input: ReviewInput;
  methodId: string;
  createdAt: Date;
}

export async function insertReview(q: Queryable, r: NewReview): Promise<void> {
  const i = r.input;
  await q.query(
    `insert into reviews (trade_code, reviewer_id, subject_id, reviewer_role, neutral, stars, phrases, trade_badges, note,
                          method_id, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      r.tradeCode, r.reviewerId, r.subjectId, r.reviewerRole, i.neutral,
      i.neutral ? null : i.stars, i.neutral ? [] : i.phrases, i.neutral ? [] : i.tradeBadges, i.neutral ? null : (i.note ?? null),
      r.methodId, r.createdAt,
    ],
  );
}

/**
 * How coarse a review's time becomes when its trade is purged (review round 1, I2): an exact review
 * time would link a permanent review to an outside record of its trade. Month and year (owner
 * 2026-11-01, item 27); 301's trigger allows exactly this unit.
 */
export const REVIEW_DETACH_GRANULARITY = 'month';

/**
 * SEAM for the Plan 7 whole-trade purge (apps/api/src/retention/tradePurge.ts on
 * wip/lead-p7-retention) and Plan 5 Task 20: before the trade row is deleted, in the same
 * transaction and AS x2f_purge (`set local role x2f_purge`), forget which trade and which reviewer a
 * review came from. The reviews themselves stay (permanent); `trade_code` and `reviewer_id` are
 * nulled together and `created_at` is truncated to its UTC month. 301's trigger allows exactly that
 * to x2f_purge and nothing else. A detached review is never matched again, so a second call is a
 * no-op. Returns the number of reviews detached. (The trade's review_skips rows go with the trade
 * row itself: on delete cascade.)
 */
export async function detachReviews(q: Queryable, code: string): Promise<number> {
  const r = await q.query(
    `update reviews set trade_code = null, reviewer_id = null, created_at = date_trunc('month', created_at, 'UTC') where trade_code = $1`,
    [code],
  );
  return r.rowCount ?? 0;
}

/**
 * R-011 (owner Q40; was C12, owner 2026-11-02, review I2): ERASE every review and Skip review row of
 * one trade, so nothing of them shows anywhere. The SEAM a ruling's transaction calls when the trade
 * ends REVERSED (NEEDS_P4_OVERTURN_ERASES_REVIEWS, apps/api/test/reviews-tripwire.test.ts): with the
 * transaction's client, in the SAME transaction that records the deciding ruling, after that write.
 * It must run in a transaction. It does not decide whether the trade was reversed:
 * `eraseReversedReviews` below does.
 *
 * - Lock order: the trade row first (FOR UPDATE), like the review and skip routes
 *   (routes.ts `reviewableSide`), so a review submitted meanwhile either commits first and is
 *   deleted here, or waits and then finds the trade not reviewable (409 `not-reviewable`, once the
 *   overturn is recorded). The lock is taken under the caller's role (FOR UPDATE needs update rights
 *   x2f_purge does not have).
 * - The deletes run as x2f_purge (`set local role`), the one role 301's reviews_final trigger lets
 *   delete a review (309 grants it review_skips); the caller's role is put back afterwards for the
 *   rest of its transaction. No trigger is changed.
 * - Idempotent: a second call deletes nothing.
 *
 * Returns how many reviews and skips were deleted.
 */
export async function eraseReviewsOfTrade(q: Queryable, code: string): Promise<{ reviews: number; skips: number }> {
  await q.query('select 1 from trades where code = $1 for update', [code]);
  const { rows: role } = await q.query<{ r: string }>(`select current_setting('role') as r`);
  // PURGE_ROLE is a compile-time constant (an SQL identifier, not a bound parameter).
  await q.query(`set local role ${PURGE_ROLE}`);
  const reviews = await q.query('delete from reviews where trade_code = $1', [code]);
  const skips = await q.query('delete from review_skips where trade_code = $1', [code]);
  await q.query(`select set_config('role', $1, true)`, [role[0]!.r]);
  return { reviews: reviews.rowCount ?? 0, skips: skips.rowCount ?? 0 };
}

/**
 * `eraseReviewsOfTrade`, only if the trade's final binding outcome is a REVERSAL (R-011,
 * traders/finalOutcome.ts `disputeOutcomeSql`): its reviews and skips are erased and it is no longer
 * reviewable (`reviewableSinceSql`), so the gate and the pending list leave it out. Any other trade is
 * left alone: one that settled as a sale keeps its reviews, and one whose dispute or appeal is still
 * pending keeps them on hold (`reviewHeldSql`) for the result to decide. Locks the trade row first,
 * then decides; same transaction rules as `eraseReviewsOfTrade`.
 */
export async function eraseReversedReviews(q: Queryable, code: string): Promise<{ reviews: number; skips: number }> {
  const { rows } = await q.query<{ reversed: boolean }>(
    `select coalesce(${disputeOutcomeSql('t')} = 'reversed', false) as reversed from trades t where t.code = $1 for update`,
    [code],
  );
  if (rows[0]?.reversed !== true) return { reviews: 0, skips: 0 };
  return eraseReviewsOfTrade(q, code);
}
