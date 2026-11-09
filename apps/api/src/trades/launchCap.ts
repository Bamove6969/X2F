import { LAUNCH_TRADE_CAP_USD_CENTS, fiatCents, type AmountUnit } from '@x2f/trade';
import { ApiError } from '../errors.js';
import type { MarketPrices } from '../price/market.js';
import { usdCentsOf } from '../traders/stage.js';

/**
 * The launch cap (owner p11-6; `LAUNCH_TRADE_CAP_USD_CENTS`). `usdCents` is the value being
 * capped, or null when the app has no USD price to count it with: that fails closed (409
 * `price-unavailable`), never lets it through. Above the cap: 409 `launch-cap` `{ capUsdCents }`.
 */
export function assertWithinLaunchCap(usdCents: bigint | null): void {
  throwLaunchCapRefusal(launchCapRefusal(usdCents));
}

/** Throws `refused` as `assertWithinLaunchCap` would; nothing for null. */
export function throwLaunchCapRefusal(refused: LaunchCapRefusal | null): void {
  if (refused === 'price-unavailable') throw new ApiError(409, 'price-unavailable');
  if (refused === 'launch-cap') throw new ApiError(409, 'launch-cap', { capUsdCents: LAUNCH_TRADE_CAP_USD_CENTS.toString() });
}

export type LaunchCapRefusal = 'price-unavailable' | 'launch-cap';

/** `assertWithinLaunchCap`'s refusal as a code, for a per-offer result (My offers' Turn on); null when within. */
export function launchCapRefusal(usdCents: bigint | null): LaunchCapRefusal | null {
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

/**
 * A band's top edge (J-16: `offer_tiers.max_amount`, in the offer's unit) as US cents at
 * `currency`'s market rate now: a fiat band's maximum converted as `usdCentsFor`; an XMR band's
 * largest amount valued in `currency` at the market and then in US dollars (so an XMR band is
 * judged exactly as a take values its XMR, `take.ts usdValue`). Null while the currency has no
 * quote (a US-dollar fiat band needs none).
 */
export function bandTopUsdCents(unit: AmountUnit, currency: string, maxAmount: bigint, prices: MarketPrices): bigint | null {
  if (unit === 'fiat') return usdCentsFor(currency, maxAmount, prices);
  const q = prices.quote(currency);
  if (q === null) return null;
  return usdCentsOf(fiatCents(maxAmount, q.price), { centsPerXmr: q.price.centsPerXmr, usdCentsPerXmr: q.usdCentsPerXmr });
}

/** The bands of one of an offer's currencies, as `offers/routes.ts` `Flex` carries them. */
export interface CappedCurrency {
  currency: string;
  tiers: readonly { max: string }[];
}

/**
 * The launch cap over a whole flexible offer (J-16 on launch-rules; owner p11-6): every band's top
 * edge in every currency of the offer, at that currency's market rate now (`bandTopUsdCents`),
 * is at most $5,000. 'launch-cap' when any priced band is over, whatever else is unpriced: the
 * poster has to lower that band either way.
 *
 * A currency with no market price now cannot be judged. At post (`unpricedHidden` false) that fails
 * closed, as launch-rules does for one currency: 'price-unavailable'. At a relist (`unpricedHidden`
 * true) the lead's default for the open owner question p11-95 applies: the priced currencies are
 * checked and relist, and the unpriced one stays hidden (owner Q5: no list shows a currency without
 * a price) until its rate returns; only an offer with no priced currency at all is
 * 'price-unavailable'. OWNER QUESTION p11-95: flip `unpricedHidden` to false at the relist and
 * bulk-relist call sites (and the `flexOffers.test.ts` case named for it) if the owner wants a
 * relist to fail closed on any unpriced currency instead.
 */
export function offerLaunchCapRefusal(
  unit: AmountUnit,
  currencies: readonly CappedCurrency[],
  prices: MarketPrices,
  unpricedHidden: boolean,
): LaunchCapRefusal | null {
  let unpriced = 0;
  for (const c of currencies) {
    for (const t of c.tiers) {
      const usd = bandTopUsdCents(unit, c.currency, BigInt(t.max), prices);
      if (usd === null) {
        unpriced++;
        break;
      }
      if (usd > LAUNCH_TRADE_CAP_USD_CENTS) return 'launch-cap';
    }
  }
  if (unpriced === 0) return null;
  return unpricedHidden && unpriced < currencies.length ? null : 'price-unavailable';
}
