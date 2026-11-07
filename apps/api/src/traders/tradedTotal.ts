import { tradedBucketXmr } from '@x2f/reputation';
import type { Deps } from '../app.js';
import type { FastifyInstance } from 'fastify';
import { requireSession } from '../auth/sessions.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { verifiedPastRepBySite, type VerifiedSiteVolume } from '../pastrep/store.js';

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
 * The dollar total (`own_usd_cents`) is for moderators only, never public (owner Q63, 6 Nov). The
 * public line is in XMR: `tradedBucketXmr(own_xmr_atomic)` (migration 312), the account's own trades
 * only. Imported volume never joins it: it shows as separate per-site lines (owner Q64 + F17), from
 * the dollar figure a moderator verified on an APPROVED past-reputation claim (migration 310,
 * `pastrep/store.ts`) converted at the current XMR/USD price. An unverified (null), not-yet-approved
 * (`signed`) or dead (rejected, removed, revoked) claim adds no line, and is read live, so a revoked
 * claim stops showing at once.
 */
export async function countTradeTotals(q: Queryable, code: string): Promise<void> {
  // Completed: add the value to both sides, once.
  await q.query(
    `with t as (
       select code, buyer_account_id, seller_account_id, usd_cents, amount_atomic from trades
        where code = $1 and (state = 'released' or (state = 'refunded' and dispute_by is not null))
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
 * Owner Q64: one line per site with a verified figure. Owner F17 (7 Nov): shown converted to XMR at
 * the current XMR/USD price, rounded down like the XMR line (a site at 10 XMR or less shows
 * nothing). With no USD price right now, no imported line shows (nothing to convert with).
 */
export interface ImportedLine {
  site: string;
  overXmr: number;
}

const PICO = 1_000_000_000_000n;

export function importedLines(volumes: readonly VerifiedSiteVolume[] | undefined, usdCentsPerXmr: bigint | null): ImportedLine[] {
  if (usdCentsPerXmr === null || usdCentsPerXmr <= 0n) return [];
  return (volumes ?? []).flatMap((v) => {
    const overXmr = tradedBucketXmr((v.usdCents * PICO) / usdCentsPerXmr);
    return overXmr === null ? [] : [{ site: v.site, overXmr }];
  });
}

/** The trader's own setting and their lines (shown to them whether or not they are public). */
export async function tradedTotalSetting(
  q: Queryable,
  accountId: string,
  usdCentsPerXmr: bigint | null,
): Promise<{ show: boolean; tradedOverXmr: number | null; imported: ImportedLine[] }> {
  const { rows } = await q.query<{ show: boolean; xmr: string }>(
    `select a.show_traded_total as show, ${tradedXmrSql('a.id')}::text as xmr from accounts a where a.id = $1`,
    [accountId],
  );
  const r = rows[0]!;
  const sites = await verifiedPastRepBySite(q, [accountId]);
  return { show: r.show, tradedOverXmr: tradedBucketXmr(BigInt(r.xmr)), imported: importedLines(sites.get(accountId), usdCentsPerXmr) };
}

/**
 * `GET /v1/account/profile/traded-total` → `{ show, tradedOverXmr, imported }`: the trader's own
 * setting, XMR bucket and per-site imported lines (owner Q63, Q64). `PUT` the same path `{ show: boolean }` turns the public line on or off (off by default)
 * and answers the same shape. Trader sessions only (the account's own trader, not staff).
 */
export function tradedTotalRoutes(app: FastifyInstance): void {
  const trader = requireSession({ kinds: ['trader'] });
  const PATH = '/v1/account/profile/traded-total';
  app.get(PATH, { preHandler: trader }, async (req) => tradedTotalSetting(req.server.deps.db, req.auth.accountId, usdRate(req.server.deps)));
  app.put(PATH, { preHandler: trader }, async (req) => {
    const body = req.body as { show?: unknown } | null;
    if (body === null || typeof body !== 'object' || Array.isArray(body) || typeof body.show !== 'boolean') throw new ApiError(400, 'bad-request');
    await req.server.deps.db.query('update accounts set show_traded_total = $2 where id = $1', [req.auth.accountId, body.show]);
    return tradedTotalSetting(req.server.deps.db, req.auth.accountId, usdRate(req.server.deps));
  });
}

/** The current XMR price in US cents, or null when the USD market price is paused (owner F17). */
export function usdRate(deps: Pick<Deps, 'prices'>): bigint | null {
  return deps.prices.quote('USD')?.price.centsPerXmr ?? null;
}
