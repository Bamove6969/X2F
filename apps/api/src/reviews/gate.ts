import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { reviewableSinceSql } from './store.js';

/**
 * Plan 5 Task 3: the pending-review gate (spec 5.1 "a user cannot start their next trade until they
 * have rated the last one", P5-A4; owner 2026-11-01: "submit a review or tap Skip to complete the
 * trade and clear it"). Every reviewable trade this trader has neither reviewed nor skipped blocks
 * them from taking an offer, from being taken as a poster, and from setting up a trade as the poster
 * (`POST /v1/trades/:code/wallet`); their offers are left out of the lists meanwhile and reappear
 * at once when they review or skip. Posting an offer is still allowed. There is no deadline: with
 * no blind reveal (owner 2026-11-02) the P5-A31 late-review modes are gone, so a trade blocks until
 * its side is done.
 */

/**
 * SQL (boolean): the reviewable trade (`s.since`) counts for the gate: it became reviewable at or
 * after `site_flags.reviews_since`, the time migration 301 was applied (review round 1, M4). Trades
 * that ended before reviews existed stay reviewable (GET/POST) but never block.
 */
// No site_flags row: '-infinity', so every trade counts and the gate fails closed like the other site_flags readers (round 2, m1).
const AFTER_CUTOFF = `s.since >= coalesce((select f.reviews_since from site_flags f), '-infinity'::timestamptz)`;

/** SQL (boolean): the trade `t` has a review or a skip by `account`'s side. */
function sideDone(t: string, account: string): string {
  const side = `case when ${t}.buyer_account_id = ${account} then 'buyer' else 'seller' end`;
  return `(exists (select 1 from reviews rv where rv.trade_code = ${t}.code and rv.reviewer_role = ${side})
        or exists (select 1 from review_skips sk where sk.trade_code = ${t}.code and sk.side = ${side}))`;
}

/**
 * SQL (boolean): the account `account` (an SQL expression of type uuid) has a pending review as of
 * `now` (an SQL expression of type timestamptz, bound from the clock). The pending trade is aliased
 * `pr` so it never clashes with the caller's aliases. Nothing depends on `now` any more (no review
 * deadline); it stays referenced so the callers' bound parameter keeps a type.
 */
export function pendingReviewSql(account: string, now: string): string {
  return `exists (
    select 1 from trades pr cross join lateral (select ${reviewableSinceSql('pr')} as since) s
     where (pr.buyer_account_id = ${account} or pr.seller_account_id = ${account})
       and s.since is not null and ${AFTER_CUTOFF} and ${now} is not null
       and not ${sideDone('pr', account)})`;
}

/** 409 `review-pending` while the account has a reviewable trade it has neither rated nor skipped. */
export async function assertNoPendingReview(q: Queryable, accountId: string, now: Date): Promise<void> {
  if (await hasPendingReview(q, accountId, now)) throw new ApiError(409, 'review-pending');
}

export async function hasPendingReview(q: Queryable, accountId: string, now: Date): Promise<boolean> {
  const { rows } = await q.query<{ pending: boolean }>(`select ${pendingReviewSql('$1::uuid', '$2::timestamptz')} as pending`, [accountId, now]);
  return rows[0]!.pending;
}

export interface PendingReview {
  code: string;
  /** The other trader's public Trade Tag. */
  counterparty: string;
  reviewableSince: Date;
}

/** The account's pending reviews (the trades the gate counts, same cutoff), oldest first. */
export async function pendingReviews(q: Queryable, accountId: string, now: Date): Promise<PendingReview[]> {
  const { rows } = await q.query<{ code: string; counterparty: string; since: Date }>(
    `select t.code, a.trade_tag as counterparty, s.since
       from trades t cross join lateral (select ${reviewableSinceSql('t')} as since) s
       join accounts a on a.id = case when t.buyer_account_id = $1 then t.seller_account_id else t.buyer_account_id end
      where (t.buyer_account_id = $1 or t.seller_account_id = $1)
        and s.since is not null and ${AFTER_CUTOFF} and $2::timestamptz is not null
        and not ${sideDone('t', '$1')}
      order by s.since, t.code`,
    [accountId, now],
  );
  return rows.map((r) => ({ code: r.code, counterparty: r.counterparty, reviewableSince: r.since }));
}
