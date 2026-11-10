// An offer's size bands (owner 2026-11-06 Q23/Q27: up to 3 amount bands per currency, each with its
// own price and fewest trades) and the words for its range and price, for the quote's bands card
// (quote/QuoteBands.tsx). The offers card (OfferCard.tsx) words its range with offerAmounts.ts and
// its price with markupOf (ui/margin.ts); the range words here are the card's (rangeText is fiatRangeText for a
// 2-place currency, an XMR band's range is the card's xmrRangeText), so the two screens never
// disagree about an offer's range (owner 2026-11-08: the quote carries the bands over).
//
// The API sends one range and one price per offer today (Task 4 `OfferCard`), so `offerBands` gives
// one band: the offer's min to max at its price, in the unit the poster set (owner 8 Nov, "Offer
// amounts in XMR or fiat"). When bands reach the API (FlexOffer-Post, not built), `offerBands` is the
// one place that reads them; the rest already handles several.
import { atomicForFiat, formatXmr, formatXmrExact, offerRate, rangeInBoth, type AmountUnit, type Price } from '@x2f/trade';
import { formatMinor, type Offer, type Pricing } from './api.js';
import { APPROX, offerRange, xmrRangeText } from './offerAmounts.js';

/**
 * One band: amounts from `from` to `to`, both included, in the band's `unit` as the poster set it:
 * the currency's minor units ('fiat') or atomic XMR ('xmr'). An offer's bands share one unit.
 */
export interface Band {
  unit: AmountUnit;
  from: bigint;
  to: bigint;
  pricing: Pricing;
  /** The fewest completed trades the band asks of the other trader (0: none). */
  minTrades: number;
}

/** The offer's bands, lowest first. */
export function offerBands(o: Pick<Offer, 'amountUnit' | 'minAtomic' | 'maxAtomic' | 'minFiatCents' | 'maxFiatCents' | 'pricing' | 'minTrades'>): readonly Band[] {
  const r = offerRange(o);
  return [{ unit: r.unit, from: r.min, to: r.max, pricing: o.pricing, minTrades: o.minTrades }];
}

/** Where an amount falls: inside band `index`, under the smallest trade, over the largest, or in a gap. */
export type BandAt = { kind: 'in'; index: number } | { kind: 'below' } | { kind: 'above' } | { kind: 'between' };

/**
 * The band `amount` falls in; both edges of a band are inside it. `amount` is in the bands' unit
 * (minor units for fiat bands, atomic for XMR bands). `bands` is lowest first and not empty.
 */
export function bandAt(bands: readonly Band[], amount: bigint): BandAt {
  const index = bands.findIndex((b) => amount >= b.from && amount <= b.to);
  if (index >= 0) return { kind: 'in', index };
  if (amount < bands[0]!.from) return { kind: 'below' };
  if (amount > bands[bands.length - 1]!.to) return { kind: 'above' };
  return { kind: 'between' };
}

/**
 * Money in the currency's minor units with `exponent` places (2 on the offers card, which has no
 * price route; the quote passes the route's exponent: whole yen, 3-place dinars). `whole` drops a
 * zero fraction ("$50", but "$500.01").
 */
export function money(minor: bigint, currency: string, exponent = 2, whole = false): string {
  if (exponent === 2) return formatMinor(minor, currency, { whole });
  const unit = 10n ** BigInt(exponent);
  const frac = (minor % unit).toString().padStart(exponent, '0');
  const dropFrac = whole && minor % unit === 0n;
  const nf = new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: exponent, maximumFractionDigits: exponent });
  return nf
    .formatToParts(minor / unit)
    .filter((p) => !(dropFrac && (p.type === 'decimal' || p.type === 'fraction')))
    .map((p) => (p.type === 'fraction' ? frac : p.value))
    .join('');
}

const whole = (minor: bigint, currency: string, exponent = 2) => money(minor, currency, exponent, true);

/** A range as the offers card shows it: "$50 – $1,500", cents kept only when there are some ("$500.01"). */
export function rangeText(from: bigint, to: bigint, currency: string, exponent = 2): string {
  return `${whole(from, currency, exponent)} – ${whole(to, currency, exponent)}`;
}

/** The band's own range, as the poster set it: "$50 – $1,500", or XMR figures "0.300000 – 9.000000" (the card's 6 places; the view adds "XMR"). */
export function bandRange(band: Band, currency: string, exponent = 2): string {
  return band.unit === 'xmr' ? xmrRangeText(band.from, band.to) : rangeText(band.from, band.to, currency, exponent);
}

