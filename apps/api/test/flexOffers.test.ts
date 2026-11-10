import { atomicForFiat, fiatCents, rateFor } from '@x2f/trade';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { currencyExponent } from '../src/price/currencies.js';
import type { MarketPrices, MarketQuote } from '../src/price/market.js';
import { applyEvent, loadTrade, loadTradeRow } from '../src/trades/store.js';
import { makeVendor, seedAccount } from './helpers/accounts.js';
import { flexBody } from './helpers/offers.js';
import { Browser } from './helpers/totp.js';
import { tradeApp } from './helpers/tradeApp.js';
import { XMR, fakeAddress, happyPath, seedReviews, seedTrade } from './helpers/trades.js';

// J-16, Plan 3 Tasks 34/35 rebuilt with the owner's numbers: at most 3 bands per currency and 5
// payment types per offer (Q23), bands in whole units following on one unit later (2 Nov), a second
// band on the same amounts only when it differs by a condition (Q20/F3: the lead's default list,
// pending p11-60), up to 5 currencies with their own bands, methods offered in some or all of them
// with instructions per method and currency; the buyer picks a currency and a method at take, both
// locked into the trade; market ± X% only (no fixed price). Real Postgres; a fake market (USD
// $330.00 per XMR, EUR 0.9 of it, every other known currency 1.0 of it unless made unpriced, or moved
// to a rate of its own in `market.rates`).

const DAY = 86_400_000;
const market = { usdCentsPerXmr: 33_000n as bigint | null, unpriced: new Set<string>(), rates: new Map<string, bigint>() };

function quote(currency: string): MarketQuote | null {
  const usd = market.usdCentsPerXmr;
  const exponent = currencyExponent(currency);
  if (usd === null || exponent === null || market.unpriced.has(currency)) return null;
  const local = market.rates.get(currency) ?? (currency === 'EUR' ? (usd * 9n) / 10n : usd);
  return { price: { currency, centsPerXmr: local }, at: new Date('2026-10-17T11:59:00Z'), sources: 3, exponent, usdCentsPerXmr: usd, fx: null };
}

const prices: MarketPrices = {
  current: (c) => quote(c)?.price ?? null,
  quote,
  health: () => ({ xmr: [], fx: { sources: [], rejected: [], settings: { staleAfterMs: 0, sanityBps: 0 } }, paused: [] }) as unknown as ReturnType<MarketPrices['health']>,
  poll: async () => {},
  start: () => {},
  stop: async () => {},
};

let app: FastifyInstance;
let deps: Deps;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];
/**
 * Browsing is behind the front door (owner, 8 Nov 2026): the lists and offers are read by a
 * bystander, a Graduated vendor with 20 released trades and no ties to anyone (as offers.test).
 */
let viewer: Browser;
const VIEWER_TRADES = 20;

beforeAll(async () => {
  ({ app, deps, trader } = await tradeApp({}, { prices }));
  viewer = (await person(VIEWER_TRADES)).browser;
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  market.usdCentsPerXmr = 33_000n;
  market.unpriced = new Set();
  market.rates = new Map();
});

type Who = Awaited<ReturnType<typeof trader>> & { wallet: string };

async function addWallet(accountId: string): Promise<string> {
  const now = deps.clock();
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into wallets (account_id, app, label, address, created_at, usable_from) values ($1, 'feather', 'Main', $2, $3, $4) returning id`,
    [accountId, fakeAddress(), new Date(now.getTime() - 2 * DAY), new Date(now.getTime() - DAY)],
  );
  return rows[0]!.id;
}

/** A vendor with a usable wallet, a 40-day-old account and `completed` released, rated trades. */
async function person(completed = 2): Promise<Who> {
  const t = await trader();
  const wallet = await addWallet(t.id);
  await makeVendor(deps, t.id);
  const now = deps.clock();
  await deps.db.query('update accounts set created_at = $2 where id = $1', [t.id, new Date(now.getTime() - 40 * DAY)]);
  for (let i = 0; i < completed; i++) {
    const other = await seedAccount(deps, { loginName: `cp${Math.random().toString(36).slice(2, 12)}` });
    const { code } = await seedTrade(deps, { sellerId: t.id, buyerId: other, poster: 'seller' });
    await deps.db.query(`update trades set state = 'released', closed_at = $2 where code = $1`, [code, now]);
    await seedReviews(deps, code);
  }
  return { ...t, wallet };
}

const band = (min: string, max: string, marginBps = 0, minTrades: number | null = null, methodIds?: string[]) =>
  methodIds === undefined ? { min, max, marginBps, minTrades } : { min, max, marginBps, minTrades, methodIds };
const method = (methodId: string, adjustBps = 0, instructions = '', more: Record<string, unknown> = {}) => ({ methodId, adjustBps, instructions, ...more });

/** Tests share one database: each uses currencies of its own to keep their lists apart. */
function flex(currency: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    side: 'sell', terms: 'Flexible.',
    currencies: [{ currency, bands: [band('10', '100', 100), band('101', '5000', 50, 5)] }],
    methods: [method('ZELLE', 0, 'Zelle to pay@example.test'), method('PAYPAL', 200, 'PayPal friends and family')],
    ...over,
  };
}

async function post(who: Who, b: Record<string, unknown>): Promise<string> {
  const res = await who.browser.post('/v1/offers', b);
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { id: string }).id;
}

type Card = Record<string, unknown> & { id: string; rate: string | null };

async function list(q: string, who: Browser = viewer): Promise<Card[]> {
  const res = await who.get(`/v1/offers?${q}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Card[];
}

