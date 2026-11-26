import { MAX_NETWORK_FEE } from '@x2f/core';
import { feeWalletNetworkFee, type RulingKind, type SettleKind } from '@x2f/trade';
import type { FastifyInstance } from 'fastify';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { requireStaff } from './guard.js';

/**
 * Plan 4 Task 32 (B-004): the internal revenue ledger (migration 430), for the owner's revenue,
 * payroll and treasury figures.
 *
 * The owner's rules (HANDOFF "Decided 2026-10-29c", owner answers 2026-10-28 13:26-13:45):
 * - the poster pays the 1% on a released trade and on a ruling that completes the trade; a cancel
 *   of any kind (buyer cancel, walk-away, mutual cancel, no-show or lapse refund) pays nothing, and
 *   so does a ruling's full reversal, everything back to the original parties (owner g63, 7 Nov);
 * - a fee owed with no money in the escrow to take it from (a lien, @x2f/staff `rulingFee`) is
 *   taken from the poster's future trades; it is booked here as `owed` on the day it is collected
 *   (`bookOwedFeeCollected`), never when it is owed.
 *
 * The ledger books exactly what the settlement's payout set sends to the fee wallet
 * (`feeOutputAtomic`, the same rule as @x2f/trade's `payoutsFor`), so it can be checked against the
 * fee wallet (Task 9) and never counts a fee that was not paid.
 *
 * Owner 16 Nov 2026 (migration 830): the payout's network fee is shared by its receiving outputs,
 * one equal share per output, so X2F's fee output arrives short by its share. `fee_atomic` stays
 * the gross 1% (what the payout set names); `network_fee_atomic` is what the fee outputs paid of the
 * network fee (`bookSettlementNetworkFee`, from the settled tx's fee), so net = gross − network fees.
 * X2F's own treasury sends (the fee sweep, payroll payouts) are not wired yet (Plan 6) and record
 * no network fee, so they are not in these figures (`treasuryNetworkFeesRecorded: false`).
 *
 * Retention (R6, the 30-day and 90-day purges): `revenue_ledger` holds day, market, counts and
 * amounts only. The per-trade marker `revenue_booked` (code and amount, no account) is what makes
 * booking idempotent; it is deleted with its trade, so after the purge only the amounts remain.
 */

/** A settlement's kind as the trade row names it (`trades.settling`), or a ruling's payout set. */
export type FeeOutputKind = SettleKind | RulingKind;

/**
 * What the fee wallet receives when a trade settles by `kind` (atomic units), the fee output of
 * `payoutsFor`:
 * - `release` and `dispute-buyer` (the ruling releases to the buyer, the trade completes): the
 *   trade's fee;
 * - `dispute-seller` (a full reversal, owner g63): nothing, whoever posted; the whole balance goes
 *   back to the seller;
 * - every cancel and refund (`mutual-cancel`, `buyer-cancel`, `auto-refund`, `lapse-refund`): nothing.
 * An unknown kind pays nothing here (the trade store must never fail a settlement over the ledger).
 */
export function feeOutputAtomic(kind: FeeOutputKind | string | null, _poster: 'seller' | 'buyer', feeAtomic: bigint): bigint {
  switch (kind) {
    case 'release':
    case 'dispute-buyer':
      return feeAtomic;
    default:
      return 0n;
  }
}

/** A fee's USD estimate in cents, rounded down: the fee at its trade's take-time dollar value. */
export function usdEstimateCents(feeAtomic: bigint, tradeUsdCents: bigint | null, takeAmountAtomic: bigint): bigint {
  if (tradeUsdCents === null || takeAmountAtomic <= 0n) return 0n;
  return (feeAtomic * tradeUsdCents) / takeAmountAtomic;
}

interface TradeFacts {
  code: string;
  state: string;
  settling: string | null;
  poster: 'seller' | 'buyer';
  fee_atomic: string;
  amount_atomic: string;
  grown_from_atomic: string | null;
  usd_cents: string | null;
  locked_currency: string;
  closed_at: Date | null;
}

