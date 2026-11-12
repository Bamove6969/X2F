import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import type { MarketPrices, MarketQuote } from '../src/price/market.js';
import { assertNotBlocked, blockedEitherWay, blocksBetween, hasBlocked } from '../src/traders/blocks.js';
import { applyEvent } from '../src/trades/store.js';
import { makeVendor, seedAccount } from './helpers/accounts.js';
import { rolesToAbilities } from '../src/team/abilities.js';
import { Browser } from './helpers/totp.js';
import { tradeApp } from './helpers/tradeApp.js';
import { driveTo, seedTrade } from './helpers/trades.js';
import { flexBody } from './helpers/offers.js';

// Plan 3 Task 37: the trader-to-trader block (spec 2.4). Real Postgres, one database for the file.

const DAY = 86_400_000;

/**
 * USD at $330.00 per XMR; every other currency at 3,300,000 minor units (offers are market ± %, owner
 * Q1). Every currency has a price: posting converts each band's top edge to US dollars and fails
 * closed without a price (the launch cap, owner p11-6).
 */
function quote(currency: string): MarketQuote | null {
  return {
    price: { currency, centsPerXmr: currency === 'USD' ? 33_000n : 3_300_000n }, at: new Date('2026-10-17T11:59:00Z'), sources: 3, exponent: 2,
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
  // Owner 2 Nov 2026: only vendors post.
  await makeVendor(deps, t.id);
  const now = deps.clock();
  await deps.db.query(
    `insert into wallets (account_id, app, label, address, created_at, usable_from) values ($1, 'cake', 'Main', $2, $3, $4)`,
    [t.id, `addr-${Math.random()}`, new Date(now.getTime() - 2 * DAY), new Date(now.getTime() - DAY)],
  );
  return t;
}

let currencies = ['THB', 'ZAR', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'AUD', 'NZD', 'SGD', 'HKD'];
/** Tests share one database: each uses a currency of its own so their lists stay apart. */
const ownCurrency = (): string => {
  const c = currencies[0]!;
  currencies = currencies.slice(1);
  return c;
};

async function post(who: Who, currency: string, marginBps = 0): Promise<string> {
  const res = await who.browser.post('/v1/offers', flexBody({
    side: 'sell', methodId: 'ZELLE', currency, pricing: { mode: 'market', marginBps },
    minFiatCents: '5000', maxFiatCents: '200000', minTrades: null, terms: 'Zelle only.',
  }));
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
    expect(Object.keys(list[0]!).sort()).toEqual(['blockedAt', 'displayName', 'note']);
    // Who blocked me is never answered: c blocked a, and a's list only has a's own blocks.
    expect(((await b.browser.get('/v1/account/blocks')).json() as unknown[]).length).toBe(0);
    // The private login name is never sent. The database holds only its tag (FU-D), so the test
    // compares with the name the helper signed up with.
    expect((await deps.db.query('select login_name, login_key from accounts where id = $1', [b.id])).rows[0]).toEqual({ login_name: null, login_key: null });
    expect((await a.browser.get('/v1/account/blocks')).body.toLowerCase()).not.toContain(b.loginName.toLowerCase());

    await unblock(a, b);
    await unblock(a, b);
    // Unblocking is by name, case-insensitively.
    expect((await a.browser.delete(`/v1/account/blocks/${c.displayName.toUpperCase()}`)).statusCode).toBe(204);
    expect((await a.browser.get('/v1/account/blocks')).json()).toEqual([]);
    // c's block of a is c's own, untouched.
    expect(await blockedEitherWay(deps.db, a.id, c.id)).toBe(true);
  });

  it('review M1: unblocks by the stored name even if the name rules would now refuse it', async () => {
    const a = await trader();
    const b = await trader();
    await block(a, b);
    // A name the current rules refuse (a later reserved-word or shape change), set directly.
    await deps.db.query(`update accounts set display_name = 'x', display_key = 'x' where id = $1`, [b.id]);
    expect((await a.browser.get('/v1/account/blocks')).json()).toMatchObject([{ displayName: 'x' }]);
    expect((await a.browser.delete('/v1/account/blocks/X')).statusCode).toBe(204);
    expect((await a.browser.get('/v1/account/blocks')).json()).toEqual([]);
    expect(await blockedEitherWay(deps.db, a.id, b.id)).toBe(false);
  });

  it('refuses an unknown name, an overlong name and anyone but a signed-in trader', async () => {
    const a = await trader();
    expect((await a.browser.delete('/v1/account/blocks/Dnobody1234567x')).json()).toEqual({ error: 'not-found' });
    expect((await a.browser.delete(`/v1/account/blocks/${'x'.repeat(65)}`)).statusCode).toBe(400);
    expect((await anon.get('/v1/account/blocks')).statusCode).toBe(401);
    expect((await anon.delete(`/v1/account/blocks/${a.displayName}`)).statusCode).toBe(401);
  });
});

