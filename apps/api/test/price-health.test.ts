import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { addOwnerAlert } from '../src/alerts.js';
import { SESSION_COOKIE, startSession } from '../src/auth/sessions.js';
import { CURRENCY_EXPONENTS } from '../src/price/currencies.js';
import { PRICE_FEED_DEFAULTS, createPriceFeed, type PriceQuote, type PriceSource, type PriceSourceHealth } from '../src/price/feed.js';
import { createFxRates, decimalToScaled, type FxHealth, type FxSource } from '../src/price/fx.js';
import { createAlertGrouper, type HealthSnapshot, type PriceAlert } from '../src/price/health.js';
import { createMarketPrices } from '../src/price/market.js';
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
  xmr: [xmrSource('kraken', 0), xmrSource('bitfinex', 0), xmrSource('coingecko', 0)],
  fx: fxHealth(),
  paused: [],
  ...over,
});

describe('createAlertGrouper', () => {
  it('1–2 failures are retried quietly; the 3rd in a row alerts once, however long the outage; recovery gives an all-clear', () => {
    const g = createAlertGrouper();
    expect(g.update(snap())).toEqual([]);
    expect(g.update(snap({ xmr: [xmrSource('kraken', 1), xmrSource('bitfinex', 0), xmrSource('coingecko', 0)] }))).toEqual([]);
    expect(g.update(snap({ xmr: [xmrSource('kraken', 2), xmrSource('bitfinex', 0), xmrSource('coingecko', 0)] }))).toEqual([]);
    expect(g.update(snap({ xmr: [xmrSource('kraken', 3), xmrSource('bitfinex', 0), xmrSource('coingecko', 0)] }))).toEqual([
      { kind: 'price-source-failing', detail: { feed: 'xmr', source: 'kraken', reason: 'failures', message: 'Kraken price feed failing, using backup' } },
    ]);
    for (let n = 4; n < 300; n++) {
      expect(g.update(snap({ xmr: [xmrSource('kraken', n), xmrSource('bitfinex', 0), xmrSource('coingecko', 0)] }))).toEqual([]);
    }
    expect(g.update(snap())).toEqual([
      { kind: 'price-source-recovered', detail: { feed: 'xmr', source: 'kraken', message: 'Kraken price feed recovered' } },
    ]);
    expect(g.update(snap())).toEqual([]);
  });

  it('an exchange-rate source failing or stale alerts once (stale and failing are one outage)', () => {
    const g = createAlertGrouper();
    const cb = (consecutiveFailures: number, stale: boolean) =>
      fxHealth({ sources: [{ name: 'coinbase', rank: 1, lastGoodAt: T0, consecutiveFailures, stale, usedFor: [] }] });
    expect(g.update(snap({ fx: cb(0, true) }))).toEqual([
      { kind: 'price-source-failing', detail: { feed: 'fx', source: 'coinbase', reason: 'stale', message: 'Coinbase exchange rates stale, using backup' } },
    ]);
    expect(g.update(snap({ fx: cb(3, true) }))).toEqual([]);
    expect(g.update(snap({ fx: cb(12, false) }))).toEqual([]);
    expect(g.update(snap({ fx: cb(0, false) }))).toEqual([
      { kind: 'price-source-recovered', detail: { feed: 'fx', source: 'coinbase', message: 'Coinbase exchange rates recovered' } },
    ]);
    const g2 = createAlertGrouper();
    expect(g2.update(snap({ fx: cb(3, false) }))[0]!.detail).toMatchObject({ reason: 'failures', message: 'Coinbase exchange rates failing, using backup' });
  });

  it('a rate refused by the sanity guard alerts once per source and currency, and clears when accepted again', () => {
    const g = createAlertGrouper();
    const rejected = [{ source: 'coinbase', currency: 'EUR', at: T0 }];
    expect(g.update(snap({ fx: fxHealth({ rejected }) }))).toEqual([
      {
        kind: 'price-source-failing',
        detail: { feed: 'fx', source: 'coinbase', currency: 'EUR', reason: 'rejected', message: 'Coinbase EUR rate moved more than 10%, using backup' },
      },
    ]);
    expect(g.update(snap({ fx: fxHealth({ rejected }) }))).toEqual([]);
    expect(g.update(snap())).toEqual([
      { kind: 'price-source-recovered', detail: { feed: 'fx', source: 'coinbase', currency: 'EUR', message: 'Coinbase EUR rate back in range' } },
    ]);
  });

  it('paused currencies: one urgent alert per outage listing them, one all-clear when they come back', () => {
    const g = createAlertGrouper();
    expect(g.update(snap({ paused: ['NGN', 'EUR'] }))).toEqual([
      { kind: 'market-prices-paused', detail: { urgent: true, currencies: ['EUR', 'NGN'], message: 'EUR, NGN market prices paused' } },
    ]);
    expect(g.update(snap({ paused: ['EUR', 'NGN'] }))).toEqual([]);
    expect(g.update(snap({ paused: ['EUR', 'NGN', 'USD'] }))).toEqual([
      { kind: 'market-prices-paused', detail: { urgent: true, currencies: ['USD'], message: 'USD market prices paused' } },
    ]);
    expect(g.update(snap({ paused: ['NGN'] }))).toEqual([
      { kind: 'market-prices-resumed', detail: { currencies: ['EUR', 'USD'], message: 'EUR, USD market prices back' } },
    ]);
    expect(g.update(snap({ paused: ALL }))).toEqual([
      { kind: 'market-prices-paused', detail: { urgent: true, currencies: ALL.filter((c) => c !== 'NGN').sort(), message: 'Market prices paused in every currency' } },
    ]);
    expect(g.update(snap({ paused: [] }))[0]).toEqual({
      kind: 'market-prices-resumed', detail: { currencies: [...ALL].sort(), message: 'Market prices back in every currency' },
    });
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
    const prices = createMarketPrices({ xmr, fx, onAlert: (a) => void alerts.push(a) });
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
    c.advance(5 * MIN);
    await prices.poll();
    expect(alerts).toEqual([
      { kind: 'price-source-recovered', detail: { feed: 'fx', source: 'coinbase', message: 'Coinbase exchange rates recovered' } },
    ]);
    expect(prices.quote('EUR')?.fx?.source).toBe('coinbase');
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
        detail: { feed: 'fx', source: 'coinbase', currency: 'EUR', reason: 'rejected', message: 'Coinbase EUR rate moved more than 10%, using backup' },
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

  it('a failing alert sink never breaks polling', async () => {
    const c = clockAt(T0);
    const xmr = createPriceFeed([xmrStub('a', () => 33000n), xmrStub('b', () => 33000n)], { ...PRICE_FEED_DEFAULTS, clock: c.clock });
    const fx = createFxRates([fxStub('coinbase', () => ({ EUR: '0.9' }))], { clock: c.clock });
    const prices = createMarketPrices({ xmr, fx, onAlert: () => Promise.reject(new Error('db down')) });
    await expect(prices.poll()).resolves.toBeUndefined();
    expect(prices.current('EUR')?.centsPerXmr).toBe(29700n);
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
    ownerId = await seedAccount(deps, { username: 'boss', kind: 'owner' });
    traderId = await seedAccount(deps, { username: 'trader1' });
    staffId = await seedAccount(deps, { username: 'mod1', kind: 'staff' });
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
  });

  it('GET /v1/price answers the local price and its USD value, with no cookie', async () => {
    const eur = await app.inject({ method: 'GET', url: '/v1/price?currency=EUR' });
    expect(eur.statusCode).toBe(200);
    expect(eur.json()).toEqual({ currency: 'EUR', centsPerXmr: '29705', exponent: 2, at: T0.toISOString(), usdCentsPerXmr: '33005' });
    const usd = await app.inject({ method: 'GET', url: '/v1/price?currency=USD' });
    expect(usd.json()).toEqual({ currency: 'USD', centsPerXmr: '33005', exponent: 2, at: T0.toISOString(), usdCentsPerXmr: '33005' });
    const gbp = await app.inject({ method: 'GET', url: '/v1/price?currency=GBP' });
    expect(gbp.statusCode).toBe(503);
    expect(gbp.json()).toEqual({ error: 'price-unavailable' });
  });

  describe('GET /v1/owner/price-health', () => {
    it('refuses no session (401), a trader and staff (403)', async () => {
      expect((await app.inject({ method: 'GET', url: '/v1/owner/price-health' })).statusCode).toBe(401);
      for (const id of [traderId, staffId]) {
        const res = await app.inject({ method: 'GET', url: '/v1/owner/price-health', headers: { cookie: await cookieFor(id) } });
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'wrong-account-kind' });
      }
    });

    it('shows the owner every source, the paused currencies and the settings', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/owner/price-health', headers: { cookie: await cookieFor(ownerId) } });
      expect(res.statusCode).toBe(200);
      const body = res.json();
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
