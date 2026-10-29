import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import type { MarketPrices, MarketQuote } from '../src/price/market.js';
import { assertNotBlocked, blockedEitherWay, blocksBetween, hasBlocked } from '../src/traders/blocks.js';
import { applyEvent } from '../src/trades/store.js';
import { Browser } from './helpers/totp.js';
import { tradeApp } from './helpers/tradeApp.js';
import { driveTo, seedTrade } from './helpers/trades.js';

// Plan 3 Task 37: the trader-to-trader block (spec 2.4). Real Postgres, one database for the file.

const DAY = 86_400_000;

function quote(currency: string): MarketQuote | null {
  if (currency !== 'USD') return null;
  return {
    price: { currency, centsPerXmr: 33_000n }, at: new Date('2026-10-17T11:59:00Z'), sources: 3, exponent: 2,
    usdCentsPerXmr: 33_000n, fx: null,
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

type Who = Awaited<ReturnType<typeof trader>>;

/** A trader with a usable payout wallet, so they can post. */
async function poster(): Promise<Who> {
  const t = await trader();
  const now = deps.clock();
  await deps.db.query(
    `insert into wallets (account_id, app, label, address, created_at, usable_from) values ($1, 'cake', 'Main', $2, $3, $4)`,
    [t.id, `addr-${Math.random()}`, new Date(now.getTime() - 2 * DAY), new Date(now.getTime() - DAY)],
  );
  return t;
}

let currencies = ['GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'AUD', 'NZD', 'SGD', 'HKD'];
/** Tests share one database: each uses a currency of its own so their lists stay apart. */
const ownCurrency = (): string => {
  const c = currencies[0]!;
  currencies = currencies.slice(1);
  return c;
};

async function post(who: Who, currency: string): Promise<string> {
  const res = await who.browser.post('/v1/offers', {
    side: 'sell', methodId: 'ZELLE', currency, pricing: { mode: 'fixed', centsPerXmr: '3300000' },
    minFiatCents: '5000', maxFiatCents: '200000', minTrades: 0, terms: 'Zelle only.',
  });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { id: string }).id;
}

async function listed(who: Browser, currency: string): Promise<string[]> {
  const res = await who.get(`/v1/offers?side=sell&method=ZELLE&currency=${currency}&sort=online`);
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { id: string }[]).map((c) => c.id);
}

const block = async (a: Who, b: Who) => {
  expect((await a.browser.post('/v1/account/blocks', { displayName: b.displayName })).statusCode).toBe(204);
};
const unblock = async (a: Who, b: Who) => {
  expect((await a.browser.delete(`/v1/account/blocks/${encodeURIComponent(b.displayName)}`)).statusCode).toBe(204);
};

describe('GET, POST and DELETE /v1/account/blocks', () => {
  it('lists only the people I blocked, newest first, by public name; unblocking is idempotent', async () => {
    const a = await trader();
    const b = await trader();
    const c = await trader();
    expect((await a.browser.get('/v1/account/blocks')).json()).toEqual([]);
    await block(a, b);
    await block(c, a);
    // b was blocked first.
    await deps.db.query('update account_blocks set created_at = $3 where account_id = $1 and blocked_id = $2', [a.id, b.id, new Date(deps.clock().getTime() - 5000)]);
    await block(a, c);
    const list = (await a.browser.get('/v1/account/blocks')).json() as { displayName: string; blockedAt: string }[];
    expect(list.map((e) => e.displayName)).toEqual([c.displayName, b.displayName]);
    expect(Object.keys(list[0]!).sort()).toEqual(['blockedAt', 'displayName']);
    // Who blocked me is never answered: c blocked a, and a's list only has a's own blocks.
    expect(((await b.browser.get('/v1/account/blocks')).json() as unknown[]).length).toBe(0);
    // The private login name is never sent.
    const { rows } = await deps.db.query<{ login_name: string }>('select login_name from accounts where id = $1', [b.id]);
    expect((await a.browser.get('/v1/account/blocks')).body).not.toContain(JSON.stringify(rows[0]!.login_name));

    await unblock(a, b);
    await unblock(a, b);
    // Unblocking is by name, case-insensitively.
    expect((await a.browser.delete(`/v1/account/blocks/${c.displayName.toUpperCase()}`)).statusCode).toBe(204);
    expect((await a.browser.get('/v1/account/blocks')).json()).toEqual([]);
    // c's block of a is c's own, untouched.
    expect(await blockedEitherWay(deps.db, a.id, c.id)).toBe(true);
  });

  it('refuses an unknown name, an overlong name and anyone but a signed-in trader', async () => {
    const a = await trader();
    expect((await a.browser.delete('/v1/account/blocks/Dnobody1234567x')).json()).toEqual({ error: 'not-found' });
    expect((await a.browser.delete(`/v1/account/blocks/${'x'.repeat(65)}`)).statusCode).toBe(400);
    expect((await anon.get('/v1/account/blocks')).statusCode).toBe(401);
    expect((await anon.delete(`/v1/account/blocks/${a.displayName}`)).statusCode).toBe(401);
  });
});

describe('a block stops business both ways (Task 37)', () => {
  it("the blocked person's list leaves out the blocker's offers, and the blocker's list the blocked person's", async () => {
    const cur = ownCurrency();
    const a = await poster();
    const b = await poster();
    const other = await trader();
    const aOffer = await post(a, cur);
    const bOffer = await post(b, cur);
    await block(a, b);
    expect((await listed(b.browser, cur)).sort()).toEqual([bOffer]);
    expect((await listed(a.browser, cur)).sort()).toEqual([aOffer]);
    // Everyone else still sees both.
    expect((await listed(other.browser, cur)).sort()).toEqual([aOffer, bOffer].sort());
    // Unblocking restores everything.
    await unblock(a, b);
    expect((await listed(b.browser, cur)).sort()).toEqual([aOffer, bOffer].sort());
    expect((await listed(a.browser, cur)).sort()).toEqual([aOffer, bOffer].sort());
  });

  it("GET /v1/offers/:id answers 404 not-found either way, the same as an offer that does not exist", async () => {
    const cur = ownCurrency();
    const a = await poster();
    const b = await poster();
    const aOffer = await post(a, cur);
    const bOffer = await post(b, cur);
    await block(a, b);
    const ghost = await b.browser.get('/v1/offers/00000000-0000-4000-8000-000000000000');
    for (const [who, id] of [[b, aOffer], [a, bOffer]] as const) {
      const res = await who.browser.get(`/v1/offers/${id}`);
      expect(res.statusCode).toBe(404);
      expect(res.body).toBe(ghost.body);
    }
    // Each still sees their own offer.
    expect((await a.browser.get(`/v1/offers/${aOffer}`)).statusCode).toBe(200);
    expect((await b.browser.get(`/v1/offers/${bOffer}`)).statusCode).toBe(200);
    await unblock(a, b);
    expect((await b.browser.get(`/v1/offers/${aOffer}`)).statusCode).toBe(200);
    expect((await a.browser.get(`/v1/offers/${bOffer}`)).statusCode).toBe(200);
  });

  it('the blocked person never sees the blocker online; the blocker still sees the blocked person', async () => {
    const a = await poster();
    const b = await poster();
    await block(a, b);
    const { code } = await seedTrade(deps, { sellerId: a.id, buyerId: b.id, poster: 'seller' });
    const asB = (await b.browser.get(`/v1/trades/${code}`)).json() as { counterparty: Record<string, unknown> };
    expect(asB.counterparty).toMatchObject({ displayName: a.displayName, online: false, lastSeenAt: null });
    const asA = (await a.browser.get(`/v1/trades/${code}`)).json() as { counterparty: Record<string, unknown> };
    expect(asA.counterparty).toMatchObject({ displayName: b.displayName, online: true });
    await unblock(a, b);
    const again = (await b.browser.get(`/v1/trades/${code}`)).json() as { counterparty: Record<string, unknown> };
    expect(again.counterparty).toMatchObject({ online: true });
    expect(again.counterparty.lastSeenAt).not.toBeNull();
  });

  it('a trade already open continues to the end after a block (escrow must finish)', async () => {
    const seller = await poster();
    const buyer = await poster();
    const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
    const secured = await driveTo(deps, trade, 'secured');
    await block(seller, buyer);
    await block(buyer, seller);
    const paid = await buyer.browser.post(`/v1/trades/${trade.code}/events`, { type: 'mark-paid', fiatCents: secured.fiatCents.toString() });
    expect(paid.statusCode, paid.body).toBe(200);
    const release = await seller.browser.post(`/v1/trades/${trade.code}/events`, { type: 'release-started' });
    expect(release.statusCode, release.body).toBe(200);
    const done = await applyEvent(deps, trade.code, { type: 'settled', kind: 'release', txHash: randomBytes(32).toString('hex') }, 'system');
    expect(done.state).toBe('released');
    expect(((await buyer.browser.get(`/v1/trades/${trade.code}`)).json() as { state: string }).state).toBe('released');
  });

  it('assertNotBlocked (for the take, chats and profiles) refuses either way with 404 not-found', async () => {
    const a = await trader();
    const b = await trader();
    const c = await trader();
    await block(a, b);
    for (const [x, y] of [[a, b], [b, a]] as const) {
      await expect(assertNotBlocked(deps.db, x.id, y.id)).rejects.toMatchObject({ status: 404, code: 'not-found' });
    }
    await expect(assertNotBlocked(deps.db, a.id, c.id)).resolves.toBeUndefined();
    await unblock(a, b);
    await expect(assertNotBlocked(deps.db, b.id, a.id)).resolves.toBeUndefined();
  });

  it('hasBlocked (the profile) is one way: only the blocked person loses the profile', async () => {
    const a = await trader();
    const b = await trader();
    await block(a, b);
    expect(await hasBlocked(deps.db, a.id, b.id)).toBe(true);
    expect(await hasBlocked(deps.db, b.id, a.id)).toBe(false);
    expect(await hasBlocked(deps.db, a.id, null)).toBe(false);
    await unblock(a, b);
    expect(await hasBlocked(deps.db, a.id, b.id)).toBe(false);
  });

  it('blocksBetween (staff, a dispute between the two only) lists both directions with their time', async () => {
    const a = await trader();
    const b = await trader();
    expect(await blocksBetween(deps.db, a.id, b.id)).toEqual([]);
    await block(b, a);
    const got = await blocksBetween(deps.db, a.id, b.id);
    expect(got).toEqual([{ blockerId: b.id, blockedId: a.id, since: expect.any(Date) }]);
    await block(a, b);
    expect((await blocksBetween(deps.db, b.id, a.id)).length).toBe(2);
  });

  it('a logged-out view is not a block: it cannot be identified, so it gets the coarse public presence (decision, Task 37)', async () => {
    const cur = ownCurrency();
    const a = await poster();
    const b = await poster();
    const aOffer = await post(a, cur);
    await block(a, b);
    // Floored to 5 minutes and bucketed, exactly as Task 4 shows anyone logged out; never finer.
    const card = ((await anon.get(`/v1/offers/${aOffer}`)).json() as { poster: { lastSeenAt: string | null } }).poster;
    expect(card.lastSeenAt).not.toBeNull();
    expect(Date.parse(card.lastSeenAt!) % (5 * 60_000)).toBe(0);
    expect(await listed(anon, cur)).toEqual([aOffer]);
  });
});
