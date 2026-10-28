import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import type { MarketPrices, MarketQuote } from '../src/price/market.js';
import { seedAccount } from './helpers/accounts.js';
import { Browser } from './helpers/totp.js';
import { tradeApp } from './helpers/tradeApp.js';
import { seedTrade } from './helpers/trades.js';

// Plan 3 Task 4: offers. Real Postgres (one database per file), a fake market so each test sets
// the price feed up or down.

const DAY = 86_400_000;

/** The market the app sees: USD (and EUR at 0.9 USD) at `usdCentsPerXmr`, or nothing while down. */
const market = { usdCentsPerXmr: 33_000n as bigint | null };

function quote(currency: string): MarketQuote | null {
  const usd = market.usdCentsPerXmr;
  if (usd === null) return null;
  const local = currency === 'USD' ? usd : currency === 'EUR' ? (usd * 9n) / 10n : null;
  if (local === null) return null;
  return {
    price: { currency, centsPerXmr: local }, at: new Date('2026-10-17T11:59:00Z'), sources: 3, exponent: 2,
    usdCentsPerXmr: usd, fx: null,
  };
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
let anon: Browser;

beforeAll(async () => {
  ({ app, deps, trader } = await tradeApp({}, { prices }));
  anon = new Browser(app);
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  market.usdCentsPerXmr = 33_000n;
});

type Who = Awaited<ReturnType<typeof trader>>;

async function addWallet(accountId: string, usable = true): Promise<void> {
  const now = deps.clock();
  await deps.db.query(
    `insert into wallets (account_id, app, label, address, created_at, usable_from) values ($1, 'cake', 'Main', $2, $3, $4)`,
    [accountId, `addr-${Math.random()}`, new Date(now.getTime() - 2 * DAY), usable ? new Date(now.getTime() - DAY) : new Date(now.getTime() + DAY)],
  );
}

/** A trader with one usable payout wallet. */
async function poster(): Promise<Who> {
  const t = await trader();
  await addWallet(t.id);
  return t;
}

/** Tests share one database: most use a currency of their own to keep their lists apart. */
const BODY = {
  side: 'sell', methodId: 'ZELLE', currency: 'USD', pricing: { mode: 'market', marginBps: 50 },
  minFiatCents: '5000', maxFiatCents: '200000', minTrades: 0, terms: 'Zelle only from an account in your own name.',
};

async function post(who: Who, over: Record<string, unknown> = {}): Promise<string> {
  const res = await who.browser.post('/v1/offers', { ...BODY, ...over });
  expect(res.statusCode, res.body).toBe(201);
  const id = (res.json() as { id: string }).id;
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  return id;
}

type Card = Record<string, unknown> & { id: string; poster: Record<string, unknown>; rate: string | null };

async function list(q: string, who: Browser = anon): Promise<Card[]> {
  const res = await who.get(`/v1/offers?${q}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Card[];
}

/** Sets an account's age and its number of completed (released) trades. */
async function history(accountId: string, a: { days: number; completed: number }): Promise<void> {
  const now = deps.clock();
  await deps.db.query('update accounts set created_at = $2 where id = $1', [accountId, new Date(now.getTime() - a.days * DAY)]);
  for (let i = 0; i < a.completed; i++) {
    const other = await seedAccount(deps, { username: `cp${Math.random().toString(36).slice(2, 12)}` });
    const { code } = await seedTrade(deps, { sellerId: accountId, buyerId: other, poster: 'seller' });
    await deps.db.query(`update trades set state = 'released', closed_at = $2 where code = $1`, [code, now]);
  }
}

describe('POST /v1/offers and GET /v1/offers', () => {
  it('posts an offer and lists it to a logged-out browser, in the shape the web parses (P3-M9)', async () => {
    const p = await poster();
    const id = await post(p, { currency: 'CAD' });
    // CAD has no market in the fake feed: the market offer has no rate now.
    const cards = await list('side=sell&method=ZELLE&currency=CAD&sort=best');
    expect(cards).toEqual([
      {
        id,
        poster: {
          username: p.username, completedTrades: 0, online: true, lastSeenAt: deps.clock().toISOString(),
          typicalMinutes: null, positivePct: null, badges: [], stage: 'starter',
        },
        rate: null,
        pricing: { mode: 'market', marginBps: 50 },
        minFiatCents: '5000',
        maxFiatCents: '200000',
        minTrades: 0,
      },
    ]);
    // Other sides, methods and currencies do not see it.
    expect(await list('side=buy&method=ZELLE&currency=CAD')).toEqual([]);
    expect(await list('side=sell&method=REVOLUT&currency=CAD')).toEqual([]);
  });

  it('a market offer lists the market rate plus its margin; the single-offer route answers logged out too', async () => {
    const p = await poster();
    const id = await post(p, { currency: 'EUR', pricing: { mode: 'market', marginBps: -100 } });
    // EUR market 29700; −1% → 29403.
    const [card] = await list('side=sell&method=ZELLE&currency=EUR');
    expect(card).toMatchObject({ id, rate: '29403', pricing: { mode: 'market', marginBps: -100 } });
    const one = await anon.get(`/v1/offers/${id}`);
    expect(one.statusCode).toBe(200);
    expect(one.json()).toEqual({
      ...card, side: 'sell', methodId: 'ZELLE', currency: 'EUR', terms: BODY.terms, status: 'live',
    });
    expect((await anon.get('/v1/offers/00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect((await anon.get('/v1/offers/not-a-uuid')).statusCode).toBe(404);
  });

  it('a fixed-price offer lists its own rate while the feed is down; a market offer lists rate null', async () => {
    const p = await poster();
    const fixed = await post(p, { currency: 'GBP', pricing: { mode: 'fixed', centsPerXmr: '28000' } });
    const mkt = await post(p, { currency: 'GBP', side: 'sell' });
    market.usdCentsPerXmr = null;
    const cards = await list('side=sell&method=ZELLE&currency=GBP');
    expect(cards.find((c) => c.id === fixed)).toMatchObject({ rate: '28000', pricing: { mode: 'fixed', centsPerXmr: '28000' } });
    expect(cards.find((c) => c.id === mkt)).toMatchObject({ rate: null });
    // Best price for someone buying XMR (sell ads): lowest first; no price now goes last.
    expect(cards.map((c) => c.id)).toEqual([fixed, mkt]);
  });

  it('sorts best price for the person browsing: sell ads lowest first, buy ads highest first', async () => {
    const p = await poster();
    const q = await poster();
    const cheap = await post(p, { currency: 'BRL', pricing: { mode: 'fixed', centsPerXmr: '150000' } });
    const dear = await post(q, { currency: 'BRL', pricing: { mode: 'fixed', centsPerXmr: '160000' } });
    expect((await list('side=sell&method=ZELLE&currency=BRL&sort=best')).map((c) => c.id)).toEqual([cheap, dear]);
    const low = await post(p, { side: 'buy', currency: 'BRL', pricing: { mode: 'fixed', centsPerXmr: '150000' } });
    const high = await post(q, { side: 'buy', currency: 'BRL', pricing: { mode: 'fixed', centsPerXmr: '160000' } });
    expect((await list('side=buy&method=ZELLE&currency=BRL&sort=best')).map((c) => c.id)).toEqual([high, low]);
    // Most trades first.
    await history(q.id, { days: 1, completed: 2 });
    expect((await list('side=buy&method=ZELLE&currency=BRL&sort=trades')).map((c) => c.id)).toEqual([high, low]);
    await history(p.id, { days: 1, completed: 3 });
    expect((await list('side=buy&method=ZELLE&currency=BRL&sort=trades')).map((c) => c.id)).toEqual([low, high]);
    // Online first.
    await deps.db.query('update sessions set last_seen_at = $2 where account_id = $1', [p.id, new Date(deps.clock().getTime() - DAY)]);
    const online = await list('side=buy&method=ZELLE&currency=BRL&sort=online');
    expect(online.map((c) => c.id)).toEqual([high, low]);
    expect(online[1]!.poster).toMatchObject({ online: false, lastSeenAt: new Date(deps.clock().getTime() - DAY).toISOString() });
  });

  it('refuses a bad query with 400', async () => {
    for (const q of ['', 'side=sell&currency=USD', 'side=both&method=ZELLE&currency=USD', 'side=sell&method=ZELLE&currency=usd',
      'side=sell&method=ZELLE&currency=USD&sort=cheap', 'side=sell&method=ZELLE&method=REVOLUT&currency=USD']) {
      expect((await anon.get(`/v1/offers?${q}`)).statusCode, q).toBe(400);
    }
  });

  it('a staff account cannot post (wrong-account-kind); logged out is 401', async () => {
    const staff = await trader('staff');
    const res = await staff.browser.post('/v1/offers', BODY);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'wrong-account-kind' });
    expect((await anon.post('/v1/offers', BODY)).statusCode).toBe(401);
  });

  it('SBP (legal review) → 409 method-unavailable; an unknown method → 400', async () => {
    const p = await poster();
    const res = await p.browser.post('/v1/offers', { ...BODY, methodId: 'SBP' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'method-unavailable' });
    expect((await p.browser.post('/v1/offers', { ...BODY, methodId: 'NOPE' })).statusCode).toBe(400);
  });

  it('a held account and a paused site cannot post', async () => {
    const p = await poster();
    await deps.db.query('insert into trading_holds (account_id, created_at) values ($1, $2)', [p.id, deps.clock()]);
    const held = await p.browser.post('/v1/offers', BODY);
    expect(held.statusCode).toBe(409);
    expect(held.json()).toEqual({ error: 'trading-hold' });
    await deps.db.query('update trading_holds set lifted_at = $2 where account_id = $1', [p.id, deps.clock()]);
    await post(p);

    await deps.db.query('update site_flags set trading_paused = true');
    try {
      const paused = await p.browser.post('/v1/offers', BODY);
      expect(paused.statusCode).toBe(409);
      expect(paused.json()).toEqual({ error: 'trading-paused' });
    } finally {
      await deps.db.query('update site_flags set trading_paused = false');
    }
  });

  it('no usable wallet → 409 no-wallet, also with one waiting (24-hour) wallet only', async () => {
    const t = await trader();
    const none = await t.browser.post('/v1/offers', BODY);
    expect(none.statusCode).toBe(409);
    expect(none.json()).toEqual({ error: 'no-wallet' });
    await addWallet(t.id, false);
    expect((await t.browser.post('/v1/offers', BODY)).json()).toEqual({ error: 'no-wallet' });
    await addWallet(t.id, true);
    await post(t);
  });

  it('refuses malformed bodies with 400, including both marginBps and centsPerXmr', async () => {
    const p = await poster();
    const bad: Record<string, unknown>[] = [
      { pricing: { mode: 'market', marginBps: 50, centsPerXmr: '33000' } },
      { pricing: { mode: 'fixed', centsPerXmr: '33000', marginBps: 0 } },
      { pricing: { mode: 'market', marginBps: 5001 } },
      { pricing: { mode: 'market', marginBps: 1.5 } },
      { pricing: { mode: 'fixed', centsPerXmr: '0' } },
      { pricing: { mode: 'fixed', centsPerXmr: 33000 } },
      { pricing: { mode: 'auction' } },
      { side: 'both' },
      { currency: 'XXX' },
      { minFiatCents: '0' },
      { minFiatCents: '300000' },
      { minFiatCents: '50.00' },
      { maxFiatCents: '1'.repeat(16) },
      { minTrades: 7 },
      { terms: 'x'.repeat(4001) },
      { terms: 'bidi ‮ override' },
      { extra: true },
    ];
    for (const over of bad) {
      const res = await p.browser.post('/v1/offers', { ...BODY, ...over });
      expect(res.statusCode, JSON.stringify(over)).toBe(400);
    }
    const { methodId: _m, ...noMethod } = BODY;
    expect((await p.browser.post('/v1/offers', noMethod)).statusCode).toBe(400);
    // Newlines in the terms are fine.
    await post(p, { terms: 'Line one.\nLine two.', minTrades: 50 });
  });

  it('a gift-card offer must name the card country, and carries it (Revision 2026-10-27)', async () => {
    const p = await poster();
    const gift = { methodId: 'AMAZON_GIFT_CARD', currency: 'USD', side: 'buy' };
    expect((await p.browser.post('/v1/offers', { ...BODY, ...gift })).statusCode).toBe(400);
    expect((await p.browser.post('/v1/offers', { ...BODY, ...gift, country: 'us' })).statusCode).toBe(400);
    // A country on a method that is not a gift card is refused too.
    expect((await p.browser.post('/v1/offers', { ...BODY, country: 'US' })).statusCode).toBe(400);
    const id = await post(p, { ...gift, country: 'US' });
    const [card] = await list('side=buy&method=AMAZON_GIFT_CARD&currency=USD');
    expect(card).toMatchObject({ id, country: 'US' });
    expect((await anon.get(`/v1/offers/${id}`)).json()).toMatchObject({ country: 'US' });
    // A card without one has no country key at all.
    const plain = await post(p, { currency: 'INR' });
    expect('country' in (await list('side=sell&method=ZELLE&currency=INR')).find((c) => c.id === plain)!).toBe(false);
  });
});

describe('PATCH /v1/offers/:id', () => {
  it('only the poster can pause, relist and remove', async () => {
    const p = await poster();
    const other = await poster();
    const id = await post(p, { currency: 'AUD' });
    const q = 'side=sell&method=ZELLE&currency=AUD';

    const notMine = await other.browser.patch(`/v1/offers/${id}`, { status: 'paused' });
    expect(notMine.statusCode).toBe(403);
    expect(notMine.json()).toEqual({ error: 'wrong-party' });
    expect((await anon.patch(`/v1/offers/${id}`, { status: 'paused' })).statusCode).toBe(401);
    expect((await p.browser.patch(`/v1/offers/${id}`, { status: 'gone' })).statusCode).toBe(400);
    expect(await list(q)).toHaveLength(1);

    const paused = await p.browser.patch(`/v1/offers/${id}`, { status: 'paused' });
    expect(paused.statusCode).toBe(200);
    expect(paused.json()).toEqual({ id, status: 'paused' });
    expect(await list(q)).toEqual([]);
    // A paused offer is shown to its poster only.
    expect((await anon.get(`/v1/offers/${id}`)).statusCode).toBe(404);
    expect((await p.browser.get(`/v1/offers/${id}`)).json()).toMatchObject({ status: 'paused' });

    expect((await p.browser.patch(`/v1/offers/${id}`, { status: 'live' })).json()).toEqual({ id, status: 'live' });
    expect(await list(q)).toHaveLength(1);

    expect((await p.browser.patch(`/v1/offers/${id}`, { status: 'removed' })).json()).toEqual({ id, status: 'removed' });
    expect(await list(q)).toEqual([]);
    // Removed is final.
    expect((await p.browser.patch(`/v1/offers/${id}`, { status: 'live' })).statusCode).toBe(404);
    expect((await p.browser.get(`/v1/offers/${id}`)).statusCode).toBe(404);
  });

  it('relisting is posting again: a hold or a paused site refuses it', async () => {
    const p = await poster();
    const id = await post(p, { currency: 'NZD' });
    await p.browser.patch(`/v1/offers/${id}`, { status: 'paused' });
    await deps.db.query('insert into trading_holds (account_id, created_at) values ($1, $2)', [p.id, deps.clock()]);
    expect((await p.browser.patch(`/v1/offers/${id}`, { status: 'live' })).json()).toEqual({ error: 'trading-hold' });
    // Pausing and removing stay allowed under a hold.
    expect((await p.browser.patch(`/v1/offers/${id}`, { status: 'paused' })).statusCode).toBe(200);
  });
});

describe('who is listed', () => {
  it('hides offers of disabled and held posters', async () => {
    const held = await poster();
    const off = await poster();
    const ok = await poster();
    await post(held, { currency: 'CHF' });
    await post(off, { currency: 'CHF' });
    const keep = await post(ok, { currency: 'CHF' });
    await deps.db.query('insert into trading_holds (account_id, created_at) values ($1, $2)', [held.id, deps.clock()]);
    await deps.db.query('update accounts set disabled_at = $2 where id = $1', [off.id, deps.clock()]);
    expect((await list('side=sell&method=ZELLE&currency=CHF')).map((c) => c.id)).toEqual([keep]);
  });

  it('/v1/methods counts live offers from the offers table, with the best rate', async () => {
    const p = await poster();
    await post(p, { currency: 'SEK', pricing: { mode: 'fixed', centsPerXmr: '350000' } });
    await post(p, { currency: 'SEK', pricing: { mode: 'fixed', centsPerXmr: '340000' } });
    const paused = await post(p, { currency: 'SEK', pricing: { mode: 'fixed', centsPerXmr: '100' } });
    await p.browser.patch(`/v1/offers/${paused}`, { status: 'paused' });
    const res = await anon.get('/v1/methods?side=sell&currency=SEK');
    expect(res.statusCode).toBe(200);
    const { live } = res.json() as { live: { id: string; offers: number; bestRate: string | null }[] };
    expect(live).toEqual([expect.objectContaining({ id: 'ZELLE', offers: 2, bestRate: '340000' })]);
    // Buy ads: the best is the highest.
    await post(p, { side: 'buy', currency: 'SEK', pricing: { mode: 'fixed', centsPerXmr: '340000' } });
    await post(p, { side: 'buy', currency: 'SEK', pricing: { mode: 'fixed', centsPerXmr: '360000' } });
    const buy = (await anon.get('/v1/methods?side=buy&currency=SEK')).json() as { live: { id: string; bestRate: string | null }[] };
    expect(buy.live).toEqual([expect.objectContaining({ id: 'ZELLE', bestRate: '360000' })]);
  });
});

describe('starter limits (spec 2.3, Revision 2026-10-24)', () => {
  /** Each case posts the only offer in its currency. */
  const stageOf = async (currency: string): Promise<unknown> => (await list(`side=sell&method=ZELLE&currency=${currency}`))[0]?.poster.stage;

  it("the poster's stage follows completed trades and account age", async () => {
    const cases: [string, { days: number; completed: number }, string][] = [
      ['DKK', { days: 3, completed: 5 }, 'starter'],
      ['NOK', { days: 8, completed: 4 }, 'starter'],
      ['PLN', { days: 8, completed: 5 }, 'building'],
      ['CZK', { days: 10, completed: 20 }, 'building'],
      ['HUF', { days: 31, completed: 20 }, 'graduated'],
    ];
    for (const [currency, h, stage] of cases) {
      const p = await poster();
      await history(p.id, h);
      await post(p, { currency });
      expect(await stageOf(currency), `${currency} ${JSON.stringify(h)}`).toBe(stage);
      expect((await list(`side=sell&method=ZELLE&currency=${currency}`))[0]!.poster.completedTrades).toBe(h.completed);
    }
  });

  it('the trade view counterparty carries the stage too', async () => {
    const s = await trader();
    const b = await trader();
    await history(s.id, { days: 40, completed: 20 });
    const { code } = await seedTrade(deps, { sellerId: s.id, buyerId: b.id, poster: 'seller' });
    const v = (await b.browser.get(`/v1/trades/${code}`)).json() as { counterparty: Record<string, unknown> };
    expect(v.counterparty).toMatchObject({ username: s.username, stage: 'graduated', completedTrades: 20 });
  });

  it("marks offers above a signed-in viewer's cap with the stage that opens them (opensAt)", async () => {
    const p = await poster();
    // $100, $500 and $1,500 minimums (USD).
    const small = await post(p, { currency: 'USD', minFiatCents: '10000', maxFiatCents: '20000', side: 'buy' });
    const mid = await post(p, { currency: 'USD', minFiatCents: '50000', maxFiatCents: '90000', side: 'buy' });
    const big = await post(p, { currency: 'USD', minFiatCents: '150000', maxFiatCents: '300000', side: 'buy' });
    const q = 'side=buy&method=ZELLE&currency=USD';
    const opens = async (who: Browser) => {
      const cards = await list(q, who);
      return Object.fromEntries([small, mid, big].map((id) => [id, cards.find((c) => c.id === id)?.opensAt ?? '-']));
    };

    expect(await opens(anon)).toEqual({ [small]: '-', [mid]: '-', [big]: '-' });
    const starter = await trader();
    expect(await opens(starter.browser)).toEqual({ [small]: '-', [mid]: 'building', [big]: 'graduated' });
    const building = await trader();
    await history(building.id, { days: 8, completed: 5 });
    expect(await opens(building.browser)).toEqual({ [small]: '-', [mid]: '-', [big]: 'graduated' });
    const graduated = await trader();
    await history(graduated.id, { days: 31, completed: 20 });
    expect(await opens(graduated.browser)).toEqual({ [small]: '-', [mid]: '-', [big]: '-' });

    // In another currency the minimum is converted to USD at the market: €500 = $555.56 > $200.
    const eur = await post(p, { currency: 'EUR', minFiatCents: '50000', maxFiatCents: '60000', side: 'buy' });
    expect((await list('side=buy&method=ZELLE&currency=EUR', starter.browser)).find((c) => c.id === eur)?.opensAt).toBe('building');
    // A fixed-price offer is converted the same way (its minimum is still money in its currency).
    const fixedBig = await post(p, { currency: 'USD', side: 'buy', minFiatCents: '150000', maxFiatCents: '160000', pricing: { mode: 'fixed', centsPerXmr: '1' } });
    expect((await list(q, starter.browser)).find((c) => c.id === fixedBig)?.opensAt).toBe('graduated');

    // While the market is down the cap cannot be checked here: no mark (the take checks it).
    market.usdCentsPerXmr = null;
    expect(await opens(starter.browser)).toEqual({ [small]: '-', [mid]: '-', [big]: '-' });

    // The owner's settings move the caps: a $600 Starter cap opens the $500 offer.
    market.usdCentsPerXmr = 33_000n;
    await deps.db.query(`insert into owner_settings (key, value, updated_at) values ('starter_cap_usd', 600, now())`);
    try {
      expect(await opens(starter.browser)).toEqual({ [small]: '-', [mid]: '-', [big]: 'graduated' });
    } finally {
      await deps.db.query(`delete from owner_settings where key = 'starter_cap_usd'`);
    }
  });
});
