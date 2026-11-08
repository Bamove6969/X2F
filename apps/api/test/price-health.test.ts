import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { addOwnerAlert } from '../src/alerts.js';
import { SESSION_COOKIE, startSession } from '../src/auth/sessions.js';
import { CURRENCY_EXPONENTS } from '../src/price/currencies.js';
import { PRICE_FEED_DEFAULTS, createPriceFeed, type PriceQuote, type PriceSource, type PriceSourceHealth } from '../src/price/feed.js';
import { createFxRates, decimalToScaled, type FxHealth, type FxSource } from '../src/price/fx.js';
import { PRICE_HEALTH_DEFAULTS, createAlertGrouper, type HealthSnapshot, type PriceAlert } from '../src/price/health.js';
import { createMarketPrices } from '../src/price/market.js';
import { priceHealthBody } from '../src/price/routes.js';
import { FX_SETTING_KEYS, loadFxSettings } from '../src/price/settings.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';

const T0 = new Date('2026-10-24T06:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const ALL = Object.keys(CURRENCY_EXPONENTS);
const NON_USD = ALL.filter((c) => c !== 'USD');

function clockAt(start: Date) {
  let now = start;
  return { clock: () => now, set: (d: Date) => void (now = d), advance: (ms: number) => void (now = new Date(now.getTime() + ms)) };
}

function xmrStub(name: string, cents: () => bigint | Error): PriceSource {
  return {
    name,
    async fetchQuotes(): Promise<PriceQuote[]> {
      const v = cents();
      if (v instanceof Error) throw v;
      return [{ currency: 'USD', centsPerXmr: v }];
    },
  };
}

function fxStub(name: string, rates: () => Record<string, string> | Error): FxSource {
  return {
    name,
    async fetchRates() {
      const x = rates();
      if (x instanceof Error) throw x;
      return new Map(Object.entries(x).map(([c, v]) => [c, decimalToScaled(v)!]));
    },
  };
}

// ---- The alert grouper (pure) ----

const xmrSource = (name: string, consecutiveFailures: number): PriceSourceHealth => ({
  name, lastGoodAt: T0, consecutiveFailures, inUse: consecutiveFailures === 0,
});
const fxHealth = (over: Partial<FxHealth> = {}): FxHealth => ({
  sources: [
    { name: 'coinbase', rank: 1, lastGoodAt: T0, consecutiveFailures: 0, stale: false, usedFor: NON_USD },
    { name: 'bitpay', rank: 2, lastGoodAt: T0, consecutiveFailures: 0, stale: false, usedFor: [] },
  ],
  rejected: [],
  settings: { staleAfterMs: HOUR, sanityBps: 1_000 },
  ...over,
});
const snap = (over: Partial<HealthSnapshot> = {}): HealthSnapshot => ({
  at: T0,
  xmr: [xmrSource('kraken', 0), xmrSource('bitfinex', 0), xmrSource('coingecko', 0)],
  fx: fxHealth(),
  paused: [],
  ...over,
});

/** A grouper fed one snapshot every `stepMs` (default 5 min, the exchange-rate poll). */
function stepper(stepMs = 5 * MIN) {
  const g = createAlertGrouper();
  let t = T0.getTime() - stepMs;
  return (over: Partial<HealthSnapshot> = {}) => {
    t += stepMs;
    return g.update(snap({ ...over, at: new Date(t) }));
  };
}
const kraken = (n: number) => ({ xmr: [xmrSource('kraken', n), xmrSource('bitfinex', 0), xmrSource('coingecko', 0)] });

describe('createAlertGrouper', () => {
  it('uses the quiet period defaults: 3 clean polls in a row and at least 15 min', () => {
    expect(PRICE_HEALTH_DEFAULTS).toEqual({ quietPolls: 3, quietMs: 15 * MIN });
  });

  it('1–2 failures are retried quietly; the 3rd in a row alerts once, however long the outage', () => {
    const step = stepper(MIN);
    expect(step()).toEqual([]);
    expect(step(kraken(1))).toEqual([]);
    expect(step(kraken(2))).toEqual([]);
    expect(step(kraken(3))).toEqual([
      { kind: 'price-source-failing', detail: { feed: 'xmr', source: 'kraken', reason: 'failures', message: 'Kraken price feed failing, using backup' } },
    ]);
    for (let n = 4; n < 300; n++) expect(step(kraken(n))).toEqual([]);
  });

  it('the all-clear waits until the condition has stayed away for 3 polls AND 15 min', () => {
    const step = stepper(5 * MIN);
    expect(step(kraken(3))).toHaveLength(1);
    expect(step(), 'clean 1 (0 min)').toEqual([]);
    expect(step(), 'clean 2 (5 min)').toEqual([]);
    expect(step(), 'clean 3 (10 min): 3 polls but not 15 min yet').toEqual([]);
    expect(step(), 'clean 4 (15 min)').toEqual([
      { kind: 'price-source-recovered', detail: { feed: 'xmr', source: 'kraken', message: 'Kraken price feed recovered' } },
    ]);
    expect(step()).toEqual([]);
    // Time alone is not enough either: polls 15 min apart still need 3 of them.
    const slow = stepper(15 * MIN);
    expect(slow(kraken(3))).toHaveLength(1);
    expect(slow(), '0 min, 1 poll').toEqual([]);
    expect(slow(), '15 min, 2 polls').toEqual([]);
    expect(slow(), '30 min, 3 polls').toHaveLength(1);
  });

  it('a flapping source (good 1 poll in 4) gives one alert per outage, not one per flap', () => {
    for (const stepMs of [MIN, 5 * MIN]) {
      const step = stepper(stepMs);
      const alerts: PriceAlert[] = [];
      for (let i = 0; i < 240; i++) alerts.push(...step(kraken([0, 1, 2, 3][i % 4]!)));
      expect(alerts, `polls every ${stepMs / MIN} min`).toEqual([
        { kind: 'price-source-failing', detail: { feed: 'xmr', source: 'kraken', reason: 'failures', message: 'Kraken price feed failing, using backup' } },
      ]);
    }
  });

  it('a condition that comes back during the quiet period is the same outage (no new alert)', () => {
    const step = stepper();
    expect(step(kraken(3))).toHaveLength(1);
    expect(step()).toEqual([]);
    expect(step()).toEqual([]);
    expect(step(kraken(3))).toEqual([]);
    for (let i = 0; i < 3; i++) expect(step()).toEqual([]);
    expect(step()).toHaveLength(1); // 15 min after it went away again
  });

  it('an exchange-rate source failing or stale alerts once (stale and failing are one outage)', () => {
    const step = stepper();
    const cb = (consecutiveFailures: number, stale: boolean) => ({
      fx: fxHealth({ sources: [{ name: 'coinbase', rank: 1, lastGoodAt: T0, consecutiveFailures, stale, usedFor: [] }] }),
    });
    expect(step(cb(0, true))).toEqual([
      { kind: 'price-source-failing', detail: { feed: 'fx', source: 'coinbase', reason: 'stale', message: 'Coinbase exchange rates stale, using backup' } },
    ]);
    expect(step(cb(3, true))).toEqual([]);
    expect(step(cb(12, false))).toEqual([]);
    for (let i = 0; i < 3; i++) expect(step(cb(0, false))).toEqual([]);
    expect(step(cb(0, false))).toEqual([
      { kind: 'price-source-recovered', detail: { feed: 'fx', source: 'coinbase', message: 'Coinbase exchange rates recovered' } },
    ]);
    const g2 = createAlertGrouper();
    expect(g2.update(snap(cb(3, false)))[0]!.detail).toMatchObject({ reason: 'failures', message: 'Coinbase exchange rates failing, using backup' });
  });

  it('a rate refused by the sanity guard alerts once per source and currency, and clears after the quiet period', () => {
    const step = stepper();
    const rejected = { fx: fxHealth({ rejected: [{ source: 'coinbase', currency: 'EUR', at: T0 }] }) };
    expect(step(rejected)).toEqual([
      {
        kind: 'price-source-failing',
        detail: { feed: 'fx', source: 'coinbase', reason: 'rejected', currencies: ['EUR'], message: 'Coinbase EUR rate off by more than 10%, using backup' },
      },
    ]);
    expect(step(rejected)).toEqual([]);
    for (let i = 0; i < 3; i++) expect(step()).toEqual([]);
    expect(step()).toEqual([
      { kind: 'price-source-recovered', detail: { feed: 'fx', source: 'coinbase', currencies: ['EUR'], message: 'Coinbase EUR rate back in range' } },
    ]);
  });

  it('refusals are grouped per source per poll: Coinbase refused for 44 currencies gives 1 alert and 1 all-clear (re-review)', () => {
    const step = stepper();
    const codes = NON_USD.slice(0, 44);
    expect(codes).toHaveLength(44);
    const all = { fx: fxHealth({ rejected: codes.map((currency) => ({ source: 'coinbase', currency, at: T0 })) }) };
    expect(step(all)).toEqual([
      {
        kind: 'price-source-failing',
        detail: { feed: 'fx', source: 'coinbase', reason: 'rejected', currencies: [...codes].sort(), message: 'Coinbase rates for 44 currencies off by more than 10%, using backup' },
      },
    ]);
    expect(step(all)).toEqual([]);
    for (let i = 0; i < 3; i++) expect(step()).toEqual([]);
    expect(step()).toEqual([
      { kind: 'price-source-recovered', detail: { feed: 'fx', source: 'coinbase', currencies: [...codes].sort(), message: 'Coinbase rates for 44 currencies back in range' } },
    ]);
    expect(step()).toEqual([]);
  });

  it('refusals of two sources in one poll give one alert each, listing their currencies', () => {
    const step = stepper();
    const rej = (source: string, currency: string) => ({ source, currency, at: T0 });
    expect(step({ fx: fxHealth({ rejected: [rej('bitpay', 'NGN'), rej('coingecko', 'NGN'), rej('bitpay', 'EUR')] }) })).toEqual([
      { kind: 'price-source-failing', detail: { feed: 'fx', source: 'bitpay', reason: 'rejected', currencies: ['EUR', 'NGN'], message: 'BitPay EUR, NGN rates off by more than 10%, using backup' } },
      { kind: 'price-source-failing', detail: { feed: 'fx', source: 'coingecko', reason: 'rejected', currencies: ['NGN'], message: 'CoinGecko NGN rate off by more than 10%, using backup' } },
    ]);
  });

  it('paused currencies: one urgent alert per outage listing them, one all-clear after the quiet period', () => {
    const step = stepper();
    expect(step({ paused: ['NGN', 'EUR'] })).toEqual([
      { kind: 'market-prices-paused', detail: { urgent: true, currencies: ['EUR', 'NGN'], message: 'EUR, NGN market prices paused' } },
    ]);
    expect(step({ paused: ['EUR', 'NGN'] })).toEqual([]);
    expect(step({ paused: ['EUR', 'NGN', 'USD'] })).toEqual([
      { kind: 'market-prices-paused', detail: { urgent: true, currencies: ['USD'], message: 'USD market prices paused' } },
    ]);
    for (let i = 0; i < 3; i++) expect(step({ paused: ['NGN'] })).toEqual([]);
    expect(step({ paused: ['NGN'] })).toEqual([
      { kind: 'market-prices-resumed', detail: { currencies: ['EUR', 'USD'], message: 'EUR, USD market prices back' } },
    ]);
    expect(step({ paused: ALL })).toEqual([
      { kind: 'market-prices-paused', detail: { urgent: true, currencies: ALL.filter((c) => c !== 'NGN').sort(), message: 'Market prices paused in every currency' } },
    ]);
    for (let i = 0; i < 3; i++) expect(step({ paused: [] })).toEqual([]);
    expect(step({ paused: [] })[0]).toEqual({
      kind: 'market-prices-resumed', detail: { currencies: [...ALL].sort(), message: 'Market prices back in every currency' },
    });
  });

  it('a flapping XMR median (every currency paused 1 poll in 2) sends one urgent alert, not one per flap', () => {
    const step = stepper(MIN);
    const alerts: PriceAlert[] = [];
    for (let i = 0; i < 120; i++) alerts.push(...step({ paused: i % 2 === 0 ? ALL : [] }));
    expect(alerts).toEqual([
      { kind: 'market-prices-paused', detail: { urgent: true, currencies: [...ALL].sort(), message: 'Market prices paused in every currency' } },
    ]);
  });
});

// ---- Market prices: XMR/USD median × USD→X ----

describe('createMarketPrices', () => {
  function build(o: { xmr?: () => bigint | Error; fx?: Array<() => Record<string, string> | Error> } = {}) {
    const c = clockAt(T0);
    const xmrAnswer = o.xmr ?? (() => 33000n);
    const xmr = createPriceFeed([xmrStub('kraken', xmrAnswer), xmrStub('bitfinex', xmrAnswer)], { ...PRICE_FEED_DEFAULTS, clock: c.clock });
    const fxAnswers = o.fx ?? [() => ({ EUR: '0.90', JPY: '156.87', KWD: '0.310706' })];
    const fx = createFxRates(fxAnswers.map((a, i) => fxStub(['coinbase', 'bitpay', 'coingecko'][i]!, a)), { clock: c.clock });
    const alerts: PriceAlert[] = [];
    const prices = createMarketPrices({ xmr, fx, clock: c.clock, onAlert: (a) => void alerts.push(a) });
    return { c, prices, alerts };
  }

  it('prices every currency as the XMR/USD median × the USD→X rate, with its USD value', async () => {
    const { prices } = build();
    expect(prices.quote('USD')).toBeNull(); // nothing polled yet
    await prices.poll();
    expect(prices.quote('USD')).toEqual({
      price: { currency: 'USD', centsPerXmr: 33000n }, at: T0, sources: 2, exponent: 2, usdCentsPerXmr: 33000n, fx: null,
    });
    expect(prices.quote('EUR')).toEqual({
      price: { currency: 'EUR', centsPerXmr: 29700n }, at: T0, sources: 2, exponent: 2, usdCentsPerXmr: 33000n,
      fx: { currency: 'EUR', rate: decimalToScaled('0.90')!, source: 'coinbase', at: T0 },
    });
    expect(prices.current('EUR')).toEqual({ currency: 'EUR', centsPerXmr: 29700n });
    // 330 × 156.87 = 51767.1 JPY (no minor unit); 330 × 0.310706 = 102.53298 KWD (3 places), half up.
    expect(prices.current('JPY')?.centsPerXmr).toBe(51767n);
    expect(prices.current('KWD')?.centsPerXmr).toBe(102533n);
    expect(prices.current('GBP')).toBeNull(); // no source has it
    expect(prices.current('XXX')).toBeNull();
  });

  it('rounds half up in the minor unit', async () => {
    const { prices } = build({ xmr: () => 1n, fx: [() => ({ EUR: '0.5' })] }); // 0.005 EUR
    await prices.poll();
    expect(prices.current('EUR')?.centsPerXmr).toBe(1n);
    const low = build({ xmr: () => 1n, fx: [() => ({ EUR: '0.49' })] }); // 0.0049 EUR: below one cent
    await low.prices.poll();
    expect(low.prices.current('EUR')).toBeNull();
  });

  it('no XMR price pauses every currency; no fresh rate pauses only that one', async () => {
    let up = true;
    const { prices, c } = build({ xmr: () => (up ? 33000n : new Error('down')) });
    await prices.poll();
    expect(prices.current('EUR')).not.toBeNull();
    up = false;
    c.advance(MIN);
    await prices.poll();
    for (const cur of ['USD', 'EUR', 'JPY']) expect(prices.current(cur), cur).toBeNull();
  });

  it('pauses one currency when all of its sources are down, and alerts once, then all-clear', async () => {
    let ngn = true;
    const answer = () => (ngn ? { EUR: '0.90', NGN: '1332' } : { EUR: '0.90' });
    const { prices, c, alerts } = build({ fx: [answer, answer, answer] });
    await prices.poll();
    expect(prices.current('NGN')).not.toBeNull();
    const firstPaused = alerts.filter((a) => a.kind === 'market-prices-paused');
    expect(firstPaused, 'currencies no source quotes are paused from the start').toHaveLength(1);
    expect(firstPaused[0]!.detail.currencies).not.toContain('NGN');
    alerts.length = 0;
    ngn = false;
    for (let i = 0; i < 6; i++) {
      c.advance(5 * MIN);
      await prices.poll();
    }
    expect(prices.current('NGN')).toBeNull();
    expect(prices.current('EUR')).not.toBeNull();
    expect(alerts).toEqual([{ kind: 'market-prices-paused', detail: { urgent: true, currencies: ['NGN'], message: 'NGN market prices paused' } }]);
    alerts.length = 0;
    ngn = true;
    for (let i = 0; i < 3; i++) {
      c.advance(5 * MIN);
      await prices.poll();
    }
    expect(prices.current('NGN'), 'the price is back at once').not.toBeNull();
    expect(alerts, 'the all-clear waits for the quiet period').toEqual([]);
    c.advance(5 * MIN);
    await prices.poll();
    expect(alerts).toEqual([{ kind: 'market-prices-resumed', detail: { currencies: ['NGN'], message: 'NGN market prices back' } }]);
  });

  it('a failing top source alerts "failing, using backup" once, the backup serves, and recovery gives an all-clear', async () => {
    let cb = true;
    const { prices, c, alerts } = build({ fx: [() => (cb ? { EUR: '0.90' } : new Error('down')), () => ({ EUR: '0.91' })] });
    await prices.poll();
    alerts.length = 0;
    cb = false;
    for (let i = 0; i < 10; i++) {
      c.advance(5 * MIN);
      await prices.poll();
    }
    expect(alerts).toEqual([
      { kind: 'price-source-failing', detail: { feed: 'fx', source: 'coinbase', reason: 'failures', message: 'Coinbase exchange rates failing, using backup' } },
    ]);
    expect(prices.quote('EUR')?.fx?.source).toBe('bitpay');
    alerts.length = 0;
    cb = true;
    for (let i = 0; i < 4; i++) {
      c.advance(5 * MIN);
      await prices.poll();
    }
    expect(alerts).toEqual([
      { kind: 'price-source-recovered', detail: { feed: 'fx', source: 'coinbase', message: 'Coinbase exchange rates recovered' } },
    ]);
    expect(prices.quote('EUR')?.fx?.source).toBe('coinbase');
  });

  it('a flapping XMR median (down every other minute) sends one urgent paused alert in an hour', async () => {
    let up = true;
    const { prices, c, alerts } = build({ xmr: () => (up ? 33000n : new Error('down')) });
    await prices.poll();
    alerts.length = 0; // the start-up alert for the currencies no source quotes
    for (let i = 0; i < 60; i++) {
      up = !up;
      c.advance(MIN);
      await prices.poll();
    }
    expect(alerts).toEqual([
      { kind: 'market-prices-paused', detail: { urgent: true, currencies: ['EUR', 'JPY', 'KWD', 'USD'], message: 'Market prices paused in every currency' } },
    ]);
  });

  it('the sanity guard raises an alert and falls back', async () => {
    let eur = '0.90';
    const { prices, c, alerts } = build({ fx: [() => ({ EUR: eur }), () => ({ EUR: '0.91' })] });
    await prices.poll();
    alerts.length = 0;
    eur = '1.20';
    c.advance(5 * MIN);
    await prices.poll();
    expect(prices.quote('EUR')?.fx?.source).toBe('bitpay');
    expect(alerts).toEqual([
      {
        kind: 'price-source-failing',
        detail: { feed: 'fx', source: 'coinbase', reason: 'rejected', currencies: ['EUR'], message: 'Coinbase EUR rate off by more than 10%, using backup' },
      },
    ]);
  });

  it('health lists every source with last good fetch, failures and use, plus the paused currencies and settings', async () => {
    const { prices } = build();
    await prices.poll();
    const h = prices.health();
    expect(h.xmr).toEqual([
      { name: 'kraken', lastGoodAt: T0, consecutiveFailures: 0, inUse: true },
      { name: 'bitfinex', lastGoodAt: T0, consecutiveFailures: 0, inUse: true },
    ]);
    expect(h.fx.sources).toEqual([
      { name: 'coinbase', rank: 1, lastGoodAt: T0, consecutiveFailures: 0, stale: false, usedFor: ['EUR', 'JPY', 'KWD'] },
    ]);
    expect(h.paused).toEqual(ALL.filter((x) => !['USD', 'EUR', 'JPY', 'KWD'].includes(x)).sort());
    expect(h.fx.settings).toEqual({ staleAfterMs: HOUR, sanityBps: 1_000 });
  });

  it('stop() waits for a poll in flight and then for the alerts it queued', async () => {
    const c = clockAt(T0);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: PriceSource = {
      name: 'slow',
      async fetchQuotes() {
        await gate;
        return [{ currency: 'USD', centsPerXmr: 33000n }];
      },
    };
    const xmr = createPriceFeed([slow, xmrStub('b', () => 33000n)], { ...PRICE_FEED_DEFAULTS, clock: c.clock, timeoutMs: 600_000 });
    const fx = createFxRates([fxStub('coinbase', () => ({ EUR: '0.9' }))], { clock: c.clock });
    let deliver!: () => void;
    const delivered = new Promise<void>((r) => (deliver = r));
    const sent: PriceAlert[] = [];
    const prices = createMarketPrices({
      xmr, fx, clock: c.clock,
      onAlert: async (a) => {
        await delivered;
        sent.push(a);
      },
    });
    prices.start();
    let stopped = false;
    const stopping = prices.stop().then(() => void (stopped = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(stopped, 'the poll is still in flight').toBe(false);
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(stopped, 'the poll is done but its alert is not delivered yet').toBe(false);
    deliver();
    await stopping;
    expect(sent.map((a) => a.kind)).toEqual(['market-prices-paused']);
  });

  it('a failing alert sink never breaks polling', async () => {
    const c = clockAt(T0);
    const xmr = createPriceFeed([xmrStub('a', () => 33000n), xmrStub('b', () => 33000n)], { ...PRICE_FEED_DEFAULTS, clock: c.clock });
    const fx = createFxRates([fxStub('coinbase', () => ({ EUR: '0.9' }))], { clock: c.clock });
    const prices = createMarketPrices({ xmr, fx, onAlert: () => Promise.reject(new Error('db down')) });
    await expect(prices.poll()).resolves.toBeUndefined();
    expect(prices.current('EUR')?.centsPerXmr).toBe(29700n);
  });

  it('a failing alert sink is logged as one fixed line per lost alert, with no alert detail (re-review I3)', async () => {
    const c = clockAt(T0);
    // Every source down: the urgent alert fires, and the sink fails.
    const xmr = createPriceFeed([xmrStub('a', () => new Error('down')), xmrStub('b', () => new Error('down'))], { ...PRICE_FEED_DEFAULTS, clock: c.clock });
    const fx = createFxRates([fxStub('coinbase', () => ({ EUR: '0.9' }))], { clock: c.clock });
    const lines: Array<[Record<string, unknown>, string]> = [];
    const prices = createMarketPrices({
      xmr, fx, clock: c.clock,
      onAlert: () => Promise.reject(Object.assign(new Error('db down'), { detail: 'Key (account_id)=(secret-owner-id)' })),
      log: { error: (obj, msg) => void lines.push([obj, msg]) },
    });
    await prices.poll();
    await prices.stop();
    expect(lines.length).toBeGreaterThan(0);
    for (const [obj, msg] of lines) {
      expect(msg).toBe('price alert not delivered');
      // Only the message, never the error object: a pg `detail` must not reach the logs (round 3).
      expect(obj).toEqual({ error: 'db down' });
    }
    expect(JSON.stringify(lines)).not.toContain('secret-owner-id');
  });
});

// ---- Database: owner settings, owner alerts, routes ----

describe('with the database', () => {
  let app: FastifyInstance;
  let deps: Deps;
  let db: pg.Pool;
  let ownerId: string;
  let traderId: string;
  let staffId: string;
  let fxUp = true;

  beforeAll(async () => {
    const c = clockAt(T0);
    const xmr = createPriceFeed([xmrStub('kraken', () => 33000n), xmrStub('bitfinex', () => 33010n)], { ...PRICE_FEED_DEFAULTS, clock: c.clock });
    const fx = createFxRates([fxStub('coinbase', () => (fxUp ? { EUR: '0.90' } : new Error('down')))], { clock: c.clock });
    const prices = createMarketPrices({ xmr, fx });
    ({ app, deps } = await testApp({ prices, clock: c.clock }));
    db = deps.db;
    await prices.poll();
    app.post('/t/login', async (req, reply) => {
      const b = req.body as { accountId: string };
      await startSession(deps, req, reply, { accountId: b.accountId, level: 'full', deviceLabel: 'Test', method: 'passkey', firstSession: true });
      return {};
    });
    ownerId = await seedAccount(deps, { loginName: 'boss', kind: 'owner' });
    traderId = await seedAccount(deps, { loginName: 'trader1' });
    staffId = await seedAccount(deps, { loginName: 'mod1', kind: 'staff' });
  });
  afterAll(async () => app.close());

  async function cookieFor(accountId: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/t/login', headers: { origin: 'https://x2f.test' }, payload: { accountId } });
    const set = [res.headers['set-cookie']].flat().find((h) => typeof h === 'string' && h.startsWith(`${SESSION_COOKIE}=`))!;
    return set.split(';')[0]!;
  }

  it('owner settings: the migration stores 1 h and 10%; a change is read; a bad row falls back to the default', async () => {
    expect(FX_SETTING_KEYS).toEqual({ staleAfter: 'fx_stale_after_min', sanity: 'fx_sanity_pct' });
    expect(await loadFxSettings(db)).toEqual({ staleAfterMs: HOUR, sanityBps: 1_000 });
    await db.query(`update owner_settings set value = 90 where key = 'fx_stale_after_min'`);
    await db.query(`update owner_settings set value = 5 where key = 'fx_sanity_pct'`);
    expect(await loadFxSettings(db)).toEqual({ staleAfterMs: 90 * MIN, sanityBps: 500 });
    await db.query(`update owner_settings set value = 0 where key = 'fx_stale_after_min'`);
    await db.query(`delete from owner_settings where key = 'fx_sanity_pct'`);
    expect(await loadFxSettings(db)).toEqual({ staleAfterMs: HOUR, sanityBps: 1_000 });
    await db.query(`update owner_settings set value = 60 where key = 'fx_stale_after_min'`);
    await db.query(`insert into owner_settings (key, value, updated_at) values ('fx_sanity_pct', 10, now())`);
  });

  it('an owner alert goes to the owner account only', async () => {
    await addOwnerAlert(db, 'market-prices-paused', { urgent: true, currencies: ['EUR'], message: 'EUR market prices paused' }, T0);
    const { rows } = await db.query<{ account_id: string; kind: string; detail: unknown }>(
      `select account_id, kind, detail from alerts where kind like 'market-%' or kind like 'price-%'`,
    );
    expect(rows).toEqual([
      { account_id: ownerId, kind: 'market-prices-paused', detail: { urgent: true, currencies: ['EUR'], message: 'EUR market prices paused' } },
    ]);
    // A disabled owner account gets nothing.
    await db.query('update accounts set disabled_at = $2 where id = $1', [ownerId, T0]);
    try {
      await addOwnerAlert(db, 'market-prices-resumed', { currencies: ['EUR'], message: 'EUR market prices back' }, T0);
      const after = await db.query(`select 1 from alerts where kind = 'market-prices-resumed'`);
      expect(after.rows).toEqual([]);
    } finally {
      await db.query('update accounts set disabled_at = null where id = $1', [ownerId]);
    }
  });

  it('GET /v1/price answers a signed-in trader the local price and its USD value (behind the front door, owner 8 Nov 2026)', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/price?currency=EUR' })).statusCode).toBe(401);
    const headers = { cookie: await cookieFor(traderId) };
    const eur = await app.inject({ method: 'GET', url: '/v1/price?currency=EUR', headers });
    expect(eur.statusCode).toBe(200);
    expect(eur.json()).toEqual({ currency: 'EUR', centsPerXmr: '29705', exponent: 2, at: T0.toISOString(), usdCentsPerXmr: '33005' });
    const usd = await app.inject({ method: 'GET', url: '/v1/price?currency=USD', headers });
    expect(usd.json()).toEqual({ currency: 'USD', centsPerXmr: '33005', exponent: 2, at: T0.toISOString(), usdCentsPerXmr: '33005' });
    const gbp = await app.inject({ method: 'GET', url: '/v1/price?currency=GBP', headers });
    expect(gbp.statusCode).toBe(503);
    expect(gbp.json()).toEqual({ error: 'price-unavailable' });
  });

  describe("the owner's Price health (staff API only, owner Q13)", () => {
    it('is gone from the trader API: 404 for no session and for the owner', async () => {
      expect((await app.inject({ method: 'GET', url: '/v1/owner/price-health' })).statusCode).toBe(404);
      const res = await app.inject({ method: 'GET', url: '/v1/owner/price-health', headers: { cookie: await cookieFor(ownerId) } });
      expect(res.statusCode).toBe(404);
    });

    it('priceHealthBody (served at GET /staff/v1/price-health) shows every source, the paused currencies and the settings', async () => {
      const body = priceHealthBody(deps.prices);
      expect(body.xmr).toEqual([
        { name: 'kraken', lastGoodAt: T0.toISOString(), consecutiveFailures: 0, inUse: true },
        { name: 'bitfinex', lastGoodAt: T0.toISOString(), consecutiveFailures: 0, inUse: true },
      ]);
      expect(body.fx).toEqual([
        { name: 'coinbase', rank: 1, lastGoodAt: T0.toISOString(), consecutiveFailures: 0, stale: false, inUse: true, usedFor: ['EUR'] },
      ]);
      expect(body.rejected).toEqual([]);
      expect(body.paused).toContain('GBP');
      expect(body.paused).not.toContain('EUR');
      expect(body.settings).toEqual({ staleAfterMinutes: 60, sanityPercent: 10 });
    });
  });
});