function takeBody(who: Who, amountAtomic: bigint, centsPerXmr: bigint, methodId: string, currency: string): Record<string, unknown> {
  return {
    amountAtomic: amountAtomic.toString(), walletId: who.wallet, centsPerXmr: centsPerXmr.toString(), methodId, currency,
    fiatCents: fiatCents(amountAtomic, { currency, centsPerXmr }).toString(),
  };
}

const refusal = (res: { statusCode: number; json(): unknown }) => ({ status: res.statusCode, ...(res.json() as object) });
const market$ = (currency: string) => prices.current(currency)!;

describe('posting a flexible offer (the owner numbers)', () => {
  it('takes currencies, bands and methods; the old single-method shape is 400', async () => {
    const p = await person();
    await post(p, flex('NZD'));
    const old = await p.browser.post('/v1/offers', {
      side: 'sell', methodId: 'ZELLE', currency: 'NZD', pricing: { mode: 'market', marginBps: 0 }, minFiatCents: '1000', maxFiatCents: '9000', minTrades: null, terms: '',
    });
    expect(old.statusCode).toBe(400);
  });

  it('at most 5 payment types per offer (owner Q23)', async () => {
    const p = await person();
    const five = ['ZELLE', 'PAYPAL', 'REVOLUT', 'TRANSFERWISE', 'ACH_TRANSFER'].map((m) => method(m));
    await post(p, flex('CHF', { methods: five }));
    const six = await p.browser.post('/v1/offers', flex('CHF', { methods: [...five, method('VENMO')] }));
    expect(six.statusCode).toBe(400);
  });

  it('at most 3 bands per currency (owner Q23); no gap; whole units following on', async () => {
    const p = await person();
    const three = [band('10', '100'), band('101', '200', 10), band('201', '300', 20)];
    await post(p, flex('SEK', { currencies: [{ currency: 'SEK', bands: three }] }));
    for (const bands of [
      [...three, band('301', '400', 30)],
      [band('10', '100'), band('102', '200', 10)],
      [band('10', '100.5')],
      [band('10', '100', 0, 3)],
    ]) {
      const res = await p.browser.post('/v1/offers', flex('SEK', { currencies: [{ currency: 'SEK', bands }] }));
      expect(res.statusCode, JSON.stringify(bands)).toBe(400);
    }
  });

  it('a second band on the same amounts needs another condition (lead default, pending the owner)', async () => {
    const p = await person();
    const res = await p.browser.post('/v1/offers', flex('DKK', { currencies: [{ currency: 'DKK', bands: [band('10', '100', 50), band('10', '100', 50)] }] }));
    expect(res.statusCode).toBe(400);
    await post(p, flex('DKK', { currencies: [{ currency: 'DKK', bands: [band('10', '100', 50), band('10', '100', 20, 25)] }] }));
    // A band for some payment types only; naming one not offered in the currency is 400.
    await post(p, flex('DKK', { currencies: [{ currency: 'DKK', bands: [band('10', '100', 50), band('10', '100', 50, null, ['ZELLE'])] }] }));
    const stranger = await p.browser.post('/v1/offers', flex('DKK', { currencies: [{ currency: 'DKK', bands: [band('10', '100', 0, null, ['VENMO'])] }] }));
    expect(stranger.statusCode).toBe(400);
  });

  it('every margin + adjustment within ±50%; every currency has a method; at most 5 currencies', async () => {
    const p = await person();
    const over = await p.browser.post('/v1/offers', flex('PLN', { currencies: [{ currency: 'PLN', bands: [band('1', '9', 4900)] }], methods: [method('ZELLE', 200)] }));
    expect(over.statusCode).toBe(400);
    const lonely = await p.browser.post('/v1/offers', {
      ...flex('PLN'), currencies: [{ currency: 'PLN', bands: [band('1', '9')] }, { currency: 'CZK', bands: [band('1', '9')] }],
      methods: [method('ZELLE', 0, '', { currencies: ['PLN'] })],
    });
    expect(lonely.statusCode).toBe(400);
    const six = ['PLN', 'CZK', 'HUF', 'UAH', 'TRY', 'GEL'].map((currency) => ({ currency, bands: [band('1', '9')] }));
    expect((await p.browser.post('/v1/offers', flex('PLN', { currencies: six }))).statusCode).toBe(400);
    await post(p, flex('PLN', { currencies: six.slice(0, 5) }));
  });

  it('an XMR offer has one band per currency (lead default until the owner rules)', async () => {
    const p = await person();
    const xmr = (bands: unknown[]) => flex('ILS', { amountUnit: 'xmr', currencies: [{ currency: 'ILS', bands }] });
    await post(p, xmr([band((XMR / 2n).toString(), (XMR * 3n).toString(), 100)]));
    const two = await p.browser.post('/v1/offers', xmr([band('1', XMR.toString()), band((XMR + 1n).toString(), (XMR * 2n).toString(), 10)]));
    expect(two.statusCode).toBe(400);
    const card = (await list('side=sell&method=ZELLE&currency=ILS')).at(-1)!;
    expect(card).toMatchObject({ amountUnit: 'xmr', minAtomic: (XMR / 2n).toString(), maxAtomic: (XMR * 3n).toString() });
  });

  it("a method's price change is -5% to +10% in steps of 0.5% (the owner's rule, review I4): the API and the database refuse the rest", async () => {
    const p = await person();
    // Each of these keeps band + change within ±50% (the band is +1%): only the change rule refuses them.
    for (const adjustBps of [-550, 1050, 37, 525, 2000, -2000]) {
      const res = await p.browser.post('/v1/offers', flex('NOK', { methods: [method('ZELLE', adjustBps)] }));
      expect(res.statusCode, `adjustBps ${adjustBps}`).toBe(400);
    }
    const ids: string[] = [];
    for (const adjustBps of [-500, 1000, 50]) ids.push(await post(p, flex('NOK', { methods: [method('ZELLE', adjustBps)] })));
    // The database's own check, for a row written past the API.
    for (const adjustBps of [25, 1500, -550]) {
      await expect(
        deps.db.query(`insert into offer_methods (offer_id, position, method_id, instructions, adjust_bps) values ($1, 7, 'VENMO', '', $2)`, [ids[0], adjustBps]),
      ).rejects.toThrow(/adjust_bps/);
    }
  });
});

