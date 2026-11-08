// An offer's size bands (owner 2026-11-06 Q23/Q27: up to 3 amount bands per currency, each with its
// own price and fewest trades) and the words for its range and price. The offers card (OfferCard.tsx)
// and the quote (quote/QuoteBands.tsx) both read this file, so what the two screens say about an
// offer's ranges and prices never disagree (owner 2026-11-08: the quote carries the bands over).
//
// The API sends one range and one price per offer today (Task 4 `OfferCard`), so `offerBands` gives
// one band: the offer's min to max at its price. When bands reach the API (FlexOffer-Post, not built),
// `offerBands` is the one place that reads them; the rest already handles several.
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

/**
 * Where the price clips for the amount typed (`at`; null with no amount yet): where this band's
 * price ends and what the next band asks, or which edge of the offer the amount is past.
 * COPY-UNSIGNED, DESIGNER-REVIEW (owner 2026-11-08 asked for the bands on the quote; no board yet).
 */
export function bandClip(bands: readonly Band[], at: BandAt | null, currency: string, market: bigint | null, favourable: (sign: number) => boolean): string {
  const first = bands[0]!;
  const last = bands[bands.length - 1]!;
  if (at === null) return `${rangeText(first.fromFiatCents, last.toFiatCents, currency)} per trade.`;
  if (at.kind === 'below') return `Your amount is below ${whole(first.fromFiatCents, currency)}, the smallest trade.`;
  if (at.kind === 'above') return `Your amount is above ${whole(last.toFiatCents, currency)}, the largest trade.`;
  if (at.kind === 'between') return 'No band covers your amount.';
  const band = bands[at.index]!;
  const next = bands[at.index + 1];
  if (next === undefined) return `Up to ${whole(band.toFiatCents, currency)} at this price, the largest trade.`;
  return `Up to ${whole(band.toFiatCents, currency)} at this price. Above it: ${marginText(next.pricing, currency, market, favourable).text}.`;
}
