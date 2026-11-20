import { ATOMIC_PER_XMR, fiatCents, type Price } from '@x2f/trade';
import type { MarketQuote } from '../price/market.js';
import { usdCentsOf } from '../traders/stage.js';

/**
 * One rule for what a trade counts against a cap, shared by the take (the starter caps, account
 * limits and the launch cap) and by the offer list's clamp for a poster held by an account limit
 * (Plan 4 Task 26, review B1), so the two can never drift apart.
 *
 * `usdValue`: the trade's value in US cents, the larger of its fiat total and its XMR amount valued
 * at the live market price (lead decision 2026-10-29, Task 5 review M5), so an offer priced below
 * the market (down to −50%) cannot move more XMR inside a cap. Both convert with `usdCentsOf` at the
 * market quote `q`, exactly as Task 4's `opensAt` converts an offer's minimum (Task 4 review M8).
 */
export function usdValue(currency: string, q: MarketQuote, amountAtomic: bigint, cents: bigint): bigint {
  const usd = (c: bigint): bigint => (currency === 'USD' ? c : usdCentsOf(c, { centsPerXmr: q.price.centsPerXmr, usdCentsPerXmr: q.usdCentsPerXmr }));
  const total = usd(cents);
  const market = usd(fiatCents(amountAtomic, q.price));
  return total > market ? total : market;
}

/**
 * The largest XMR amount (atomic) whose trade at `rate` is within `capUsdCents` by `usdValue`, found
 * by bisection (the value only rises with the amount). `from` is an amount already known to be
 * within (the take's own amount; 0 otherwise).
 */
export function largestAtomicWithin(currency: string, q: MarketQuote, rate: Price, capUsdCents: bigint, from = 0n): bigint {
  const within = (x: bigint): boolean => usdValue(currency, q, x, fiatCents(x, rate)) <= capUsdCents;
  let lo = from;
  let hi = lo > 0n ? lo * 2n : 1n;
  while (within(hi)) [lo, hi] = [hi, hi * 2n];
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    if (within(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * The largest fiat total (minor units) a taker can ask for at `rate` without the amount it buys
 * (`atomicForFiat`, rounded down, as the quote works it out) passing `maxAtomic`: every total up to
 * it takes an amount of at most `maxAtomic`, and the next one takes more.
 */
export function largestTotalWithin(rate: Price, maxAtomic: bigint): bigint {
  return ((maxAtomic + 1n) * rate.centsPerXmr - 1n) / ATOMIC_PER_XMR;
}