describe('browsing by currency and method', () => {
  it('a card is in the filtered currency, priced by band and method; an amount no band holds has no rate', async () => {
    const p = await person();
    const id = await post(p, flex('AED'));
    const usd = market$('AED');
    const zelle = (await list('side=sell&method=ZELLE&currency=AED')).find((c) => c.id === id)!;
    expect(zelle).toMatchObject({
      currency: 'AED', currencies: ['AED'], amountUnit: 'fiat', minFiatCents: '1000', maxFiatCents: '500000', minTrades: null,
      tiers: [
        { min: '1000', max: '10099', marginBps: 100, minTrades: null, methodIds: null },
        { min: '10100', max: '500000', marginBps: 50, minTrades: 5, methodIds: null },
      ],
      methods: [{ methodId: 'ZELLE', adjustBps: 0 }, { methodId: 'PAYPAL', adjustBps: 200 }],
    });
    // The bystander's 20 trades meet the second band's rule, so the headline is its +0.5%; a viewer
    // with 0 trades gets the +1% band (the front door: every list is a signed-in one).
    expect(zelle.rate).toBe(rateFor(usd, 50).centsPerXmr.toString());
    const fresh = await person(0);
    expect((await list('side=sell&method=ZELLE&currency=AED', fresh.browser)).find((c) => c.id === id)!.rate).toBe(rateFor(usd, 100).centsPerXmr.toString());
    const paypal = (await list('side=sell&method=PAYPAL&currency=AED&amount=20000', fresh.browser)).find((c) => c.id === id)!;
    expect(paypal.rate).toBe(rateFor(usd, 250).centsPerXmr.toString());
    expect(paypal.pricing).toEqual({ mode: 'market', marginBps: 250 });
    expect((await list('side=sell&method=ZELLE&currency=AED&amount=999')).find((c) => c.id === id)!.rate).toBeNull();
    // The instructions are the poster's: never on a public card.
    expect(JSON.stringify(zelle)).not.toContain('pay@example.test');
    // Not listed under a method or currency it does not take.
    expect((await list('side=sell&method=REVOLUT&currency=AED')).some((c) => c.id === id)).toBe(false);
    expect((await list('side=sell&method=ZELLE&currency=SAR')).some((c) => c.id === id)).toBe(false);
  });

  it('a band for some payment types prices only those; a viewer with enough trades gets the better band', async () => {
    const p = await person();
    const id = await post(p, flex('BHD', {
      currencies: [{ currency: 'BHD', bands: [band('10', '100', 200), band('10', '100', 50, 5, ['ZELLE'])] }],
    }));
    const m = market$('BHD');
    const seasoned = await person(5);
    const z = (await list('side=sell&method=ZELLE&currency=BHD&amount=50000', seasoned.browser)).find((c) => c.id === id)!;
    expect(z.rate).toBe(rateFor(m, 50).centsPerXmr.toString());
    const pp = (await list('side=sell&method=PAYPAL&currency=BHD&amount=50000', seasoned.browser)).find((c) => c.id === id)!;
    expect(pp.rate).toBe(rateFor(m, 400).centsPerXmr.toString());
    // A viewer short of the rule sees the band anyone gets.
    const fresh = await person(0);
    expect((await list('side=sell&method=ZELLE&currency=BHD&amount=50000', fresh.browser)).find((c) => c.id === id)!.rate).toBe(rateFor(m, 200).centsPerXmr.toString());
    // The signed-in viewer's own completed trades travel with the card, so the quote picks the band
    // the take will (pickTier); every list is a signed-in one (the front door).
    expect((z as { viewerTrades?: number }).viewerTrades).toBe(5);
    expect(((await list('side=sell&method=ZELLE&currency=BHD', fresh.browser)).find((c) => c.id === id) as { viewerTrades?: number }).viewerTrades).toBe(0);
    expect(((await list('side=sell&method=ZELLE&currency=BHD')).find((c) => c.id === id) as { viewerTrades?: number }).viewerTrades).toBe(VIEWER_TRADES);
  });

  it('a currency with no market price lists nothing; the offer still lists under its other currencies', async () => {
    const p = await person();
    const id = await post(p, {
      ...flex('THB'), currencies: [{ currency: 'THB', bands: [band('10', '100')] }, { currency: 'MYR', bands: [band('20', '200')] }],
    });
    market.unpriced = new Set(['THB']);
    expect(await list('side=sell&method=ZELLE&currency=THB')).toEqual([]);
    expect((await list('side=sell&method=ZELLE&currency=MYR')).find((c) => c.id === id)).toMatchObject({ currency: 'MYR', currencies: ['THB', 'MYR'] });
    // The single offer still opens in THB, with no rate.
    expect((await viewer.get(`/v1/offers/${id}?currency=THB`)).json()).toMatchObject({ currency: 'THB', rate: null });
    market.unpriced = new Set(['THB', 'MYR']);
    const mine = (await p.browser.get('/v1/account/offers')).json() as { id: string; hidden?: string }[];
    expect(mine.find((o) => o.id === id)?.hidden).toBe('no-price');
  });
});