async function loadFacts(q: Queryable, code: string): Promise<TradeFacts | undefined> {
  const { rows } = await q.query<TradeFacts>(
    `select code, state, settling, poster, fee_atomic::text, amount_atomic::text, grown_from_atomic::text, usd_cents::text,
            locked_currency, closed_at from trades where code = $1`,
    [code],
  );
  return rows[0];
}

/**
 * Adds one booking to the day's row and marks the trade, once per trade, kind and debt (`debtId`, ''
 * for a trade's own fee). The row's `trades` counts each trade once per kind: a second debt the
 * same trade collects adds its amount, not another trade (the `exists` reads the markers as they
 * were before this statement). Returns whether it booked.
 */
async function book(q: Queryable, a: { code: string; kind: 'fee' | 'owed'; debtId: string; feeAtomic: bigint; usdCents: bigint; currency: string; at: Date }): Promise<boolean> {
  if (a.feeAtomic <= 0n) return false;
  const { rows } = await q.query<{ booked: boolean }>(
    `with mark as (
       insert into revenue_booked (trade_code, kind, debt_id, fee_atomic, booked_at) values ($1, $2, $7, $3, $6)
       on conflict do nothing returning trade_code
     ), add as (
       insert into revenue_ledger (day, currency, kind, trades, fee_atomic, usd_estimate_cents)
       select ($6::timestamptz at time zone 'UTC')::date, $5, $2,
              case when exists (select 1 from revenue_booked where trade_code = $1 and kind = $2) then 0 else 1 end, $3, $4
         from mark
       on conflict (day, currency, kind) do update set
         trades = revenue_ledger.trades + excluded.trades,
         fee_atomic = revenue_ledger.fee_atomic + excluded.fee_atomic,
         usd_estimate_cents = revenue_ledger.usd_estimate_cents + excluded.usd_estimate_cents
       returning 1
     )
     select exists (select 1 from add) as booked`,
    [a.code, a.kind, a.feeAtomic.toString(), a.usdCents.toString(), a.currency, a.at, a.debtId],
  );
  return rows[0]?.booked === true;
}

/**
 * Books a settled trade's 1%, in the transaction that stores its settlement (trades/store.ts
 * `applyEvent`, beside `countTradeTotals`): a `released` trade only; a `refunded` one (a refund,
 * or a ruling's full reversal, `dispute-seller`) books nothing whatever `kind` says (owner g63).
 * `kind` is the payout set the
 * settlement used; it defaults to the row's `settling` (`release` for a release). Plan 4 Task 14's
 * ruling execution passes its `RulingKind` when the row does not name it. Idempotent per trade: a
 * second call, or a replayed event, books nothing. A trade still open, a cancel of any kind, or a
 * settlement that paid no fee books nothing. The day is the UTC day the trade closed.
 */
export async function bookTradeRevenue(q: Queryable, code: string, kind?: FeeOutputKind): Promise<boolean> {
  const t = await loadFacts(q, code);
  // Only a completed trade pays the 1% (owner g63): a refunded trade, a ruling's full reversal
  // included, books nothing whatever kind the caller names.
  if (!t || t.closed_at === null || t.state !== 'released') return false;
  const fee = feeOutputAtomic(kind ?? t.settling, t.poster, BigInt(t.fee_atomic));
  const take = BigInt(t.grown_from_atomic ?? t.amount_atomic);
  return book(q, {
    code, kind: 'fee', debtId: '', feeAtomic: fee, currency: t.locked_currency, at: t.closed_at,
    usdCents: usdEstimateCents(fee, t.usd_cents === null ? null : BigInt(t.usd_cents), take),
  });
}

