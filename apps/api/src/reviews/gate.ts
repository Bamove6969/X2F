import { LATE_REVIEW, REVEAL_AFTER_DAYS, type LateReviewMode } from '@x2f/reputation';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { reviewableSinceSql } from './store.js';

/**
 * Plan 5 Task 3: the pending-review gate (spec 5.1 "a user cannot start their next trade until they
 * have rated the last one", P5-A4). Every reviewable trade without this trader's own review blocks
 * them from taking an offer, from being taken as a poster, and from setting up a trade as the poster
 * (`POST /v1/trades/:code/wallet`); their offers are left out of the lists meanwhile. Posting an
 * offer is still allowed.
 *
 * P5-A31 (OPEN, owner): with `LATE_REVIEW = 'closed'` a trade stops blocking once its reveal deadline
 * (reviewable + 7 days) has passed; `'any'` and `'neutral-only'` keep blocking until rated.
 */

let lateMode: LateReviewMode = LATE_REVIEW;

/** The P5-A31 mode in force (the @x2f/reputation constant; tests switch it). */
export function lateReviewMode(): LateReviewMode {
  return lateMode;
}

/** For tests only: switch the P5-A31 mode for this process. */
export function setLateReviewMode(m: LateReviewMode): void {
  lateMode = m;
}

/**
 * SQL (boolean): the reviewable trade (`s.since`) counts for the gate: it became reviewable at or
 * after `site_flags.reviews_since`, the time migration 301 was applied (review round 1, M4). Trades
 * that ended before reviews existed stay reviewable (GET/POST) but never block.
 */
const AFTER_CUTOFF = `s.since >= (select f.reviews_since from site_flags f)`;

const REVEAL_INTERVAL = `interval '${REVEAL_AFTER_DAYS} days'`;

/** SQL (boolean): the review window of a reviewable trade (`s.since`) is still open at `now`. */
function stillOpen(now: string): string {
  // `now` is referenced in every mode, so its parameter always has a type.
  return lateMode === 'closed' ? `${now} < s.since + ${REVEAL_INTERVAL}` : `${now} is not null`;
}

/**
 * SQL (boolean): the account `account` (an SQL expression of type uuid) has a pending review as of
 * `now` (an SQL expression of type timestamptz, bound from the clock). The pending trade is aliased
 * `pr` so it never clashes with the caller's aliases.
 */
export function pendingReviewSql(account: string, now: string): string {
  return `exists (
    select 1 from trades pr cross join lateral (select ${reviewableSinceSql('pr')} as since) s
     where (pr.buyer_account_id = ${account} or pr.seller_account_id = ${account})
       and s.since is not null and ${AFTER_CUTOFF} and ${stillOpen(now)}
       and not exists (
         select 1 from reviews rv
          where rv.trade_code = pr.code
            and rv.reviewer_role = case when pr.buyer_account_id = ${account} then 'buyer' else 'seller' end))`;
}

/** 409 `review-pending` while the account has a reviewable trade it has not rated. */
export async function assertNoPendingReview(q: Queryable, accountId: string, now: Date): Promise<void> {
  if (await hasPendingReview(q, accountId, now)) throw new ApiError(409, 'review-pending');
}

export async function hasPendingReview(q: Queryable, accountId: string, now: Date): Promise<boolean> {
  const { rows } = await q.query<{ pending: boolean }>(`select ${pendingReviewSql('$1::uuid', '$2::timestamptz')} as pending`, [accountId, now]);
  return rows[0]!.pending;
}

export interface PendingReview {
  code: string;
  /** The other trader's public display name. */
  counterparty: string;
  reviewableSince: Date;
}

/** The account's pending reviews (the trades the gate counts, same cutoff), oldest first. */
export async function pendingReviews(q: Queryable, accountId: string, now: Date): Promise<PendingReview[]> {
  const { rows } = await q.query<{ code: string; counterparty: string; since: Date }>(
    `select t.code, a.display_name as counterparty, s.since
       from trades t cross join lateral (select ${reviewableSinceSql('t')} as since) s
       join accounts a on a.id = case when t.buyer_account_id = $1 then t.seller_account_id else t.buyer_account_id end
      where (t.buyer_account_id = $1 or t.seller_account_id = $1)
        and s.since is not null and ${AFTER_CUTOFF} and ${stillOpen('$2::timestamptz')}
        and not exists (
          select 1 from reviews rv
           where rv.trade_code = t.code and rv.reviewer_role = case when t.buyer_account_id = $1 then 'buyer' else 'seller' end)
      order by s.since, t.code`,
    [accountId, now],
  );
  return rows.map((r) => ({ code: r.code, counterparty: r.counterparty, reviewableSince: r.since }));
}
