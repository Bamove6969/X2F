// The quote as BuyQuote and SellQuote show it (plan Task 18, spec 2.2 step 3). Kept free of React so
// the unit tests and the Playwright stubs share it. Every money figure comes from @x2f/trade (Task 1):
// the rate from offerRate, XMR for a fiat amount from atomicForFiat, the fiat total from fiatCents
// and what the seller locks from escrowPlan. This file only reads what the person typed and picks
// which of those results to show; it does no money maths of its own.
import { atomicForFiat, escrowPlan, fiatCents, formatXmr, formatXmrExact, offerRate, posterRole, type Price, type Pricing } from '@x2f/trade';

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
  poster: { displayName: string; stage: Stage };
  pricing: Pricing;
  minFiatCents: bigint;
  maxFiatCents: bigint;
  minTrades: number;
  /** Set by the API for a signed-in viewer whose cap is below the offer's minimum (Revision 2026-10-24). */
  opensAt?: OpensAt;
}

/**
 * `GET /v1/price` for the offer's currency: the market price in the currency's minor units, the
 * currency's ISO 4217 exponent (how many decimals a minor unit is: 0 for JPY, 3 for KWD, 2 for
 * most; Revision 2026-10-20) and the same XMR in US-dollar cents.
 */
export interface MarketNow {
  centsPerXmr: bigint;
  exponent: number;
  usdCentsPerXmr: bigint | null;
}

/**
 * The currency's exponent from the currency itself (Intl's ISO 4217 table), for a fixed-price offer
 * quoting with the feed down; 2 for a code Intl does not know.
 */
export function currencyExponent(currency: string): number {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** The exponent every fiat figure of this quote uses: the feed's when it is up, else the currency's own. */
export function quoteExponent(offer: Pick<QuoteOffer, 'currency'>, market: MarketNow | null): number {
  return market?.exponent ?? currencyExponent(offer.currency);
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

const XMR_DECIMALS = 12;

/**
 * What the person typed, in the currency's minor units (fiat, `exponent` places: cents for USD,
 * whole yen for JPY) or atomic units (XMR, 12 places); null unless it is a plain non-negative
 * decimal with at most that many places. Thousands commas and spaces are ignored.
 */
export function parseAmount(text: string, unit: Unit, exponent = 2): bigint | null {
  const t = text.replace(/[,\s]/g, '');
  const m = /^(\d{0,15})(?:\.(\d*))?$/.exec(t);
  if (!m) return null;
  const whole = m[1] ?? '';
  const frac = m[2] ?? '';
  if (whole === '' && frac === '') return null;
  const places = unit === 'xmr' ? XMR_DECIMALS : exponent;
  if (frac.length > places) return null;
  return BigInt(whole === '' ? '0' : whole) * 10n ** BigInt(places) + BigInt(frac.padEnd(places, '0') || '0');
}

export function quote(i: { offer: QuoteOffer; market: MarketNow | null; text: string; unit: Unit }): Quote {
  const { offer, market, text, unit } = i;
  if (offer.opensAt !== undefined) return { kind: 'opens-at', stage: offer.opensAt };
  const rate = offerRate(offer.pricing, offer.currency, market ? { currency: offer.currency, centsPerXmr: market.centsPerXmr } : null);
  if (rate === null) return { kind: 'price-unavailable' };

  const typed = parseAmount(text, unit, quoteExponent(offer, market));
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

/**
 * The XMR figure as shown: exactly what is sent. The board's 6 places, and more (up to all 12) only
 * when the amount has non-zero digits past the sixth, so 1.0000009 typed on SellQuote is never
 * shown as "1.000000" (Task 18 review, item 5). The rule is @x2f/trade formatXmrExact, which every
 * figure the user must send uses.
 */
export const xmrText = formatXmrExact;

/**
 * Minor units as a currency string with `exponent` decimals: 41250n USD → "$412.50", 41250n JPY
 * (exponent 0) → "¥41,250", 1234n KWD (3) → "KWD 1.234". Exact for any bigint: the whole part is
 * formatted as a bigint and the fraction written in by hand (@x2f/trade formatFiat does the same
 * for 2 decimals).
 */
export function formatMinor(minor: bigint, currency: string, exponent: number): string {
  const unit = 10n ** BigInt(exponent);
  const whole = minor / unit;
  const frac = (minor % unit).toString().padStart(exponent, '0');
  const nf = new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: exponent, maximumFractionDigits: exponent });
  return nf
    .formatToParts(whole)
    .map((p) => (p.type === 'fraction' ? frac : p.value))
    .join('');
}

/** Money with no fraction shown when it is zero: the board's "$50 to $1,500". */
export function fiatWhole(minor: bigint, currency: string, exponent = 2): string {
  const s = formatMinor(minor, currency, exponent);
  return exponent > 0 && minor % 10n ** BigInt(exponent) === 0n ? s.replace(new RegExp(`\\.0{${exponent}}(?=\\D*$)`), '') : s;
}

/** The currency's sign for the amount box ("$" on the board). */
export function currencySign(currency: string): string {
  return formatMinor(0n, currency, 0).replace(/[\d.,\s-]/g, '');
}

/**
 * The text Max puts in the amount box for `fiatMinorMax`: the minor units as a plain decimal with
 * `exponent` places, or the XMR that buys at most that much at `rate` (atomicForFiat floors,
 * formatXmr truncates).
 */
export function amountText(fiatMinorMax: bigint, unit: Unit, rate: Price, exponent = 2): string {
  if (unit === 'fiat') {
    const u = 10n ** BigInt(exponent);
    return exponent === 0 ? `${fiatMinorMax}` : `${fiatMinorMax / u}.${(fiatMinorMax % u).toString().padStart(exponent, '0')}`;
  }
  return formatXmr(atomicForFiat(fiatMinorMax, rate));
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
