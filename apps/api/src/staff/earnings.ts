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
    if (s === undefined) by.set(m, (s = { fee: 0n, swept: 0n, payroll: 0n, trades: 0, booked: 0n }));
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
  const row = (month: string, s: Sums): EarningsMonth => {
    const earned = s.fee + s.payroll;
    return {
      month,
      feeWalletAtomic: s.fee.toString(),
      sweptInAtomic: s.swept.toString(),
      payrollWalletAtomic: s.payroll.toString(),
      earnedAtomic: earned.toString(),
      usdEstimateCents: a.usdCentsPerXmr === null ? null : ((earned * a.usdCentsPerXmr) / ATOMIC_PER_XMR).toString(),
      trades: s.trades,
      bookedNetAtomic: s.booked.toString(),
    };
  };
  const total: Sums = { fee: 0n, swept: 0n, payroll: 0n, trades: 0, booked: 0n };
  for (const s of by.values()) {
    total.fee += s.fee;
    total.swept += s.swept;
    total.payroll += s.payroll;
    total.trades += s.trades;
    total.booked += s.booked;
  }
  const months = [...by.keys()].sort().map((m) => row(m, by.get(m)!));
  return { months, allTime: row('all-time', total) };
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

const NO_WALLETS: EarningsSnapshot = { fee: null, payroll: null };

/**
 * `GET /staff/v1/earnings` (perm `earnings.read`, the owner's alone) → `EarningsReport`. No query
 * (any is 400 `bad-request`). Without the earnings watch (no wallet on this server) both wallets
 * are null and the months carry the books alone.
 */
export function staffEarningsRoutes(app: FastifyInstance): void {
  const perm = 'earnings.read' as const;
  app.get('/staff/v1/earnings', { config: { perm }, preHandler: requireStaff(perm) }, async (req) => {
    const query = (req.query ?? {}) as Record<string, unknown>;
    for (const k of Object.keys(query)) throw new ApiError(400, 'bad-request', { field: k });
    const { db, config, prices, earnings } = req.server.deps;
    const quote = prices.quote('USD');
    return earningsReport(db, {
      snapshot: earnings?.snapshot() ?? NO_WALLETS,
      feeWallet: config.feeWallet,
      payrollWallet: config.payrollWallet,
      usdCentsPerXmr: quote === null || quote.usdCentsPerXmr <= 0n ? null : quote.usdCentsPerXmr,
    });
  });
}
