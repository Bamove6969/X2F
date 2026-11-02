import { CURRENCY_EXPONENTS, currencyExponent } from './currencies.js';
import { PRICE_FEED_DEFAULTS, type FeedQuote, type PriceFeed } from './feed.js';
import { RATE_SCALE, type FxRate, type FxRates } from './fx.js';

/**
 * Several price feeds with a per-currency fallback (owner 2026-11-02; plan note
 * docs/superpowers/specs/2026-11-02-price-feeds.md). A price ROUTE is one way to get XMR's price in a
 * currency. Per currency the routes are tried in a fixed order and the first with a fresh, sane quote
 * wins: never an average across routes, the rule the owner set for exchange rates (2026-10-24). A
 * currency no route prices has NO price, and only that currency.
 */

/** One route's market quote for a currency: the price, its time, and the same XMR's US-dollar value. */
export interface RouteQuote extends FeedQuote {
  /** The XMR/USD median the price goes with (US cents per XMR): its USD value. */
  usdCentsPerXmr: bigint;
  /** The exchange rate used; null for USD and for routes that use none (`direct`). */
  fx: FxRate | null;
}

export interface PriceRoute {
  name: string;
  /** XMR's price in `currency`, or null when this route has none; may throw (counted as none). */
  quote(currency: string): RouteQuote | null;
}

/** The chain's answer: a route's quote and which route gave it. */
export interface ChainQuote extends RouteQuote {
  route: string;
}

export interface PriceChain {
  /** The first route's fresh, sane quote for `currency`, or null: that currency has no price. */
  quote(currency: string): ChainQuote | null;
  /** Every supported currency (sorted) with the route pricing it right now, or null. */
  coverage(): Array<{ currency: string; route: string | null }>;
}

export interface ChainOptions {
  /** A route's quote older than this is refused (default: the XMR feed's limit, 5 min). Always on. */
  maxAgeMs?: number;
  /**
   * When set: if any other route also prices the currency and differs from the chosen price by more
   * than this (basis points of the smaller), the currency has no price (fail closed). Unset: off.
   */
  maxGapBps?: number | null;
  /** The server clock; the real time when not given (the age check never switches off; review M6). */
  clock?: () => Date;
}

/** Further apart than `bps` of the smaller value (symmetric: a value too small by any factor is far). */
export function farApart(a: bigint, b: bigint, bps: number): boolean {
  const lo = a < b ? a : b;
  const diff = a > b ? a - b : b - a;
  return diff * 10_000n > lo * BigInt(bps);
}

export function createPriceChain(routes: readonly PriceRoute[], o: ChainOptions = {}): PriceChain {
  const clock = o.clock ?? (() => new Date());
  const maxAgeMs = o.maxAgeMs ?? PRICE_FEED_DEFAULTS.maxAgeMs;
  const maxGapBps = o.maxGapBps ?? null;

  function sane(q: RouteQuote | null, currency: string, exponent: number, now: number): q is RouteQuote {
    if (q === null || typeof q !== 'object' || !q.price || q.price.currency !== currency || q.exponent !== exponent) return false;
    if (typeof q.price.centsPerXmr !== 'bigint' || q.price.centsPerXmr <= 0n) return false;
    if (typeof q.usdCentsPerXmr !== 'bigint' || q.usdCentsPerXmr <= 0n) return false;
    const at = q.at instanceof Date ? q.at.getTime() : Number.NaN;
    return Number.isFinite(at) && now - at <= maxAgeMs;
  }

  function ask(r: PriceRoute, currency: string): RouteQuote | null {
    try {
      return r.quote(currency);
    } catch {
      return null;
    }
  }

  function quote(currency: string): ChainQuote | null {
    const exponent = currencyExponent(currency);
    if (exponent === null) return null;
    const now = clock().getTime();
    let chosen: ChainQuote | null = null;
    for (const r of routes) {
      const q = ask(r, currency);
      if (!sane(q, currency, exponent, now)) continue;
      if (chosen === null) {
        chosen = { ...q, route: r.name };
        if (maxGapBps === null) return chosen; // no cross-check: later routes are not asked
      } else if (farApart(chosen.price.centsPerXmr, q.price.centsPerXmr, maxGapBps!)) {
        return null;
      }
    }
    return chosen;
  }

  return {
    quote,
    coverage: () => Object.keys(CURRENCY_EXPONENTS).sort().map((currency) => ({ currency, route: quote(currency)?.route ?? null })),
  };
}

