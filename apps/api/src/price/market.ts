import type { Price } from '@x2f/trade';
import { CURRENCY_EXPONENTS, currencyExponent } from './currencies.js';
import { PRICE_FEED_DEFAULTS, type FeedQuote, type PriceFeed, type PriceSourceHealth } from './feed.js';
import { FX_DEFAULTS, RATE_SCALE, type FxHealth, type FxRate, type FxRates } from './fx.js';
import { createAlertGrouper, type PriceAlert } from './health.js';

/**
 * The market price of every currency (spec 11.6, owner 2026-10-24): the XMR/USD median times the
 * USD→X exchange rate in use. No XMR/USD price pauses every currency; no fresh rate pauses only
 * that currency. A paused currency has no market price; fixed-price offers do not use this.
 */

export interface MarketQuote extends FeedQuote {
  /** The XMR/USD median the local price was made from (US cents per XMR): its USD value. */
  usdCentsPerXmr: bigint;
  /** The exchange rate used; null for USD. */
  fx: FxRate | null;
}

export interface PriceHealthView {
  xmr: PriceSourceHealth[];
  fx: FxHealth;
  /** Currencies with no market price right now, sorted. */
  paused: string[];
}

export interface MarketPrices {
  current(currency: string): Price | null;
  /** The local price with its USD value, or null when that currency's market prices are paused. */
  quote(currency: string): MarketQuote | null;
  health(): PriceHealthView;
  /** Polls the XMR feed and the exchange rates once, then sends any alerts; never throws. */
  poll(): Promise<void>;
  /** Polls both now and then each on its own interval; the timers do not keep the process alive. */
  start(): void;
  stop(): Promise<void>;
}

export interface MarketOptions {
  xmr: PriceFeed;
  fx: FxRates;
  xmrPollMs?: number;
  fxPollMs?: number;
  /** The server clock, for the alerts' quiet period. */
  clock?: () => Date;
  /** Where price health alerts go (the owner's in-app alerts); a failure here never stops polling. */
  onAlert?: (a: PriceAlert) => void | Promise<void>;
}

export function createMarketPrices(o: MarketOptions): MarketPrices {
  const grouper = createAlertGrouper();
  const clock = o.clock ?? (() => new Date());
  let sending: Promise<void> = Promise.resolve();
  const timers: Array<ReturnType<typeof setInterval>> = [];
  const inFlight = new Set<Promise<void>>();

  function quote(currency: string): MarketQuote | null {
    const exponent = currencyExponent(currency);
    if (exponent === null) return null;
    const usd = o.xmr.quote('USD');
    if (!usd) return null;
    const usdCents = usd.price.centsPerXmr;
    if (currency === 'USD') return { ...usd, usdCentsPerXmr: usdCents, fx: null };
    const fx = o.fx.rate(currency);
    if (!fx) return null;
    // usdCents / 100 × rate / RATE_SCALE × 10^exponent minor units, half up.
    const den = 100n * RATE_SCALE;
    const cents = (usdCents * fx.rate * 10n ** BigInt(exponent) * 2n + den) / (2n * den);
    if (cents <= 0n) return null;
    return { price: { currency, centsPerXmr: cents }, at: usd.at, sources: usd.sources, exponent, usdCentsPerXmr: usdCents, fx };
  }

  function health(): PriceHealthView {
    const paused = Object.keys(CURRENCY_EXPONENTS).filter((c) => quote(c) === null).sort();
    return { xmr: o.xmr.sources(), fx: o.fx.health(), paused };
  }

  /** After a poll: compares health with the last time and queues the alerts, in order. */
  function evaluate(): Promise<void> {
    if (!o.xmr.polled() || !o.fx.polled()) return sending;
    const alerts = grouper.update({ at: clock(), ...health() });
    const sink = o.onAlert;
    if (sink) {
      for (const a of alerts) {
        // A lost alert cannot be retried without double-sending; the condition stays in health().
        sending = sending.then(() => sink(a)).catch(() => undefined);
      }
    }
    return sending;
  }

  function track(p: Promise<void>): Promise<void> {
    inFlight.add(p);
    return p.finally(() => inFlight.delete(p));
  }

  return {
    quote,
    current: (currency) => quote(currency)?.price ?? null,
    health,
    poll: () => track(Promise.all([o.xmr.poll(), o.fx.poll()]).then(evaluate)),
    start() {
      if (timers.length > 0) return;
      void track(Promise.all([o.xmr.poll(), o.fx.poll()]).then(evaluate));
      const every = (ms: number, poll: () => Promise<void>) => {
        const t = setInterval(() => void track(poll().then(evaluate)), ms);
        t.unref?.();
        timers.push(t);
      };
      every(o.xmrPollMs ?? PRICE_FEED_DEFAULTS.pollMs, () => o.xmr.poll());
      every(o.fxPollMs ?? FX_DEFAULTS.pollMs, () => o.fx.poll());
    },
    async stop() {
      for (const t of timers.splice(0)) clearInterval(t);
      await Promise.all([...inFlight]);
      await sending;
    },
  };
}
