import type { FastifyInstance } from 'fastify';
import { fiatCents } from '@x2f/trade';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import type { MarketPrices, MarketQuote } from '../src/price/market.js';
import { loadTradeRow } from '../src/trades/store.js';
import { makeVendor, seedAccount } from './helpers/accounts.js';
import { Browser } from './helpers/totp.js';
import { tradeApp } from './helpers/tradeApp.js';
import { XMR, fakeAddress, seedReviews, seedTrade } from './helpers/trades.js';

// Owner, 8 Nov 2026 ("Offer amounts in XMR or fiat"): an offer stores its trade size in the unit its
// poster chose (`amountUnit`), the lists show both units at the offer's rate now, and the take
// checks the size in the poster's unit at the rate it locks (the market plus the margin, or the
// fixed price). Real Postgres (one database per file), a fake market so each test moves the price.

const DAY = 86_400_000;
const market = { usdCentsPerXmr: 33_000n as bigint | null };

function quote(currency: string): MarketQuote | null {
  const usd = market.usdCentsPerXmr;
  if (usd === null || currency !== 'USD') return null;
  return { price: { currency, centsPerXmr: usd }, at: new Date('2026-10-17T11:59:00Z'), sources: 3, exponent: 2, usdCentsPerXmr: usd, fx: null };
}

const prices: MarketPrices = {
  current: (c) => quote(c)?.price ?? null,
  quote,
  health: () => ({}) as unknown as ReturnType<MarketPrices['health']>,
  poll: async () => {},
  start: () => {},
  stop: async () => {},
};

let app: FastifyInstance;
let deps: Deps;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];
let anon: Browser;
type Who = Awaited<ReturnType<typeof trader>> & { wallet: string };

beforeAll(async () => {
  ({ app, deps, trader } = await tradeApp({}, { prices }));
  anon = new Browser(app);
  // As take.test.ts: Graduated (no starter caps) at 2 completed trades.
  await deps.db.query(
    `insert into owner_settings (key, value, updated_at) values ('building_min_trades', 1, now()), ('graduated_min_trades', 2, now())`,
  );
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  market.usdCentsPerXmr = 33_000n;
});

