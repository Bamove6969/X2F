import type { FastifyInstance } from 'fastify';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { requireStaff } from './guard.js';

/**
 * Plan 4 Task 9: the owner's earnings as X2F's own wallets saw them arrive, summed by UTC month.
 *
 * Since the owner's fee split (26 Nov 2026, PR #25) every completed trade pays its 1% as two
 * outputs: one to the fee wallet (wallet 1, `X2F_FEE_WALLET`, its spend key offline) and one to the
 * hot payroll wallet (wallet 2, `X2F_PAYROLL_WALLET`), whose excess over the owner's cap is swept to
 * the fee wallet (`feeSweep.ts`). So, per UTC month:
 * - the fee wallet's arrivals, read through its VIEW-ONLY key (`feeViewWallet.ts`): the server can
 *   see what arrived and can never spend it. A sweep from the payroll wallet (its tx hash is in
 *   `fee_sweeps`, outcome `sent`) is money already counted when it reached the payroll wallet, so
 *   it is shown apart (`sweptInAtomic`) and not counted again;
 * - the payroll wallet's arrivals, from the wallet-rpc the API already holds (`payrollWallet.ts`
 *   `incoming`);
 * - beside them, the books' figures for the same month (the revenue ledger, `revenue.ts`): the
 *   trades that paid the 1% and the booked total after network fees, so the owner can check one
 *   against the other.
 *
 * The USD estimate is at the price when the page is read (the plan's `currentPrice('USD')`), not at
 * each fee's trade-time rate as the ledger's is: US cents, rounded down; null with no price (lead
 * default on the parked branch, 20 Nov).
 *
 * Owner 26 Nov 2026 (Jess): "tallies by the day, tallies by the week, and tallies by the month".
 * `?period=day|week|month` gives the same sums for a bounded window (`TALLY_COUNT`: the last 31
 * days, 12 ISO weeks starting Monday, or 12 months, the current one included, every one listed
 * even when empty) in `EARNINGS_TIME_ZONE`. No site or owner setting holds a time zone (the only
 * zones stored are staff login hours, which are not a display preference) and the revenue ledger
 * books whole UTC days, so the tallies are UTC and say so. Without `period` the answer is the
 * monthly report as before, unchanged.
 *
 * Nothing here is stored: the wallets are read every EARNINGS_SYNC_MS into memory (`startEarnings`)
 * and only per-month sums leave this module. No tx hash, no address beyond its last four
 * characters, and never a key is in an answer or a log line.
 */

/** One incoming transfer to one of X2F's wallets: its tx, when its block was made, how much (atomic units). */
export interface IncomingTransfer {
  txHash: string;
  at: Date;
  atomic: bigint;
}

/** A wallet whose confirmed incoming transfers can be listed (read-only). */
export interface IncomeSource {
  incoming(): Promise<IncomingTransfer[]>;
}

const ATOMIC_PER_XMR = 1_000_000_000_000n;
const HEX64 = /^[0-9a-f]{64}$/;
/** How often the wallets are read (the plan: every 10 minutes). */
export const EARNINGS_SYNC_MS = 10 * 60_000;

/** A wallet's address, shown only by its last four characters (the board's "ending …9Fq2"). */
export function walletEndOf(address: string): string {
  if (typeof address !== 'string' || address.length < 4) throw new RangeError('address too short');
  return address.slice(-4);
}

/** The UTC month of `d`, `YYYY-MM`. */
export const utcMonth = (d: Date): string => d.toISOString().slice(0, 7);

/** Throws on a transfer that is not one (a source's answer is checked before it is kept). */
function checkTransfer(t: IncomingTransfer): void {
  if (t === null || typeof t !== 'object') throw new RangeError('not a transfer');
  if (typeof t.txHash !== 'string' || !HEX64.test(t.txHash)) throw new RangeError('transfer tx hash is malformed');
  if (!(t.at instanceof Date) || !Number.isFinite(t.at.getTime())) throw new RangeError('transfer time is not a date');
  if (typeof t.atomic !== 'bigint' || t.atomic <= 0n) throw new RangeError('transfer amount must be positive');
}

