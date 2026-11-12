import { tradedBucketUsd, tradedBucketXmr } from '@x2f/reputation';
import type { FastifyInstance } from 'fastify';
import { requireSession } from '../auth/sessions.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { verifiedPastRepBySite, type VerifiedSiteVolume } from '../pastrep/store.js';
import { disputeOutcomeSql, isFinalSaleSql } from './finalOutcome.js';

/**
 * C12b (owner 2026-11-01/02, via the lead): the per-account running totals of 308_traded_totals.sql.
 *
 * `countTradeTotals` runs in the transaction that stores a trade event (trades/store.ts
 * `applyEvent`) and in the one that saves a dispute (disputes/store.ts `saveDispute`), and is
 * idempotent per trade. Owner Q41 (R-012, 6 Nov 2026; claude3's option A): the totals follow the
 * FINAL binding outcome: a trade counts only if it ended as a real completed sale
 * (traders/finalOutcome.ts `isFinalSaleSql`: released with no dispute, or its disputes decided as a
 * sale), otherwise it is removed. So a COMPLETED sale adds its take-time USD value
 * (`trades.usd_cents`; null counts nothing) and its XMR to both sides once (a `trade_totals_counted`
 * row of kind 'completed'); a trade counted earlier whose final outcome turns out a reversal (a later
 * dispute, or an appeal that reverses the ruling) takes exactly that back off both sides and drops the
 * mark, so a later sale outcome can count it again. A trade whose dispute is still pending is left as
 * it stands until the result. A cancel of any kind adds one to the `cancels` of the side that ended
 * it (`countCancel`, J-21; moderators only). A review or a Skip review changes neither. The totals have no
 * link to trades, so they survive the 30-day purge. SEAM for Plan 5 Task 20's `account_totals`.
 *
 * The dollar total (`own_usd_cents`) is for moderators only, never public (owner Q63, 6 Nov). The
 * public line is in XMR: `tradedBucketXmr(own_xmr_atomic)` (migration 312), the account's own trades
 * only. Imported volume never joins it: it shows as separate per-site lines (owner Q64, p4-1), from
 * the dollar figure a moderator verified on an APPROVED past-reputation claim (migration 310,
 * `pastrep/store.ts`), bucketed in US dollars (owner p4-1). An unverified (null), not-yet-approved
 * (`signed`) or dead (rejected, removed, revoked) claim adds no line, and is read live, so a revoked
 * claim stops showing at once.
 */
export async function countTradeTotals(q: Queryable, code: string): Promise<void> {
  // Review m3: both parties' rows first, in account-id order, on every path (a trade event as well
  // as a dispute's save), so two transactions on trades between the same two accounts never take
  // them in opposite orders (the upserts below go buyer, then seller).
  await lockPartyTotals(q, code);
  // A final sale: add the value to both sides, once.
  await q.query(
    `with t as (
       select t.code, t.buyer_account_id, t.seller_account_id, t.usd_cents, t.amount_atomic from trades t
        where t.code = $1 and ${isFinalSaleSql('t')}
     ), mark as (
       insert into trade_totals_counted (trade_code, kind) select code, 'completed' from t
       on conflict do nothing returning trade_code
     )
     insert into account_traded_totals (account_id, own_usd_cents, own_xmr_atomic)
     select a.id, coalesce(t.usd_cents, 0), t.amount_atomic from t join mark on mark.trade_code = t.code
       cross join lateral (values (t.buyer_account_id), (t.seller_account_id)) as a (id)
     on conflict (account_id) do update set own_usd_cents = account_traded_totals.own_usd_cents + excluded.own_usd_cents,
       own_xmr_atomic = account_traded_totals.own_xmr_atomic + excluded.own_xmr_atomic`,
    [code],
  );
  // Counted before, reversed in the end (R-012): take it back off both sides, once. The values are
  // what was added (a closed trade's usd_cents and amount_atomic no longer change); never below 0.
  await q.query(
    `with t as (
       select t.code, t.buyer_account_id, t.seller_account_id, t.usd_cents, t.amount_atomic from trades t
        where t.code = $1 and ${disputeOutcomeSql('t')} = 'reversed'
     ), unmark as (
       delete from trade_totals_counted c using t where c.trade_code = t.code and c.kind = 'completed' returning c.trade_code
     )
     update account_traded_totals tt
        set own_usd_cents = greatest(0, tt.own_usd_cents - coalesce(t.usd_cents, 0)),
            own_xmr_atomic = greatest(0, tt.own_xmr_atomic - t.amount_atomic)
       from t join unmark on unmark.trade_code = t.code
      where tt.account_id in (t.buyer_account_id, t.seller_account_id)`,
    [code],
  );
  // Review n1: a fast payment counted at the seller's release comes back off the buyer when the
  // trade is reversed in the end (it was not a real payment for a sale), once.
  await q.query(
    `with t as (
       select t.code, t.buyer_account_id from trades t where t.code = $1 and ${disputeOutcomeSql('t')} = 'reversed'
     ), unmark as (
       delete from trade_totals_counted c using t where c.trade_code = t.code and c.kind = 'fast-payment' returning c.trade_code
     )
     update account_traded_totals tt set fast_payments = greatest(0, tt.fast_payments - 1)
       from t join unmark on unmark.trade_code = t.code
      where tt.account_id = t.buyer_account_id`,
    [code],
  );
  await countCancel(q, code);
}