describe('the currency picker (owner Q28, Q24)', () => {
  it('USD, EUR, GBP, CAD, AUD, JPY first, then A-Z with flags; no rate: kept, unavailable, and back with its rate', async () => {
    const get = async () => ((await viewer.get('/v1/currencies')).json() as { currencies: { code: string; flag: string; available: boolean }[] }).currencies;
    const all = await get();
    expect(all.slice(0, 6).map((c) => c.code)).toEqual(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY']);
    const rest = all.slice(6).map((c) => c.code);
    expect(rest).toEqual([...rest].sort());
    expect(all.find((c) => c.code === 'USD')).toEqual({ code: 'USD', flag: '\u{1F1FA}\u{1F1F8}', available: true });
    market.unpriced = new Set(['JPY']);
    expect((await get()).find((c) => c.code === 'JPY')).toMatchObject({ available: false });
    market.unpriced = new Set();
    expect((await get()).find((c) => c.code === 'JPY')).toMatchObject({ available: true });
  });
});

describe('taking a flexible offer', () => {
  it('needs a currency of the offer and a method offered in it; locks them and that pair\'s instructions', async () => {
    const p = await person();
    const id = await post(p, {
      side: 'sell', terms: 'Two currencies.',
      currencies: [{ currency: 'HKD', bands: [band('20', '500', 100)] }, { currency: 'TWD', bands: [band('10', '900', 300)] }],
      methods: [
        method('ZELLE', 0, 'Zelle to pay@example.test', { currencies: ['HKD'] }),
        method('PAYPAL', 200, 'PayPal friends and family', { instructionsByCurrency: { TWD: 'PayPal TWD to tw@example.test' } }),
      ],
    });
    const t = await person();
    const amount = XMR / 10n;
    const twd = rateFor(market$('TWD'), 500).centsPerXmr;
    // Zelle is not offered in TWD; KRW is not on the offer; the old body without them is 400.
    expect((await t.browser.post(`/v1/offers/${id}/take`, takeBody(t, amount, twd, 'ZELLE', 'TWD'))).statusCode).toBe(400);
    expect((await t.browser.post(`/v1/offers/${id}/take`, takeBody(t, amount, twd, 'PAYPAL', 'KRW'))).statusCode).toBe(400);
    const { methodId: _m, currency: _c, ...old } = takeBody(t, amount, twd, 'PAYPAL', 'TWD');
    expect((await t.browser.post(`/v1/offers/${id}/take`, old)).statusCode).toBe(400);
    const res = await t.browser.post(`/v1/offers/${id}/take`, takeBody(t, amount, twd, 'PAYPAL', 'TWD'));
    expect(res.statusCode, res.body).toBe(200);
    const row = (await loadTradeRow(deps.db, (res.json() as { code: string }).code))!;
    expect(row).toMatchObject({ method_id: 'PAYPAL', locked_currency: 'TWD', locked_cents_per_xmr: twd.toString(), method_instructions: 'PayPal TWD to tw@example.test' });
    // The band's fiat limits, as covered (10-900 TWD, the top band ending at its max).
    expect(row).toMatchObject({ min_fiat_cents: '1000', max_fiat_cents: '90000' });
    // The trade view shows the instructions only once the escrow is secured.
    const view = (await t.browser.get(`/v1/trades/${row.code}`)).json() as { paymentInstructions: unknown };
    expect(view.paymentInstructions).toBeNull();
    // A trade's deal never changes, its instructions included.
    await expect(deps.db.query(`update trades set method_instructions = 'x' where code = $1`, [row.code])).rejects.toThrow(/deal never changes/);
  });

  it('the band holding the total, the best for the taker of those whose rule they meet; refusals name the rule', async () => {
    const p = await person();
    const id = await post(p, flex('MXN', {
      currencies: [{ currency: 'MXN', bands: [band('10', '1000', 200), band('10', '1000', 50, 10)] }],
    }));
    const m = market$('MXN');
    const newbie = await person(0);
    // 0.25 XMR at about 330 = about 82: inside 10-1000 (and under a Starter's $200 cap). A newbie
    // gets +2%; a 10-trade taker gets +0.5%.
    const amount = XMR / 2n;
    const r2 = rateFor(m, 200).centsPerXmr;
    const at2 = await newbie.browser.post(`/v1/offers/${id}/take`, takeBody(newbie, amount / 2n, r2, 'ZELLE', 'MXN'));
    expect(at2.statusCode, at2.body).toBe(200);
    expect((at2.json() as { centsPerXmr: string }).centsPerXmr).toBe(r2.toString());
    const pro = await person(10);
    const r05 = rateFor(m, 50).centsPerXmr;
    const at05 = await pro.browser.post(`/v1/offers/${id}/take`, takeBody(pro, amount / 2n, r05, 'ZELLE', 'MXN'));
    expect(at05.statusCode, at05.body).toBe(200);
    expect((at05.json() as { centsPerXmr: string }).centsPerXmr).toBe(r05.toString());
    // Outside every band: out-of-range.
    const big = await person(10);
    expect(refusal(await big.browser.post(`/v1/offers/${id}/take`, takeBody(big, XMR * 4n, r05, 'ZELLE', 'MXN')))).toEqual({ status: 409, error: 'out-of-range' });
  });

  it('a band whose rule the taker misses is refused with that rule', async () => {
    const p = await person();
    const id = await post(p, flex('ZAR', { currencies: [{ currency: 'ZAR', bands: [band('10', '5000', 0, 25)] }] }));
    const t = await person(0);
    const r = rateFor(market$('ZAR'), 0).centsPerXmr;
    expect(refusal(await t.browser.post(`/v1/offers/${id}/take`, takeBody(t, XMR, r, 'ZELLE', 'ZAR')))).toEqual({ status: 409, error: 'not-enough-trades', minTrades: 25 });
  });
});

describe('review M1: the band the taker gets, the instructions once secured, the no-rate paths, the band edges', () => {
  it("a taker who misses the better band's rule and quotes its rate is refused price-changed; that band never locks (M1a)", async () => {
    const p = await person();
    const id = await post(p, flex('BRL', { currencies: [{ currency: 'BRL', bands: [band('10', '1000', 200), band('10', '1000', 50, 10)] }] }));
    const m = market$('BRL');
    const newbie = await person(0);
    // The +0.5% band is for 10 completed trades; a newbie's band is +2%, about 1.5% off, past the 0.5% tolerance.
    const better = rateFor(m, 50).centsPerXmr;
    expect(refusal(await newbie.browser.post(`/v1/offers/${id}/take`, takeBody(newbie, XMR / 4n, better, 'ZELLE', 'BRL')))).toEqual({ status: 409, error: 'price-changed' });
    expect((await deps.db.query('select 1 from trades where offer_id = $1', [id])).rowCount).toBe(0);
    // Quoting their own band's rate, they trade at it.
    const own = rateFor(m, 200).centsPerXmr;
    const res = await newbie.browser.post(`/v1/offers/${id}/take`, takeBody(newbie, XMR / 4n, own, 'ZELLE', 'BRL'));
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { centsPerXmr: string }).centsPerXmr).toBe(own.toString());
  });

  it('the locked instructions reach both traders once the escrow is secured, and neither before (M1b)', async () => {
    const p = await person();
    const id = await post(p, flex('ARS', { methods: [method('ZELLE', 0, 'Zelle to pay@example.test')] }));
    const t = await person();
    const res = await t.browser.post(`/v1/offers/${id}/take`, takeBody(t, XMR / 4n, rateFor(market$('ARS'), 100).centsPerXmr, 'ZELLE', 'ARS'));
    expect(res.statusCode, res.body).toBe(200);
    const code = (res.json() as { code: string }).code;
    const shown = async (who: Who) => ((await who.browser.get(`/v1/trades/${code}`)).json() as { paymentInstructions: unknown }).paymentInstructions;
    expect([await shown(t), await shown(p)]).toEqual([null, null]);
    // The happy path step by step: still hidden through funding and securing, shown from secured on.
    for (const step of happyPath((await loadTrade(deps.db, code))!, fakeAddress())) {
      await applyEvent(deps, code, step.e, step.by);
      if (step.to === 'secured') break;
      expect([await shown(t), await shown(p)], step.to).toEqual([null, null]);
    }
    expect([await shown(t), await shown(p)]).toEqual(['Zelle to pay@example.test', 'Zelle to pay@example.test']);
  });

  it("offer detail: anyone but the poster gets the currency's methods without their instructions; the poster gets them (M1c)", async () => {
    // Behind the front door a bystander and another trader read it; a logged-out visitor gets 401 (frontDoor.test).
    const p = await person();
    const id = await post(p, flex('IDR', {
      methods: [method('ZELLE', 0, 'Zelle to pay@example.test'), method('PAYPAL', 200, 'PayPal shared', { instructionsByCurrency: { IDR: 'PayPal IDR to id@example.test' } })],
    }));
    const other = await person();
    for (const who of [viewer, other.browser]) {
      const res = await who.get(`/v1/offers/${id}?currency=IDR`);
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json() as { methods: unknown[] }).methods).toEqual([{ methodId: 'ZELLE', adjustBps: 0 }, { methodId: 'PAYPAL', adjustBps: 200 }]);
      expect(res.body).not.toContain('example.test');
    }
    const own = (await p.browser.get(`/v1/offers/${id}?currency=IDR`)).json() as { methods: unknown[] };
    expect(own.methods).toEqual([
      { methodId: 'ZELLE', adjustBps: 0, instructions: 'Zelle to pay@example.test' },
      { methodId: 'PAYPAL', adjustBps: 200, instructions: 'PayPal IDR to id@example.test' },
    ]);
  });

  it('a take in the unpriced currency of a multi-currency offer is refused price-unavailable; its other currency still takes (M1d)', async () => {
    const p = await person();
    const id = await post(p, { ...flex('PHP'), currencies: [{ currency: 'PHP', bands: [band('10', '100')] }, { currency: 'INR', bands: [band('10', '100')] }] });
    const t = await person();
    // The rate the taker's quote showed before the feed lost INR.
    const quoted = market$('INR').centsPerXmr;
    market.unpriced = new Set(['INR']);
    expect(refusal(await t.browser.post(`/v1/offers/${id}/take`, takeBody(t, XMR / 4n, quoted, 'ZELLE', 'INR')))).toEqual({ status: 409, error: 'price-unavailable' });
    expect((await deps.db.query('select 1 from trades where offer_id = $1', [id])).rowCount).toBe(0);
    const ok = await t.browser.post(`/v1/offers/${id}/take`, takeBody(t, XMR / 4n, market$('PHP').centsPerXmr, 'ZELLE', 'PHP'));
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('an offer hidden while its currency has no rate is listed again once the rate returns (M1e)', async () => {
    const p = await person();
    const id = await post(p, flex('SGD'));
    const q = 'side=sell&method=ZELLE&currency=SGD';
    expect((await list(q)).some((c) => c.id === id)).toBe(true);
    market.unpriced = new Set(['SGD']);
    expect(await list(q)).toEqual([]);
    market.unpriced = new Set();
    // Back with its rate (the bystander's 20 trades meet the second band's rule: its +0.5%).
    expect((await list(q)).find((c) => c.id === id)).toMatchObject({ currency: 'SGD', rate: rateFor(market$('SGD'), 50).centsPerXmr.toString() });
  });

  it('band edges through a take (owner 2 Nov: 200-500 then 501-800): 500.50 and 500.99 lock the first band, 501.00 the second; 199.99 and 800.01 are out of range (M1f)', async () => {
    // Totals up to 800 (about $800 here): Building traders, whose cap is $1,000.
    const p = await person(5);
    const id = await post(p, flex('CNY', { currencies: [{ currency: 'CNY', bands: [band('200', '500', 100), band('501', '800', 200)] }] }));
    const m = market$('CNY');
    const r1 = rateFor(m, 100).centsPerXmr;
    const r2 = rateFor(m, 200).centsPerXmr;
    /** The smallest amount whose total at `rate` is exactly `cents` (fiatCents rounds half up). */
    const amountFor = (cents: bigint, rate: bigint): bigint => {
      const at = { currency: 'CNY', centsPerXmr: rate };
      let a = atomicForFiat(cents, at);
      while (fiatCents(a, at) < cents) a += 1n;
      expect(fiatCents(a, at)).toBe(cents);
      return a;
    };
    const takeAt = async (t: Who, cents: bigint, rate: bigint) => t.browser.post(`/v1/offers/${id}/take`, takeBody(t, amountFor(cents, rate), rate, 'ZELLE', 'CNY'));
    // A refused take leaves no trade, so one taker tries both ends; each take that goes through needs a taker of its own (one waiting take per buyer per ad).
    const edge = await person(5);
    for (const [cents, rate] of [[19999n, r1], [80001n, r2]] as const) {
      expect(refusal(await takeAt(edge, cents, rate)), String(cents)).toEqual({ status: 409, error: 'out-of-range' });
    }
    // The band is picked by the total, and the rate that locks is that band's: a wrong band would answer price-changed (1% apart).
    for (const [cents, rate] of [[20000n, r1], [50050n, r1], [50099n, r1], [50100n, r2], [80000n, r2]] as const) {
      const res = await takeAt(await person(5), cents, rate);
      expect(res.statusCode, `${cents}: ${res.body}`).toBe(200);
      expect(res.json()).toMatchObject({ centsPerXmr: rate.toString(), fiatCents: cents.toString() });
    }
  });
});