/**
 * SEAM for Plan 4 Task 12's `fees_owed` (J-06): books an owed fee as revenue when it is collected,
 * on the collecting trade (`code`, whose fee output carried `collectedAtomic` on top of its own
 * fee), on the day `at` it was collected, under that trade's market. Call it once per collected
 * debt (`debtId`, the `fees_owed` row's id), in the release transaction that raises
 * `fees_owed.collected_atomic`: the collecting trade must already be `released` (it throws
 * otherwise, so a take-time or cancelled trade never books revenue that was not paid). Idempotent
 * per collecting trade and debt (review F5); zero books nothing. The outstanding total stays in
 * `fees_owed` and is listed apart (`revenueReport`).
 */
export async function bookOwedFeeCollected(q: Queryable, a: { code: string; debtId: string; collectedAtomic: bigint; at: Date }): Promise<boolean> {
  if (a.collectedAtomic < 0n) throw new RangeError('collected amount must not be negative');
  if (typeof a.debtId !== 'string' || a.debtId === '' || a.debtId.length > 64) throw new RangeError('debtId must name the collected debt');
  const t = await loadFacts(q, a.code);
  if (!t) throw new RangeError('unknown trade');
  if (t.state !== 'released') throw new Error('the collecting trade is not released');
  const take = BigInt(t.grown_from_atomic ?? t.amount_atomic);
  return book(q, {
    code: a.code, kind: 'owed', debtId: a.debtId, feeAtomic: a.collectedAtomic, currency: t.locked_currency, at: a.at,
    usdCents: usdEstimateCents(a.collectedAtomic, t.usd_cents === null ? null : BigInt(t.usd_cents), take),
  });
}

/**
 * Owner 16 Nov 2026: books the network fee X2F's fee output paid on a settled trade, from the
 * settlement tx's whole network fee `txFeeAtomic` (the moderation watcher's `settled` report, read
 * from its wallet's record of the tx): the fee output's equal share (@x2f/trade
 * `feeWalletNetworkFee`, wallet2's split). Only on a trade whose own 1% is booked (released, a fee
 * output paid); once per trade (a replayed report, or another fee, books nothing); added to that
 * booking's ledger row (the trade's close day and market). Returns whether it booked.
 *
 * Review M2 (16 Nov): the fee is capped at MAX_NETWORK_FEE (0.01 XMR) before the share is taken.
 * No co-signer accepts more, and a sweep the watcher counts lets the fee output be short by at most
 * its share of the capped fee (proveSweep), so a higher report (a modified app, two old app
 * versions) can never book more than X2F's output could have lost. The route logs such a report.
 */
export async function bookSettlementNetworkFee(q: Queryable, code: string, txFeeAtomic: bigint): Promise<boolean> {
  if (typeof txFeeAtomic !== 'bigint' || txFeeAtomic < 0n) throw new RangeError('network fee must not be negative');
  const t = await loadFacts(q, code);
  if (!t || t.closed_at === null || t.state !== 'released') return false;
  const kind = (t.settling ?? 'release') as FeeOutputKind;
  if (feeOutputAtomic(kind, t.poster, BigInt(t.fee_atomic)) <= 0n) return false;
  const share = feeWalletNetworkFee(kind, txFeeAtomic > MAX_NETWORK_FEE ? MAX_NETWORK_FEE : txFeeAtomic);
  if (share <= 0n) return false;
  const { rows } = await q.query<{ booked: boolean }>(
    `with mark as (
       update revenue_booked set network_fee_atomic = $2
        where trade_code = $1 and kind = 'fee' and debt_id = '' and network_fee_atomic is null
       returning booked_at
     ), add as (
       insert into revenue_ledger (day, currency, kind, network_fee_atomic)
       select (booked_at at time zone 'UTC')::date, $3, 'fee', $2 from mark
       on conflict (day, currency, kind) do update set
         network_fee_atomic = revenue_ledger.network_fee_atomic + excluded.network_fee_atomic
       returning 1
     )
     select exists (select 1 from add) as booked`,
    [code, share.toString(), t.locked_currency],
  );
  return rows[0]?.booked === true;
}

// ---------------------------------------------------------------------------------------------
// The owner's totals

export type RevenuePeriod = 'day' | 'month';

