import { REVEAL_AFTER_DAYS, isRevealed, revealAt, reviewMonth, type ReviewInput, type Side } from '@x2f/reputation';
import type { Queryable } from '../db/pool.js';
import { getMethod } from '../methods/profiles.js';

/**
 * Plan 5 Task 3: the reviews table (301_reviews.sql) and when a trade can be reviewed.
 *
 * A review is permanent and anonymous in public (spec 5.1, owner 2026-10-29 and 2026-10-29b). It
 * stores only its weight, never the trade's USD amount (lead decision 2026-10-30), and holds its
 * own method, reveal anchor and date, so it needs nothing from `trades` once the trade is purged.
 */

/**
 * When the trade (alias `t`) became reviewable, as SQL (timestamptz, null while it is not), P5-A3 and
 * P5-A5:
 * - a trade that never had a dispute: only `released`, from its close;
 * - a trade that has EVER had a dispute (trades.dispute_by, or any row in `disputes`, including a
 *   dispute after a refund): only once the trade has ended again and every dispute on it is done
 *   (`final` or `closed`), whatever the outcome; from the later of the trade's close and the last
 *   dispute's end (`disputes.closed_at`, else its latest ruling's time).
 * A dispute still `ruled` inside or after its appeal window is not done: Plan 4 moves it to `final`
 * (fail-safe: not reviewable, so it blocks nothing, until then).
 */
export const reviewableSinceSql = (t: string): string => `(case
  when ${t}.closed_at is null or ${t}.state = 'disputed' then null
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
  weight: string;
  method_id: string;
  reviewable_since: Date;
  created_at: Date;
}

/**
 * What anyone may see of a review (P5-A10 as revised 2026-10-29b): stars or Neutral, the phrases,
 * the trade badges, the note, the method's name and the month. Never the reviewer, the trade, an
 * amount, the weight or an exact time.
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
 * The blind reveal of one trade's reviews as `viewer` sees it (spec 5.3, @x2f/reputation `revealAt`).
 * The anchor is the viewer's OWN stored review's `reviewable_since`, else the trade's reviewable time
 * now (`live`); null when there is neither (nothing to reveal). It is never the other side's stored
 * row (review round 1, M1): stored and live can differ (a released trade later escalated to a
 * dispute has no live time; a dispute going `final` then `closed` moves it later), and an anchor
 * taken from the counterparty's row would tell the viewer that the counterparty has rated, and could
 * show their review while the viewer cannot rate.
 */
export function revealFacts(
  live: Date | null,
  reviews: { buyer: ReviewRow | null; seller: ReviewRow | null },
  viewer: Side,
): { revealAt: Date; revealed: (now: Date) => boolean } | null {
  const anchor = reviews[viewer]?.reviewable_since ?? live;
  if (anchor === null) return null;
  const facts = { reviewableSince: anchor, submitted: { buyer: reviews.buyer?.created_at ?? null, seller: reviews.seller?.created_at ?? null } };
  return { revealAt: revealAt(facts), revealed: (now) => isRevealed(facts, now) };
}

export interface NewReview {
  tradeCode: string;
  reviewerId: string;
  subjectId: string;
  reviewerRole: Side;
  input: ReviewInput;
  /** From @x2f/reputation `reviewWeight` (never the USD amount itself). */
  weight: bigint;
  methodId: string;
  reviewableSince: Date;
  createdAt: Date;
}

export async function insertReview(q: Queryable, r: NewReview): Promise<void> {
  const i = r.input;
  await q.query(
    `insert into reviews (trade_code, reviewer_id, subject_id, reviewer_role, neutral, stars, phrases, trade_badges, note, weight,
                          method_id, reviewable_since, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      r.tradeCode, r.reviewerId, r.subjectId, r.reviewerRole, i.neutral,
      i.neutral ? null : i.stars, i.neutral ? [] : i.phrases, i.neutral ? [] : i.tradeBadges, i.neutral ? null : (i.note ?? null),
      r.weight.toString(), r.methodId, r.reviewableSince, r.createdAt,
    ],
  );
}

/**
 * How coarse a review's times become when its trade is purged (review round 1, I2): an exact release
 * or review time would link a permanent review to an outside record of its trade.
 */
export const REVIEW_DETACH_GRANULARITY: 'day' | 'week' | 'month' = 'month'; // PENDING OWNER (owner list item 27): month is a placeholder, easy to flip (day|week|month)

/**
 * SEAM for the Plan 7 whole-trade purge (apps/api/src/retention/tradePurge.ts on
 * wip/lead-p7-retention) and Plan 5 Task 20: before the trade row is deleted, in the same
 * transaction and AS x2f_purge (`set local role x2f_purge`), forget which trade and which reviewer a
 * review came from. The reviews themselves stay (permanent); `trade_code` and `reviewer_id` are
 * nulled together, and the two times are coarsened to `REVIEW_DETACH_GRANULARITY` (UTC):
 * `created_at` truncated down; `reviewable_since` truncated down once its reveal deadline (+7 days)
 * has passed, otherwise rounded UP to the next unit start so the reveal is never brought forward.
 * 301's trigger allows exactly that to x2f_purge and nothing else. A detached review is never
 * matched again, so a second call is a no-op. Returns the number of reviews detached.
 */
export async function detachReviews(q: Queryable, code: string): Promise<number> {
  const r = await q.query(
    `update reviews set trade_code = null, reviewer_id = null,
       created_at = date_trunc($2, created_at, 'UTC'),
       reviewable_since = case
         when reviewable_since + make_interval(days => $3) <= now() then date_trunc($2, reviewable_since, 'UTC')
         when date_trunc($2, reviewable_since, 'UTC') = reviewable_since then reviewable_since
         else date_trunc($2, reviewable_since, 'UTC') + ('1 ' || $2)::interval
       end
     where trade_code = $1`,
    [code, REVIEW_DETACH_GRANULARITY, REVEAL_AFTER_DAYS],
  );
  return r.rowCount ?? 0;
}
