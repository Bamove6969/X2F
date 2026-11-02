import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import {
  DEFAULT_PRICE_ROUTES, PRICE_ROUTE_NAMES, createPriceChain, directRoute, parsePriceRouteMaxGap, parsePriceRoutes,
  type PriceRoute, type RouteQuote,
} from '../src/price/chain.js';
import { CURRENCY_EXPONENTS } from '../src/price/currencies.js';
import { PRICE_FEED_DEFAULTS, createPriceFeed, type PriceQuote, type PriceSource } from '../src/price/feed.js';
import {
  CANDIDATE_FX_SOURCE_NAMES, DEFAULT_FX_SOURCES, RATE_SCALE, createFxRates, decimalToScaled, fxSources, parseFxSources, type FxSource,
} from '../src/price/fx.js';
import { createMarketPrices } from '../src/price/market.js';
import { CANDIDATE_PRICE_SOURCE_NAMES, DEFAULT_PRICE_SOURCES, parsePriceSources, priceSources } from '../src/price/sources.js';
import { VAPID_ENV } from './helpers/vapid.js';

/**
 * Several price feeds with a per-currency fallback (docs/superpowers/specs/2026-11-02-price-feeds.md).
 * Every feed here is a fake: no test touches the network.
 */

const T0 = new Date('2026-11-02T06:00:00Z');
const MIN = 60_000;

function clockAt(start: Date) {
  let now = start;
  return { clock: () => now, set: (d: Date) => void (now = d), advance: (ms: number) => void (now = new Date(now.getTime() + ms)) };
}

const rq = (currency: string, cents: bigint, over: Partial<RouteQuote> = {}): RouteQuote => ({
  price: { currency, centsPerXmr: cents },
  at: T0,
  sources: 2,
  exponent: CURRENCY_EXPONENTS[currency]!,
  usdCentsPerXmr: 30_000n,
  fx: null,
  ...over,
});

/** A route answering from a table (currency -> quote), counting its calls. */
function fakeRoute(name: string, table: Record<string, RouteQuote | null | Error>): PriceRoute & { calls: string[] } {
  const calls: string[] = [];
  return {
    name,
    calls,
    quote(currency) {
      calls.push(currency);
      const v = table[currency];
      if (v instanceof Error) throw v;
      return v ?? null;
    },
  };
}