/**
 * The `market` route (spec 11.6, owner 2026-10-24): the XMR/USD median times the USD→X exchange rate
 * in use. No XMR/USD price: nothing; no fresh rate for X: nothing for X.
 */
export function marketRoute(xmr: PriceFeed, fx: FxRates): PriceRoute {
  return {
    name: 'market',
    quote(currency) {
      const exponent = currencyExponent(currency);
      if (exponent === null) return null;
      const usd = xmr.quote('USD');
      if (!usd) return null;
      const usdCents = usd.price.centsPerXmr;
      if (currency === 'USD') return { ...usd, usdCentsPerXmr: usdCents, fx: null };
      const rate = fx.rate(currency);
      if (!rate) return null;
      // usdCents / 100 × rate / RATE_SCALE × 10^exponent minor units, half up.
      const den = 100n * RATE_SCALE;
      const cents = (usdCents * rate.rate * 10n ** BigInt(exponent) * 2n + den) / (2n * den);
      if (cents <= 0n) return null;
      return { price: { currency, centsPerXmr: cents }, at: usd.at, sources: usd.sources, exponent, usdCentsPerXmr: usdCents, fx: rate };
    },
  };
}

/**
 * The `direct` route: XMR/X straight from the XMR sources that quote X (Kraken: EUR; CoinGecko: every
 * currency), under the feed's median rules (at least `minSources` agreeing). It still needs the
 * XMR/USD median for the USD value (Task 34 Q9), so it covers an exchange-rate outage, not an XMR one.
 * Dated by the older of the two medians.
 */
export function directRoute(xmr: PriceFeed): PriceRoute {
  return {
    name: 'direct',
    quote(currency) {
      if (currencyExponent(currency) === null) return null;
      const usd = xmr.quote('USD');
      if (!usd) return null;
      const d = currency === 'USD' ? usd : xmr.quote(currency);
      if (!d) return null;
      const at = d.at.getTime() <= usd.at.getTime() ? d.at : usd.at;
      return { ...d, at, usdCentsPerXmr: usd.price.centsPerXmr, fx: null };
    },
  };
}

/** The routes `PRICE_ROUTES` can name, by name. */
export const PRICE_ROUTE_NAMES = ['market', 'direct'] as const;
export type PriceRouteName = (typeof PRICE_ROUTE_NAMES)[number];

/** The default `PRICE_ROUTES`: the market route only (today's behaviour; enabling more is owner call OC1). */
export const DEFAULT_PRICE_ROUTES: readonly PriceRouteName[] = Object.freeze(['market']);

/** The named routes over the given feeds, in the given order. */
export function priceRoutesFor(names: readonly PriceRouteName[], xmr: PriceFeed, fx: FxRates): PriceRoute[] {
  return names.map((n) => (n === 'market' ? marketRoute(xmr, fx) : directRoute(xmr)));
}

/** `PRICE_ROUTES`: comma-separated route names, each known and once, market first; unset or empty: the default. */
export function parsePriceRoutes(raw: string | undefined): PriceRouteName[] {
  if (raw === undefined || raw.trim() === '') return [...DEFAULT_PRICE_ROUTES];
  const out: PriceRouteName[] = [];
  for (const n of raw.split(',').map((s) => s.trim())) {
    const known = PRICE_ROUTE_NAMES.find((k) => k === n);
    if (!known || out.includes(known)) {
      throw new Error(`config: PRICE_ROUTES is malformed (comma-separated, each once, in order, from: ${PRICE_ROUTE_NAMES.join(', ')})`);
    }
    out.push(known);
  }
  // Review M1, fail closed: the market route (the owner's 2026-10-24 design) always comes first; a
  // backup route only after it. Relaxing this is part of owner call OC1.
  if (out[0] !== 'market') throw new Error('config: PRICE_ROUTES must start with market (direct only after it)');
  return out;
}

/** `PRICE_ROUTE_MAX_GAP_PCT`: a whole percent 1..50, as basis points; unset or empty: off (null). */
export function parsePriceRouteMaxGap(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const t = raw.trim();
  const n = /^\d{1,2}$/.test(t) ? Number(t) : Number.NaN;
  if (!Number.isInteger(n) || n < 1 || n > 50) throw new Error('config: PRICE_ROUTE_MAX_GAP_PCT is malformed (a whole percent from 1 to 50)');
  return n * 100;
}