/** A Graduated trader (40 days, 2 released trades: no starter caps) with one usable wallet. */
async function person(): Promise<Who> {
  const t = await trader();
  const now = deps.clock();
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into wallets (account_id, app, label, address, created_at, usable_from) values ($1, 'feather', 'Main', $2, $3, $4) returning id`,
    [t.id, fakeAddress(), new Date(now.getTime() - 2 * DAY), new Date(now.getTime() - DAY)],
  );
  await deps.db.query('update accounts set created_at = $2 where id = $1', [t.id, new Date(now.getTime() - 40 * DAY)]);
  for (let i = 0; i < 2; i++) {
    const other = await seedAccount(deps, { loginName: `cp${Math.random().toString(36).slice(2, 12)}` });
    const { code } = await seedTrade(deps, { sellerId: t.id, buyerId: other, poster: 'seller' });
    await deps.db.query(`update trades set state = 'released', closed_at = $2 where code = $1`, [code, now]);
    await seedReviews(deps, code);
  }
  return { ...t, wallet: rows[0]!.id };
}

const BASE = { side: 'sell', methodId: 'ZELLE', currency: 'USD', pricing: { mode: 'market', marginBps: 250 }, minTrades: null, terms: '' };
/** 1 - 5 XMR at +2.5%. */
const XMR_OFFER = { ...BASE, amountUnit: 'xmr', minAtomic: (1n * XMR).toString(), maxAtomic: (5n * XMR).toString() };
/** $500 - $3,000 at +2.5%. */
const FIAT_OFFER = { ...BASE, amountUnit: 'fiat', minFiatCents: '50000', maxFiatCents: '300000' };

async function post(who: Who, b: Record<string, unknown>): Promise<string> {
  // Only vendors post offers (owner 2 Nov 2026, vendor.test.ts); the poster becomes one here.
  await makeVendor(deps, who.id);
  const res = await who.browser.post('/v1/offers', b);
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { id: string }).id;
}

type Card = Record<string, unknown> & { id: string };
async function card(id: string, who: Browser = anon): Promise<Card> {
  const res = await who.get('/v1/offers?side=sell&method=ZELLE&currency=USD');
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as Card[]).find((c) => c.id === id)!;
}

/** A take at the offer's rate now (+2.5% on the market unless `rate` is given). */
function takeBody(who: Who, amountAtomic: bigint, rate = (market.usdCentsPerXmr! * 10_250n + 5_000n) / 10_000n): Record<string, unknown> {
  return {
    amountAtomic: amountAtomic.toString(), walletId: who.wallet, centsPerXmr: rate.toString(),
    fiatCents: fiatCents(amountAtomic, { currency: 'USD', centsPerXmr: rate }).toString(),
  };
}

const refusal = (res: { statusCode: number; json(): unknown }) => ({ status: res.statusCode, error: (res.json() as { error?: string }).error });

describe('posting and listing in the poster\'s unit', () => {
  it('an XMR offer stores its XMR; the card carries it and the fiat at the offer rate (margin included)', async () => {
    const p = await person();
    const id = await post(p, XMR_OFFER);
    // $330 × 1.025 = $338.25 / XMR: 1 XMR = $338.25, 5 XMR = $1,691.25.
    expect(await card(id)).toMatchObject({
      rate: '33825', amountUnit: 'xmr', minAtomic: '1000000000000', maxAtomic: '5000000000000', minFiatCents: '33825', maxFiatCents: '169125',
    });
    const { rows } = await deps.db.query('select amount_unit, min_atomic, max_atomic, min_fiat_cents, max_fiat_cents from offers where id = $1', [id]);
    expect(rows[0]).toEqual({ amount_unit: 'xmr', min_atomic: '1000000000000', max_atomic: '5000000000000', min_fiat_cents: null, max_fiat_cents: null });
    // The single-offer route and My offers say the same.
    expect((await anon.get(`/v1/offers/${id}`)).json()).toMatchObject({ amountUnit: 'xmr', minAtomic: '1000000000000', minFiatCents: '33825' });
    const mine = ((await p.browser.get('/v1/account/offers')).json() as Card[]).find((o) => o.id === id);
    expect(mine).toMatchObject({ amountUnit: 'xmr', minAtomic: '1000000000000', maxAtomic: '5000000000000', minFiatCents: '33825', maxFiatCents: '169125' });
  });

  it('a fiat offer stores its fiat; the card carries the XMR it buys at the offer rate, floored', async () => {
    const p = await person();
    const id = await post(p, FIAT_OFFER);
    expect(await card(id)).toMatchObject({
      amountUnit: 'fiat', minFiatCents: '50000', maxFiatCents: '300000', minAtomic: '1478196600147', maxAtomic: '8869179600886',
    });
    // Without amountUnit an offer is in fiat, as before.
    const { amountUnit: _u, ...old } = FIAT_OFFER;
    expect(await card(await post(await person(), old))).toMatchObject({ amountUnit: 'fiat', minFiatCents: '50000' });
  });

  it('while the feed is down the converted pair is null for a market offer; a fixed price still converts', async () => {
    const mkt = await post(await person(), XMR_OFFER);
    const fixed = await post(await person(), { ...XMR_OFFER, pricing: { mode: 'fixed', centsPerXmr: '35000' } });
    const fiat = await post(await person(), FIAT_OFFER);
    market.usdCentsPerXmr = null;
    expect(await card(mkt)).toMatchObject({ rate: null, amountUnit: 'xmr', minAtomic: '1000000000000', minFiatCents: null, maxFiatCents: null });
    expect(await card(fixed)).toMatchObject({ rate: '35000', minFiatCents: '35000', maxFiatCents: '175000' });
    expect(await card(fiat)).toMatchObject({ rate: null, minFiatCents: '50000', minAtomic: null, maxAtomic: null });
  });

  it('refuses a body whose amounts do not match its unit, or are not positive whole numbers in order', async () => {
    const p = await person();
    const { minAtomic: _a, maxAtomic: _b, ...xmrBase } = XMR_OFFER;
    const { minFiatCents: _c, maxFiatCents: _d, ...fiatBase } = FIAT_OFFER;
    const bad: Record<string, unknown>[] = [
      { ...xmrBase, minFiatCents: '50000', maxFiatCents: '300000' },
      { ...fiatBase, minAtomic: '1', maxAtomic: '2' },
      { ...XMR_OFFER, minFiatCents: '50000' },
      { ...FIAT_OFFER, maxAtomic: '2' },
      { ...XMR_OFFER, amountUnit: 'btc' },
      { ...XMR_OFFER, minAtomic: '0' },
      { ...XMR_OFFER, minAtomic: '6000000000000' },
      { ...XMR_OFFER, minAtomic: 1000000000000 },
      { ...XMR_OFFER, minAtomic: '1.5' },
      { ...XMR_OFFER, maxAtomic: '1'.repeat(21) },
      { ...xmrBase, minAtomic: '1' },
    ];
    for (const b of bad) expect((await p.browser.post('/v1/offers', b)).statusCode, JSON.stringify(b)).toBe(400);
  });
});

describe('the take checks the size in the poster\'s unit at the rate it locks', () => {
  it('an XMR offer takes exactly its XMR range, whatever the fiat; the trade records the fiat limits at the locked rate', async () => {
    const seller = await person();
    const offer = await post(seller, XMR_OFFER);
    const buyer = await person();
    expect(refusal(await buyer.browser.post(`/v1/offers/${offer}/take`, takeBody(buyer, XMR - 1n)))).toEqual({ status: 409, error: 'out-of-range' });
    expect(refusal(await buyer.browser.post(`/v1/offers/${offer}/take`, takeBody(buyer, 5n * XMR + 1n)))).toEqual({ status: 409, error: 'out-of-range' });
    const res = await buyer.browser.post(`/v1/offers/${offer}/take`, takeBody(buyer, XMR));
    expect(res.statusCode, res.body).toBe(200);
    const row = (await loadTradeRow(deps.db, (res.json() as { code: string }).code))!;
    expect({ locked: row.locked_cents_per_xmr, min: row.min_fiat_cents, max: row.max_fiat_cents }).toEqual({ locked: '33825', min: '33825', max: '169125' });
  });

  it('a move in the price moves an XMR range\'s fiat, never its XMR', async () => {
    const offer = await post(await person(), XMR_OFFER);
    const buyer = await person();
    // The market doubles: 5 XMR is now $3,382.50 at the offer rate, and still inside 1 - 5 XMR.
    market.usdCentsPerXmr = 66_000n;
    const res = await buyer.browser.post(`/v1/offers/${offer}/take`, takeBody(buyer, 5n * XMR));
    expect(res.statusCode, res.body).toBe(200);
    const row = (await loadTradeRow(deps.db, (res.json() as { code: string }).code))!;
    expect({ min: row.min_fiat_cents, max: row.max_fiat_cents }).toEqual({ min: '67650', max: '338250' });
  });

  it('a fiat offer checks the total at the offer rate, the margin included (edges inside)', async () => {
    const offer = await post(await person(), FIAT_OFFER);
    const buyer = await person();
    // 1 XMR is $338.25 with the margin: below $500. 9 XMR is $3,044.25: above $3,000 (it would be $2,970 at the bare market).
    expect(refusal(await buyer.browser.post(`/v1/offers/${offer}/take`, takeBody(buyer, XMR)))).toEqual({ status: 409, error: 'out-of-range' });
    expect(refusal(await buyer.browser.post(`/v1/offers/${offer}/take`, takeBody(buyer, 9n * XMR)))).toEqual({ status: 409, error: 'out-of-range' });
    // The XMR the card shows for $500 (floored) totals exactly $500 again.
    const res = await buyer.browser.post(`/v1/offers/${offer}/take`, takeBody(buyer, 1_478_196_600_147n));
    expect(res.statusCode, res.body).toBe(200);
    const row = (await loadTradeRow(deps.db, (res.json() as { code: string }).code))!;
    expect({ fiat: row.fiat_cents, min: row.min_fiat_cents, max: row.max_fiat_cents }).toEqual({ fiat: '50000', min: '50000', max: '300000' });
  });

  it('a tiny XMR minimum still never makes a trade with a zero fiat total', async () => {
    const offer = await post(await person(), { ...XMR_OFFER, minAtomic: '1', maxAtomic: (5n * XMR).toString() });
    const buyer = await person();
    // 0.00001 XMR totals $0.00 (0.34 of a cent): refused before any trade is made.
    const zero = takeBody(buyer, 10_000_000n);
    expect(zero.fiatCents).toBe('0');
    expect((await buyer.browser.post(`/v1/offers/${offer}/take`, zero)).statusCode).toBe(400);
    // 0.00003 XMR totals 1 cent: taken, and the trade's fiat minimum is that one cent, never 0.
    const res = await buyer.browser.post(`/v1/offers/${offer}/take`, takeBody(buyer, 30_000_000n));
    expect(res.statusCode, res.body).toBe(200);
    const row = (await loadTradeRow(deps.db, (res.json() as { code: string }).code))!;
    expect({ fiat: row.fiat_cents, min: row.min_fiat_cents }).toEqual({ fiat: '1', min: '1' });
  });
});