describe('review M2: two bands priced within the 0.5% tolerance', () => {
  it("a taker quoting the better band they do not qualify for gets their own band, at its rate; the answer carries the rate that locked", async () => {
    const p = await person();
    // +2.0% for anyone, +1.7% for 5 completed trades: 0.3% apart, inside the tolerance.
    const id = await post(p, flex('BMD', { currencies: [{ currency: 'BMD', bands: [band('10', '1000', 200), band('10', '1000', 170, 5)] }] }));
    const m = market$('BMD');
    const newbie = await person(0);
    const shown = rateFor(m, 170).centsPerXmr;
    const locked = rateFor(m, 200).centsPerXmr;
    const res = await newbie.browser.post(`/v1/offers/${id}/take`, takeBody(newbie, XMR / 4n, shown, 'ZELLE', 'BMD'));
    expect(res.statusCode, res.body).toBe(200);
    const out = res.json() as { code: string; centsPerXmr: string; fiatCents: string };
    // Not the rate they quoted: the server's band, the rate it locked, and that rate's total.
    expect(out.centsPerXmr).toBe(locked.toString());
    expect(out.fiatCents).toBe(fiatCents(XMR / 4n, { currency: 'BMD', centsPerXmr: locked }).toString());
    expect((await loadTradeRow(deps.db, out.code))!.locked_cents_per_xmr).toBe(locked.toString());
  });
});

