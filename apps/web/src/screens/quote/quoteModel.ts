// The quote as BuyQuote and SellQuote show it (plan Task 18, spec 2.2 step 3). Kept free of React so
// the unit tests and the Playwright stubs share it. Every money figure comes from @x2f/trade (Task 1):
// the rate from offerRate, XMR for a fiat amount from atomicForFiat, the fiat total from fiatCents
// and what the seller locks from escrowPlan. This file only reads what the person typed and picks
// which of those results to show; it does no money maths of its own.
import { atomicForFiat, escrowPlan, fiatCents, formatFiat, formatXmr, offerRate, posterRole, type Price, type Pricing } from '@x2f/trade';

/** The ad's side: a sell ad (the poster sells XMR, the taker buys: BuyQuote) or a buy ad (SellQuote). */
export type AdSide = 'sell' | 'buy';
export type Stage = 'starter' | 'building' | 'graduated';
export type OpensAt = 'building' | 'graduated';
export type Unit = 'fiat' | 'xmr';

/** The offer fields a quote reads (Task 4 `OfferCard`, plus the side and currency it was listed under). */
export interface QuoteOffer {
  id: string;
  side: AdSide;
  currency: string;
  /** Public fields only: the poster's display name (spec 6.1) and stage. */
  poster: { username: string; stage: Stage };
  pricing: Pricing;
  minFiatCents: bigint;
  maxFiatCents: bigint;
  minTrades: number;
  /** Set by the API for a signed-in viewer whose cap is below the offer's minimum (Revision 2026-10-24). */
  opensAt?: OpensAt;
}

/** `GET /v1/price` for the offer's currency: the market price and the same XMR in US-dollar cents. */
export interface MarketNow {
  centsPerXmr: bigint;
  usdCentsPerXmr: bigint | null;
}

export type Quote =
  /** A market-priced offer while the feed is down or stale (Review Focus 5, spec 11.6). */
  | { kind: 'price-unavailable' }
  /** The viewer's starter-limits stage is below the offer's minimum (spec 2.3). */
  | { kind: 'opens-at'; stage: OpensAt }
  /** Nothing readable typed yet. */
  | { kind: 'enter'; rate: Price }
  | { kind: 'too-low'; rate: Price }
  | { kind: 'too-high'; rate: Price }
  | {
      kind: 'ok';
      rate: Price;
      /** The trade amount sent to take. */
      amountAtomic: bigint;
      /** The fiat total, exactly as Task 5 stores it at take (OD-5). */
      fiatCents: bigint;
      /** What a taking buyer receives: the whole amount (the taker pays no X2F fee). */
      receiveAtomic: bigint;
      /** What a taking seller locks in escrow (escrowPlan; on a buy ad that is the amount). */
      sellerFundsAtomic: bigint;
      /** The total's US-dollar value beside a non-USD trade (spec 11.6); null for USD or with no feed. */
      usdCents: bigint | null;
      /** The rate's US-dollar value per XMR beside a non-USD trade; null for USD or with no feed. */
      usdPerXmrCents: bigint | null;
    };

const DECIMALS: Record<Unit, number> = { fiat: 2, xmr: 12 };

/**
 * What the person typed, in cents (fiat) or atomic units (XMR); null unless it is a plain
 * non-negative decimal with at most 2 (fiat) or 12 (XMR) places. Thousands commas and spaces are
 * ignored.
 */
export function parseAmount(text: string, unit: Unit): bigint | null {
  const t = text.replace(/[,\s]/g, '');
  const m = /^(\d{0,15})(?:\.(\d*))?$/.exec(t);
  if (!m) return null;
  const whole = m[1] ?? '';
  const frac = m[2] ?? '';
  if (whole === '' && frac === '') return null;
  const places = DECIMALS[unit];
  if (frac.length > places) return null;
  return BigInt(whole === '' ? '0' : whole) * 10n ** BigInt(places) + BigInt(frac.padEnd(places, '0') || '0');
}

