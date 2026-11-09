import { LAUNCH_TRADE_CAP_USD_CENTS } from '@x2f/trade';
import { ApiError } from '../errors.js';
import type { MarketPrices } from '../price/market.js';
import { usdCentsOf } from '../traders/stage.js';

/**
 * The launch cap (owner p11-6; `LAUNCH_TRADE_CAP_USD_CENTS`). `usdCents` is the value being
 * capped, or null when the app has no USD price to count it with: that fails closed (409
 * `price-unavailable`), never lets it through. Above the cap: 409 `launch-cap` `{ capUsdCents }`.
 */
export function assertWithinLaunchCap(usdCents: bigint | null): void {
  const refused = launchCapRefusal(usdCents);
  if (refused === 'price-unavailable') throw new ApiError(409, 'price-unavailable');
  if (refused === 'launch-cap') throw new ApiError(409, 'launch-cap', { capUsdCents: LAUNCH_TRADE_CAP_USD_CENTS.toString() });
}

/** `assertWithinLaunchCap`'s refusal as a code, for a per-offer result (My offers' Turn on); null when within. */
export function launchCapRefusal(usdCents: bigint | null): 'price-unavailable' | 'launch-cap' | null {
  if (usdCents === null) return 'price-unavailable';
  return usdCents > LAUNCH_TRADE_CAP_USD_CENTS ? 'launch-cap' : null;
}

/**
 * An amount in `currency`'s minor units as US cents, by the app's own market quote (the same
 * conversion the starter caps use, rounded up). A US-dollar amount needs no price; any other
 * currency without a quote is null.
 */
export function usdCentsFor(currency: string, minor: bigint, prices: MarketPrices): bigint | null {
  if (currency === 'USD') return minor;
  const q = prices.quote(currency);
  if (q === null) return null;
  return usdCentsOf(minor, { centsPerXmr: q.price.centsPerXmr, usdCentsPerXmr: q.usdCentsPerXmr });
}
