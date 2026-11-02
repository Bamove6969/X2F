import { offerRate } from '@x2f/trade';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { OFFER_CAP_DEFAULTS, OFFER_CAP_KEYS, rateSql } from '../src/offers/routes.js';
import type { MarketPrices, MarketQuote } from '../src/price/market.js';
import { currentLoginTag, seedAccount } from './helpers/accounts.js';
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
let setNow: (d: Date) => void;

beforeAll(async () => {
  ({ app, deps, trader, setNow } = await tradeApp({}, { prices }));
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
    const other = await seedAccount(deps, { loginName: `cp${Math.random().toString(36).slice(2, 12)}` });
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
          displayName: p.displayName, completedTrades: 0, online: true, lastSeenAt: deps.clock().toISOString(),
          typicalMinutes: null, positivePct: null, badges: [], stage: 'starter',
        },
        rate: null,
        pricing: { mode: 'market', marginBps: 50 },
        minFiatCents: '5000',
        maxFiatCents: '200000',
        minTrades: 0,
      },
    ]);
    // The private login name is never in a public answer (spec 6.1, FU-A). The database holds only
    // its tag (FU-D), so the test compares with the name the helper signed up with.
    const { rows } = await deps.db.query<{ login_name: string | null; login_key: string | null; login_tag: Buffer | null }>(
      'select login_name, login_key, login_tag from accounts where id = $1',
      [p.id],
    );
    expect(rows[0]).toEqual({ login_name: null, login_key: null, login_tag: currentLoginTag(deps, p.loginName) });
    expect(p.loginName.toLowerCase()).not.toBe(p.displayName.toLowerCase());
    for (const url of ['/v1/offers?side=sell&method=ZELLE&currency=CAD', `/v1/offers/${id}`]) {
      expect((await anon.get(url)).body.toLowerCase()).not.toContain(p.loginName.toLowerCase());
    }
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
    expect(v.counterparty).toMatchObject({ displayName: s.displayName, stage: 'graduated', completedTrades: 20 });
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
    // (Another poster: p already has 3 buying offers, the per-side cap.)
    const eur = await post(await poster(), { currency: 'EUR', minFiatCents: '50000', maxFiatCents: '60000', side: 'buy' });
    expect((await list('side=buy&method=ZELLE&currency=EUR', starter.browser)).find((c) => c.id === eur)?.opensAt).toBe('building');
    // A fixed-price offer is converted the same way (its minimum is still money in its currency).
    const fixedBig = await post(await poster(), { currency: 'USD', side: 'buy', minFiatCents: '150000', maxFiatCents: '160000', pricing: { mode: 'fixed', centsPerXmr: '1' } });
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