export interface RevenueBucket {
  /** `YYYY-MM-DD` by day, `YYYY-MM` by month (UTC). */
  period: string;
  /** Released trades and settled disputes that paid the 1%. */
  trades: number;
  /** Their 1%, atomic units (decimal string). */
  feeAtomic: string;
  /** Owed fees collected in the period, and how many collecting trades. */
  owedCollectedAtomic: string;
  owedCollections: number;
  /** feeAtomic + owedCollectedAtomic. */
  totalAtomic: string;
  /** The USD estimate of the total, cents (each fee at its trade's take-time value). */
  usdEstimateCents: string;
  /** Monero network fees X2F's fee outputs paid (owner 16 Nov: its share of each payout's fee). */
  networkFeeAtomic: string;
  /** totalAtomic − networkFeeAtomic: the total after every recorded Monero network fee. */
  netAtomic: string;
}

export interface RevenueReport {
  by: RevenuePeriod;
  from: string;
  to: string;
  /** Periods with any revenue, oldest first (a period with none is left out). */
  buckets: RevenueBucket[];
  /** The whole range, as one bucket (its `period` is `from..to`). */
  total: RevenueBucket;
  /** The range per fiat market (`period` is the currency code), largest total first. */
  byCurrency: RevenueBucket[];
  /** Every day ever booked, whatever the range (`period` is `to-date`): the owner's totals to date. */
  toDate: RevenueBucket;
  /**
   * Whether X2F's own treasury sends (the fee sweep to cold storage, payroll payouts) record their
   * network fee in these figures. False: they are not wired yet (Plan 6) and record none.
   */
  treasuryNetworkFeesRecorded: boolean;
  /**
   * Owed fees not yet collected, atomic units, whatever the range: the sum of `amount_atomic -
   * collected_atomic` over the unsettled `fees_owed` rows (migration 400, J-06).
   */
  owedOutstandingAtomic: string;
}

interface SumRow {
  key: string;
  fee_trades: string;
  fee_atomic: string;
  owed_n: string;
  owed_atomic: string;
  usd: string;
  net_fee: string;
}

const bucketOf = (r: SumRow): RevenueBucket => ({
  period: r.key,
  trades: Number(r.fee_trades),
  feeAtomic: r.fee_atomic,
  owedCollectedAtomic: r.owed_atomic,
  owedCollections: Number(r.owed_n),
  totalAtomic: (BigInt(r.fee_atomic) + BigInt(r.owed_atomic)).toString(),
  usdEstimateCents: r.usd,
  networkFeeAtomic: r.net_fee,
  netAtomic: (BigInt(r.fee_atomic) + BigInt(r.owed_atomic) - BigInt(r.net_fee)).toString(),
});

const SUMS = `coalesce(sum(trades) filter (where kind = 'fee'), 0)::text as fee_trades,
              coalesce(sum(fee_atomic) filter (where kind = 'fee'), 0)::text as fee_atomic,
              coalesce(sum(trades) filter (where kind = 'owed'), 0)::text as owed_n,
              coalesce(sum(fee_atomic) filter (where kind = 'owed'), 0)::text as owed_atomic,
              coalesce(sum(usd_estimate_cents), 0)::text as usd,
              coalesce(sum(network_fee_atomic), 0)::text as net_fee`;

