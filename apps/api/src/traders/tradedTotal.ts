import { tradedBucketUsd } from '@x2f/reputation';
import type { FastifyInstance } from 'fastify';
import { requireSession } from '../auth/sessions.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { verifiedPastRepUsdSql } from '../pastrep/store.js';

/**
 * C12b (owner 2026-11-01/02, via the lead): the per-account running totals of 308_traded_totals.sql.
 *
 * `countTradeTotals` runs in the transaction that stores a trade event (trades/store.ts
 * `applyEvent`) and is idempotent per trade: a COMPLETED trade (released, or refunded to settle a
 * dispute: R38, the same rule as `COMPLETED_TRADES_SQL`) adds its take-time USD value
 * (`trades.usd_cents`; null counts nothing) to both sides' `own_usd_cents` once; a settled
 * `buyer-cancel` adds one to the buyer's `buyer_cancels` once (moderators only, a Plan 4 seam). A
 * review or a Skip review changes neither. The totals have no link to trades, so they survive the
 * 30-day purge. SEAM for Plan 5 Task 20's `account_totals`.
 *
 * The public bucket is `tradedBucketUsd(own_usd_cents + verifiedPastRepUsdCents)`: the account's own
 * counted total plus the volume proven on other sites, ONLY through the dollar figure a moderator
 * verified on an APPROVED past-reputation claim (owner 2026-11-02, lead 07:48; migration 310,
 * `pastrep/store.ts`). An unverified (null), not-yet-approved (`signed`) or dead (rejected, removed,
 * revoked) claim adds nothing,
 * and is read live, so a revoked claim stops counting at once. With no trades of its own, verified
 * imported volume alone counts (OWNER-Q: the owner said the line includes it; plan default).
 */
export async function countTradeTotals(q: Queryable, code: string): Promise<void> {
  // Completed: add the value to both sides, once.
  await q.query(
    `with t as (
       select code, buyer_account_id, seller_account_id, usd_cents from trades
        where code = $1 and (state = 'released' or (state = 'refunded' and dispute_by is not null))
     ), mark as (
       insert into trade_totals_counted (trade_code, kind) select code, 'completed' from t
       on conflict do nothing returning trade_code
     )
     insert into account_traded_totals (account_id, own_usd_cents)
     select a.id, coalesce(t.usd_cents, 0) from t join mark on mark.trade_code = t.code
       cross join lateral (values (t.buyer_account_id), (t.seller_account_id)) as a (id)
     on conflict (account_id) do update set own_usd_cents = account_traded_totals.own_usd_cents + excluded.own_usd_cents`,
    [code],
  );
  // A settled buyer cancel: one for the buyer, once.
  await q.query(
    `with t as (
       select code, buyer_account_id from trades where code = $1 and state = 'refunded' and settling = 'buyer-cancel'
     ), mark as (
       insert into trade_totals_counted (trade_code, kind) select code, 'buyer-cancel' from t
       on conflict do nothing returning trade_code
     )
     insert into account_traded_totals (account_id, buyer_cancels)
     select t.buyer_account_id, 1 from t join mark on mark.trade_code = t.code
     on conflict (account_id) do update set buyer_cancels = account_traded_totals.buyer_cancels + 1`,
    [code],
  );
}

/**
 * SQL (bigint): the account `account`'s total for the public bucket: its own counted total (0 with no
 * row) plus `verifiedPastRepUsdCents` (as `verifiedPastRepUsdSql`, the same sum in one query).
 */
export const tradedTotalSql = (account: string): string =>
  `(coalesce((select tt.own_usd_cents from account_traded_totals tt where tt.account_id = ${account}), 0) + ${verifiedPastRepUsdSql(account)})`;

/** The public bucket in whole dollars, or null: opted out, or below $10,000. Never the exact total. */
export function tradedOverUsd(show: boolean, totalUsdCents: string | bigint): number | null {
  return show ? tradedBucketUsd(BigInt(totalUsdCents)) : null;
}

/** The trader's own setting and their bucket (shown to them whether or not it is public). */
export async function tradedTotalSetting(q: Queryable, accountId: string): Promise<{ show: boolean; tradedOverUsd: number | null }> {
  const { rows } = await q.query<{ show: boolean; total: string }>(
    `select a.show_traded_total as show, ${tradedTotalSql('a.id')} as total from accounts a where a.id = $1`,
    [accountId],
  );
  const r = rows[0]!;
  return { show: r.show, tradedOverUsd: tradedBucketUsd(BigInt(r.total)) };
}

/**
 * `GET /v1/account/profile/traded-total` → `{ show, tradedOverUsd }`: the trader's own setting and
 * bucket. `PUT` the same path `{ show: boolean }` turns the public line on or off (off by default)
 * and answers the same shape. Trader sessions only (the account's own trader, not staff).
 */
export function tradedTotalRoutes(app: FastifyInstance): void {
  const trader = requireSession({ kinds: ['trader'] });
  const PATH = '/v1/account/profile/traded-total';
  app.get(PATH, { preHandler: trader }, async (req) => tradedTotalSetting(req.server.deps.db, req.auth.accountId));
  app.put(PATH, { preHandler: trader }, async (req) => {
    const body = req.body as { show?: unknown } | null;
    if (body === null || typeof body !== 'object' || Array.isArray(body) || typeof body.show !== 'boolean') throw new ApiError(400, 'bad-request');
    await req.server.deps.db.query('update accounts set show_traded_total = $2 where id = $1', [req.auth.accountId, body.show]);
    return tradedTotalSetting(req.server.deps.db, req.auth.accountId);
  });
}