describe('createPriceChain', () => {
  const c = clockAt(T0);
  const opts = { clock: c.clock };

  it('uses the first route that has the currency, and says which', () => {
    const a = fakeRoute('a', { EUR: rq('EUR', 27_000n) });
    const b = fakeRoute('b', { EUR: rq('EUR', 27_100n), GBP: rq('GBP', 23_000n) });
    const chain = createPriceChain([a, b], opts);
    expect(chain.quote('EUR')).toMatchObject({ route: 'a', price: { currency: 'EUR', centsPerXmr: 27_000n } });
    expect(chain.quote('GBP')).toMatchObject({ route: 'b', price: { currency: 'GBP', centsPerXmr: 23_000n } });
  });

  it('has no price for a currency no route covers, and only for that currency', () => {
    const chain = createPriceChain([fakeRoute('a', { EUR: rq('EUR', 27_000n) })], opts);
    expect(chain.quote('JPY')).toBeNull();
    expect(chain.quote('EUR')).not.toBeNull();
  });

  it('never asks a route about an unsupported currency', () => {
    const a = fakeRoute('a', {});
    const chain = createPriceChain([a], opts);
    expect(chain.quote('XXX')).toBeNull();
    expect(chain.quote('usd')).toBeNull();
    expect(a.calls).toEqual([]);
  });

  it('treats a route that throws as having no price and falls back', () => {
    const chain = createPriceChain([fakeRoute('a', { EUR: new Error('boom') }), fakeRoute('b', { EUR: rq('EUR', 27_100n) })], opts);
    expect(chain.quote('EUR')).toMatchObject({ route: 'b' });
  });

  it('skips a quote older than the XMR feed limit (5 min) and falls back', () => {
    const old = new Date(T0.getTime() - PRICE_FEED_DEFAULTS.maxAgeMs - 1);
    const chain = createPriceChain([fakeRoute('a', { EUR: rq('EUR', 27_000n, { at: old }) }), fakeRoute('b', { EUR: rq('EUR', 27_100n) })], opts);
    expect(chain.quote('EUR')).toMatchObject({ route: 'b' });
    const edge = new Date(T0.getTime() - PRICE_FEED_DEFAULTS.maxAgeMs);
    expect(createPriceChain([fakeRoute('a', { EUR: rq('EUR', 27_000n, { at: edge }) })], opts).quote('EUR')).toMatchObject({ route: 'a' });
  });

  it.each([
    ['a zero price', rq('EUR', 0n)],
    ['a negative price', rq('EUR', -1n)],
    ['no USD value', rq('EUR', 27_000n, { usdCentsPerXmr: 0n })],
    ['another currency', rq('GBP', 23_000n)],
    ['a wrong exponent', rq('EUR', 27_000n, { exponent: 0 })],
    ['an invalid time', rq('EUR', 27_000n, { at: new Date(Number.NaN) })],
  ])('refuses %s from a route and falls back', (_what, bad) => {
    const chain = createPriceChain([fakeRoute('a', { EUR: bad }), fakeRoute('b', { EUR: rq('EUR', 27_100n) })], opts);
    expect(chain.quote('EUR')).toMatchObject({ route: 'b', price: { centsPerXmr: 27_100n } });
  });

  it('by default does not compare routes: the first wins however far the next is', () => {
    const chain = createPriceChain([fakeRoute('a', { EUR: rq('EUR', 27_000n) }), fakeRoute('b', { EUR: rq('EUR', 54_000n) })], opts);
    expect(chain.quote('EUR')).toMatchObject({ route: 'a', price: { centsPerXmr: 27_000n } });
  });

  describe('with a gap limit between routes', () => {
    const gap = { ...opts, maxGapBps: 300 };
    it('uses the first when every other route is within the limit', () => {
      const chain = createPriceChain([fakeRoute('a', { EUR: rq('EUR', 10_000n) }), fakeRoute('b', { EUR: rq('EUR', 10_300n) })], gap);
      expect(chain.quote('EUR')).toMatchObject({ route: 'a', price: { centsPerXmr: 10_000n } });
    });
    it('has NO price when another route is further than the limit (either direction)', () => {
      expect(createPriceChain([fakeRoute('a', { EUR: rq('EUR', 10_000n) }), fakeRoute('b', { EUR: rq('EUR', 10_301n) })], gap).quote('EUR')).toBeNull();
      // Measured against the smaller value, so a price too small by any factor is refused too.
      expect(createPriceChain([fakeRoute('a', { EUR: rq('EUR', 10_000n) }), fakeRoute('b', { EUR: rq('EUR', 9_708n) })], gap).quote('EUR')).toBeNull();
      expect(createPriceChain([fakeRoute('a', { EUR: rq('EUR', 10_000n) }), fakeRoute('b', { EUR: rq('EUR', 1n) })], gap).quote('EUR')).toBeNull();
    });
    it('ignores routes with no (or a refused) price when comparing', () => {
      const old = new Date(T0.getTime() - PRICE_FEED_DEFAULTS.maxAgeMs - 1);
      const chain = createPriceChain(
        [fakeRoute('a', { EUR: rq('EUR', 10_000n) }), fakeRoute('b', { EUR: rq('EUR', 99_000n, { at: old }) }), fakeRoute('c', {})],
        gap,
      );
      expect(chain.quote('EUR')).toMatchObject({ route: 'a' });
    });
  });

  it('coverage lists every supported currency with its route or null', () => {
    const chain = createPriceChain([fakeRoute('a', { USD: rq('USD', 30_000n), EUR: rq('EUR', 27_000n) }), fakeRoute('b', { GBP: rq('GBP', 23_000n) })], opts);
    const cov = chain.coverage();
    expect(cov.map((x) => x.currency)).toEqual(Object.keys(CURRENCY_EXPONENTS).sort());
    expect(cov.find((x) => x.currency === 'USD')).toEqual({ currency: 'USD', route: 'a' });
    expect(cov.find((x) => x.currency === 'GBP')).toEqual({ currency: 'GBP', route: 'b' });
    expect(cov.find((x) => x.currency === 'JPY')).toEqual({ currency: 'JPY', route: null });
  });
});

