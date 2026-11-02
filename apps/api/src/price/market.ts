import type { Price } from '@x2f/trade';
import { DEFAULT_PRICE_ROUTES, createPriceChain, priceRoutesFor, type PriceRouteName, type RouteQuote } from './chain.js';
import { PRICE_FEED_DEFAULTS, type PriceFeed, type PriceSourceHealth } from './feed.js';
import { FX_DEFAULTS, type FxHealth, type FxRates } from './fx.js';
import { createAlertGrouper, type PriceAlert } from './health.js';

/**
 * The market price of every currency (spec 11.6, owner 2026-10-24): the XMR/USD median times the
 * USD→X exchange rate in use. No XMR/USD price pauses every currency; no fresh rate pauses only
 * that currency. A paused currency has no market price; fixed-price offers do not use this.
 * Since 2026-11-02 that is the `market` route of a per-currency chain (chain.ts): with more routes
 * configured (`PRICE_ROUTES`), a currency the market route cannot price falls back to the next.
 */

/**
 * The local price with its USD value and the exchange rate used (null for USD or a route without one).
 * `route` names the route that priced it; always set by `createMarketPrices`, optional so that
 * hand-made quotes (test fakes, other branches) keep type-checking.
 */
export interface MarketQuote extends RouteQuote {
  route?: string;
}

export interface PriceHealthView {
  xmr: PriceSourceHealth[];
  fx: FxHealth;
  /** Currencies with no market price right now, sorted. */
  paused: string[];
  /** Every supported currency (sorted) with the route pricing it right now, or null (paused). */
  coverage: Array<{ currency: string; route: string | null }>;
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
  /** `PRICE_ROUTES`: the routes tried per currency, in order (default: the market route only). */
  routes?: readonly PriceRouteName[];
  /** `PRICE_ROUTE_MAX_GAP_PCT` in basis points: routes further apart leave the currency unpriced. Unset: off. */
  maxGapBps?: number | null;
  /**
   * Where a lost alert is reported: one fixed line with the error's message only (never the error
   * object, whose pg `detail` can quote row values, and never the alert's detail).
   */
  log?: { error(obj: { error: string }, msg: string): void };
}

export function createMarketPrices(o: MarketOptions): MarketPrices {
  const grouper = createAlertGrouper();
  const clock = o.clock ?? (() => new Date());
  let sending: Promise<void> = Promise.resolve();
  const timers: Array<ReturnType<typeof setInterval>> = [];
  const inFlight = new Set<Promise<void>>();

  // The chain's own age check runs on the server clock (the real time when none is given; review M6).
  const chain = createPriceChain(priceRoutesFor(o.routes ?? DEFAULT_PRICE_ROUTES, o.xmr, o.fx), {
    clock,
    maxGapBps: o.maxGapBps ?? null,
  });
  const quote = (currency: string): MarketQuote | null => chain.quote(currency);

  function health(): PriceHealthView {
    const coverage = chain.coverage();
    const paused = coverage.filter((c) => c.route === null).map((c) => c.currency);
    return { xmr: o.xmr.sources(), fx: o.fx.health(), paused, coverage };
  }

  /** After a poll: compares health with the last time and queues the alerts, in order (not awaited here). */
  function evaluate(): void {
    if (!o.xmr.polled() || !o.fx.polled()) return;
    const alerts = grouper.update({ at: clock(), ...health() });
    const sink = o.onAlert;
    if (sink) {
      for (const a of alerts) {
        // A lost alert cannot be retried without double-sending; the condition stays in health().
        sending = sending
          .then(() => sink(a))
          .catch((err: unknown) =>
            o.log?.error({ error: err instanceof Error ? err.message : 'unknown' }, 'price alert not delivered'),
          );
      }
    }
  }

  function track(p: Promise<void>): Promise<void> {
    inFlight.add(p);
    return p.finally(() => inFlight.delete(p));
  }

  return {
    quote,
    current: (currency) => quote(currency)?.price ?? null,
    health,
    // poll() waits for its alerts too (callers and tests see them sent); the timers' polls do not.
    poll: () => track(Promise.all([o.xmr.poll(), o.fx.poll()]).then(evaluate)).then(() => sending),
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
      await Promise.all([...inFlight]); // the polls in flight queue their alerts…
      await sending; // …which are sent before stop() returns
    },
  };
}