describe('written once, and removed offers keep no payment details', () => {
  it('bands, currencies and methods never change; removing an offer blanks its instructions', async () => {
    const p = await person();
    const id = await post(p, flex('NGN', {
      methods: [method('ZELLE', 0, 'Zelle to pay@example.test'), method('PAYPAL', 0, 'PayPal', { instructionsByCurrency: { NGN: 'PayPal NGN' } })],
    }));
    await expect(deps.db.query('update offer_tiers set margin_bps = 1 where offer_id = $1', [id])).rejects.toThrow(/written once/);
    await expect(deps.db.query(`update offer_currencies set currency = 'USD' where offer_id = $1`, [id])).rejects.toThrow(/written once/);
    await expect(deps.db.query('update offer_methods set adjust_bps = 1 where offer_id = $1', [id])).rejects.toThrow(/written once/);
    expect((await p.browser.patch(`/v1/offers/${id}`, { status: 'removed' })).statusCode).toBe(200);
    const left = await deps.db.query(
      `select (select array_agg(instructions order by position) from offer_methods where offer_id = $1) as shared,
              (select array_agg(instructions) from offer_method_currencies where offer_id = $1) as pairs`,
      [id],
    );
    expect(left.rows[0]).toEqual({ shared: ['', ''], pairs: [null, null] });
  });
});