// ---- The direct route and createMarketPrices with several routes, over fake sources ----

function xmrStub(name: string, quotes: () => PriceQuote[] | Error): PriceSource {
  return {
    name,
    async fetchQuotes() {
      const q = quotes();
      if (q instanceof Error) throw q;
      return q;
    },
  };
}
function fxStub(name: string, rates: () => Record<string, string> | Error): FxSource {
  return {
    name,
    async fetchRates() {
      const x = rates();
      if (x instanceof Error) throw x;
      return new Map(Object.entries(x).map(([k, v]) => [k, decimalToScaled(v)!]));
    },
  };
}
const q = (currency: string, cents: bigint): PriceQuote => ({ currency, centsPerXmr: cents });

describe('directRoute', () => {
  it('prices a currency from the XMR sources that quote it, with the USD median as its USD value', async () => {
    const c = clockAt(T0);
    const xmr = createPriceFeed(
      [xmrStub('a', () => [q('USD', 30_000n), q('EUR', 27_000n)]), xmrStub('b', () => [q('USD', 30_000n), q('EUR', 27_200n)])],
      { ...PRICE_FEED_DEFAULTS, clock: c.clock },
    );
    await xmr.poll();
    const r = directRoute(xmr);
    expect(r.name).toBe('direct');
    expect(r.quote('EUR')).toMatchObject({ price: { currency: 'EUR', centsPerXmr: 27_100n }, usdCentsPerXmr: 30_000n, fx: null, sources: 2, exponent: 2 });
    expect(r.quote('USD')).toMatchObject({ price: { currency: 'USD', centsPerXmr: 30_000n }, usdCentsPerXmr: 30_000n, fx: null });
    expect(r.quote('GBP')).toBeNull();
  });

  it('has no price with only one XMR source for that currency (the median needs 2)', async () => {
    const c = clockAt(T0);
    const xmr = createPriceFeed(
      [xmrStub('a', () => [q('USD', 30_000n), q('EUR', 27_000n)]), xmrStub('b', () => [q('USD', 30_000n)])],
      { ...PRICE_FEED_DEFAULTS, clock: c.clock },
    );
    await xmr.poll();
    expect(directRoute(xmr).quote('EUR')).toBeNull();
  });

  it('has no price without the XMR/USD median, even when the currency has one (Q9: a USD value is needed)', async () => {
    const c = clockAt(T0);
    const xmr = createPriceFeed(
      [xmrStub('a', () => [q('USD', 30_000n), q('EUR', 27_000n)]), xmrStub('b', () => [q('USD', 60_000n), q('EUR', 27_000n)])],
      { ...PRICE_FEED_DEFAULTS, clock: c.clock },
    );
    await xmr.poll();
    expect(xmr.quote('EUR')).not.toBeNull();
    expect(directRoute(xmr).quote('EUR')).toBeNull();
  });
});