// The quote's bands card (BuyQuote board, canvas v142, "This offer's bands"). Owner 2026-11-08,
// "Offer amounts in XMR or fiat": the quote carries the markup, the ranges in both units, and the
// with/without-markup view. All money maths is bigint (@x2f/trade); nothing goes through a float.
// The band's price against the market is worded by ui/margin.ts (design final call 10 Nov 2026).
// TODO(wip/lead-offer-units): switch bandRate and bandXmr to that branch's exported conversion
// helpers when it lands; an offer set in XMR then converts the other way.

/**
 * The band's rate per XMR: its own price with `withMarkup` (offerRate), else the market price;
 * null when that price is not known (a market band with the feed down; the market without one).
 */
export function bandRate(band: Band, currency: string, market: bigint | null, withMarkup: boolean): Price | null {
  const marketPrice = market === null ? null : { currency, centsPerXmr: market };
  return withMarkup ? offerRate(band.pricing, currency, marketPrice) : marketPrice;
}

/** A fiat band's edges in XMR at `rate`: "0.151515 – 4.545454" (atomicForFiat floors, 6 places, truncated). */
export function bandXmr(band: Band, rate: Price): string {
  if (band.unit !== 'fiat') throw new RangeError('bandXmr takes a fiat band');
  return `${formatXmr(atomicForFiat(band.from, rate), 6)} – ${formatXmr(atomicForFiat(band.to, rate), 6)}`;
}

/** An XMR band's edges in the currency at `rate`: "$165.77 – $1,500" (@x2f/trade fiatCents, half up; the quote's exponent). */
export function bandFiat(band: Band, rate: Price, currency: string, exponent = 2): string {
  if (band.unit !== 'xmr') throw new RangeError('bandFiat takes an XMR band');
  const b = rangeInBoth({ unit: 'xmr', min: band.from, max: band.to }, rate);
  return rangeText(b.minFiat, b.maxFiat, currency, exponent);
}

/**
 * The band's range in the other unit at `rate`, marked as converted (lead 9 Nov, design not yet
 * asked: an XMR band shows its XMR and "≈" the fiat at the live rate, as the card does): the text
 * after "≈ " and its unit. COPY-UNSIGNED: the "≈ " prefix (offerAmounts APPROX).
 */
export function bandOther(band: Band, rate: Price, currency: string, exponent = 2): { text: string; unit: string } {
  return band.unit === 'fiat' ? { text: `${APPROX}${bandXmr(band, rate)}`, unit: 'XMR' } : { text: `${APPROX}${bandFiat(band, rate, currency, exponent)}`, unit: currency };
}

/** A clip line: "Above $500 the rate changes to $331.88." (`dir` up) or "Below $500.01 …" (down); an XMR band's edge reads "5.000000 XMR". */
export interface Clip {
  dir: 'up' | 'down';
  at: string;
  rate: string;
}

/** A band edge as the clip line says it: whole money, or the exact XMR with its unit. COPY-UNSIGNED: "XMR" after the figure. */
function edgeText(band: Band, edge: bigint, currency: string, exponent: number): string {
  return band.unit === 'xmr' ? `${formatXmrExact(edge)} XMR` : whole(edge, currency, exponent);
}

/**
 * Where the price clips around the band the amount is in: the next band up and the next band down,
 * each at its own price (the markup always: these are the rates a trade would lock). None outside
 * a band, and none for a neighbour whose rate is not known.
 */
export function clipLines(bands: readonly Band[], at: BandAt | null, currency: string, market: bigint | null, exponent = 2): Clip[] {
  if (at?.kind !== 'in') return [];
  const band = bands[at.index]!;
  const out: Clip[] = [];
  const up = bands[at.index + 1];
  const upRate = up && bandRate(up, currency, market, true);
  if (upRate) out.push({ dir: 'up', at: edgeText(band, band.to, currency, exponent), rate: money(upRate.centsPerXmr, currency, exponent) });
  const down = bands[at.index - 1];
  const downRate = down && bandRate(down, currency, market, true);
  if (downRate) out.push({ dir: 'down', at: edgeText(band, band.from, currency, exponent), rate: money(downRate.centsPerXmr, currency, exponent) });
  return out;
}
