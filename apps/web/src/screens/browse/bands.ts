// An offer's size bands (owner 2026-11-06 Q23/Q27: up to 3 amount bands per currency, each with its
// own price and fewest trades) and the words for its range and price. The offers card (OfferCard.tsx)
// and the quote (quote/QuoteBands.tsx) both read this file, so what the two screens say about an
// offer's ranges and prices never disagree (owner 2026-11-08: the quote carries the bands over).
//
// The API sends one range and one price per offer today (Task 4 `OfferCard`), so `offerBands` gives
// one band: the offer's min to max at its price. When bands reach the API (FlexOffer-Post, not built),
// `offerBands` is the one place that reads them; the rest already handles several.
import { atomicForFiat, formatXmr, offerRate, type Price } from '@x2f/trade';
import { formatMinor, type Offer, type Pricing } from './api.js';

/** One band: amounts from `fromFiatCents` to `toFiatCents`, both included, in the currency's minor units. */
export interface Band {
  fromFiatCents: bigint;
  toFiatCents: bigint;
  pricing: Pricing;
  /** The fewest completed trades the band asks of the other trader (0: none). */
  minTrades: number;
}

/** The offer's bands, lowest first. */
export function offerBands(o: Pick<Offer, 'minFiatCents' | 'maxFiatCents' | 'pricing' | 'minTrades'>): readonly Band[] {
  return [{ fromFiatCents: o.minFiatCents, toFiatCents: o.maxFiatCents, pricing: o.pricing, minTrades: o.minTrades }];
}

/** Where an amount falls: inside band `index`, under the smallest trade, over the largest, or in a gap. */
export type BandAt = { kind: 'in'; index: number } | { kind: 'below' } | { kind: 'above' } | { kind: 'between' };

/** The band `fiatCents` falls in; both edges of a band are inside it. `bands` is lowest first and not empty. */
export function bandAt(bands: readonly Band[], fiatCents: bigint): BandAt {
  const index = bands.findIndex((b) => fiatCents >= b.fromFiatCents && fiatCents <= b.toFiatCents);
  if (index >= 0) return { kind: 'in', index };
  if (fiatCents < bands[0]!.fromFiatCents) return { kind: 'below' };
  if (fiatCents > bands[bands.length - 1]!.toFiatCents) return { kind: 'above' };
  return { kind: 'between' };
}

const whole = (minor: bigint, currency: string) => formatMinor(minor, currency, { whole: true });

/** A range as the offers card shows it: "$50 – $1,500", cents kept only when there are some ("$500.01"). */
export function rangeText(from: bigint, to: bigint, currency: string): string {
  return `${whole(from, currency)} – ${whole(to, currency)}`;
}

/** The offer's whole range per trade, as on its card. */
export function offerRange(o: Pick<Offer, 'minFiatCents' | 'maxFiatCents'>, currency: string): string {
  return rangeText(o.minFiatCents, o.maxFiatCents, currency);
}

/**
 * A price compared with the market, as on the offers card: "0.2% above market", "At market"; a
 * fixed price reads its difference from the market price now, or "Fixed price" with no market.
 * `favourable` says whether a price above (positive) or below (negative) market is good for the
 * person looking (BrowseCopy.favourable), shown in the escrow tone.
 */
export function marginText(pricing: Pricing, currency: string, market: bigint | null, favourable: (sign: number) => boolean): { text: string; favourable: boolean } {
  if (pricing.mode === 'fixed') {
    if (market === null) return { text: 'Fixed price', favourable: false };
    const diff = pricing.centsPerXmr - market;
    if (diff === 0n) return { text: 'At market', favourable: false };
    const abs = diff < 0n ? -diff : diff;
    return { text: `${formatMinor(abs, currency)} ${diff > 0n ? 'above' : 'below'} market`, favourable: favourable(diff > 0n ? 1 : -1) };
  }
  const bps = pricing.marginBps;
  if (bps === 0) return { text: 'At market', favourable: false };
  const pct = (Math.abs(bps) / 100).toFixed(2).replace(/\.?0+$/, '');
  return { text: `${pct}% ${bps > 0 ? 'above' : 'below'} market`, favourable: favourable(bps) };
}

// The quote's bands card (BuyQuote board, canvas v142, "This offer's bands"). Owner 2026-11-08,
// "Offer amounts in XMR or fiat": the quote carries the markup, the ranges in both units, and the
// with/without-markup view. All money maths is bigint (@x2f/trade); nothing goes through a float.
// TODO(wip/lead-offer-units): switch bandRate, bandXmr and markupText to that branch's exported
// conversion and markup helpers when it lands; an offer set in XMR then converts the other way.

/**
 * The band's rate per XMR: its own price with `withMarkup` (offerRate), else the market price;
 * null when that price is not known (a market band with the feed down; the market without one).
 */
export function bandRate(band: Band, currency: string, market: bigint | null, withMarkup: boolean): Price | null {
  const marketPrice = market === null ? null : { currency, centsPerXmr: market };
  return withMarkup ? offerRate(band.pricing, currency, marketPrice) : marketPrice;
}

/** The band's fiat edges in XMR at `rate`: "0.151515 – 4.545454" (atomicForFiat floors, 6 places, truncated). */
export function bandXmr(band: Band, rate: Price): string {
  return `${formatXmr(atomicForFiat(band.fromFiatCents, rate), 6)} – ${formatXmr(atomicForFiat(band.toFiatCents, rate), 6)}`;
}

/**
 * The band's markup over the market, 2 places as on the board: "+0.03%", "−0.20%", "0.00%". A
 * market band's is its margin, exact; a fixed band's needs the market price (null without one),
 * rounded half away from zero to a basis point.
 */
export function markupText(pricing: Pricing, market: bigint | null): string | null {
  let bps: bigint;
  if (pricing.mode === 'market') bps = BigInt(pricing.marginBps);
  else if (market === null || market <= 0n) return null;
  else {
    const diff = (pricing.centsPerXmr - market) * 10_000n;
    const abs = ((diff < 0n ? -diff : diff) * 2n + market) / (2n * market);
    bps = diff < 0n ? -abs : abs;
  }
  const abs = bps < 0n ? -bps : bps;
  const sign = bps > 0n ? '+' : bps < 0n ? '−' : '';
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}%`;
}

/** A clip line: "Above $500 the rate changes to $331.88." (`dir` up) or "Below $500.01 …" (down). */
export interface Clip {
  dir: 'up' | 'down';
  at: string;
  rate: string;
}

/**
 * Where the price clips around the band the amount is in: the next band up and the next band down,
 * each at its own price (the markup always: these are the rates a trade would lock). None outside
 * a band, and none for a neighbour whose rate is not known.
 */
export function clipLines(bands: readonly Band[], at: BandAt | null, currency: string, market: bigint | null): Clip[] {
  if (at?.kind !== 'in') return [];
  const band = bands[at.index]!;
  const out: Clip[] = [];
  const up = bands[at.index + 1];
  const upRate = up && bandRate(up, currency, market, true);
  if (upRate) out.push({ dir: 'up', at: whole(band.toFiatCents, currency), rate: formatMinor(upRate.centsPerXmr, currency) });
  const down = bands[at.index - 1];
  const downRate = down && bandRate(down, currency, market, true);
  if (downRate) out.push({ dir: 'down', at: whole(band.fromFiatCents, currency), rate: formatMinor(downRate.centsPerXmr, currency) });
  return out;
}