describe('review fixes (Task 4 review 2026-10-28)', () => {
  it('cap (owner 2026-11-01): at most 3 buying and 3 selling offers per account, whatever the method and currency (409 too-many-offers { perSide: 3 }); paused ones count, removed ones do not', async () => {
    const p = await poster();
    const sells = [
      await post(p, { currency: 'TRY' }),
      await post(p, { currency: 'EUR', methodId: 'REVOLUT' }),
      await post(p, { currency: 'GBP', methodId: 'REVOLUT' }),
    ];
    // A fourth selling offer in a market of its own is still over the cap.
    const over = await p.browser.post('/v1/offers', { ...BODY, currency: 'CHF', methodId: 'REVOLUT' });
    expect(over.statusCode).toBe(409);
    expect(over.json()).toEqual({ error: 'too-many-offers', perSide: 3 });
    // Buying is its own count of 3.
    await post(p, { side: 'buy', currency: 'TRY' });
    await post(p, { side: 'buy', currency: 'USD' });
    await post(p, { side: 'buy', currency: 'EUR', methodId: 'REVOLUT' });
    expect((await p.browser.post('/v1/offers', { ...BODY, side: 'buy', currency: 'GBP' })).json()).toEqual({ error: 'too-many-offers', perSide: 3 });
    // A paused offer still counts (no grandfathering); a removed one does not.
    await p.browser.patch(`/v1/offers/${sells[0]}`, { status: 'paused' });
    expect((await p.browser.post('/v1/offers', { ...BODY, currency: 'CHF' })).statusCode).toBe(409);
    await p.browser.patch(`/v1/offers/${sells[0]}`, { status: 'removed' });
    await post(p, { currency: 'CHF' });
    expect((await p.browser.post('/v1/offers', { ...BODY, currency: 'AUD' })).statusCode).toBe(409);
  });

  it('cap: the old per-market and 20-in-all settings are not read; the owner setting offers_max_per_side moves the cap, relisting included', async () => {
    expect(OFFER_CAP_DEFAULTS).toEqual({ perSide: 3 });
    expect(OFFER_CAP_KEYS).toEqual({ perSide: 'offers_max_per_side' });
    const q = await poster();
    const a = await post(q, { currency: 'ZAR' });
    const b = await post(q, { currency: 'USD' });
    await q.browser.patch(`/v1/offers/${a}`, { status: 'paused' });
    await q.browser.patch(`/v1/offers/${b}`, { status: 'paused' });
    await deps.db.query(
      `insert into owner_settings (key, value, updated_at) values ('offers_max_per_market', 100, now()), ('offers_max_total', 100, now()), ('offers_max_per_side', 1, now())`,
    );
    try {
      expect((await q.browser.post('/v1/offers', { ...BODY, currency: 'EUR' })).json()).toEqual({ error: 'too-many-offers', perSide: 1 });
      // The other side is not full.
      await post(q, { side: 'buy', currency: 'EUR' });
      // Relisting counts the others on its side: one other paused selling offer is already the cap of 1.
      expect((await q.browser.patch(`/v1/offers/${a}`, { status: 'live' })).json()).toEqual({ error: 'too-many-offers', perSide: 1 });
      await q.browser.patch(`/v1/offers/${b}`, { status: 'removed' });
      expect((await q.browser.patch(`/v1/offers/${a}`, { status: 'live' })).statusCode).toBe(200);
    } finally {
      await deps.db.query(`delete from owner_settings where key in ('offers_max_per_market', 'offers_max_total', 'offers_max_per_side')`);
    }
  });

  it('I1: six concurrent posts in one market create exactly three offers (real Postgres)', async () => {
    const p = await poster();
    const results = await Promise.all(Array.from({ length: 6 }, () => p.browser.post('/v1/offers', { ...BODY, currency: 'NGN' })));
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 201, 201, 409, 409, 409]);
    const { rows } = await deps.db.query(`select count(*)::int as n from offers where account_id = $1 and currency = 'NGN'`, [p.id]);
    expect(rows[0]).toEqual({ n: 3 });
  });

  it('I1: the best sort is done by the database across market and fixed offers', async () => {
    const p = await poster();
    const q = await poster();
    // USD market 33000: +1% = 33330, −1% = 32670; fixed 33000 sits between.
    const mid = await post(q, { currency: 'USD', methodId: 'CASH_APP', pricing: { mode: 'fixed', centsPerXmr: '33000' } });
    const up = await post(p, { currency: 'USD', methodId: 'CASH_APP', pricing: { mode: 'market', marginBps: 100 } });
    const down = await post(p, { currency: 'USD', methodId: 'CASH_APP', pricing: { mode: 'market', marginBps: -100 } });
    const cards = await list('side=sell&method=CASH_APP&currency=USD&sort=best');
    expect(cards.map((c) => [c.id, c.rate])).toEqual([[down, '32670'], [mid, '33000'], [up, '33330']]);
  });

  it('M2: terms refuse C0/C1 controls (but newline and tab) and bidi controls; emoji with ZWJ and soft hyphens are fine; CRLF becomes LF', async () => {
    const p = await poster();
    for (const t of ['nul \u0000 here', 'c1 \u0085 here', 'del \u007f', 'bidi ‮', 'isolate ⁦x⁩', 'esc \u001b[31m']) {
      const res = await p.browser.post('/v1/offers', { ...BODY, currency: 'UAH', terms: t });
      expect(res.statusCode, JSON.stringify(t)).toBe(400);
    }
    const id = await post(p, { currency: 'UAH', terms: 'Team \u{1F469}‍\u{1F4BB} ok­ay\r\nline two\rthree\tend' });
    expect((await anon.get(`/v1/offers/${id}`)).json()).toMatchObject({ terms: 'Team \u{1F469}‍\u{1F4BB} ok­ay\nline two\nthree\tend' });
  });

  it('M3: lastSeenAt is public only to the 5 minutes (floored)', async () => {
    const p = await poster();
    await post(p, { currency: 'GEL' });
    await deps.db.query('update sessions set last_seen_at = $2 where account_id = $1', [p.id, new Date('2026-10-17T11:58:27.123Z')]);
    const [card] = await list('side=sell&method=ZELLE&currency=GEL');
    expect(card!.poster).toMatchObject({ online: true, lastSeenAt: '2026-10-17T11:55:00.000Z' });
  });

  it('M6: during an emergency stop the lists are empty and only the poster sees the offer', async () => {
    const p = await poster();
    const id = await post(p, { currency: 'AED' });
    await deps.db.query('update site_flags set trading_paused = true');
    try {
      expect(await list('side=sell&method=ZELLE&currency=AED')).toEqual([]);
      expect(((await anon.get('/v1/methods?side=sell&currency=AED')).json() as { live: unknown[] }).live).toEqual([]);
      expect((await anon.get(`/v1/offers/${id}`)).statusCode).toBe(404);
      expect((await p.browser.get(`/v1/offers/${id}`)).json()).toMatchObject({ id, status: 'live' });
    } finally {
      await deps.db.query('update site_flags set trading_paused = false');
    }
    expect(await list('side=sell&method=ZELLE&currency=AED')).toHaveLength(1);
  });

  it("M7: the poster's own offers never carry opensAt; another viewer's single-offer answer does", async () => {
    const p = await poster(); // Starter, cap $200
    const id = await post(p, { currency: 'SAR', minFiatCents: '50000', maxFiatCents: '90000', pricing: { mode: 'fixed', centsPerXmr: '120000' } });
    // SAR has no market in the fake feed, so use USD for the converted cap.
    const usd = await post(p, { currency: 'USD', side: 'sell', methodId: 'APPLE_CASH', minFiatCents: '50000', maxFiatCents: '90000' });
    expect((await list('side=sell&method=APPLE_CASH&currency=USD', p.browser)).find((c) => c.id === usd)!.opensAt).toBeUndefined();
    expect((await p.browser.get(`/v1/offers/${usd}`)).json()).not.toHaveProperty('opensAt');
    const other = await trader();
    expect((await other.browser.get(`/v1/offers/${usd}`)).json()).toMatchObject({ opensAt: 'building' });
    expect((await other.browser.get(`/v1/offers/${id}`)).json()).not.toHaveProperty('opensAt');
  });

  it('M11: the single-offer route hides held and disabled posters and methods under legal review', async () => {
    const held = await poster();
    const off = await poster();
    const h = await post(held, { currency: 'PKR' });
    const d = await post(off, { currency: 'PKR' });
    await deps.db.query('insert into trading_holds (account_id, created_at) values ($1, $2)', [held.id, deps.clock()]);
    await deps.db.query('update accounts set disabled_at = $2 where id = $1', [off.id, deps.clock()]);
    expect((await anon.get(`/v1/offers/${h}`)).statusCode).toBe(404);
    expect((await anon.get(`/v1/offers/${d}`)).statusCode).toBe(404);
    // An SBP offer (only possible from before the method went under review) is hidden too.
    const p = await poster();
    const sbp = await post(p, { currency: 'BDT' });
    await deps.db.query(`update offers set method_id = 'SBP' where id = $1`, [sbp]);
    expect((await anon.get(`/v1/offers/${sbp}`)).statusCode).toBe(404);
    expect(await list('side=sell&method=SBP&currency=BDT')).toEqual([]);
  });

  it('M11: a repeated sort is 400; browsing signed in does not touch the session', async () => {
    expect((await anon.get('/v1/offers?side=sell&method=ZELLE&currency=USD&sort=best&sort=online')).statusCode).toBe(400);
    const t = await trader();
    const before = new Date(deps.clock().getTime() - 60_000);
    await deps.db.query('update sessions set last_seen_at = $2 where account_id = $1', [t.id, before]);
    await list('side=sell&method=ZELLE&currency=USD', t.browser);
    const p = await poster();
    const id = await post(p, { currency: 'LKR' });
    await t.browser.get(`/v1/offers/${id}`);
    const { rows } = await deps.db.query<{ last_seen_at: Date }>('select last_seen_at from sessions where account_id = $1', [t.id]);
    expect(rows.map((r) => r.last_seen_at.toISOString())).toEqual([before.toISOString()]);
  });

  it('M10: GET /v1/account/me carries the trader stage', async () => {
    const t = await trader();
    expect((await t.browser.get('/v1/account/me')).json()).toMatchObject({ stage: 'starter' });
    await history(t.id, { days: 8, completed: 5 });
    expect((await t.browser.get('/v1/account/me')).json()).toMatchObject({ stage: 'building' });
    const staff = await trader('staff');
    expect((await staff.browser.get('/v1/account/me')).json()).toMatchObject({ stage: null });
  });
});