export function quote(i: { offer: QuoteOffer; market: MarketNow | null; text: string; unit: Unit }): Quote {
  const { offer, market, text, unit } = i;
  if (offer.opensAt !== undefined) return { kind: 'opens-at', stage: offer.opensAt };
  const rate = offerRate(offer.pricing, offer.currency, market ? { currency: offer.currency, centsPerXmr: market.centsPerXmr } : null);
  if (rate === null) return { kind: 'price-unavailable' };

  const typed = parseAmount(text, unit);
  if (typed === null || typed === 0n) return { kind: 'enter', rate };
  const amountAtomic = unit === 'fiat' ? atomicForFiat(typed, rate) : typed;
  if (amountAtomic === 0n) return { kind: 'too-low', rate };
  const total = fiatCents(amountAtomic, rate);
  if (total < offer.minFiatCents) return { kind: 'too-low', rate };
  if (total > offer.maxFiatCents) return { kind: 'too-high', rate };

  // The US-dollar figures are the trade's own figures (at the offer's rate, margin or fixed price
  // included) converted at the exchange rate the feed implies, usdCentsPerXmr / centsPerXmr: never
  // the raw market XMR/USD, which would leave out the margin (Task 18 review, item 3).
  const toUsd = offer.currency !== 'USD' && market?.usdCentsPerXmr != null ? (cents: bigint) => mulDivHalfUp(cents, market.usdCentsPerXmr!, market.centsPerXmr) : null;
  return {
    kind: 'ok',
    rate,
    amountAtomic,
    fiatCents: total,
    receiveAtomic: amountAtomic,
    sellerFundsAtomic: escrowPlan({ amountAtomic, poster: posterRole(offer.side) }).sellerFundsAtomic,
    usdCents: toUsd ? toUsd(total) : null,
    usdPerXmrCents: toUsd ? toUsd(rate.centsPerXmr) : null,
  };
}

/** a * b / d, rounded half up (bigint only; the same rounding as the rest of the quote). */
function mulDivHalfUp(a: bigint, b: bigint, d: bigint): bigint {
  return (a * b + d / 2n) / d;
}

/** Money with no cents shown when there are none: the board's "$50 to $1,500". */
export function fiatWhole(cents: bigint, currency: string): string {
  const s = formatFiat(cents, currency);
  return cents % 100n === 0n ? s.replace(/\.00(?=\D*$)/, '') : s;
}

/** The currency's sign for the amount box ("$" on the board), from formatFiat. */
export function currencySign(currency: string): string {
  return formatFiat(0n, currency).replace(/[\d.,\s-]/g, '');
}

/**
 * The text Max puts in the amount box for `fiatCentsMax`: the cents as a plain decimal, or the XMR
 * that buys at most that much at `rate` (atomicForFiat floors, formatXmr truncates).
 */
export function amountText(fiatCentsMax: bigint, unit: Unit, rate: Price): string {
  if (unit === 'fiat') return `${fiatCentsMax / 100n}.${(fiatCentsMax % 100n).toString().padStart(2, '0')}`;
  return formatXmr(atomicForFiat(fiatCentsMax, rate));
}

export const STAGE_NAMES: Record<Stage, string> = { starter: 'Starter', building: 'Building', graduated: 'Graduated' };

/**
 * The quote for an offer card's Trade (Tasks 16 and 17 navigate here): `/buy/<method>/<offer>` for
 * a sell ad (BuyQuote), `/sell/<method>/<offer>` for a buy ad (SellQuote).
 */
export function quotePath(adSide: AdSide, methodId: string, offerId: string, currency: string): string {
  const viewer = adSide === 'sell' ? 'buy' : 'sell';
  return `/${viewer}/${encodeURIComponent(methodId)}/${encodeURIComponent(offerId)}?${new URLSearchParams({ currency })}`;
}