// ---------------------------------------------------------------------------------------------
// Reading the wallets

/** `syncing`: not read yet; `ready`: the last read worked; `stale`: the last read failed, the figures are from `syncedAt`; `unavailable`: no read has worked yet. */
export type WalletState = 'syncing' | 'ready' | 'stale' | 'unavailable';

export interface WalletRead {
  state: WalletState;
  /** When the last read that worked finished; null before one has. */
  syncedAt: Date | null;
  transfers: readonly IncomingTransfer[];
}

export interface EarningsSnapshot {
  /** Null: no view-only fee wallet is set up (`X2F_FEE_WALLET_VIEW_KEY` unset). */
  fee: WalletRead | null;
  /** Null: no payroll wallet is connected (`X2F_PAYROLL_WALLET_RPC_URL` unset). */
  payroll: WalletRead | null;
}

export interface EarningsWatch {
  snapshot(): EarningsSnapshot;
  /** Reads both wallets now (a read already running is waited for instead). */
  refresh(): Promise<void>;
  stop(): Promise<void>;
}

export type EarningsWallet = 'fee' | 'payroll';

/**
 * Reads each configured wallet now and every `everyMs` (one pass at a time), keeping the last good
 * list in memory. A failed read keeps the last good figures (`stale`) and calls `onError` with the
 * wallet's name only: the error itself is never handed on, so nothing a wallet library put in its
 * message reaches a log.
 */