/** The ledger between two UTC days inclusive (`YYYY-MM-DD`), by day or by month. */
export async function revenueReport(q: Queryable, r: { from: string; to: string; by: RevenuePeriod }): Promise<RevenueReport> {
  const key = r.by === 'day' ? `to_char(day, 'YYYY-MM-DD')` : `to_char(day, 'YYYY-MM')`;
  const range = 'day between $1::date and $2::date';
  const args = [r.from, r.to];
  const buckets = (await q.query<SumRow>(`select ${key} as key, ${SUMS} from revenue_ledger where ${range} group by 1 order by 1`, args)).rows.map(bucketOf);
  const total = bucketOf({ ...(await q.query<SumRow>(`select ${SUMS} from revenue_ledger where ${range}`, args)).rows[0]!, key: `${r.from}..${r.to}` });
  const byCurrency = (await q.query<SumRow>(`select currency as key, ${SUMS} from revenue_ledger where ${range} group by 1 order by 1`, args)).rows
    .map(bucketOf)
    .sort((a, b) => {
      const d = BigInt(b.totalAtomic) - BigInt(a.totalAtomic);
      return d > 0n ? 1 : d < 0n ? -1 : a.period.localeCompare(b.period);
    });
  const toDate = bucketOf({ ...(await q.query<SumRow>(`select ${SUMS} from revenue_ledger`)).rows[0]!, key: 'to-date' });
  const outstanding = (
    await q.query<{ n: string }>('select coalesce(sum(amount_atomic - collected_atomic), 0)::text as n from fees_owed where settled_at is null')
  ).rows[0]!.n;
  return { by: r.by, from: r.from, to: r.to, buckets, total, byCurrency, toDate, treasuryNetworkFeesRecorded: false, owedOutstandingAtomic: outstanding };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
/** The longest range per request: about a year by day, ten years by month. */
const MAX_DAYS: Readonly<Record<RevenuePeriod, number>> = { day: 366, month: 3660 };

function parseDay(v: unknown, field: string): number {
  if (typeof v !== 'string' || !DAY.test(v)) throw new ApiError(400, 'bad-request', { field });
  const t = Date.parse(`${v}T00:00:00Z`);
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== v) throw new ApiError(400, 'bad-request', { field });
  return t;
}

const isoDay = (t: number): string => new Date(t).toISOString().slice(0, 10);

/**
 * `GET /staff/v1/revenue?by=day|month&from=YYYY-MM-DD&to=YYYY-MM-DD` (UTC days, inclusive). `by`
 * defaults to `month`; `to` to today; `from` to 30 days before `to` by day, or the first of the
 * month eleven months before `to` by month. A range over 366 days by day or 3,660 by month, `from`
 * after `to`, or a malformed value is 400 `bad-request`.
 */
export function parseRevenueQuery(query: unknown, now: Date): { from: string; to: string; by: RevenuePeriod } {
  const q = (query ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(q)) if (!['by', 'from', 'to'].includes(k)) throw new ApiError(400, 'bad-request', { field: k });
  const by = q.by ?? 'month';
  if (by !== 'day' && by !== 'month') throw new ApiError(400, 'bad-request', { field: 'by' });
  const to = q.to === undefined ? Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`) : parseDay(q.to, 'to');
  let from: number;
  if (q.from !== undefined) {
    from = parseDay(q.from, 'from');
  } else if (by === 'day') {
    from = to - 30 * DAY_MS;
  } else {
    const d = new Date(to);
    from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 11, 1);
  }
  if (from > to || (to - from) / DAY_MS + 1 > MAX_DAYS[by]) throw new ApiError(400, 'bad-request', { field: 'from' });
  return { from: isoDay(from), to: isoDay(to), by };
}

/**
 * The owner's revenue totals on the staff API: `GET /staff/v1/revenue` (perm `earnings.read`, the
 * owner's alone: no role but the owner holds it and it cannot be granted) → `RevenueReport`.
 * NEEDS_DESIGN_REVENUE: the staff web page that shows it (StaffOverview's revenue card, growth and
 * the payroll and treasury views) is Claude Design's to draw; until then apps/staff-web's minimal
 * Revenue page (screens/Revenue.tsx, under the owner's Overview) shows the to-date and monthly totals.
 */
export function staffRevenueRoutes(app: FastifyInstance): void {
  const perm = 'earnings.read' as const;
  app.get('/staff/v1/revenue', { config: { perm }, preHandler: requireStaff(perm) }, async (req) => {
    const { db, clock } = req.server.deps;
    return revenueReport(db, parseRevenueQuery(req.query, clock()));
  });
}
