import { getMethod } from '../methods/profiles.js';
import { reviewMonth, type ReviewDisputeStatus } from '@x2f/reputation';
import type { Queryable } from '../db/pool.js';
import { reviewHeldSql } from '../traders/finalOutcome.js';

/**
 * Plan 5 Task 19 (Revision 2026-10-29b, owner): review disputes (317_review_disputes.sql).
 *
 * The person a review is about disputes it with a free-text reason. While the dispute is open the
 * review shows "Under review" and counts in no figure (% positive, Trusted, the other badges, the
 * signed record: lead default, the benefit of the doubt); a moderator then lets it stand, removes
 * some of its comments (the stars stay), or removes it (it shows and counts nowhere; the row stays,
 * marked, so the decision can be checked). One dispute per review, ever (lead default, owner
 * question: see the migration).
 */

/** The longest reason a trader gives, and the moderator's shortest and longest (plan Task 19). */
export const DISPUTE_REASON_MAX = 1000;
export const DECISION_REASON_MIN = 20;
export const DECISION_REASON_MAX = 1000;

/** The moderator outcomes (the owner's three, Revision 2026-10-29b). */
export const DISPUTE_OUTCOMES = ['stands', 'comments-removed', 'removed'] as const satisfies readonly ReviewDisputeStatus[];
export type DisputeOutcome = (typeof DISPUTE_OUTCOMES)[number];

/**
 * SQL (boolean): the review (alias `r`) shows to others: not removed by a moderator and not on hold
 * by a pending appeal (R-011, `reviewHeldSql`). An "Under review" one still shows, with its label.
 */
export const reviewShownSql = (r: string): string => `(not ${r}.removed and not ${reviewHeldSql(r)})`;

/** SQL (boolean): the review (alias `r`) has an open dispute: it shows "Under review". */
export const underReviewSql = (r: string): string =>
  `(exists (select 1 from review_disputes rd where rd.review_id = ${r}.id and rd.status = 'open'))`;

/**
 * SQL (boolean): the review (alias `r`) counts in the figures (@x2f/reputation `countsInStats`):
 * shown, and not under review. A review whose comments were removed keeps its stars, so it counts.
 */
export const reviewCountsSql = (r: string): string => `(${reviewShownSql(r)} and not ${underReviewSql(r)})`;

export type OpenResult = 'ok' | 'not-found' | 'not-disputable' | 'disputed';

/**
 * Opens a dispute on review `reviewId` for `subjectId`, in the caller's transaction. Only the review's
 * subject may (anyone else gets the same answer as an unknown id: `not-found`); a review that does
 * not show (removed, or on hold by an appeal) is `not-disputable`; a review already disputed, open or
 * decided, is `disputed`. The review row is locked first, so two disputes of one review serialize
 * (the unique index is the backstop).
 */
export async function openReviewDispute(q: Queryable, reviewId: string, subjectId: string, reason: string, now: Date): Promise<OpenResult> {
  const { rows } = await q.query<{ shown: boolean }>(
    `select ${reviewShownSql('r')} as shown from reviews r where r.id = $1 and r.subject_id = $2 for update`,
    [reviewId, subjectId],
  );
  if (rows.length === 0) return 'not-found';
  if (!rows[0]!.shown) return 'not-disputable';
  const ins = await q.query(
    `insert into review_disputes (review_id, reason_text, opened_at) values ($1, $2, $3) on conflict (review_id) do nothing`,
    [reviewId, reason, now],
  );
  return (ins.rowCount ?? 0) === 1 ? 'ok' : 'disputed';
}

/** What a moderator sees of an open dispute: the review and the reason, never who wrote either. */
export interface StaffReviewDispute {
  id: string;
  openedAt: string;
  reason: string;
  review: {
    neutral: boolean;
    stars: number | null;
    phrases: string[];
    tradeBadges: string[];
    note: string | null;
    method: string;
    /** Month and year, as the public sees it. */
    age: string;
    /** Which side wrote it (the subject was the other side). */
    reviewerRole: 'buyer' | 'seller';
  };
  /**
   * The trade's code while the trade still exists, so the moderator can look at it; null once the
   * trade was purged (30 days after it ended): there is no chat to read, and the decision rests on
   * the review and the reason (plan Task 19).
   */
  tradeCode: string | null;
}