describe('createMarketPrices with several routes', () => {
  async function setup(routes?: Parameters<typeof createMarketPrices>[0]['routes'], maxGapBps?: number) {
    const c = clockAt(T0);
    let fxDown = false;
    const xmr = createPriceFeed(
      [xmrStub('a', () => [q('USD', 30_000n), q('EUR', 27_000n)]), xmrStub('b', () => [q('USD', 30_000n), q('EUR', 27_000n)])],
      { ...PRICE_FEED_DEFAULTS, clock: c.clock },
    );
    const fx = createFxRates([fxStub('one', () => (fxDown ? new Error('down') : { EUR: '0.9', GBP: '0.8' }))], { clock: c.clock, failLimit: 1 });
    const prices = createMarketPrices({ xmr, fx, clock: c.clock, ...(routes ? { routes } : {}), ...(maxGapBps ? { maxGapBps } : {}) });
    await prices.poll();
    return { prices, c, setFxDown: (v: boolean) => void (fxDown = v) };
  }

  it('defaults to the market route only: today\'s prices, now marked with their route', async () => {
    const { prices, setFxDown } = await setup();
    expect(prices.quote('EUR')).toMatchObject({ route: 'market', price: { centsPerXmr: 27_000n }, usdCentsPerXmr: 30_000n });
    expect(prices.quote('USD')).toMatchObject({ route: 'market' });
    expect(prices.quote('EUR')!.fx).toMatchObject({ source: 'one', rate: (9n * RATE_SCALE) / 10n });
    setFxDown(true);
    await prices.poll();
    expect(prices.quote('EUR')).toBeNull();
    expect(prices.health().paused).toContain('EUR');
  });

  it('with market,direct: EUR falls back to the direct route when its exchange rate is down; GBP (no direct quote) pauses alone', async () => {
    const { prices, setFxDown } = await setup(['market', 'direct']);
    expect(prices.quote('EUR')).toMatchObject({ route: 'market' });
    setFxDown(true);
    await prices.poll();
    expect(prices.quote('EUR')).toMatchObject({ route: 'direct', price: { centsPerXmr: 27_000n }, usdCentsPerXmr: 30_000n, fx: null });
    expect(prices.current('EUR')).toEqual({ currency: 'EUR', centsPerXmr: 27_000n });
    expect(prices.quote('GBP')).toBeNull();
    expect(prices.quote('USD')).toMatchObject({ route: 'market' });
    const h = prices.health();
    expect(h.paused).toContain('GBP');
    expect(h.paused).not.toContain('EUR');
    expect(h.coverage.find((x) => x.currency === 'EUR')).toEqual({ currency: 'EUR', route: 'direct' });
    expect(h.coverage.find((x) => x.currency === 'GBP')).toEqual({ currency: 'GBP', route: null });
  });

  it('with a gap limit, routes that disagree leave the currency with no price', async () => {
    // Market EUR = 30000 × 0.9 = 27000 = direct EUR: within any limit. Then direct says 25000 (8% off): refused.
    const ok = await setup(['market', 'direct'], 100);
    expect(ok.prices.quote('EUR')).toMatchObject({ route: 'market' });
    const c = clockAt(T0);
    const xmr = createPriceFeed(
      [xmrStub('a', () => [q('USD', 30_000n), q('EUR', 25_000n)]), xmrStub('b', () => [q('USD', 30_000n), q('EUR', 25_000n)])],
      { ...PRICE_FEED_DEFAULTS, clock: c.clock },
    );
    const fx = createFxRates([fxStub('one', () => ({ EUR: '0.9' }))], { clock: c.clock });
    const prices = createMarketPrices({ xmr, fx, clock: c.clock, routes: ['market', 'direct'], maxGapBps: 300 });
    await prices.poll();
    expect(prices.quote('EUR')).toBeNull();
    expect(prices.health().paused).toContain('EUR');
  });
});

// ---- Config ----

const ENV = {
  X2F_ORIGINS: 'https://x2f.test', X2F_RP_ID: 'x2f.test', DATABASE_URL: 'postgres://u@h/x', X2F_LEAKED_LIST_PATH: '/x',
  X2F_SERVER_KEY: Buffer.alloc(32, 1).toString('base64'), X2F_MONERO_NETWORK: 'stagenet', X2F_TERMS_VERSION: 'v1',
  X2F_PGP_SIGNING_KEY_PATH: '/k', X2F_PGP_SIGNING_FINGERPRINT: 'a'.repeat(40),
  X2F_PASSWORD_PEPPERS: `1:${Buffer.alloc(32, 11).toString('base64')}`, X2F_RECOVERY_CODE_KEYS: `1:${Buffer.alloc(32, 12).toString('base64')}`,
  X2F_TOTP_KEYS: `1:${Buffer.alloc(32, 13).toString('base64')}`, X2F_LOGIN_NAME_KEYS: `1:${Buffer.alloc(32, 14).toString('base64')}`,
  ...VAPID_ENV,
};