// S-093 (owner p7-6, 8 Nov 2026): "a blocked list with optional notes and the date/time blocked". The
// note is the blocker's own private text on the person they blocked; only the blocker ever reads it.
describe('S-093: a private note per blocked person, and when they were blocked', () => {
  const noteOf = async (a: Who, b: Who) =>
    ((await a.browser.get('/v1/account/blocks')).json() as { displayName: string; note: string | null; blockedAt: string }[]).find((e) => e.displayName === b.displayName);
  const putNote = (a: Who, name: string, note: unknown) => a.browser.put(`/v1/account/blocks/${encodeURIComponent(name)}/note`, { note });

  it('a block starts with no note and its exact time; the blocker sets, changes and clears the note', async () => {
    const a = await trader();
    const b = await trader();
    await block(a, b);
    const first = await noteOf(a, b);
    expect(first).toEqual({ displayName: b.displayName, blockedAt: deps.clock().toISOString(), note: null });
    const set = await putNote(a, b.displayName, '  Asked for my phone number in chat.  ');
    expect([set.statusCode, set.json()]).toEqual([200, { note: 'Asked for my phone number in chat.' }]);
    expect((await noteOf(a, b))!.note).toBe('Asked for my phone number in chat.');
    // By the name case-insensitively, as unblock.
    expect((await putNote(a, b.displayName.toUpperCase(), 'Second try.')).json()).toEqual({ note: 'Second try.' });
    // A note keeps the block's time.
    expect((await noteOf(a, b))!.blockedAt).toBe(first!.blockedAt);
    // Null or blank text clears it.
    expect((await putNote(a, b.displayName, null)).json()).toEqual({ note: null });
    await putNote(a, b.displayName, 'Again.');
    expect((await putNote(a, b.displayName, '   ')).json()).toEqual({ note: null });
    expect((await noteOf(a, b))!.note).toBeNull();
  });

  it('only the blocker ever sees the note: not the blocked person, not a moderator\'s blocksBetween, and unblocking deletes it', async () => {
    const a = await trader();
    const b = await trader();
    await block(a, b);
    await putNote(a, b.displayName, 'Private words 7Q2.');
    await block(b, a);
    // The blocked person's own list has their own block of a, with no note of a's.
    expect(await noteOf(b, a)).toMatchObject({ note: null });
    expect((await b.browser.get('/v1/account/blocks')).body).not.toContain('7Q2');
    // Staff see a block only in a dispute between the two (blocksBetween): never its note.
    const between = await blocksBetween(deps.db, a.id, b.id);
    expect(JSON.stringify(between)).not.toContain('7Q2');
    for (const e of between) expect(Object.keys(e).sort()).toEqual(['blockedId', 'blockerId', 'since']);
    // Unblocking removes the row and its note; blocking again starts with none.
    await unblock(a, b);
    await block(a, b);
    expect((await noteOf(a, b))!.note).toBeNull();
  });

  it('a note needs a block of mine: someone I did not block, or an unknown name, is 404; bad notes are 400; signed-in traders only', async () => {
    const a = await trader();
    const b = await trader();
    const c = await trader();
    // c blocked b; a did not block b: a cannot write a note on c's row or on a block that does not exist.
    await block(c, b);
    expect((await putNote(a, b.displayName, 'x')).json()).toEqual({ error: 'not-found' });
    expect((await putNote(a, 'Dnobody1234567x', 'x')).json()).toEqual({ error: 'not-found' });
    expect((await noteOf(c, b))!.note).toBeNull();
    await block(a, b);
    for (const bad of [12, ['x'], { t: 'x' }, 'x'.repeat(501), 'tab\u0000nul', undefined]) {
      const res = await putNote(a, b.displayName, bad);
      expect(res.statusCode, String(bad)).toBe(400);
    }
    // 500 characters (not bytes) is the limit, and a new line is allowed.
    expect((await putNote(a, b.displayName, '\u00e9'.repeat(500))).statusCode).toBe(200);
    expect((await putNote(a, b.displayName, 'line one\nline two')).json()).toEqual({ note: 'line one\nline two' });
    expect((await a.browser.put(`/v1/account/blocks/${'x'.repeat(65)}/note`, { note: 'x' })).statusCode).toBe(400);
    expect((await anon.put(`/v1/account/blocks/${encodeURIComponent(b.displayName)}/note`, { note: 'x' })).statusCode).toBe(401);
  });
});