export function startEarnings(a: {
  fee: IncomeSource | null;
  payroll: IncomeSource | null;
  clock: () => Date;
  everyMs?: number;
  onError?: (wallet: EarningsWallet) => void;
}): EarningsWatch {
  const reads: Record<EarningsWallet, WalletRead | null> = {
    fee: a.fee === null ? null : { state: 'syncing', syncedAt: null, transfers: [] },
    payroll: a.payroll === null ? null : { state: 'syncing', syncedAt: null, transfers: [] },
  };
  const readOne = async (name: EarningsWallet, src: IncomeSource | null): Promise<void> => {
    if (src === null) return;
    const before = reads[name]!;
    try {
      const list = await src.incoming();
      if (!Array.isArray(list)) throw new RangeError('not a list');
      for (const t of list) checkTransfer(t);
      reads[name] = { state: 'ready', syncedAt: a.clock(), transfers: list.map((t) => ({ txHash: t.txHash, at: new Date(t.at.getTime()), atomic: t.atomic })) };
    } catch {
      reads[name] = { ...before, state: before.syncedAt === null ? 'unavailable' : 'stale' };
      try {
        a.onError?.(name);
      } catch {
        // best effort
      }
    }
  };
  let running: Promise<void> | null = null;
  let stopped = false;
  const refresh = (): Promise<void> => {
    if (running === null) {
      running = Promise.all([readOne('fee', a.fee), readOne('payroll', a.payroll)])
        .then(() => undefined)
        .finally(() => (running = null));
    }
    return running;
  };
  const any = a.fee !== null || a.payroll !== null;
  const timer = any ? setInterval(() => void (stopped ? undefined : refresh()), a.everyMs ?? EARNINGS_SYNC_MS) : null;
  timer?.unref();
  if (any) void refresh();
  return {
    snapshot: () => ({ fee: reads.fee, payroll: reads.payroll }),
    refresh,
    async stop() {
      stopped = true;
      if (timer !== null) clearInterval(timer);
      await running;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The owner's figures

export interface EarningsMonth {
  /** `YYYY-MM` (UTC); `all-time` for the total. */
  month: string;
  /** What arrived in the fee wallet, sweeps from the payroll wallet left out (atomic units, decimal string). */
  feeWalletAtomic: string;
  /** What the payroll wallet's sweeps moved into the fee wallet (already counted in the payroll wallet). */
  sweptInAtomic: string;
  /** What arrived in the payroll wallet. */
  payrollWalletAtomic: string;
  /** feeWalletAtomic + payrollWalletAtomic: what X2F's wallets received from trades. */
  earnedAtomic: string;
  /** The earned amount in US cents at the current price, rounded down; null with no price. */
  usdEstimateCents: string | null;
  /** The books: released trades and settled disputes that paid the 1% (revenue ledger). */
  trades: number;
  /** The books: the 1%s and owed fees collected, less the network fees X2F's outputs paid. */
  bookedNetAtomic: string;
}

export interface EarningsWalletView {
  /** The last four characters of the wallet's address. */
  walletEnd: string;
  state: WalletState;
  syncedAt: string | null;
}

export interface EarningsReport {
  /** Null: the view-only fee wallet is not set up on this server. */
  feeWallet: EarningsWalletView | null;
  /** Null: the payroll wallet is not connected on this server. */
  payrollWallet: EarningsWalletView | null;
  /** The XMR price the estimates use (US cents); null with none. */
  usdCentsPerXmr: string | null;
  /** Every UTC month with anything in it, oldest first. */
  months: EarningsMonth[];
  allTime: EarningsMonth;
}

/** The books for one UTC month (revenue_ledger). */
export interface LedgerMonth {
  trades: number;
  netAtomic: bigint;
}

interface Sums {
  fee: bigint;
  swept: bigint;
  payroll: bigint;
  trades: number;
  booked: bigint;
}

/** The figures of an EarningsMonth or EarningsTally, without its label. */
type Figures = Omit<EarningsMonth, 'month'>;

const zero = (): Sums => ({ fee: 0n, swept: 0n, payroll: 0n, trades: 0, booked: 0n });

function sumAll(all: Iterable<Sums>): Sums {
  const total = zero();
  for (const s of all) {
    total.fee += s.fee;
    total.swept += s.swept;
    total.payroll += s.payroll;
    total.trades += s.trades;
    total.booked += s.booked;
  }
  return total;
}

function figures(s: Sums, usdCentsPerXmr: bigint | null): Figures {
  const earned = s.fee + s.payroll;
  return {
    feeWalletAtomic: s.fee.toString(),
    sweptInAtomic: s.swept.toString(),
    payrollWalletAtomic: s.payroll.toString(),
    earnedAtomic: earned.toString(),
    usdEstimateCents: usdCentsPerXmr === null ? null : ((earned * usdCentsPerXmr) / ATOMIC_PER_XMR).toString(),
    trades: s.trades,
    bookedNetAtomic: s.booked.toString(),
  };
}

/**
 * Sums the wallets' arrivals and the books by UTC month. Pure; throws on a malformed input. A fee
 * wallet arrival whose tx hash is one of `sweptTxHashes` is a sweep from the payroll wallet.
 */
export function summarizeEarnings(a: {
  fee: readonly IncomingTransfer[];
  payroll: readonly IncomingTransfer[];
  sweptTxHashes: ReadonlySet<string>;
  ledger: ReadonlyMap<string, LedgerMonth>;
  usdCentsPerXmr: bigint | null;
}): { months: EarningsMonth[]; allTime: EarningsMonth } {
  if (a.usdCentsPerXmr !== null && a.usdCentsPerXmr < 0n) throw new RangeError('price must not be negative');
  const by = new Map<string, Sums>();
  const at = (m: string): Sums => {
    let s = by.get(m);
    if (s === undefined) by.set(m, (s = zero()));
    return s;
  };
  for (const t of a.fee) {
    checkTransfer(t);
    const s = at(utcMonth(t.at));
    if (a.sweptTxHashes.has(t.txHash)) s.swept += t.atomic;
    else s.fee += t.atomic;
  }
  for (const t of a.payroll) {
    checkTransfer(t);
    at(utcMonth(t.at)).payroll += t.atomic;
  }
  for (const [m, l] of a.ledger) {
    if (!/^\d{4}-\d{2}$/.test(m)) throw new RangeError('ledger month is malformed');
    if (!Number.isSafeInteger(l.trades) || l.trades < 0) throw new RangeError('trade count must be a whole number');
    const s = at(m);
    s.trades += l.trades;
    s.booked += l.netAtomic;
  }
  const row = (month: string, s: Sums): EarningsMonth => ({ month, ...figures(s, a.usdCentsPerXmr) });
  const total = sumAll(by.values());
  const months = [...by.keys()].sort().map((m) => row(m, by.get(m)!));
  return { months, allTime: row('all-time', total) };
}

// ---------------------------------------------------------------------------------------------
// Tallies by the day, the week and the month (owner 26 Nov 2026)

export type EarningsPeriod = 'day' | 'week' | 'month';
export const EARNINGS_PERIODS: readonly EarningsPeriod[] = ['day', 'week', 'month'];
/** The zone the tallies are cut in: no site or owner setting stores one, and the ledger books UTC days. */
export const EARNINGS_TIME_ZONE = 'UTC';
/** How many tallies each period gives, the current one included. */
export const TALLY_COUNT: Readonly<Record<EarningsPeriod, number>> = { day: 31, week: 12, month: 12 };

export interface EarningsTally extends Figures {
  /** `YYYY-MM-DD` (day), ISO `YYYY-Www` (week, Monday to Sunday) or `YYYY-MM` (month). */
  period: string;
  /** The first and last day it covers, `YYYY-MM-DD`, both included. */
  from: string;
  to: string;
}

export interface EarningsTallies {
  feeWallet: EarningsWalletView | null;
  payrollWallet: EarningsWalletView | null;
  usdCentsPerXmr: string | null;
  /** The zone the days, weeks and months are cut in (`UTC`). */
  timeZone: string;
  period: EarningsPeriod;
  /** Every tally of the window, oldest first, empty ones too. */
  tallies: EarningsTally[];
  /** The whole window: `period` is `last-31-days`, `last-12-weeks` or `last-12-months`. */
  total: EarningsTally;
  allTime: EarningsMonth;
}

const DAY_MS = 86_400_000;
const dayOf = (d: Date): string => d.toISOString().slice(0, 10);
const dayMs = (day: string): number => Date.parse(`${day}T00:00:00Z`);
const addDays = (day: string, n: number): string => dayOf(new Date(dayMs(day) + n * DAY_MS));

/** The first day of the day, ISO week (Monday) or month that `day` (`YYYY-MM-DD`, UTC) falls in. */
export function tallyStart(period: EarningsPeriod, day: string): string {
  if (period === 'day') return day;
  if (period === 'month') return `${day.slice(0, 7)}-01`;
  const weekday = (new Date(dayMs(day)).getUTCDay() + 6) % 7; // Monday 0 … Sunday 6
  return addDays(day, -weekday);
}

/** The ISO week of the Monday `monday`, `YYYY-Www` (its year is the year of its Thursday). */
export function isoWeek(monday: string): string {
  const thursday = new Date(dayMs(addDays(monday, 3)));
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / (7 * DAY_MS)) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function nextStart(period: EarningsPeriod, start: string): string {
  if (period === 'day') return addDays(start, 1);
  if (period === 'week') return addDays(start, 7);
  const y = Number(start.slice(0, 4));
  const m = Number(start.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

function prevStart(period: EarningsPeriod, start: string): string {
  if (period !== 'month') return addDays(start, period === 'day' ? -1 : -7);
  return tallyStart('month', addDays(start, -1));
}

/** The first days of the window's tallies, oldest first: `TALLY_COUNT[period]` of them, ending with the one `now` is in. */
export function tallyStarts(period: EarningsPeriod, now: Date): string[] {
  const starts = [tallyStart(period, dayOf(now))];
  while (starts.length < TALLY_COUNT[period]) starts.unshift(prevStart(period, starts[0]!));
  return starts;
}

const tallyLabel = (period: EarningsPeriod, start: string): string => (period === 'day' ? start : period === 'week' ? isoWeek(start) : start.slice(0, 7));

/**
 * Sums the wallets' arrivals and the books (by UTC day) into the window's tallies. Pure; throws on
 * a malformed input. Anything outside the window counts only in `allTime` (summarizeEarnings).
 */
export function summarizeTallies(a: {
  period: EarningsPeriod;
  now: Date;
  fee: readonly IncomingTransfer[];
  payroll: readonly IncomingTransfer[];
  sweptTxHashes: ReadonlySet<string>;
  /** The books by UTC day, `YYYY-MM-DD`. */
  ledgerByDay: ReadonlyMap<string, LedgerMonth>;
  usdCentsPerXmr: bigint | null;
}): { tallies: EarningsTally[]; total: EarningsTally } {
  if (!EARNINGS_PERIODS.includes(a.period)) throw new RangeError('unknown period');
  if (!(a.now instanceof Date) || !Number.isFinite(a.now.getTime())) throw new RangeError('now is not a date');
  if (a.usdCentsPerXmr !== null && a.usdCentsPerXmr < 0n) throw new RangeError('price must not be negative');
  const starts = tallyStarts(a.period, a.now);
  const by = new Map<string, Sums>(starts.map((s) => [s, zero()]));
  const at = (day: string): Sums | undefined => by.get(tallyStart(a.period, day));
  for (const t of a.fee) {
    checkTransfer(t);
    const s = at(dayOf(t.at));
    if (s === undefined) continue;
    if (a.sweptTxHashes.has(t.txHash)) s.swept += t.atomic;
    else s.fee += t.atomic;
  }
  for (const t of a.payroll) {
    checkTransfer(t);
    const s = at(dayOf(t.at));
    if (s !== undefined) s.payroll += t.atomic;
  }
  for (const [day, l] of a.ledgerByDay) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(dayMs(day))) throw new RangeError('ledger day is malformed');
    if (!Number.isSafeInteger(l.trades) || l.trades < 0) throw new RangeError('trade count must be a whole number');
    const s = at(day);
    if (s === undefined) continue;
    s.trades += l.trades;
    s.booked += l.netAtomic;
  }
  const tallies = starts.map((start) => ({
    period: tallyLabel(a.period, start),
    from: start,
    to: addDays(nextStart(a.period, start), -1),
    ...figures(by.get(start)!, a.usdCentsPerXmr),
  }));
  const total: EarningsTally = {
    period: `last-${TALLY_COUNT[a.period]}-${a.period}s`,
    from: tallies[0]!.from,
    to: tallies[tallies.length - 1]!.to,
    ...figures(sumAll(by.values()), a.usdCentsPerXmr),
  };
  return { tallies, total };
}

/** The books by UTC day from `from` (`YYYY-MM-DD`) on: trades that paid the 1%, and the booked total after network fees. */
async function ledgerByDay(q: Queryable, from: string): Promise<Map<string, LedgerMonth>> {
  const { rows } = await q.query<{ d: string; trades: string; net: string }>(
    `select to_char(day, 'YYYY-MM-DD') as d,
            coalesce(sum(trades) filter (where kind = 'fee'), 0)::text as trades,
            (coalesce(sum(fee_atomic), 0) - coalesce(sum(network_fee_atomic), 0))::text as net
       from revenue_ledger where day >= $1::date group by 1`,
    [from],
  );
  return new Map(rows.map((r) => [r.d, { trades: Number(r.trades), netAtomic: BigInt(r.net) }]));
}

/** The books by UTC month: trades that paid the 1%, and the booked total after network fees. */
async function ledgerByMonth(q: Queryable): Promise<Map<string, LedgerMonth>> {
  const { rows } = await q.query<{ m: string; trades: string; net: string }>(
    `select to_char(day, 'YYYY-MM') as m,
            coalesce(sum(trades) filter (where kind = 'fee'), 0)::text as trades,
            (coalesce(sum(fee_atomic), 0) - coalesce(sum(network_fee_atomic), 0))::text as net
       from revenue_ledger group by 1`,
  );
  return new Map(rows.map((r) => [r.m, { trades: Number(r.trades), netAtomic: BigInt(r.net) }]));
}

/** The payroll wallet's sweeps that went out (their tx hashes), so the fee wallet does not count them twice. */
async function sentSweeps(q: Queryable): Promise<Set<string>> {
  const { rows } = await q.query<{ tx_hash: string }>(`select tx_hash from fee_sweeps where outcome = 'sent' and tx_hash is not null`);
  return new Set(rows.map((r) => r.tx_hash));
}

const view = (r: WalletRead | null, address: string | null | undefined): EarningsWalletView | null =>
  r === null || address == null ? null : { walletEnd: walletEndOf(address), state: r.state, syncedAt: r.syncedAt === null ? null : r.syncedAt.toISOString() };

/** The owner's earnings report from a snapshot of the wallets and the database. */
export async function earningsReport(
  q: Queryable,
  a: { snapshot: EarningsSnapshot; feeWallet: string | null | undefined; payrollWallet: string | null | undefined; usdCentsPerXmr: bigint | null },
): Promise<EarningsReport> {
  const { months, allTime } = summarizeEarnings({
    fee: a.snapshot.fee?.transfers ?? [],
    payroll: a.snapshot.payroll?.transfers ?? [],
    sweptTxHashes: await sentSweeps(q),
    ledger: await ledgerByMonth(q),
    usdCentsPerXmr: a.usdCentsPerXmr,
  });
  return {
    feeWallet: view(a.snapshot.fee, a.feeWallet),
    payrollWallet: view(a.snapshot.payroll, a.payrollWallet),
    usdCentsPerXmr: a.usdCentsPerXmr === null ? null : a.usdCentsPerXmr.toString(),
    months,
    allTime,
  };
}

/** The owner's tallies for one period's window, beside the monthly report's all-time row. */
export async function earningsTallies(
  q: Queryable,
  a: { period: EarningsPeriod; now: Date; snapshot: EarningsSnapshot; feeWallet: string | null | undefined; payrollWallet: string | null | undefined; usdCentsPerXmr: bigint | null },
): Promise<EarningsTallies> {
  const report = await earningsReport(q, a);
  const fee = a.snapshot.fee?.transfers ?? [];
  const payroll = a.snapshot.payroll?.transfers ?? [];
  const { tallies, total } = summarizeTallies({
    period: a.period,
    now: a.now,
    fee,
    payroll,
    sweptTxHashes: await sentSweeps(q),
    ledgerByDay: await ledgerByDay(q, tallyStarts(a.period, a.now)[0]!),
    usdCentsPerXmr: a.usdCentsPerXmr,
  });
  return {
    feeWallet: report.feeWallet,
    payrollWallet: report.payrollWallet,
    usdCentsPerXmr: report.usdCentsPerXmr,
    timeZone: EARNINGS_TIME_ZONE,
    period: a.period,
    tallies,
    total,
    allTime: report.allTime,
  };
}

const NO_WALLETS: EarningsSnapshot = { fee: null, payroll: null };

/**
 * `GET /staff/v1/earnings` (perm `earnings.read`, the owner's alone) → `EarningsReport`, every UTC
 * month. `?period=day|week|month` → `EarningsTallies`, the window `TALLY_COUNT` names. Any other
 * query, or another period, is 400 `bad-request`. Without the earnings watch (no wallet on this
 * server) both wallets are null and the figures carry the books alone. Read-only: the fee wallet
 * is seen through its view-only key, nothing here needs a spend key.
 */
export function staffEarningsRoutes(app: FastifyInstance): void {
  const perm = 'earnings.read' as const;
  app.get('/staff/v1/earnings', { config: { perm }, preHandler: requireStaff(perm) }, async (req) => {
    const query = (req.query ?? {}) as Record<string, unknown>;
    for (const k of Object.keys(query)) if (k !== 'period') throw new ApiError(400, 'bad-request', { field: k });
    const period = query.period;
    if (period !== undefined && !EARNINGS_PERIODS.includes(period as EarningsPeriod)) throw new ApiError(400, 'bad-request', { field: 'period' });
    const { db, config, prices, earnings, clock } = req.server.deps;
    const quote = prices.quote('USD');
    const a = {
      snapshot: earnings?.snapshot() ?? NO_WALLETS,
      feeWallet: config.feeWallet,
      payrollWallet: config.payrollWallet,
      usdCentsPerXmr: quote === null || quote.usdCentsPerXmr <= 0n ? null : quote.usdCentsPerXmr,
    };
    if (period === undefined) return earningsReport(db, a);
    return earningsTallies(db, { ...a, period: period as EarningsPeriod, now: clock() });
  });
}