/** One page of open disputes (STAFF_PAGE of them), oldest first; `after` is the last one's `openedAt_id`. */
export const STAFF_PAGE = 50;

export async function listOpenReviewDisputes(q: Queryable, after?: { openedAt: Date; id: string }): Promise<StaffReviewDispute[]> {
  const { rows } = await q.query<{
    id: string; opened_at: Date; reason_text: string; neutral: boolean; stars: number | null; phrases: string[]; trade_badges: string[];
    note: string | null; method_id: string; created_at: Date; reviewer_role: 'buyer' | 'seller'; trade_code: string | null;
  }>(
    `select d.id, d.opened_at, d.reason_text, r.neutral, r.stars, r.phrases, r.trade_badges, r.note, r.method_id, r.created_at,
            r.reviewer_role, r.trade_code
       from review_disputes d join reviews r on r.id = d.review_id
      where d.status = 'open' and ($1::timestamptz is null or (d.opened_at, d.id) > ($1::timestamptz, $2::uuid))
      order by d.opened_at, d.id limit ${STAFF_PAGE}`,
    [after?.openedAt ?? null, after?.id ?? null],
  );
  return rows.map((r) => ({
    id: r.id,
    openedAt: r.opened_at.toISOString(),
    reason: r.reason_text,
    review: {
      neutral: r.neutral,
      stars: r.stars,
      phrases: [...r.phrases],
      tradeBadges: [...r.trade_badges],
      note: r.note,
      method: getMethod(r.method_id)?.name ?? r.method_id,
      age: reviewMonth(r.created_at),
      reviewerRole: r.reviewer_role,
    },
    tradeCode: r.trade_code,
  }));
}

/** What "remove some comments" removes: the note, and any of the review's phrases and trade badges. */
export interface CommentRemoval {
  note: boolean;
  phrases: string[];
  tradeBadges: string[];
}

export type DecideResult = 'ok' | 'not-found' | 'decided' | 'bad-removal';

/**
 * Decides dispute `id`, in the caller's transaction: the dispute row first (locked), then the review
 * as the outcome says (317's reviews_final trigger allows exactly these writes once the dispute says
 * so). `removal` is required for `comments-removed` and must remove something the review has.
 */
export async function decideReviewDispute(
  q: Queryable,
  id: string,
  o: { outcome: DisputeOutcome; reason: string; by: string; removal: CommentRemoval | null },
  now: Date,
): Promise<{ result: DecideResult; reviewId?: string }> {
  const { rows } = await q.query<{ review_id: string; status: string; note: string | null; phrases: string[]; trade_badges: string[] }>(
    `select d.review_id, d.status, r.note, r.phrases, r.trade_badges
       from review_disputes d join reviews r on r.id = d.review_id where d.id = $1 for update of d, r`,
    [id],
  );
  const d = rows[0];
  if (!d) return { result: 'not-found' };
  if (d.status !== 'open') return { result: 'decided' };
  let kept: { note: string | null; phrases: string[]; tradeBadges: string[] } | null = null;
  if (o.outcome === 'comments-removed') {
    const rm = o.removal;
    if (rm === null) return { result: 'bad-removal' };
    if (rm.note && d.note === null) return { result: 'bad-removal' };
    if (!rm.phrases.every((p) => d.phrases.includes(p)) || !rm.tradeBadges.every((b) => d.trade_badges.includes(b))) return { result: 'bad-removal' };
    if (!rm.note && rm.phrases.length === 0 && rm.tradeBadges.length === 0) return { result: 'bad-removal' };
    kept = {
      note: rm.note ? null : d.note,
      phrases: d.phrases.filter((p) => !rm.phrases.includes(p)),
      tradeBadges: d.trade_badges.filter((b) => !rm.tradeBadges.includes(b)),
    };
  }
  await q.query(
    `update review_disputes set status = $2, decided_by = $3, decided_at = $4, decision_reason = $5 where id = $1`,
    [id, o.outcome, o.by, now, o.reason],
  );
  if (o.outcome === 'removed') {
    await q.query('update reviews set removed = true where id = $1', [d.review_id]);
  } else if (kept !== null) {
    await q.query(
      'update reviews set note = $2, phrases = $3, trade_badges = $4, comments_removed = true where id = $1',
      [d.review_id, kept.note, kept.phrases, kept.tradeBadges],
    );
  }
  return { result: 'ok', reviewId: d.review_id };
}