describe('config', () => {
  it('PRICE_ROUTES: default market only; known names, each once, in order', () => {
    expect(PRICE_ROUTE_NAMES).toEqual(['market', 'direct']);
    expect(DEFAULT_PRICE_ROUTES).toEqual(['market']);
    expect(parsePriceRoutes(undefined)).toEqual(['market']);
    expect(parsePriceRoutes(' ')).toEqual(['market']);
    expect(parsePriceRoutes('market,direct')).toEqual(['market', 'direct']);
    expect(parsePriceRoutes('direct, market')).toEqual(['direct', 'market']);
    for (const bad of ['nope', 'market,market', 'market,', 'MARKET']) expect(() => parsePriceRoutes(bad)).toThrow('PRICE_ROUTES');
    expect(loadConfig(ENV).priceRoutes).toEqual(['market']);
    expect(loadConfig({ ...ENV, PRICE_ROUTES: 'market,direct' }).priceRoutes).toEqual(['market', 'direct']);
    expect(() => loadConfig({ ...ENV, PRICE_ROUTES: 'x' })).toThrow('PRICE_ROUTES');
  });

  it('PRICE_ROUTE_MAX_GAP_PCT: unset is off; a whole percent 1..50 in basis points', () => {
    expect(parsePriceRouteMaxGap(undefined)).toBeNull();
    expect(parsePriceRouteMaxGap('')).toBeNull();
    expect(parsePriceRouteMaxGap('3')).toBe(300);
    expect(parsePriceRouteMaxGap('50')).toBe(5_000);
    for (const bad of ['0', '51', '2.5', '-1', 'x', '3%']) expect(() => parsePriceRouteMaxGap(bad)).toThrow('PRICE_ROUTE_MAX_GAP_PCT');
    expect(loadConfig(ENV).priceRouteMaxGapBps).toBeNull();
    expect(loadConfig({ ...ENV, PRICE_ROUTE_MAX_GAP_PCT: '3' }).priceRouteMaxGapBps).toBe(300);
  });

  it('candidate sources are accepted only when named, never by default', () => {
    expect(CANDIDATE_PRICE_SOURCE_NAMES).toEqual(['coinpaprika']);
    expect(DEFAULT_PRICE_SOURCES).toEqual(['kraken', 'bitfinex', 'coingecko']);
    expect(parsePriceSources('kraken,coinpaprika')).toEqual(['kraken', 'coinpaprika']);
    expect(CANDIDATE_FX_SOURCE_NAMES).toEqual(['frankfurter', 'erapi']);
    expect(DEFAULT_FX_SOURCES).toEqual(['coinbase', 'bitpay', 'coingecko']);
    expect(parseFxSources('coinbase,bitpay,coingecko,erapi')).toEqual(['coinbase', 'bitpay', 'coingecko', 'erapi']);
    expect(loadConfig(ENV).priceSources).not.toContain('coinpaprika');
    expect(loadConfig(ENV).fxSources).toEqual(['coinbase', 'bitpay', 'coingecko']);
  });
});

// ---- Candidate adapters (OFF by default), over a stubbed fetch ----

function fakeFetch(body: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const f = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  return { fetch: f as typeof fetch, calls };
}
const signal = () => new AbortController().signal;

describe('coinpaprika (candidate XMR source)', () => {
  const BODY = {
    id: 'xmr-monero', symbol: 'XMR', last_updated: '2026-11-02T05:59:00Z',
    quotes: { USD: { price: 301.234 }, EUR: { price: 271.5 }, XYZ: { price: 5 } },
  };

  it('reads USD and EUR with its own time, from a fixed URL, with no cookies or redirects', async () => {
    const ff = fakeFetch(BODY);
    const [s] = priceSources(['coinpaprika'], ff.fetch);
    expect(s!.name).toBe('coinpaprika');
    expect(await s!.fetchQuotes(signal())).toEqual([
      { currency: 'EUR', centsPerXmr: 27_150n, at: new Date('2026-11-02T05:59:00Z') },
      { currency: 'USD', centsPerXmr: 30_123n, at: new Date('2026-11-02T05:59:00Z') },
    ]);
    expect(ff.calls).toHaveLength(1);
    expect(ff.calls[0]!.url).toBe('https://api.coinpaprika.com/v1/tickers/xmr-monero?quotes=USD,EUR');
    expect(ff.calls[0]!.init).toMatchObject({ method: 'GET', redirect: 'error', credentials: 'omit' });
  });

  it.each([
    ['another coin', { ...BODY, id: 'btc-bitcoin' }],
    ['no quotes', { ...BODY, quotes: null }],
    ['no time', { ...BODY, last_updated: undefined }],
    ['a bad time', { ...BODY, last_updated: 'yesterday' }],
    ['not an object', [BODY]],
  ])('throws on %s', async (_w, body) => {
    const [s] = priceSources(['coinpaprika'], fakeFetch(body).fetch);
    await expect(s!.fetchQuotes(signal())).rejects.toThrow();
  });

  it('a non-200 answer throws', async () => {
    const [s] = priceSources(['coinpaprika'], fakeFetch(BODY, 503).fetch);
    await expect(s!.fetchQuotes(signal())).rejects.toThrow();
  });
});

