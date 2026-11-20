/**
 * Plan 4 Task 9, the read-only part: the owner's earnings from the fee wallet's incoming
 * transfers, summed by UTC month (this month, last month, all time), with a USD estimate at the
 * current price and the trade counts that paid the 1%.
 *
 * Pure: this module never opens a wallet, reads the environment or touches any wallet key. It
 * takes the incoming transfers as plain data. Opening the view-only fee wallet that would supply
 * them (the plan's `loadFeeWalletConfig` and `startEarnings`) and serving `GET /staff/v1/earnings`
 * are held back for a security review (tripwire NEEDS_REVIEW_FEE_VIEW_KEY in the test). Until then
 * the owner's Earnings card reads the internal revenue ledger (Task 32, `GET /staff/v1/revenue`).
 *
 * Lead default, owner question: `usdEstimate` is US cents, rounded down, at the price when the
 * page is read (the plan's `currentPrice('USD')`), not at each fee's trade-time rate as the
 * revenue ledger does; null when there is no price.
 */

/** One incoming transfer to the fee wallet: when it confirmed, and how much (atomic units). */
export interface FeeTransfer {
  at: Date;
  atomic: bigint;
}

export interface Bucket {
  /** Atomic units, decimal string. */
  atomic: string;
  /** US cents, decimal string, rounded down; null when there is no price. */
  usdEstimate: string | null;
  /** Released trades and settled disputes with a fee output in the period (owner, 2026-10-29c). */
  trades: number;
}

export interface Earnings {
  thisMonth: Bucket;
  lastMonth: Bucket;
  allTime: Bucket;
  /** The last four characters of the fee wallet's address (the board's "ending …9Fq2"). */
  walletEnd: string;
}

export interface TradeCounts {
  thisMonth: number;
  lastMonth: number;
  allTime: number;
}

const ATOMIC_PER_XMR = 1_000_000_000_000n;

/** The fee wallet's address, shown only by its last four characters. */
export function walletEndOf(address: string): string {
  if (typeof address !== 'string' || address.length < 4) throw new RangeError('address too short');
  return address.slice(-4);
}

const monthKey = (d: Date): number => d.getUTCFullYear() * 12 + d.getUTCMonth();

/** Sums the fee wallet's incoming transfers by UTC month. Throws on a malformed input. */
export function summarizeFeeIncome(a: {
  transfers: readonly FeeTransfer[];
  now: Date;
  usdCentsPerXmr: bigint | null;
  trades: TradeCounts;
  address: string;
}): Earnings {
  if (a.usdCentsPerXmr !== null && a.usdCentsPerXmr < 0n) throw new RangeError('price must not be negative');
  for (const n of [a.trades.thisMonth, a.trades.lastMonth, a.trades.allTime]) {
    if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('trade count must be a whole number');
  }
  const thisKey = monthKey(a.now);
  let thisMonth = 0n;
  let lastMonth = 0n;
  let allTime = 0n;
  for (const t of a.transfers) {
    if (!(t.at instanceof Date) || !Number.isFinite(t.at.getTime())) throw new RangeError('transfer time is not a date');
    if (typeof t.atomic !== 'bigint' || t.atomic <= 0n) throw new RangeError('transfer amount must be positive');
    const k = monthKey(t.at);
    if (k === thisKey) thisMonth += t.atomic;
    else if (k === thisKey - 1) lastMonth += t.atomic;
    allTime += t.atomic;
  }
  const bucket = (atomic: bigint, trades: number): Bucket => ({
    atomic: atomic.toString(),
    usdEstimate: a.usdCentsPerXmr === null ? null : ((atomic * a.usdCentsPerXmr) / ATOMIC_PER_XMR).toString(),
    trades,
  });
  return {
    thisMonth: bucket(thisMonth, a.trades.thisMonth),
    lastMonth: bucket(lastMonth, a.trades.lastMonth),
    allTime: bucket(allTime, a.trades.allTime),
    walletEnd: walletEndOf(a.address),
  };
}