/**
 * J-21 (owner 2 Nov 01:50, T-017): the ONE cancel figure, moderators only (the case view). A trade
 * that ended as a cancel of any kind adds one, once, to the side that ended it. Lead default until
 * the owner confirms (P5-A9's "ended alone or by proposing an accepted mutual cancel", widened to
 * every kind):
 * - the buyer's cancel (closed before any coins, or its refund settled): the buyer;
 * - the seller's walk-away before funding: the seller;
 * - an accepted mutual cancel: the side that PROPOSED it (the other side of the stored
 *   `accept-cancel` event);
 * - the seller's "Cancel and get refund" once the buyer's time to pay ran out (`auto-refund` with
 *   no dispute): the buyer, whose time ran out;
 * - nobody for what no trader tapped: the setup time-out, a funding lapse, a hold's system cancel.
 * A refund that settles a dispute is a completed trade, never a cancel. The trade's events are
 * still stored when it closes (they go with the 30-day purge, the figure stays). Runs in the
 * transaction that stores the closing event, after that event.
 */
export async function countCancel(q: Queryable, code: string): Promise<void> {
  await q.query(
    `with t as (
       select code, state, settling, buyer_account_id, seller_account_id from trades
        where code = $1 and dispute_by is null
          and (state = 'cancelled' or (state = 'refunded' and settling in ('buyer-cancel', 'mutual-cancel', 'auto-refund')))
     ), closing as (
       select e.by, e.event->>'type' as type from trade_events e where e.code = $1 order by e.id desc limit 1
     ), accepted as (
       select e.by from trade_events e where e.code = $1 and e.event->>'type' = 'accept-cancel' order by e.id desc limit 1
     ), side as (
       select t.code, t.buyer_account_id, t.seller_account_id,
              case
                when t.state = 'cancelled' then
                  case (select type from closing)
                    when 'buyer-cancel' then 'buyer'
                    when 'walk-away' then 'seller'
                    when 'accept-cancel' then case (select by from closing) when 'buyer' then 'seller' when 'seller' then 'buyer' end
                  end
                when t.settling = 'buyer-cancel' then 'buyer'
                when t.settling = 'auto-refund' then 'buyer'
                when t.settling = 'mutual-cancel' then case (select by from accepted) when 'buyer' then 'seller' when 'seller' then 'buyer' end
              end as who
         from t
     ), mark as (
       insert into trade_totals_counted (trade_code, kind) select code, 'cancel' from side where who is not null
       on conflict do nothing returning trade_code
     )
     insert into account_traded_totals (account_id, cancels)
     select case side.who when 'buyer' then side.buyer_account_id else side.seller_account_id end, 1
       from side join mark on mark.trade_code = side.code
     on conflict (account_id) do update set cancels = account_traded_totals.cancels + 1`,
    [code],
  );
}

