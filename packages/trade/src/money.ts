/**
 * Quote maths. Monero amounts are bigint atomic units (1 XMR = 10^12);
 * fiat amounts are bigint cents (minor units, two decimals).
 */
import { feeFor } from '@x2f/core';

/** Atomic units per XMR. */
export const ATOMIC_PER_XMR = 1_000_000_000_000n;
const XMR_DECIMALS = 12;
const BPS = 10_000n;

/** What the ad poster does with XMR: a sell ad is posted by a seller, a buy ad by a buyer. */
export type Side = 'sell' | 'buy';

export function posterRole(side: Side): 'seller' | 'buyer' {
  if (side === 'sell') return 'seller';
  if (side === 'buy') return 'buyer';
  throw new RangeError('unknown side');
}

/** A price in cents of `currency` per whole XMR. */
export interface Price {
  currency: string;
  centsPerXmr: bigint;
}

export type Pricing = { mode: 'market'; marginBps: number } | { mode: 'fixed'; centsPerXmr: bigint };

/** n / d rounded half up, for n >= 0 and d > 0. */
function divHalfUp(n: bigint, d: bigint): bigint {
  return (n * 2n + d) / (d * 2n);
}

function checkPrice(p: Price): void {
  if (p.centsPerXmr <= 0n) throw new RangeError('price must be positive');
}

/** The market price moved by `marginBps` basis points (+40 = 0.40% above), rounded half up. */
export function rateFor(market: Price, marginBps: number): Price {
  checkPrice(market);
  if (!Number.isSafeInteger(marginBps) || marginBps <= -10_000) throw new RangeError('bad margin');
  return { currency: market.currency, centsPerXmr: divHalfUp(market.centsPerXmr * (BPS + BigInt(marginBps)), BPS) };
}

/** Fiat value of `atomic` at `rate`, in cents, rounded half up. */
export function fiatCents(atomic: bigint, rate: Price): bigint {
  checkPrice(rate);
  if (atomic < 0n) throw new RangeError('amount must not be negative');
  return divHalfUp(atomic * rate.centsPerXmr, ATOMIC_PER_XMR);
}

/** XMR (atomic) that `cents` buys at `rate`, floored. */
export function atomicForFiat(cents: bigint, rate: Price): bigint {
  checkPrice(rate);
  if (cents < 0n) throw new RangeError('amount must not be negative');
  return (cents * ATOMIC_PER_XMR) / rate.centsPerXmr;
}

/**
 * The offer's price per XMR. A market offer needs a current feed price in the
 * same currency and returns null without one; a fixed offer ignores the feed.
 */
export function offerRate(p: Pricing, currency: string, market: Price | null): Price | null {
  if (p.mode === 'fixed') {
    const rate = { currency, centsPerXmr: p.centsPerXmr };
    checkPrice(rate);
    return rate;
  }
  if (p.mode !== 'market') throw new RangeError('unknown pricing mode');
  if (market === null || market.currency !== currency) return null;
  return rateFor(market, p.marginBps);
}

/**
 * XMR with `decimals` places (default 6). Extra digits are truncated, never
 * rounded up, so the figure never shows more than exists.
 */
export function formatXmr(atomic: bigint, decimals = 6): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > XMR_DECIMALS) throw new RangeError('bad decimals');
  const sign = atomic < 0n ? '-' : '';
  const abs = atomic < 0n ? -atomic : atomic;
  const whole = abs / ATOMIC_PER_XMR;
  const frac = (abs % ATOMIC_PER_XMR).toString().padStart(XMR_DECIMALS, '0').slice(0, decimals);
  return decimals === 0 ? `${sign}${whole}` : `${sign}${whole}.${frac}`;
}

/** Fiat cents as a currency string, e.g. 41250n USD → "$412.50". Exact for any bigint. */
export function formatFiat(cents: bigint, currency: string): string {
  const nf = new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const abs = cents < 0n ? -cents : cents;
  const whole = cents < 0n ? -(abs / 100n) : abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  // Format the whole part exactly as a bigint, then put the cents into the fraction part.
  // A negative amount under one unit still needs its minus sign.
  const parts = nf.formatToParts(whole === 0n && cents < 0n ? -0 : whole);
  return parts.map((part) => (part.type === 'fraction' ? frac : part.value)).join('');
}

/**
 * What the seller must fund. The fee is 1% of the amount, paid only by the ad
 * poster: a seller-poster funds amount + fee; on a buyer's ad the fee comes
 * out of the buyer's payout, so the seller funds the amount.
 */
export function escrowPlan(a: { amountAtomic: bigint; poster: 'seller' | 'buyer' }): { sellerFundsAtomic: bigint; feeAtomic: bigint } {
  if (a.amountAtomic <= 0n) throw new RangeError('amount must be positive');
  if (a.poster !== 'seller' && a.poster !== 'buyer') throw new RangeError('unknown poster');
  const feeAtomic = feeFor(a.amountAtomic);
  return { sellerFundsAtomic: a.amountAtomic + (a.poster === 'seller' ? feeAtomic : 0n), feeAtomic };
}