describe('candidate exchange-rate sources', () => {
  const now = new Date('2026-11-02T06:00:00Z');
  const clock = () => now;
  const one = (name: (typeof CANDIDATE_FX_SOURCE_NAMES)[number], body: unknown, status = 200) => {
    const ff = fakeFetch(body, status);
    return { source: fxSources([name], ff.fetch, clock)[0]!, calls: ff.calls };
  };
  const rate = (v: string) => decimalToScaled(v)!;

  describe('frankfurter (ECB)', () => {
    const BODY = { amount: 1.0, base: 'USD', date: '2026-10-30', rates: { EUR: 0.9213, JPY: 152.3, XYZ: 3, USD: 1 } };
    it('reads USD-based rates of supported currencies from a fixed URL', async () => {
      const { source, calls } = one('frankfurter', BODY);
      expect(source.name).toBe('frankfurter');
      expect(await source.fetchRates(signal())).toEqual(new Map([['EUR', rate('0.9213')], ['JPY', rate('152.3')]]));
      expect(calls[0]!.url).toBe('https://api.frankfurter.dev/v1/latest?base=USD');
      expect(calls[0]!.init).toMatchObject({ method: 'GET', redirect: 'error', credentials: 'omit' });
    });
    it('refuses rates published more than 4 days ago, and any other base', async () => {
      await expect(one('frankfurter', { ...BODY, date: '2026-10-28' }).source.fetchRates(signal())).rejects.toThrow();
      await expect(one('frankfurter', { ...BODY, date: '2026-10-29' }).source.fetchRates(signal())).resolves.toBeInstanceOf(Map);
      await expect(one('frankfurter', { ...BODY, base: 'EUR' }).source.fetchRates(signal())).rejects.toThrow();
      await expect(one('frankfurter', { ...BODY, date: 'soon' }).source.fetchRates(signal())).rejects.toThrow();
      await expect(one('frankfurter', BODY, 500).source.fetchRates(signal())).rejects.toThrow();
    });
  });

  describe('erapi (open.er-api.com)', () => {
    const at = Math.floor(now.getTime() / 1000) - 3600;
    const BODY = { result: 'success', base_code: 'USD', time_last_update_unix: at, rates: { USD: 1, EUR: 0.92, KWD: 0.307, AAA: 2 } };
    it('reads USD-based rates of supported currencies from a fixed URL', async () => {
      const { source, calls } = one('erapi', BODY);
      expect(await source.fetchRates(signal())).toEqual(new Map([['EUR', rate('0.92')], ['KWD', rate('0.307')]]));
      expect(calls[0]!.url).toBe('https://open.er-api.com/v6/latest/USD');
    });
    it('refuses rates published more than 2 days ago, an error result and any other base', async () => {
      const twoDays = 2 * 24 * 3600;
      const t = Math.floor(now.getTime() / 1000);
      await expect(one('erapi', { ...BODY, time_last_update_unix: t - twoDays - 1 }).source.fetchRates(signal())).rejects.toThrow();
      await expect(one('erapi', { ...BODY, time_last_update_unix: t - twoDays }).source.fetchRates(signal())).resolves.toBeInstanceOf(Map);
      await expect(one('erapi', { ...BODY, result: 'error' }).source.fetchRates(signal())).rejects.toThrow();
      await expect(one('erapi', { ...BODY, base_code: 'EUR' }).source.fetchRates(signal())).rejects.toThrow();
      await expect(one('erapi', { ...BODY, time_last_update_unix: 'x' }).source.fetchRates(signal())).rejects.toThrow();
    });
  });
});
