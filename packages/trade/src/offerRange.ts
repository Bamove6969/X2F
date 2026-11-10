/**
 * An offer's trade size in the unit its poster chose (owner, 8 Nov 2026: "Offer amounts in XMR or
 * fiat"). A range set in fiat ($500 - $3,000 CAD) still sells XMR: the poster's unit is kept exactly,
 * and the other unit is worked out at a rate at the moment it is needed (the list, the quote, the
 * take). Every figure is a bigint: XMR in atomic units, fiat in the currency's minor units.
 *
 * Rounding is the quote's (money.ts): fiat for XMR rounds half up (`fiatCents`), XMR for fiat is
 * floored (`atomicForFiat`), so a converted figure never shows more XMR than the fiat buys.
 *
 * Used by the API (the take's size check and the limits a trade records) and by the web (the ad
 * card's two rows, with or without the vendor's markup); the quote screen can use the same ones.
 */
import { atomicForFiat, fiatCents, offerRate, type Price, type Pricing } from './money.js';

export type AmountUnit = 'xmr' | 'fiat';
export const AMOUNT_UNITS: readonly AmountUnit[] = ['xmr', 'fiat'];

/** The poster's range: `min` and `max` in atomic units for 'xmr', in the currency's minor units for 'fiat'. */
export interface OfferRange {
  unit: AmountUnit;
  min: bigint;
  max: bigint;
}

/** One range in both units. */
export interface RangeBoth {
  minAtomic: bigint;
  maxAtomic: bigint;
  minFiat: bigint;
  maxFiat: bigint;
}

function checkRange(r: OfferRange): void {
  if (r.unit !== 'xmr' && r.unit !== 'fiat') throw new RangeError('unknown unit');
  if (r.min <= 0n || r.max < r.min) throw new RangeError('bad range');
}

/** The range in both units at `rate`: the poster's unit exactly as set, the other converted. */
export function rangeInBoth(r: OfferRange, rate: Price): RangeBoth {
  checkRange(r);
  if (r.unit === 'xmr') return { minAtomic: r.min, maxAtomic: r.max, minFiat: fiatCents(r.min, rate), maxFiat: fiatCents(r.max, rate) };
  return { minAtomic: atomicForFiat(r.min, rate), maxAtomic: atomicForFiat(r.max, rate), minFiat: r.min, maxFiat: r.max };
}

/**
 * The rate to show an offer's amounts at. With the markup it is the offer's own rate, what a taker
 * trades at (`offerRate`: the market moved by the margin, as the take locks it). Without it, the
 * market price itself. Null when there is no market price now (the feed is down).
 */
export function displayRate(p: Pricing, currency: string, market: Price | null, withMarkup: boolean): Price | null {
  if (withMarkup) return offerRate(p, currency, market);
  if (market === null || market.currency !== currency) return null;
  return market;
}

export type RangeCheck = 'ok' | 'too-low' | 'too-high';

/**
 * Whether a trade of `amountAtomic` at `rate` (the rate that locks: the offer's own) fits the
 * offer's range. An XMR range compares the amount itself; a fiat range compares its fiat total
 * (`fiatCents` at the rate, the total the take stores). A total that rounds to nothing is too low
 * whatever the unit (a trade needs a fiat total of at least one minor unit).
 */
export function rangeAllows(r: OfferRange, amountAtomic: bigint, rate: Price): RangeCheck {
  checkRange(r);
  if (amountAtomic <= 0n) return 'too-low';
  const total = fiatCents(amountAtomic, rate);
  if (total === 0n) return 'too-low';
  const v = r.unit === 'xmr' ? amountAtomic : total;
  if (v < r.min) return 'too-low';
  if (v > r.max) return 'too-high';
  return 'ok';
}

/**
 * The fiat limits a trade records at the take (the trade's minFiatCents and maxFiatCents: the
 * funded-above-amount growth stops at the maximum, spec 11.1). A fiat range is its own; an XMR range
 * is converted at the locked rate, the minimum at least one minor unit and the maximum never below
 * the minimum. Any amount `rangeAllows` passes has its total inside these limits (fiatCents never
 * decreases as the amount grows).
 */
export function tradeFiatLimits(r: OfferRange, rate: Price): { minFiatCents: bigint; maxFiatCents: bigint } {
  checkRange(r);
  if (r.unit === 'fiat') return { minFiatCents: r.min, maxFiatCents: r.max };
  const lo = fiatCents(r.min, rate);
  const minFiatCents = lo > 0n ? lo : 1n;
  const hi = fiatCents(r.max, rate);
  return { minFiatCents, maxFiatCents: hi > minFiatCents ? hi : minFiatCents };
}
