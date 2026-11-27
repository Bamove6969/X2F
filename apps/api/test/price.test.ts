import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { BANNED_CURRENCIES, CURRENCY_EXPONENTS, currencyExponent, decimalToMinor } from '../src/price/currencies.js';
import { PRICE_FEED_DEFAULTS, createPriceFeed, median, type PriceQuote, type PriceSource } from '../src/price/feed.js';
import { createFxRates } from '../src/price/fx.js';
import { createMarketPrices } from '../src/price/market.js';
import { PRICE_SOURCE_NAMES, parsePriceSources, priceSources, readCapped } from '../src/price/sources.js';
import type { Browser } from './helpers/totp.js';
import { tradeApp } from './helpers/tradeApp.js';
import { VAPID_ENV } from './helpers/vapid.js';

const T0 = new Date('2026-10-24T06:00:00Z');
const MIN = 60_000;

/** A source answering `quotes` (or throwing `fail`), stamped with no time of its own unless given. */
function stub(name: string, quotes: () => PriceQuote[] | Error): PriceSource {
  return {
    name,
    async fetchQuotes() {
      const q = quotes();
      if (q instanceof Error) throw q;
      return q;
    },
  };
}
const usd = (cents: bigint, at?: Date): PriceQuote[] => [{ currency: 'USD', centsPerXmr: cents, ...(at ? { at } : {}) }];

function clockAt(start: Date): { clock: () => Date; set(d: Date): void } {
  let now = start;
  return { clock: () => now, set: (d) => void (now = d) };
}

describe('median', () => {
  it('takes the middle value, and the half-up mean of the two middle ones', () => {
    expect(median([32900n, 33000n, 39000n])).toBe(33000n);
    expect(median([39000n, 32900n, 33000n])).toBe(33000n);
    expect(median([33000n, 33001n])).toBe(33001n);
    expect(median([33000n, 33003n])).toBe(33002n);
    expect(median([5n])).toBe(5n);
    expect(() => median([])).toThrow(RangeError);
  });
});