describe('the 3 + 3 cap counts an offer once, whatever its currencies', () => {
  it('a fourth selling offer is refused, however many currencies the three have', async () => {
    const p = await person();
    const two = { currencies: [{ currency: 'BDT', bands: [band('10', '100')] }, { currency: 'LKR', bands: [band('10', '100')] }] };
    for (let i = 0; i < 3; i++) await post(p, flex('BDT', two));
    // The refusal names the caps (offer-rules review M2, on main): 3 buying and 3 selling.
    expect(refusal(await p.browser.post('/v1/offers', flex('PKR')))).toEqual({ status: 409, error: 'too-many-offers', buy: 3, sell: 3 });
    await post(p, flex('PKR', { side: 'buy' }));
  });
});

describe('the launch cap over a flexible offer (owner p11-6 on J-16; launch-rules review F1)', () => {
  const CAP = { status: 409, error: 'launch-cap', capUsdCents: '500000' };
  const NO_PRICE = { status: 409, error: 'price-unavailable' };
  /** An offer in `first` and EUR, the euro band reaching `eurMax` whole euros (€4,500 is $5,000 at 0.9). */
  const withEur = (first: string, eurMax: string, more: Record<string, unknown> = {}) => ({
    ...flex(first),
    currencies: [{ currency: first, bands: [band('10', '5000')] }, { currency: 'EUR', bands: [band('10', '1000'), band('1001', eurMax, 50)] }],
    ...more,
  });
  const relist = (who: Who, id: string) => who.browser.patch(`/v1/offers/${id}`, { status: 'live' });
  const bulk = async (who: Who, ids: string[]) => {
    const res = await who.browser.post('/v1/account/offers/status', { ids, status: 'live' });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { results: unknown[] }).results;
  };

  it("posting: every band's top edge in every currency is at most $5,000 at that currency's rate; a second currency over it refuses the whole offer", async () => {
    const p = await person(0);
    // $5,000 in the first currency and €4,500 (= $5,000) in the second: fine.
    await post(p, withEur('HUF', '4500'));
    // €4,600 is $5,111.12: the band in the second currency is over, so nothing is posted.
    const mine = async () => (await deps.db.query('select 1 from offers where account_id = $1', [p.id])).rowCount;
    expect(refusal(await p.browser.post('/v1/offers', withEur('HUF', '4600')))).toEqual(CAP);
    expect(await mine()).toBe(1);
    // The cap is on the top edge: a lower band's size does not matter, and a band ending at 5,001 of a 1:1 currency is over.
    expect(refusal(await p.browser.post('/v1/offers', { ...flex('HUF'), currencies: [{ currency: 'HUF', bands: [band('10', '5001')] }] }))).toEqual(CAP);
    // An XMR offer: the band's largest amount is valued at the currency's market. 15 XMR is $4,950, 16 XMR is $5,280.
    const xmr = (max: bigint) => ({ ...flex('HUF'), amountUnit: 'xmr', currencies: [{ currency: 'HUF', bands: [band(XMR.toString(), max.toString())] }] });
    await post(p, xmr(15n * XMR));
    expect(refusal(await p.browser.post('/v1/offers', xmr(16n * XMR)))).toEqual(CAP);
    expect(await mine()).toBe(2);
  });

  it('posting fails closed when any currency of the offer has no price to count its bands with', async () => {
    const p = await person(0);
    market.unpriced = new Set(['EUR']);
    expect(refusal(await p.browser.post('/v1/offers', withEur('RUB', '4500')))).toEqual(NO_PRICE);
    // A priced band over the cap is named first: the poster has to lower it either way.
    expect(refusal(await p.browser.post('/v1/offers', withEur('RUB', '4500', { currencies: [{ currency: 'RUB', bands: [band('10', '5001')] }, { currency: 'EUR', bands: [band('10', '4500')] }] })))).toEqual(CAP);
    expect((await deps.db.query('select 1 from offers where account_id = $1', [p.id])).rowCount).toBe(0);
    market.unpriced = new Set();
    await post(p, withEur('RUB', '4500'));
  });

  it('relisting checks every band again at the rates now: a euro band the rate moved above $5,000 keeps the offer off, in PATCH and in the bulk switch', async () => {
    const p = await person(0);
    const id = await post(p, withEur('CZK', '4500'));
    await p.browser.patch(`/v1/offers/${id}`, { status: 'paused' });
    // The euro strengthens: 1 XMR = €270 = $330, so €4,500 is $5,500.
    market.rates = new Map([['EUR', 27_000n]]);
    expect(refusal(await relist(p, id))).toEqual(CAP);
    expect(await bulk(p, [id])).toEqual([{ id, status: 'paused', refused: 'launch-cap' }]);
    expect((await deps.db.query<{ status: string }>('select status from offers where id = $1', [id])).rows[0]!.status).toBe('paused');
    // Back at 0.9 it relists.
    market.rates = new Map();
    expect((await relist(p, id)).json()).toEqual({ id, status: 'live' });
  });

  it('the bulk switch judges each offer on its own: over the cap, within it, and one with an unpriced currency', async () => {
    const p = await person(0);
    const over = await post(p, withEur('SAR', '4500'));
    const fine = await post(p, { ...flex('SAR'), side: 'buy' });
    const half = await post(p, { ...flex('MMK'), currencies: [{ currency: 'MMK', bands: [band('10', '5000')] }, { currency: 'DKK', bands: [band('10', '5000')] }] });
    for (const id of [over, fine, half]) await p.browser.patch(`/v1/offers/${id}`, { status: 'paused' });
    market.rates = new Map([['EUR', 27_000n]]);
    market.unpriced = new Set(['DKK']);
    expect(await bulk(p, [over, fine, half])).toEqual([
      { id: over, status: 'paused', refused: 'launch-cap' },
      { id: fine, status: 'live' },
      // OWNER QUESTION p11-95 (lead default): the priced currency relists; DKK stays hidden until its rate returns.
      { id: half, status: 'live' },
    ]);
  });

  it('OWNER QUESTION p11-95 (lead default): a relist with one currency unpriced relists the priced currencies and leaves the unpriced one hidden until its rate returns; with no priced currency at all it fails closed', async () => {
    const p = await person(0);
    const id = await post(p, withEur('PLN', '4500'));
    await p.browser.patch(`/v1/offers/${id}`, { status: 'paused' });
    market.unpriced = new Set(['EUR']);
    // Relists: the PLN bands pass; the EUR bands cannot be judged and that currency is hidden anyway (owner Q5).
    expect((await relist(p, id)).json()).toEqual({ id, status: 'live' });
    expect((await list('side=sell&method=ZELLE&currency=PLN')).some((c) => c.id === id)).toBe(true);
    expect(await list('side=sell&method=ZELLE&currency=EUR')).toEqual([]);
    const mine = (await p.browser.get('/v1/account/offers')).json() as { id: string; hidden?: string }[];
    expect(mine.find((o) => o.id === id)).not.toHaveProperty('hidden');
    // The rate returns: the euro side is listed again, at its bands (the take checks the cap on each trade).
    market.unpriced = new Set();
    expect((await list('side=sell&method=ZELLE&currency=EUR')).some((c) => c.id === id)).toBe(true);
    // An offer none of whose currencies has a price cannot be judged at all: price-unavailable, as posting.
    const dark = await post(p, { ...flex('PLN'), side: 'buy', currencies: [{ currency: 'PLN', bands: [band('10', '5000')] }, { currency: 'EUR', bands: [band('10', '4500')] }] });
    await p.browser.patch(`/v1/offers/${dark}`, { status: 'paused' });
    market.unpriced = new Set(['PLN', 'EUR']);
    expect(refusal(await relist(p, dark))).toEqual(NO_PRICE);
    expect(await bulk(p, [dark])).toEqual([{ id: dark, status: 'paused', refused: 'price-unavailable' }]);
    market.unpriced = new Set();
    expect((await relist(p, dark)).json()).toEqual({ id: dark, status: 'live' });
  });

  it("taking: the trade's USD value in the chosen currency is at most $5,000 at the rate now, whatever the band allows, and the growth ceiling follows it", async () => {
    const p = await person(0);
    // €10-€4,500 posted at 0.9: within the cap.
    const id = await post(p, withEur('LKR', '4500'));
    const t = await person(0);
    // Both sides are Starters: lift the stage caps far above the launch cap for this test, so only
    // the launch cap can refuse (owner settings, read on every take).
    await deps.db.query(
      `insert into owner_settings (key, value, updated_at) values ('starter_cap_usd', 1000000, now()), ('building_cap_usd', 1000000, now())`,
    );
    try {
      // The euro strengthens to 1 XMR = €270: €4,400 is now $5,377.78, €4,000 is $4,888.89.
      market.rates = new Map([['EUR', 27_000n]]);
      const rate = rateFor(market$('EUR'), 50).centsPerXmr;
      const eur = (cents: bigint) => takeBody(t, atomicForFiat(cents, { currency: 'EUR', centsPerXmr: rate }), rate, 'ZELLE', 'EUR');
      expect(refusal(await t.browser.post(`/v1/offers/${id}/take`, eur(440_000n)))).toEqual(CAP);
      expect((await deps.db.query('select 1 from trades where offer_id = $1', [id])).rowCount).toBe(0);
      const ok = await t.browser.post(`/v1/offers/${id}/take`, eur(400_000n));
      expect(ok.statusCode, ok.body).toBe(200);
      // The growth ceiling: the band's €4,500 clamped to $5,000 in euros at the take's price (€4,090.90 at 1:1.2222).
      const out = ok.json() as { code: string; maxFiatCents: string };
      expect(out.maxFiatCents).toBe('409090');
      expect((await loadTradeRow(deps.db, out.code))!.max_fiat_cents).toBe('409090');
    } finally {
      await deps.db.query(`delete from owner_settings where key in ('starter_cap_usd', 'building_cap_usd')`);
    }
  });
});

describe('flexBody (the test helper) keeps the old tests meaning the same', () => {
  it('one currency, one band in whole units, one method', () => {
    expect(flexBody({ side: 'sell', methodId: 'ZELLE', currency: 'USD', pricing: { mode: 'market', marginBps: 5 }, minFiatCents: '5000', maxFiatCents: '200000', minTrades: null, terms: 't' })).toEqual({
      side: 'sell', terms: 't',
      currencies: [{ currency: 'USD', bands: [{ min: '50', max: '2000', marginBps: 5, minTrades: null }] }],
      methods: [{ methodId: 'ZELLE', adjustBps: 0, instructions: '' }],
    });
  });
});