/** J-21: each account's one cancel figure (0 with no row), for the moderator's case view only. */
export async function cancelFigures(q: Queryable, accountIds: readonly string[]): Promise<Map<string, number>> {
  const { rows } = await q.query<{ id: string; cancels: number }>(
    `select a.id::text as id, coalesce(tt.cancels, 0)::int as cancels
       from unnest($1::uuid[]) as a (id) left join account_traded_totals tt on tt.account_id = a.id`,
    [[...new Set(accountIds)]],
  );
  return new Map(rows.map((r) => [r.id, r.cancels]));
}

/**
 * Review M1 (12 Nov): locks both parties' running-totals rows of trade `code`, creating an empty row
 * (all zeros, the same as no row to every reader) for a party that has none yet, in account-id
 * order. `withDispute` calls it right after the trade and dispute row locks and before anything
 * appends to the log, so `countTradeTotals` in a decided save never waits on these rows while
 * holding the site-wide log lock (log/append.ts N3) and cannot deadlock with a trade event of the
 * same party (which takes them before its own append).
 */
export async function lockPartyTotals(q: Queryable, code: string): Promise<void> {
  await q.query(
    `insert into account_traded_totals (account_id)
     select p.id from trades t cross join lateral (values (t.buyer_account_id), (t.seller_account_id)) as p (id)
      where t.code = $1 order by p.id
     on conflict (account_id) do nothing`,
    [code],
  );
  await q.query(
    `select 1 from account_traded_totals tt
      where tt.account_id in (select buyer_account_id from trades where code = $1 union select seller_account_id from trades where code = $1)
      order by tt.account_id for update`,
    [code],
  );
}

/**
 * Owner Q63 (6 Nov 2026), SQL (numeric): the account `account`'s own XMR traded to date in atomic
 * units (0 with no row). Imported volume is never folded in: it is in dollars, and shows per site.
 */
export const tradedXmrSql = (account: string): string =>
  `coalesce((select tt.own_xmr_atomic from account_traded_totals tt where tt.account_id = ${account}), 0)`;

/** The public XMR bucket in whole XMR, or null: opted out, or 10 XMR or less. Never the exact total. */
export function tradedOverXmr(show: boolean, atomic: string | bigint): number | null {
  return show ? tradedBucketXmr(BigInt(atomic)) : null;
}

/**
 * Owner Q64: one line per site with a verified figure. Owner p4-1 (7 Nov, replacing F17's XMR
 * conversion): shown in US dollars, "$X+ on <site>, verified", X the @x2f/reputation
 * `tradedBucketUsd` step of the site's verified figure (rounded DOWN, a plus needs MORE than the
 * step, so a site at $10,000 or less shows nothing). No live price: the lines never vanish when
 * the price pauses. The XMR line never includes them.
 */
export interface ImportedLine {
  site: string;
  overUsd: number;
}

export function importedLines(volumes: readonly VerifiedSiteVolume[] | undefined): ImportedLine[] {
  return (volumes ?? []).flatMap((v) => {
    const overUsd = tradedBucketUsd(v.usdCents);
    return overUsd === null ? [] : [{ site: v.site, overUsd }];
  });
}

/** The trader's own setting and their lines (shown to them whether or not they are public). */
export async function tradedTotalSetting(q: Queryable, accountId: string): Promise<{ show: boolean; tradedOverXmr: number | null; imported: ImportedLine[] }> {
  const { rows } = await q.query<{ show: boolean; xmr: string }>(
    `select a.show_traded_total as show, ${tradedXmrSql('a.id')}::text as xmr from accounts a where a.id = $1`,
    [accountId],
  );
  const r = rows[0]!;
  const sites = await verifiedPastRepBySite(q, [accountId]);
  return { show: r.show, tradedOverXmr: tradedBucketXmr(BigInt(r.xmr)), imported: importedLines(sites.get(accountId)) };
}

/**
 * `GET /v1/account/profile/traded-total` → `{ show, tradedOverXmr, imported }`: the trader's own
 * setting, XMR bucket and per-site imported lines (owner Q63, Q64). `PUT` the same path `{ show: boolean }` turns the public line on or off (off by default)
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
