// An offer's trade size in both units (owner, 8 Nov 2026: "Offer amounts in XMR or fiat"). The
// poster set the range in XMR or in fiat (`amountUnit`); the ad card shows it in both, one row each,
// and the list's "Display amounts including vendor markup" box picks the rate the other unit is
// worked out at: off (the default), the market price; on, the offer's own rate (the market moved by
// its margin, or its fixed price), what a taker trades at. The poster's own row never changes.
//
// The money maths is @x2f/trade's (offerRange.ts: rangeInBoth, displayRate, rangeAllows); this file
// only picks the rate and formats. The quote screen can use the same: `offerRange` for the poster's
// range, `rowsAt` for the two rows at a rate, and @x2f/trade's `rangeAllows` for a size check.
import { displayRate, rangeInBoth, type OfferRange, type Price } from '@x2f/trade';
import { formatMinor, type Offer } from './api.js';

/** The poster's range as they set it. */
export function offerRange(o: Pick<Offer, 'amountUnit' | 'minAtomic' | 'maxAtomic' | 'minFiatCents' | 'maxFiatCents'>): OfferRange {
  if (o.amountUnit === 'xmr') return { unit: 'xmr', min: o.minAtomic!, max: o.maxAtomic! };
  return { unit: 'fiat', min: o.minFiatCents!, max: o.maxFiatCents! };
}

/** XMR shown on a card: six decimals, the kit's XMR figure (boards v142: "0.300000 – 9.000000"). */
export const CARD_XMR_DECIMALS = 6;

/**
 * `atomic` as XMR with `decimals` places, rounded `up` or `down` at the last place. A range's minimum
 * rounds up and its maximum down, so the range shown is never wider than the one the offer takes.
 */
export function xmrBound(atomic: bigint, dir: 'up' | 'down', decimals = CARD_XMR_DECIMALS): string {
  const step = 10n ** BigInt(12 - decimals);
  const units = dir === 'up' ? (atomic + step - 1n) / step : atomic / step;
  const scale = 10n ** BigInt(decimals);
  const whole = units / scale;
  const frac = (units % scale).toString().padStart(decimals, '0');
  return decimals === 0 ? whole.toLocaleString('en-US') : `${whole.toLocaleString('en-US')}.${frac}`;
}

/** "1.000000 – 5.000000", "1.478197 – 8.869179": the figures only; the view adds the "XMR" unit. */
export function xmrRangeText(minAtomic: bigint, maxAtomic: bigint): string {
  return `${xmrBound(minAtomic, 'up')} – ${xmrBound(maxAtomic, 'down')}`;
}

/** "$50 – $1,500" (whole amounts drop their cents), "$338.25 – $1,691.25". */
export function fiatRangeText(minFiat: bigint, maxFiat: bigint, currency: string): string {
  return `${formatMinor(minFiat, currency, { whole: true })} – ${formatMinor(maxFiat, currency, { whole: true })}`;
}

export interface RangeRows {
  /** The range in XMR, figures only (the view adds the unit); null when it is converted and there is no rate now. */
  xmr: string | null;
  /** The range in the offer's currency; null when it is converted and there is no rate now. */
  fiat: string | null;
}

/** A converted row starts with "≈" (boards v142, owner #11: the poster's own row is exact). COPY-UNSIGNED: the "≈ " prefix. */
export const APPROX = '≈ ';

/** The two rows at `rate` (null: only the poster's own row); the converted one starts with "≈". */
export function rowsAt(range: OfferRange, currency: string, rate: Price | null): RangeRows {
  if (rate === null) {
    return range.unit === 'xmr'
      ? { xmr: xmrRangeText(range.min, range.max), fiat: null }
      : { xmr: null, fiat: fiatRangeText(range.min, range.max, currency) };
  }
  const b = rangeInBoth(range, rate);
  const xmr = xmrRangeText(b.minAtomic, b.maxAtomic);
  const fiat = fiatRangeText(b.minFiat, b.maxFiat, currency);
  return range.unit === 'xmr' ? { xmr, fiat: APPROX + fiat } : { xmr: APPROX + xmr, fiat };
}

/** One amount in the other unit at `rate`, "≈ $165.77" or "≈ 1.508 XMR" (PostOffer's line under each box). COPY-UNSIGNED. */
export function otherUnit(amount: bigint, unit: OfferRange['unit'], currency: string, rate: Price): string {
  const b = rangeInBoth({ unit, min: amount, max: amount }, rate);
  return unit === 'xmr' ? `${APPROX}${formatMinor(b.minFiat, currency)}` : `${APPROX}${xmrBound(b.minAtomic, 'down', 6)} XMR`;
}

/**
 * "Market rate · updated 14:05 UTC" from the feed's `at` (boards v142, anticipated from owner #3); null for a bad time.
 * COPY-UNSIGNED: "Market rate · updated HH:MM UTC" (shown on Browse and Post an offer).
 */
export function marketUpdated(at: string): string | null {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  return `Market rate · updated ${d.toISOString().slice(11, 16)} UTC`;
}

/** COPY-UNSIGNED (boards v142): the hint under "Display amounts including vendor markup". */
export function withMarkupHint(on: boolean): string {
  return on ? "Converted at each offer's price, markup included." : 'Converted at the market rate, before markup.';
}

/**
 * The card's two rows. With the markup the rate is the offer's own as the API priced it (`rate`, so
 * the rows match the price on the card); without, the market price (`market`, minor units per XMR).
 */
export function cardRows(o: Offer, currency: string, market: bigint | null, withMarkup: boolean): RangeRows {
  const marketPrice: Price | null = market === null ? null : { currency, centsPerXmr: market };
  const rate: Price | null = withMarkup
    ? o.rate === null ? null : { currency, centsPerXmr: o.rate }
    : displayRate(o.pricing, currency, marketPrice, false);
  return rowsAt(offerRange(o), currency, rate);
}

/** The device's choice for "Display amounts including vendor markup" (off by default). */
export const WITH_MARKUP_KEY = 'x2f.offers-with-markup';

export function loadWithMarkup(storage: Storage | null): boolean {
  try {
    return storage?.getItem(WITH_MARKUP_KEY) === '1';
  } catch {
    // Storage can be off (private mode, blocked site data): the box starts off.
    return false;
  }
}

export function saveWithMarkup(storage: Storage | null, on: boolean): void {
  try {
    if (on) storage?.setItem(WITH_MARKUP_KEY, '1');
    else storage?.removeItem(WITH_MARKUP_KEY);
  } catch {
    // As loadWithMarkup: the box still works for this visit.
  }
}