describe('review fixes (Task 4 review round 2, 2026-10-28)', () => {
  it('Minor 1: the SQL rate equals offerRate for every margin and market size, huge ones included', async () => {
    // A seeded LCG, so a failure is repeatable.
    let seed = 0x2f2f2fn;
    const next = (mod: bigint): bigint => {
      seed = (seed * 6364136223846793005n + 1442695040888963407n) % (1n << 64n);
      return seed % mod;
    };
    const margins = [-5000, -4999, -101, -5, -1, 0, 1, 5, 49, 4999, 5000];
    const markets = [
      1n, 2n, 3n, 7n, 33_333n, 99_999n, 10n ** 8n, 10n ** 12n, 10n ** 15n + 7n, 10n ** 16n - 1n, 10n ** 16n + 3n,
      10_820_100_000_498_616n, 24_565_500_000_621_051n, 10n ** 18n - 1n, 10n ** 20n - 1n,
    ];
    const pairs: [bigint, number][] = [];
    for (const m of markets) for (const b of margins) pairs.push([m, b]);
    for (let i = 0; i < 3000; i++) {
      const digits = 1n + next(20n);
      pairs.push([1n + next(10n ** digits), Number(next(10_001n)) - 5000]);
    }
    const { rows } = await deps.db.query<{ rate: string }>(
      `select (${rateSql('o.m')})::text as rate
         from (select 'market'::text as price_mode, null::numeric as fixed_cents_per_xmr, u.b as margin_bps, u.m::numeric as m, u.i
                 from unnest($1::text[], $2::int[]) with ordinality as u(m, b, i)) o
        order by o.i`,
      [pairs.map(([m]) => m.toString()), pairs.map(([, b]) => b)],
    );
    const differ = pairs.flatMap(([m, b], i) => {
      const js = offerRate({ mode: 'market', marginBps: b }, 'USD', { currency: 'USD', centsPerXmr: m })!.centsPerXmr.toString();
      return rows[i]!.rate === js ? [] : [{ m: m.toString(), b, js, sql: rows[i]!.rate }];
    });
    expect(differ).toEqual([]);
    // A fixed offer's rate is its own price, also at the 20-digit maximum.
    const fixed = await deps.db.query<{ rate: string }>(
      `select (${rateSql('$1')})::text as rate from (select 'fixed'::text as price_mode, '99999999999999999999'::numeric as fixed_cents_per_xmr, null::int as margin_bps) o`,
      ['33000'],
    );
    expect(fixed.rows[0]!.rate).toBe('99999999999999999999');
  });

  it('Minor 1: the best sort uses the rate rounded half up, as the cards show it', async () => {
    market.usdCentsPerXmr = 33_333n;
    const p = await poster();
    const q = await poster();
    // 33333 × 1.0005 = 33349.67 → 33350, between the fixed 33349 and 33351.
    const lo = await post(q, { currency: 'USD', methodId: 'TRANSFERWISE', pricing: { mode: 'fixed', centsPerXmr: '33349' } });
    const hi = await post(q, { currency: 'USD', methodId: 'TRANSFERWISE', pricing: { mode: 'fixed', centsPerXmr: '33351' } });
    const mid = await post(p, { currency: 'USD', methodId: 'TRANSFERWISE', pricing: { mode: 'market', marginBps: 5 } });
    const cards = await list('side=sell&method=TRANSFERWISE&currency=USD&sort=best');
    expect(cards.map((c) => [c.id, c.rate])).toEqual([[lo, '33349'], [mid, '33350'], [hi, '33351']]);
  });

  it('Minor 2: online is seen in the current or previous 5-minute bucket, so polling learns only the bucket', async () => {
    const p = await poster();
    const q = await poster();
    // q is cheaper, so only the online sort puts p first.
    const pOffer = await post(p, { currency: 'MXN', pricing: { mode: 'fixed', centsPerXmr: '600000' } });
    const qOffer = await post(q, { currency: 'MXN', pricing: { mode: 'fixed', centsPerXmr: '500000' } });
    const seen = async (who: Who, at: string): Promise<void> => {
      await deps.db.query('update sessions set last_seen_at = $2 where account_id = $1', [who.id, new Date(at)]);
    };
    const online = async (): Promise<boolean> => ((await anon.get(`/v1/offers/${pOffer}`)).json() as Card).poster.online as boolean;
    await seen(q, '2026-10-17T11:54:59.999Z');
    try {
      // Every request time in 11:55:00-11:59:59.999 gives the same answers at every moment.
      for (const at of ['2026-10-17T11:55:00.000Z', '2026-10-17T11:57:31.000Z', '2026-10-17T11:59:59.999Z']) {
        await seen(p, at);
        for (const now of ['2026-10-17T12:00:00.000Z', '2026-10-17T12:03:00.000Z', '2026-10-17T12:04:59.999Z']) {
          setNow(new Date(now));
          expect(await online(), `${at} at ${now}`).toBe(true);
          const cards = await list('side=sell&method=ZELLE&currency=MXN&sort=online');
          expect(cards.map((c) => [c.id, c.poster.online, c.poster.lastSeenAt]), `${at} at ${now}`).toEqual([
            [pOffer, true, '2026-10-17T11:55:00.000Z'],
            [qOffer, false, '2026-10-17T11:50:00.000Z'],
          ]);
        }
        setNow(new Date('2026-10-17T12:05:00.000Z'));
        expect(await online(), at).toBe(false);
        expect((await list('side=sell&method=ZELLE&currency=MXN&sort=online')).map((c) => c.id)).toEqual([qOffer, pOffer]);
      }
    } finally {
      setNow(new Date('2026-10-17T12:00:00Z'));
    }
  });

  it("Minor 2: a poster's online status and last seen are private from a viewer they blocked (owner ruling 2026-10-28)", async () => {
    const p = await poster();
    const q = await poster();
    const blocked = await trader();
    const other = await trader();
    expect((await p.browser.post('/v1/account/blocks', { displayName: blocked.displayName })).statusCode).toBe(204);
    // q is cheaper and offline: the online sort puts p first, unless p counts as offline.
    const pOffer = await post(p, { currency: 'JPY', pricing: { mode: 'fixed', centsPerXmr: '6000000' } });
    const qOffer = await post(q, { currency: 'JPY', pricing: { mode: 'fixed', centsPerXmr: '5000000' } });
    await deps.db.query('update sessions set last_seen_at = $2 where account_id = $1', [q.id, new Date(deps.clock().getTime() - DAY)]);
    const shown = { online: true, lastSeenAt: deps.clock().toISOString() };
    const hidden = { online: false, lastSeenAt: null };
    for (const who of [anon, other.browser]) {
      const cards = await list('side=sell&method=ZELLE&currency=JPY&sort=online', who);
      expect(cards.map((c) => c.id)).toEqual([pOffer, qOffer]);
      expect(cards.find((c) => c.id === pOffer)!.poster).toMatchObject(shown);
      expect(((await who.get(`/v1/offers/${pOffer}`)).json() as Card).poster).toMatchObject(shown);
    }
    // Since Task 37 the blocked viewer does not see p's offers at all (list and 404), so p's
    // presence cannot reach them through an offer (apps/api/test/blocks.test.ts).
    expect((await list('side=sell&method=ZELLE&currency=JPY&sort=online', blocked.browser)).map((c) => c.id)).toEqual([qOffer]);
    expect((await blocked.browser.get(`/v1/offers/${pOffer}`)).statusCode).toBe(404);
    // The trade view's counterparty too.
    const { code } = await seedTrade(deps, { sellerId: p.id, buyerId: blocked.id, poster: 'seller' });
    const res = await blocked.browser.get(`/v1/trades/${code}`);
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { counterparty: Record<string, unknown> }).counterparty).toMatchObject(hidden);
    const mine = await p.browser.get(`/v1/trades/${code}`);
    expect((mine.json() as { counterparty: Record<string, unknown> }).counterparty).toMatchObject({ online: true });
  });
});
