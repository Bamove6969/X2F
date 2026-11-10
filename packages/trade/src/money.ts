/**
 * Quote maths. Monero amounts are bigint atomic units (1 XMR = 10^12);
 * fiat amounts are bigint cents (minor units, two decimals).
 */
import { feeFor } from '@x2f/core';

/** Atomic units per XMR. */
export const ATOMIC_PER_XMR = 1_000_000_000_000n;
const XMR_DECIMALS = 12;
const BPS = 10_000n;
/** The largest margin either way: ±50%. */
export const MAX_MARGIN_BPS = 5_000;

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

/**
 * How an offer is priced: always the market price moved by a margin (owner Q1, 6 Nov 2026: "all
 * offers are going to be market + whatever percentage"; F1, 7 Nov: above or below, at most 50%).
 * There is no fixed-price offer.
 */
export type Pricing = { mode: 'market'; marginBps: number };

/** n / d rounded half up, for n >= 0 and d > 0. */
function divHalfUp(n: bigint, d: bigint): bigint {
  return (n * 2n + d) / (d * 2n);
}

function checkPrice(p: Price): void {
  if (p.centsPerXmr <= 0n) throw new RangeError('price must be positive');
}

/** The market price moved by `marginBps` basis points (+40 = 0.40% above, at most ±50%), rounded half up. */
export function rateFor(market: Price, marginBps: number): Price {
  checkPrice(market);
  if (!Number.isSafeInteger(marginBps) || Math.abs(marginBps) > MAX_MARGIN_BPS) throw new RangeError('bad margin');
  const rate = { currency: market.currency, centsPerXmr: divHalfUp(market.centsPerXmr * (BPS + BigInt(marginBps)), BPS) };
  checkPrice(rate);
  return rate;
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
 * The offer's price per XMR: the market price moved by the margin. It needs a current feed price
 * in the same currency and returns null without one. Any other pricing mode is refused (there is
 * no fixed price, owner Q1).
 */
export function offerRate(p: Pricing, currency: string, market: Price | null): Price | null {
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

/**
 * XMR exact to the atomic unit, for any figure the user must send (or a remainder to send): at
 * least 6 places, and more (up to all 12) only when the digits past the 6th are non-zero,
 * trailing zeros trimmed. 0.610529733574 stays 0.610529733574 (formatXmr would show 0.610529, and
 * a seller who typed that would come up short); 1.25 reads 1.250000, as on the boards.
 */
export function formatXmrExact(atomic: bigint): string {
  const full = formatXmr(atomic, XMR_DECIMALS).replace(/0+$/, '');
  const places = full.length - full.indexOf('.') - 1;
  return places >= 6 ? full : formatXmr(atomic, 6);
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

/**
 * The trade amount that `fundsAtomic` in the escrow covers (spec 11.1, owner
 * 2026-10-20: a trade funded above its amount grows to what was funded). On a
 * buyer's ad that is the funds; on a seller's ad it is the largest A with
 * A + feeFor(A) <= funds, and anything left over is dust for the seller.
 */
export function amountForFunds(fundsAtomic: bigint, poster: 'seller' | 'buyer'): bigint {
  if (fundsAtomic <= 0n) throw new RangeError('funds must be positive');
  if (poster === 'buyer') return fundsAtomic;
  if (poster !== 'seller') throw new RangeError('unknown poster');
  const funds = (a: bigint): bigint => a + feeFor(a);
  // A + A/100 >= funds(A) > A + A/100 - 1, so the answer is within 2 of funds * 100 / 101.
  let a = (fundsAtomic * BPS) / (BPS + 100n);
  while (a > 0n && funds(a) > fundsAtomic) a -= 1n;
  while (funds(a + 1n) <= fundsAtomic) a += 1n;
  return a;
}