describe('S-093 review: the note check, team members and the Jabber notice', () => {
  const putNote = (a: Who, name: string, note: unknown) => a.browser.put(`/v1/account/blocks/${encodeURIComponent(name)}/note`, { note });
  const block = async (a: Who, b: Who) => expect((await a.browser.post('/v1/account/blocks', { displayName: b.displayName })).statusCode).toBe(204);

  it('m1: the same character rule as S-094 trader notes: C1 controls, format characters and tab are refused; a new line is allowed', async () => {
    const a = await trader();
    const b = await trader();
    await block(a, b);
    for (const bad of ['a\u0085b', 'a\u009fb', 'a\u202eb', 'a\u2066b', 'a\u200bb', 'a\u200db', 'a\u2028b', 'a\u2029b', 'a\ufeffb', 'a\tb', 'a\rb']) {
      expect((await putNote(a, b.displayName, bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect((await putNote(a, b.displayName, 'one\ntwo')).json()).toEqual({ note: 'one\ntwo' });
  });

  it('m4: a team member cannot read or write the lead\'s block notes (403 owner-only)', async () => {
    const lead = await trader();
    const b = await trader();
    await block(lead, b);
    const loginId = await seedAccount(deps, { loginName: 'blocknotemember1x', displayName: 'bn-m-1', kind: 'member' });
    await deps.db.query(
      `insert into team_members (account_id, display_name, display_key, abilities, invite_expires_at, member_account_id, joined_at, created_at)
       values ($1, 'BnMember1', 'bnmember1', $2, $3, $4, $3, $3)`,
      [lead.id, rolesToAbilities(['offers', 'trades']), deps.clock(), loginId],
    );
    const mb = new Browser(app);
    expect((await mb.post('/t/login', { accountId: loginId })).statusCode).toBe(200);
    const res = await mb.put(`/v1/account/blocks/${encodeURIComponent(b.displayName)}/note`, { note: 'x' });
    expect([res.statusCode, res.json()]).toEqual([403, { error: 'owner-only' }]);
    expect((await mb.get('/v1/account/blocks')).json()).toEqual({ error: 'owner-only' });
  });

  it('m4: a note-only change queues one Jabber notice for the blocker; the same note again queues none', async () => {
    const a = await trader();
    const b = await trader();
    await deps.db.query('insert into jabber_contacts (account_id, jid_sealed, verified_at, enabled) values ($1, $2, now(), true)', [a.id, Buffer.from('01aa', 'hex')]);
    const notices = async () => (await deps.db.query<{ n: number }>('select count(*)::int as n from jabber_outbox where account_id = $1', [a.id])).rows[0]!.n;
    await block(a, b);
    await deps.db.query('delete from jabber_outbox where account_id = $1', [a.id]);
    expect((await putNote(a, b.displayName, 'Pushy in chat.')).statusCode).toBe(200);
    expect(await notices()).toBe(1);
    expect((await putNote(a, b.displayName, 'Pushy in chat.')).statusCode).toBe(200);
    expect(await notices()).toBe(1);
    expect((await deps.db.query<{ n: number }>('select count(*)::int as n from jabber_outbox where account_id = $1', [b.id])).rows[0]!.n).toBe(0);
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

  it("review I1: /v1/methods' count and best rate leave out offers a block hides, for both sides", async () => {
    const cur = ownCurrency();
    const a = await poster();
    const b = await trader();
    const c = await poster();
    const other = await trader();
    // a's offer is the cheapest (sell ads: lowest is best).
    // 3,300,000 −10% = 2,970,000; +5% = 3,465,000.
    await post(a, cur, -1000);
    await post(c, cur, 500);
    const zelle = async (who: Browser) => {
      const res = await who.get(`/v1/methods?side=sell&currency=${cur}`);
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { live: { id: string; offers: number; bestRate: string | null }[] }).live.find((m) => m.id === 'ZELLE');
    };
    expect(await zelle(other.browser)).toMatchObject({ offers: 2, bestRate: '2970000' });
    await block(a, b);
    // The blocked person: only c's offer, at c's price, matching the list they would open.
    expect(await zelle(b.browser)).toMatchObject({ offers: 1, bestRate: '3465000' });
    expect(await listed(b.browser, cur)).toHaveLength(1);
    // The blocker: their own offer counts, c's too (c is not blocked).
    expect(await zelle(a.browser)).toMatchObject({ offers: 2, bestRate: '2970000' });
    // Everyone else: unchanged. Logged out: nothing at all (the front door, owner 8 Nov 2026).
    expect(await zelle(other.browser)).toMatchObject({ offers: 2, bestRate: '2970000' });
    expect((await anon.get(`/v1/methods?side=sell&currency=${cur}`)).statusCode).toBe(401);
    await unblock(a, b);
    expect(await zelle(b.browser)).toMatchObject({ offers: 2, bestRate: '2970000' });
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

  it('logging out does not get round a block: a logged-out view gets nothing at all (the front door, owner 8 Nov 2026; before, Task 37 accepted a coarse public view)', async () => {
    const cur = ownCurrency();
    const a = await poster();
    const b = await poster();
    const aOffer = await post(a, cur);
    await block(a, b);
    for (const url of [`/v1/offers/${aOffer}`, `/v1/offers?side=sell&method=ZELLE&currency=${cur}&sort=online`]) {
      const res = await anon.get(url);
      expect(res.statusCode, url).toBe(401);
      expect(res.json(), url).toEqual({ error: 'not-authenticated' });
    }
  });
});