describe('createPriceFeed', () => {
  it('uses the plan defaults', () => {
    expect(PRICE_FEED_DEFAULTS).toMatchObject({ minSources: 2, maxAgeMs: 300_000, pollMs: 15_000, timeoutMs: 5_000 });
  });

  it('returns the median of three sources (Review Focus 5)', async () => {
    const c = clockAt(T0);
    const feed = createPriceFeed(
      [stub('a', () => usd(32900n)), stub('b', () => usd(33000n)), stub('c', () => usd(39000n))],
      { ...PRICE_FEED_DEFAULTS, clock: c.clock },
    );
    expect(feed.current('USD')).toBeNull(); // nothing polled yet
    await feed.poll();
    expect(feed.current('USD')).toEqual({ currency: 'USD', centsPerXmr: 33000n });
    // 39000 is 18% from the median: it does not agree, so 2 sources count (M4).
    expect(feed.quote('USD')).toEqual({ price: { currency: 'USD', centsPerXmr: 33000n }, at: T0, sources: 2, exponent: 2 });
    expect(feed.current('EUR')).toBeNull();
  });

  it('returns null when only one source answered', async () => {
    const c = clockAt(T0);
    const feed = createPriceFeed(
      [stub('a', () => usd(33000n)), stub('b', () => new Error('down')), stub('c', () => [])],
      { ...PRICE_FEED_DEFAULTS, clock: c.clock },
    );
    await feed.poll();
    expect(feed.current('USD')).toBeNull();
  });

  it('uses only the last poll: sources that answered before but not now do not count', async () => {
    const c = clockAt(T0);
    let up = true;
    const feed = createPriceFeed(
      [stub('a', () => usd(33000n)), stub('b', () => (up ? usd(33100n) : new Error('down')))],
      { ...PRICE_FEED_DEFAULTS, clock: c.clock },
    );
    await feed.poll();
    expect(feed.current('USD')?.centsPerXmr).toBe(33050n);
    up = false;
    c.set(new Date(T0.getTime() + MIN));
    await feed.poll();
    expect(feed.current('USD')).toBeNull();
  });

  it('returns null once the median is more than 5 min old, and not before', async () => {
    const c = clockAt(T0);
    const feed = createPriceFeed([stub('a', () => usd(33000n)), stub('b', () => usd(33000n))], { ...PRICE_FEED_DEFAULTS, clock: c.clock });
    await feed.poll();
    c.set(new Date(T0.getTime() + 5 * MIN));
    expect(feed.current('USD')?.centsPerXmr).toBe(33000n);
    c.set(new Date(T0.getTime() + 5 * MIN + 1));
    expect(feed.current('USD')).toBeNull();
    expect(feed.quote('USD')).toBeNull();
  });

  it("dates the median by its oldest quote, using a source's own timestamp", async () => {
    const c = clockAt(T0);
    const old = new Date(T0.getTime() - 4 * MIN);
    const feed = createPriceFeed(
      [stub('a', () => usd(33000n, old)), stub('b', () => usd(33010n)), stub('c', () => usd(33020n))],
      { ...PRICE_FEED_DEFAULTS, clock: c.clock },
    );
    await feed.poll();
    expect(feed.quote('USD')?.at).toEqual(old);
    c.set(new Date(old.getTime() + 5 * MIN + 1));
    expect(feed.current('USD')).toBeNull();
  });

  it('drops a quote already stale when fetched (a frozen, delisted pair) and caps a future timestamp at now', async () => {
    const c = clockAt(T0);
    const feed = createPriceFeed(
      [
        stub('frozen', () => usd(11870n, new Date(T0.getTime() - 5 * MIN - 1))),
        stub('b', () => usd(33000n, new Date(T0.getTime() + 10 * MIN))),
        stub('c', () => usd(33010n)),
      ],
      { ...PRICE_FEED_DEFAULTS, clock: c.clock },
    );
    await feed.poll();
    expect(feed.quote('USD')).toMatchObject({ price: { centsPerXmr: 33005n }, at: T0, sources: 2 });
    // Every quote future-dated: the clamp alone dates the median, so it still goes stale on time.
    const future = new Date(T0.getTime() + 10 * MIN);
    const ahead = createPriceFeed([stub('a', () => usd(33000n, future)), stub('b', () => usd(33010n, future))], { ...PRICE_FEED_DEFAULTS, clock: c.clock });
    await ahead.poll();
    expect(ahead.quote('USD')?.at).toEqual(T0);
    c.set(new Date(T0.getTime() + 5 * MIN + 1));
    expect(ahead.current('USD')).toBeNull();
  });

  it('counts only the agreeing sources in `sources` (M4)', async () => {
    const c = clockAt(T0);
    const feed = createPriceFeed(
      [stub('a', () => usd(33000n)), stub('b', () => usd(33010n)), stub('far', () => usd(50000n))],
      { ...PRICE_FEED_DEFAULTS, clock: c.clock },
    );
    await feed.poll();
    expect(feed.quote('USD')).toMatchObject({ price: { centsPerXmr: 33010n }, sources: 2 });
  });

  it('returns null when the sources disagree (no two within 3% of the median)', async () => {
    const c = clockAt(T0);
    const feed = createPriceFeed([stub('a', () => usd(30000n)), stub('b', () => usd(36000n))], { ...PRICE_FEED_DEFAULTS, clock: c.clock });
    await feed.poll();
    expect(feed.current('USD')).toBeNull();

    const three = createPriceFeed(
      [stub('a', () => usd(20000n)), stub('b', () => usd(33000n)), stub('c', () => usd(50000n))],
      { ...PRICE_FEED_DEFAULTS, clock: c.clock },
    );
    await three.poll();
    expect(three.current('USD')).toBeNull();
  });

  it('ignores bad quotes: unknown currency, zero, negative, a duplicate from one source', async () => {
    const c = clockAt(T0);
    const feed = createPriceFeed(
      [
        stub('a', () => [
          { currency: 'USD', centsPerXmr: 33000n },
          { currency: 'USD', centsPerXmr: 99999n },
          { currency: 'XXX', centsPerXmr: 1n },
          { currency: 'EUR', centsPerXmr: 0n },
        ]),
        stub('b', () => [{ currency: 'USD', centsPerXmr: 33000n }, { currency: 'EUR', centsPerXmr: -5n }]),
      ],
      { ...PRICE_FEED_DEFAULTS, clock: c.clock },
    );
    await feed.poll();
    expect(feed.quote('USD')).toMatchObject({ price: { centsPerXmr: 33000n }, sources: 2 });
    expect(feed.current('EUR')).toBeNull();
    expect(feed.current('XXX')).toBeNull();
  });

  it('with only two sources in play the spread is 2%, not 3% (re-review)', async () => {
    expect(PRICE_FEED_DEFAULTS).toMatchObject({ maxSpreadBps: 300, pairSpreadBps: 200 });
    const c = clockAt(T0);
    // 3% apart: each is 1.5% from the mean, so within 2% of the median: a price.
    const close = createPriceFeed([stub('a', () => usd(33000n)), stub('b', () => usd(33990n))], { ...PRICE_FEED_DEFAULTS, clock: c.clock });
    await close.poll();
    expect(close.current('USD')).toEqual({ currency: 'USD', centsPerXmr: 33495n });
    // 6% apart: 3% from the mean each. Under the 3% spread that would count; with two it does not.
    const two = createPriceFeed([stub('a', () => usd(33000n)), stub('b', () => usd(34980n))], { ...PRICE_FEED_DEFAULTS, clock: c.clock });
    await two.poll();
    expect(two.current('USD')).toBeNull();
    // The same gap with a third source in play keeps the 3% spread (2.9% each side of the median).
    const three = createPriceFeed(
      [stub('a', () => usd(33000n)), stub('b', () => usd(34980n)), stub('c', () => usd(34000n))],
      { ...PRICE_FEED_DEFAULTS, clock: c.clock },
    );
    await three.poll();
    expect(three.quote('USD')).toMatchObject({ price: { centsPerXmr: 34000n }, sources: 3 });
  });

  it('the spread with three or more sources is 3% of the median (owner Q7): inside 3% counts, past it does not', async () => {
    const c = clockAt(T0);
    const feed = (far: bigint) =>
      createPriceFeed([stub('a', () => usd(34000n)), stub('b', () => usd(34010n)), stub('c', () => usd(far))], { ...PRICE_FEED_DEFAULTS, clock: c.clock });
    // Median 34010: 35030 is 1020 above it, just inside 3% (1020 × 10000 ≤ 34010 × 300).
    const atEdge = feed(35030n);
    await atEdge.poll();
    expect(atEdge.quote('USD')).toMatchObject({ price: { centsPerXmr: 34010n }, sources: 3 });
    // 3.5% above the median: under the old 5% it counted, now it does not (the other two still give a price).
    const past = feed(35200n);
    await past.poll();
    expect(past.quote('USD')).toMatchObject({ price: { centsPerXmr: 34010n }, sources: 2 });
  });

  it('an undated quote unchanged for over 30 min while another source moves is stale (frozen pair, re-review)', async () => {
    expect(PRICE_FEED_DEFAULTS.frozenAfterMs).toBe(30 * MIN);
    const c = clockAt(T0);
    let moving = 33000n;
    const feed = createPriceFeed(
      [stub('kraken', () => usd(33000n)), stub('bitfinex', () => usd(moving)), stub('steady', () => usd(33000n))],
      { ...PRICE_FEED_DEFAULTS, clock: c.clock },
    );
    const at = (min: number) => c.set(new Date(T0.getTime() + min * MIN));
    await feed.poll();
    moving = 33010n;
    at(30);
    await feed.poll();
    expect(feed.sources()[0], 'exactly 30 min unchanged: still fine').toMatchObject({ consecutiveFailures: 0, inUse: true });
    at(31);
    await feed.poll();
    expect(feed.sources().map((s) => s.consecutiveFailures), 'over 30 min and bitfinex moved since: kraken and steady are frozen').toEqual([1, 0, 1]);
    expect(feed.current('USD')).toBeNull();
    moving = 33020n;
    at(32);
    await feed.poll();
    expect(feed.current('USD'), 'still frozen').toBeNull();
  });

  it('an undated quote unchanged for hours is fine while no other source moves either (a quiet market)', async () => {
    const c = clockAt(T0);
    const feed = createPriceFeed([stub('kraken', () => usd(33000n)), stub('bitfinex', () => usd(33010n))], { ...PRICE_FEED_DEFAULTS, clock: c.clock });
    for (let m = 0; m <= 180; m += 30) {
      c.set(new Date(T0.getTime() + m * MIN));
      await feed.poll();
    }
    expect(feed.current('USD')).toEqual({ currency: 'USD', centsPerXmr: 33005n });
    expect(feed.sources().map((s) => s.consecutiveFailures)).toEqual([0, 0]);
  });

  it('a dated quote is judged by its own timestamp, never as frozen', async () => {
    const c = clockAt(T0);
    let moving = 33000n;
    const feed = createPriceFeed(
      [stub('coingecko', () => usd(33000n, c.clock())), stub('bitfinex', () => usd(moving))],
      { ...PRICE_FEED_DEFAULTS, clock: c.clock },
    );
    await feed.poll();
    moving = 33010n;
    c.set(new Date(T0.getTime() + 40 * MIN));
    await feed.poll();
    expect(feed.current('USD')).toEqual({ currency: 'USD', centsPerXmr: 33005n });
  });

  it('source health is judged on the USD quote only (re-review)', async () => {
    const c = clockAt(T0);
    const eurOnly = (cents: bigint): PriceQuote[] => [{ currency: 'EUR', centsPerXmr: cents }];
    const feed = createPriceFeed(
      [
        stub('a', () => [...usd(33000n), ...eurOnly(30000n)]),
        stub('b', () => eurOnly(30010n)), // answers, but not USD: a failure
        stub('c', () => usd(33010n)),
      ],
      { ...PRICE_FEED_DEFAULTS, clock: c.clock },
    );
    await feed.poll();
    expect(feed.sources()).toEqual([
      { name: 'a', lastGoodAt: T0, consecutiveFailures: 0, inUse: true },
      { name: 'b', lastGoodAt: null, consecutiveFailures: 1, inUse: false },
      { name: 'c', lastGoodAt: T0, consecutiveFailures: 0, inUse: true },
    ]);
  });

  it('records per source the last good fetch, failures in a row and whether it is in use (price health)', async () => {
    const c = clockAt(T0);
    let b: () => PriceQuote[] | Error = () => new Error('down');
    const feed = createPriceFeed(
      [
        stub('a', () => usd(33000n)),
        stub('b', () => b()),
        stub('frozen', () => usd(33000n, new Date(c.clock().getTime() - 5 * MIN - 1))), // a stale answer counts as a failure
        stub('far', () => usd(50000n)), // answered, but too far from the median to count
        stub('d', () => usd(33010n)),
      ],
      { ...PRICE_FEED_DEFAULTS, clock: c.clock },
    );
    expect(feed.polled()).toBe(false);
    expect(feed.sources().map((s) => s.consecutiveFailures)).toEqual([0, 0, 0, 0, 0]);
    await feed.poll();
    expect(feed.polled()).toBe(true);
    expect(feed.sources()).toEqual([
      { name: 'a', lastGoodAt: T0, consecutiveFailures: 0, inUse: true },
      { name: 'b', lastGoodAt: null, consecutiveFailures: 1, inUse: false },
      { name: 'frozen', lastGoodAt: null, consecutiveFailures: 1, inUse: false },
      { name: 'far', lastGoodAt: T0, consecutiveFailures: 0, inUse: false },
      { name: 'd', lastGoodAt: T0, consecutiveFailures: 0, inUse: true },
    ]);
    c.set(new Date(T0.getTime() + MIN));
    await feed.poll();
    expect(feed.sources()[1]).toEqual({ name: 'b', lastGoodAt: null, consecutiveFailures: 2, inUse: false });
    b = () => usd(33005n);
    c.set(new Date(T0.getTime() + 2 * MIN));
    await feed.poll();
    expect(feed.sources()[1]).toEqual({ name: 'b', lastGoodAt: c.clock(), consecutiveFailures: 0, inUse: true });
  });

  it('never throws past the feed and gives a hanging source 5 s (its signal aborts)', async () => {
    vi.useFakeTimers({ now: T0 });
    try {
      let aborted = false;
      const hang: PriceSource = {
        name: 'hang',
        fetchQuotes: (signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              aborted = true;
              reject(signal.reason);
            });
          }),
      };
      const syncThrow: PriceSource = {
        name: 'sync',
        fetchQuotes: () => {
          throw new Error('boom');
        },
      };
      const feed = createPriceFeed([hang, syncThrow, stub('b', () => usd(33000n)), stub('c', () => usd(33000n))], PRICE_FEED_DEFAULTS);
      const done = feed.poll();
      await vi.advanceTimersByTimeAsync(4_999);
      expect(aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(done).resolves.toBeUndefined();
      expect(aborted).toBe(true);
      expect(feed.quote('USD')?.sources).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('polls on start every pollMs, one poll at a time, until stopped', async () => {
    vi.useFakeTimers({ now: T0 });
    try {
      let calls = 0;
      let release: (() => void) | null = null;
      const slow: PriceSource = {
        name: 'slow',
        fetchQuotes: () => {
          calls++;
          return new Promise((resolve) => {
            release = () => resolve(usd(33000n));
          });
        },
      };
      const feed = createPriceFeed([slow, stub('b', () => usd(33000n))], { ...PRICE_FEED_DEFAULTS, timeoutMs: 600_000 });
      feed.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(calls).toBe(1);
      await vi.advanceTimersByTimeAsync(3 * MIN); // still in flight: no overlapping poll
      expect(calls).toBe(1);
      release!();
      await vi.advanceTimersByTimeAsync(MIN);
      expect(calls).toBe(2);
      release!();
      await feed.stop();
      await vi.advanceTimersByTimeAsync(5 * MIN);
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('currencies', () => {
  it('publishes the ISO 4217 exponent of each currency (Revision 2026-10-20)', () => {
    expect(currencyExponent('USD')).toBe(2);
    expect(currencyExponent('EUR')).toBe(2);
    for (const c of ['JPY', 'KRW', 'CLP', 'VND']) expect(currencyExponent(c), c).toBe(0);
    for (const c of ['KWD', 'BHD']) expect(currencyExponent(c), c).toBe(3);
    expect(currencyExponent('XXX')).toBeNull();
    expect(currencyExponent('usd')).toBeNull();
    // owner 12 Nov: Russian anything is banned; and "I'm sticking to the US sanction laws" (the
    // jurisdictions under comprehensive OFAC sanctions: Cuba, Iran, North Korea). RUB is off the list
    // (45 to 44); IRR, KPW, CUP and CUC were never on it. No price, so no offer. BANNED_CURRENCIES
    // keeps them off: the module refuses to load with one of them on the list.
    for (const c of ['RUB', 'IRR', 'KPW', 'CUP', 'CUC']) expect(currencyExponent(c), c).toBeNull();
    expect([...BANNED_CURRENCIES].sort()).toEqual(['CUC', 'CUP', 'IRR', 'KPW', 'RUB']);
    expect(Object.keys(CURRENCY_EXPONENTS)).toHaveLength(44);
    for (const [code, e] of Object.entries(CURRENCY_EXPONENTS)) {
      expect(code).toMatch(/^[A-Z]{3}$/);
      expect([0, 2, 3]).toContain(e);
    }
  });

  it('converts a decimal price to minor units, half up', () => {
    expect(decimalToMinor('581.67', 2)).toBe(58167n);
    expect(decimalToMinor('581.675', 2)).toBe(58168n);
    expect(decimalToMinor('581.674999', 2)).toBe(58167n);
    expect(decimalToMinor('91290.81713798475', 0)).toBe(91291n);
    expect(decimalToMinor('180.85', 3)).toBe(180850n);
    expect(decimalToMinor('582', 2)).toBe(58200n);
    expect(decimalToMinor('0.004', 2)).toBe(0n);
    for (const bad of ['', '-1', '1e3', '1.', '.5', 'NaN', ' 5', '5 ', '0x10', '1'.repeat(16), '1.2.3']) {
      expect(decimalToMinor(bad, 2), bad).toBeNull();
    }
  });
});

/** A stubbed `fetch` that answers `body` for any URL starting with `prefix` and records the calls. */
function fakeFetch(answers: Record<string, unknown>, status = 200) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const f = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const hit = Object.keys(answers).find((p) => url.startsWith(p));
    if (!hit) return new Response('not found', { status: 404 });
    return new Response(typeof answers[hit] === 'string' ? (answers[hit] as string) : JSON.stringify(answers[hit]), { status });
  };
  return { fetch: f as typeof fetch, calls };
}

// Shapes as fetched over Tor on 2026-10-24 (see ~/x2f-comms/briefs/p3-t3-price-sources.md), trimmed.
const KRAKEN = {
  error: [],
  result: {
    XXMRZEUR: { a: ['520.36000000', '1', '1.000'], b: ['519.70000000', '1', '1.000'], c: ['517.50000000', '0.13250000'] },
    XXMRZUSD: { a: ['581.67000000', '1', '1.000'], b: ['581.36000000', '1', '1.000'], c: ['581.67000000', '0.00513194'] },
  },
};
const BITFINEX = [['tXMRUSD', 582.46, 28.48905506, 582.47, 18.68971542, -28.16, -0.04611706, 582.46, 3109.63412689, 617.65, 563.71]];
const COINGECKO = { monero: { usd: 581.97, eur: 519.43, gbp: 435.25, jpy: 91307, kwd: 180.85, last_updated_at: 1792822948 } };

describe('price sources', () => {
  const signal = new AbortController().signal;
  const one = (name: string, f: typeof fetch) => priceSources([name as (typeof PRICE_SOURCE_NAMES)[number]], f)[0]!;

  it('lists the proposed sources', () => {
    expect(PRICE_SOURCE_NAMES).toEqual(['coingecko', 'kraken', 'bitfinex']);
  });

  it('kraken: last trade of XMR/USD and XMR/EUR', async () => {
    const { fetch, calls } = fakeFetch({ 'https://api.kraken.com/0/public/Ticker?pair=XXMRZUSD,XXMRZEUR': KRAKEN });
    const q = await one('kraken', fetch).fetchQuotes(signal);
    expect(q).toEqual([{ currency: 'EUR', centsPerXmr: 51750n }, { currency: 'USD', centsPerXmr: 58167n }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init?.signal).toBe(signal);
    expect(calls[0]!.init?.redirect).toBe('error');
  });

  it('kraken: an error entry is refused even with a result; a warning is not; a missing pair is not a price', async () => {
    const bad = fakeFetch({ 'https://api.kraken.com/': { error: ['EService:Unavailable'], result: KRAKEN.result } });
    await expect(one('kraken', bad.fetch).fetchQuotes(signal)).rejects.toThrow();
    const warned = fakeFetch({ 'https://api.kraken.com/': { error: ['WGeneral:Notice'], result: KRAKEN.result } });
    expect(await one('kraken', warned.fetch).fetchQuotes(signal)).toHaveLength(2);
    const odd = fakeFetch({ 'https://api.kraken.com/': { error: [42], result: KRAKEN.result } });
    await expect(one('kraken', odd.fetch).fetchQuotes(signal)).rejects.toThrow();
    const partial = fakeFetch({ 'https://api.kraken.com/': { error: [], result: { XXMRZUSD: KRAKEN.result.XXMRZUSD, XXMRXXBT: { c: ['0.0072', '1'] } } } });
    expect(await one('kraken', partial.fetch).fetchQuotes(signal)).toEqual([{ currency: 'USD', centsPerXmr: 58167n }]);
  });

  it('bitfinex: LAST_PRICE of tXMRUSD', async () => {
    const { fetch } = fakeFetch({ 'https://api-pub.bitfinex.com/v2/tickers?symbols=tXMRUSD': BITFINEX });
    expect(await one('bitfinex', fetch).fetchQuotes(signal)).toEqual([{ currency: 'USD', centsPerXmr: 58246n }]);
  });

  it("coingecko: every supported currency in one call, dated by CoinGecko's last_updated_at", async () => {
    const { fetch, calls } = fakeFetch({ 'https://api.coingecko.com/api/v3/simple/price?': COINGECKO });
    const q = await one('coingecko', fetch).fetchQuotes(signal);
    const at = new Date(1792822948 * 1000);
    expect(q).toEqual([
      { currency: 'USD', centsPerXmr: 58197n, at },
      { currency: 'EUR', centsPerXmr: 51943n, at },
      { currency: 'GBP', centsPerXmr: 43525n, at },
      { currency: 'JPY', centsPerXmr: 91307n, at },
      { currency: 'KWD', centsPerXmr: 180850n, at },
    ].sort((a, b) => a.currency.localeCompare(b.currency)));
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get('ids')).toBe('monero');
    expect(url.searchParams.get('include_last_updated_at')).toBe('true');
    expect(url.searchParams.get('vs_currencies')!.split(',').sort()).toEqual(Object.keys(CURRENCY_EXPONENTS).map((c) => c.toLowerCase()).sort());
  });

  it.each(PRICE_SOURCE_NAMES)('%s: a non-200 answer, non-JSON, a huge body or a wrong shape throws (the feed catches it)', async (name) => {
    for (const [body, status] of [
      [KRAKEN, 503], ['<html>Just a moment...</html>', 200], ['x'.repeat(300_000), 200], [{ unexpected: true }, 200], [[1, 2, 3], 200], [null, 200],
    ] as const) {
      const { fetch } = fakeFetch({ 'https://': body }, status);
      const r = one(name, fetch).fetchQuotes(signal);
      await expect(r, `${name} ${String(status)} ${JSON.stringify(body).slice(0, 30)}`).rejects.toThrow();
    }
  });

  it('stops reading a body past 256 KiB and cancels the stream (bytes, not characters)', async () => {
    let pulled = 0;
    let cancelled = false;
    const chunk = new TextEncoder().encode('é'.repeat(8 * 1024)); // 16 KiB of bytes, 8 K characters
    const endless = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(c) {
            pulled++;
            c.enqueue(chunk);
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 200 },
      );
    const f = (async () => endless()) as typeof fetch;
    await expect(one('coingecko', f).fetchQuotes(signal)).rejects.toThrow(/too large/);
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThanOrEqual(20); // 256 KiB / 16 KiB + the read buffer
    // The feed swallows it.
    const feed = createPriceFeed([priceSources(['coingecko'], f)[0]!, stub('b', () => usd(33000n))], PRICE_FEED_DEFAULTS);
    await expect(feed.poll()).resolves.toBeUndefined();

    // 300 KB of ASCII is refused by its announced length before any read.
    let read = false;
    const announced = new Response(
      new ReadableStream<Uint8Array>({
        pull(c) {
          read = true;
          c.enqueue(new Uint8Array(10));
          c.close();
        },
      }),
      { status: 200, headers: { 'content-length': '300000' } },
    );
    await expect(readCapped(announced, 256 * 1024)).rejects.toThrow(/too large/);
    expect(read).toBe(false);
    // Exactly at the cap is fine; one byte over is not.
    await expect(readCapped(new Response(new Uint8Array(10).fill(0x61)), 10)).resolves.toBe('a'.repeat(10));
    await expect(readCapped(new Response(new Uint8Array(11).fill(0x61)), 10)).rejects.toThrow(/too large/);
  });

  it('a price in exponent notation or below one minor unit is skipped', async () => {
    const { fetch } = fakeFetch({ 'https://api.coingecko.com/': { monero: { usd: 1e-7, eur: 519.43, last_updated_at: 1792822948 } } });
    expect((await one('coingecko', fetch).fetchQuotes(signal)).map((q) => q.currency)).toEqual(['EUR']);
  });

  it('parses PRICE_SOURCES', () => {
    expect(parsePriceSources(undefined)).toEqual(['coingecko', 'kraken', 'bitfinex']);
    expect(parsePriceSources('')).toEqual(['coingecko', 'kraken', 'bitfinex']);
    expect(parsePriceSources(' coingecko , kraken ')).toEqual(['coingecko', 'kraken']);
    expect(() => parsePriceSources('kraken,binance')).toThrow(/PRICE_SOURCES/);
    expect(() => parsePriceSources('kraken,kraken')).toThrow(/PRICE_SOURCES/);
    expect(() => parsePriceSources('kraken,,bitfinex')).toThrow(/PRICE_SOURCES/);
  });
});

describe('config PRICE_SOURCES', () => {
  const env = {
    X2F_ORIGINS: 'https://x2f.test', X2F_RP_ID: 'x2f.test', DATABASE_URL: 'postgres://u@h/x', X2F_LEAKED_LIST_PATH: '/x',
    X2F_SERVER_KEY: Buffer.alloc(32, 1).toString('base64'), X2F_MONERO_NETWORK: 'stagenet', X2F_TERMS_VERSION: 'v1',
    X2F_PGP_SIGNING_KEY_PATH: '/k', X2F_PGP_SIGNING_FINGERPRINT: 'a'.repeat(40),
      X2F_PASSWORD_PEPPERS: `1:${Buffer.alloc(32, 11).toString('base64')}`, X2F_RECOVERY_CODE_KEYS: `1:${Buffer.alloc(32, 12).toString('base64')}`,
      X2F_TOTP_KEYS: `1:${Buffer.alloc(32, 13).toString('base64')}`, X2F_LOGIN_NAME_KEYS: `1:${Buffer.alloc(32, 14).toString('base64')}`, X2F_TICKET_KEYS: `1:${Buffer.alloc(32, 15).toString('base64')}`,
      ...VAPID_ENV,
  };
  it('defaults to the three proposed sources and refuses an unknown one', () => {
    expect(loadConfig(env).priceSources).toEqual(['coingecko', 'kraken', 'bitfinex']);
    expect(loadConfig({ ...env, PRICE_SOURCES: 'bitfinex,coingecko' }).priceSources).toEqual(['bitfinex', 'coingecko']);
    expect(() => loadConfig({ ...env, PRICE_SOURCES: 'nope' })).toThrow('PRICE_SOURCES');
  });
});

describe('GET /v1/price', () => {
  let app: FastifyInstance;
  let setNow: (d: Date) => void;
  // Behind the front door (owner, 8 Nov 2026): a signed-in, set-up trader reads the price.
  let viewer: Browser;
  let answer: () => PriceQuote[] | Error = () => usd(33000n);

  beforeAll(async () => {
    const c = clockAt(T0);
    const xmr = createPriceFeed([stub('a', () => answer()), stub('b', () => answer())], { ...PRICE_FEED_DEFAULTS, clock: c.clock });
    const prices = createMarketPrices({ xmr, fx: createFxRates([], { clock: c.clock }), clock: c.clock });
    await prices.poll();
    let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];
    ({ app, setNow, trader } = await tradeApp({}, { prices, clock: c.clock }));
    viewer = (await trader()).browser;
    const set = setNow;
    setNow = (d) => {
      c.set(d);
      set(d);
    };
  });
  afterAll(async () => app.close());
  afterEach(() => setNow(T0));

  it('is 401 with no data without a session (the front door, owner 8 Nov 2026; it was open under P3-M9)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/price?currency=USD' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'not-authenticated' });
  });

  it('answers the median with its time and the currency exponent, and sets no cookie', async () => {
    const res = await viewer.get('/v1/price?currency=USD');
    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.json()).toEqual({ currency: 'USD', centsPerXmr: '33000', exponent: 2, at: T0.toISOString(), usdCentsPerXmr: '33000' });
  });

  it('is 503 price-unavailable once the median is 5 min + 1 ms old (Review Focus 5)', async () => {
    setNow(new Date(T0.getTime() + 5 * MIN + 1));
    const res = await viewer.get('/v1/price?currency=USD');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'price-unavailable' });
  });

  it('is 503 for a supported currency with no price', async () => {
    const res = await viewer.get('/v1/price?currency=EUR');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'price-unavailable' });
  });

  it.each([[''], ['?currency=usd'], ['?currency=XXX'], ['?currency=USD&currency=EUR'], ['?currency=US']])('refuses %s with 400', async (qs) => {
    const res = await viewer.get(`/v1/price${qs}`);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-request' });
  });

  it('logs no price, amount or currency', async () => {
    const { app: a, logs, trader } = await tradeApp();
    try {
      await (await trader()).browser.get('/v1/price?currency=USD');
      await a.inject({ method: 'GET', url: '/v1/price?currency=USD' });
      expect(logs.filter((l) => l.includes('33000') || l.includes('USD'))).toEqual([]);
    } finally {
      await a.close();
    }
  });
});
