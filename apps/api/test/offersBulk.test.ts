import { fiatCents } from '@x2f/trade';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { SWITCH_MAX_IDS } from '../src/offers/routes.js';
import type { MarketPrices, MarketQuote } from '../src/price/market.js';
import { testDb } from './helpers/db.js';
import { makeVendor } from './helpers/accounts.js';
import { Browser } from './helpers/totp.js';
import { tradeApp } from './helpers/tradeApp.js';
import { flexBody, insertOffer, renameOfferMethod } from './helpers/offers.js';

// Plan 3 Task 36: My offers. GET /v1/account/offers and POST /v1/account/offers/status (turn some
// or all of my offers on or off). Real Postgres, one database for the file; each test uses its own
// accounts, and tests that flip site_flags or owner_settings put them back.

const DAY = 86_400_000;

/**
 * USD at $330.00 per XMR; every other currency at 297.00 of its units (0.9 per US dollar, as EUR).
 * Every currency has a price: posting converts every band's top edge to US dollars and fails closed
 * without a price (the launch cap, owner p11-6).
 */
function quote(currency: string): MarketQuote | null {
  return {
    price: { currency, centsPerXmr: currency === 'USD' ? 33_000n : 29_700n }, at: new Date('2026-10-17T11:59:00Z'), sources: 3, exponent: 2,
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
let setNow: (d: Date) => void;

beforeAll(async () => {
  // A pool larger than the race tests' open transactions (the take race holds 4 at once, plus its poll).
  ({ app, deps, trader, setNow } = await tradeApp({}, { prices, db: await testDb({ max: 12 }) }));
  anon = new Browser(app);
});
afterAll(async () => {
  await app.close();
  await deps.db.end();
});

type Who = Awaited<ReturnType<typeof trader>>;

async function addWallet(accountId: string): Promise<void> {
  const now = deps.clock();
  await deps.db.query(
    `insert into wallets (account_id, app, label, address, created_at, usable_from) values ($1, 'cake', 'Main', $2, $3, $4)`,
    [accountId, `addr-${Math.random()}`, new Date(now.getTime() - 2 * DAY), new Date(now.getTime() - DAY)],
  );
}

async function poster(): Promise<Who> {
  const t = await trader();
  await addWallet(t.id);
  // Owner 2 Nov 2026: only vendors post.
  await makeVendor(deps, t.id);
  return t;
}

const BODY = {
  side: 'sell', methodId: 'ZELLE', currency: 'USD', pricing: { mode: 'market', marginBps: 50 },
  minFiatCents: '5000', maxFiatCents: '200000', minTrades: null, terms: 'Zelle only.',
};

async function post(who: Who, over: Record<string, unknown> = {}): Promise<string> {
  const res = await who.browser.post('/v1/offers', flexBody({ ...BODY, ...over }));
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { id: string }).id;
}

type Result = { id: string; status?: 'live' | 'paused'; refused?: string };

async function setStatus(who: Who, ids: string[] | 'all', status: 'live' | 'paused'): Promise<Result[]> {
  const res = await who.browser.post('/v1/account/offers/status', { ids, status });
  expect(res.statusCode, res.body).toBe(200);
  const body = res.json() as { status: string; results: Result[] };
  expect(body.status).toBe(status);
  return body.results;
}

async function statuses(accountId: string): Promise<Record<string, string>> {
  const { rows } = await deps.db.query<{ id: string; status: string }>('select id, status from offers where account_id = $1', [accountId]);
  return Object.fromEntries(rows.map((r) => [r.id, r.status]));
}

async function hold(accountId: string): Promise<void> {
  await deps.db.query('insert into trading_holds (account_id, created_at) values ($1, $2)', [accountId, deps.clock()]);
}

async function withStop(fn: () => Promise<void>): Promise<void> {
  await deps.db.query('update site_flags set trading_paused = true');
  try {
    await fn();
  } finally {
    await deps.db.query('update site_flags set trading_paused = false');
  }
}

describe('GET /v1/account/offers', () => {
  it('lists my live and paused offers, newest first, never removed ones or anyone else’s', async () => {
    const p = await poster();
    const other = await poster();
    const a = await post(p);
    setNow(new Date(deps.clock().getTime() + 1000));
    const b = await post(p, { side: 'buy', methodId: 'REVOLUT', currency: 'EUR', pricing: { mode: 'market', marginBps: -1000 } });
    setNow(new Date(deps.clock().getTime() + 1000));
    const c = await post(p);
    await post(other);
    await p.browser.patch(`/v1/offers/${b}`, { status: 'paused' });
    await p.browser.patch(`/v1/offers/${c}`, { status: 'removed' });

    const res = await p.browser.get('/v1/account/offers');
    expect(res.statusCode).toBe(200);
    const list = res.json() as Record<string, unknown>[];
    expect(list.map((o) => o.id)).toEqual([b, a]);
    expect(list[0]).toEqual({
      // €297.00 −10% = €267.30.
      id: b, side: 'buy', methodId: 'REVOLUT', methodName: expect.any(String), currency: 'EUR', rate: '26730',
      pricing: { mode: 'market', marginBps: -1000 }, amountUnit: 'fiat', minAtomic: '187055742611', maxAtomic: '7482229704451',
      minFiatCents: '5000', maxFiatCents: '200000', minTrades: null,
      // J-16: the first currency's bands, every currency priced, every method with its instructions
      // and its time to pay (owner p9-6; the offer's own is its first method's).
      tiers: [{ min: '5000', max: '200000', marginBps: -1000, minTrades: null, methodIds: null }],
      currencies: [{ currency: 'EUR', rate: '26730', tiers: [{ min: '5000', max: '200000', marginBps: -1000, minTrades: null, methodIds: null }] }],
      methods: [{ methodId: 'REVOLUT', methodName: expect.any(String), adjustBps: 0, instructions: '', currencies: ['EUR'], instructionsByCurrency: {}, payWindowMin: 90 }],
      status: 'paused', payWindowMin: 90, createdAt: expect.any(String),
    });
    expect(list[1]).toMatchObject({ id: a, methodId: 'ZELLE', methodName: 'Zelle', rate: '33165', status: 'live', pricing: { mode: 'market', marginBps: 50 } });
    // J-16: every method carries the catalog's name, so My offers can list them all.
    expect((list[1]!.methods as { methodName: string }[]).map((m) => m.methodName)).toEqual(['Zelle']);
  });

  it('needs a trader session (401 logged out, 403 staff)', async () => {
    expect((await anon.get('/v1/account/offers')).statusCode).toBe(401);
    expect((await anon.post('/v1/account/offers/status', { ids: 'all', status: 'paused' })).statusCode).toBe(401);
    const staff = await trader('staff');
    expect((await staff.browser.get('/v1/account/offers')).json()).toEqual({ error: 'wrong-account-kind' });
    expect((await staff.browser.post('/v1/account/offers/status', { ids: 'all', status: 'paused' })).json()).toEqual({ error: 'wrong-account-kind' });
  });
});

describe('POST /v1/account/offers/status', () => {
  it('"all" pauses every own offer and none of another account’s; removed offers stay removed', async () => {
    const p = await poster();
    const other = await poster();
    const a = await post(p);
    const b = await post(p, { side: 'buy' });
    const gone = await post(p, { currency: 'EUR' });
    await p.browser.patch(`/v1/offers/${gone}`, { status: 'removed' });
    const theirs = await post(other);

    const results = await setStatus(p, 'all', 'paused');
    expect(results.sort((x, y) => x.id.localeCompare(y.id))).toEqual([{ id: a, status: 'paused' }, { id: b, status: 'paused' }].sort((x, y) => x.id.localeCompare(y.id)));
    expect(await statuses(p.id)).toEqual({ [a]: 'paused', [b]: 'paused', [gone]: 'removed' });
    expect(await statuses(other.id)).toEqual({ [theirs]: 'live' });
    // Paused offers leave the list everyone else sees.
    expect(((await other.browser.get('/v1/offers?side=sell&method=ZELLE&currency=USD')).json() as { id: string }[]).map((o) => o.id)).not.toContain(a);

    // And "all" turns them back on.
    expect((await setStatus(p, 'all', 'live')).every((r) => r.status === 'live' && r.refused === undefined)).toBe(true);
    expect(await statuses(p.id)).toEqual({ [a]: 'live', [b]: 'live', [gone]: 'removed' });
  });

  it('turning all on while held: every offer stays off and the reply says why; turning off still works', async () => {
    const p = await poster();
    const a = await post(p);
    const b = await post(p, { side: 'buy' });
    await setStatus(p, 'all', 'paused');
    await hold(p.id);
    const on = await setStatus(p, 'all', 'live');
    expect(on).toHaveLength(2);
    for (const r of on) expect(r).toEqual({ id: r.id, status: 'paused', refused: 'trading-hold' });
    expect(await statuses(p.id)).toEqual({ [a]: 'paused', [b]: 'paused' });

    // A held account with live offers (hold placed after posting) can always turn them off.
    const q = await poster();
    const c = await post(q);
    await hold(q.id);
    expect(await setStatus(q, 'all', 'paused')).toEqual([{ id: c, status: 'paused' }]);
    expect(await setStatus(q, [c], 'live')).toEqual([{ id: c, status: 'paused', refused: 'trading-hold' }]);
  });

  it('owner option b (16 Nov 2026): turning all on with an active lien works (J-06 block lifted)', async () => {
    const p = await poster();
    const creditor = await trader();
    const a = await post(p);
    await setStatus(p, 'all', 'paused');
    await deps.db.query(
      `insert into liens (debtor_account_id, creditor_account_id, amount_atomic, from_code, dispute_seq, round, cause, created_at, changed_at)
     values ($1, $2, 1000, gen_random_uuid()::text, 1, 1, 'restitution', $3, $3)`,
      [p.id, creditor.id, deps.clock()],
    );
    expect(await setStatus(p, 'all', 'live')).toEqual([{ id: a, status: 'live' }]);
    expect(await statuses(p.id)).toEqual({ [a]: 'live' });
  });

  it('during an emergency stop turning off always succeeds and turning on is refused trading-paused', async () => {
    const p = await poster();
    const a = await post(p);
    const b = await post(p, { side: 'buy' });
    await withStop(async () => {
      const off = await setStatus(p, 'all', 'paused');
      expect(off.map((r) => r.status)).toEqual(['paused', 'paused']);
      const on = await setStatus(p, [a, b], 'live');
      expect(on).toEqual([
        { id: a, status: 'paused', refused: 'trading-paused' },
        { id: b, status: 'paused', refused: 'trading-paused' },
      ]);
    });
    expect(await statuses(p.id)).toEqual({ [a]: 'paused', [b]: 'paused' });
    expect(await setStatus(p, [a, b], 'live')).toEqual([{ id: a, status: 'live' }, { id: b, status: 'live' }]);
  });

  it('turning on without a usable wallet is refused no-wallet', async () => {
    const p = await poster();
    const a = await post(p);
    await setStatus(p, [a], 'paused');
    await deps.db.query('delete from wallets where account_id = $1', [p.id]);
    expect(await setStatus(p, [a], 'live')).toEqual([{ id: a, status: 'paused', refused: 'no-wallet' }]);
    // Off needs no wallet.
    await deps.db.query(`update offers set status = 'live' where id = $1`, [a]);
    expect(await setStatus(p, [a], 'paused')).toEqual([{ id: a, status: 'paused' }]);
  });

  it('the launch cap is checked per offer as relisting checks it (launch-rules review F1)', async () => {
    const p = await poster();
    // An offer from before the cap, paused, with a 20,000.00 band: $22,222 at 0.9 (J-16: bands are
    // written once, so it is inserted as migration 490 would have moved it).
    const a = await insertOffer(deps.db, { accountId: p.id, side: 'sell', methodId: 'ZELLE', currency: 'SEK', min: 5000, max: 2_000_000, status: 'paused', at: deps.clock() });
    const b = await post(p, { currency: 'NOK' });
    await setStatus(p, 'all', 'paused');
    expect(await setStatus(p, [a, b], 'live')).toEqual([
      { id: a, status: 'paused', refused: 'launch-cap' },
      { id: b, status: 'live' },
    ]);
    expect(await statuses(p.id)).toEqual({ [a]: 'paused', [b]: 'live' });
    // The same answer as the single relist route.
    expect((await p.browser.patch(`/v1/offers/${a}`, { status: 'live' })).json()).toEqual({ error: 'launch-cap', capUsdCents: '500000' });
    // At $5,000 exactly (4,500.00 at 0.9) it goes on.
    const c = await insertOffer(deps.db, { accountId: p.id, side: 'buy', methodId: 'ZELLE', currency: 'SEK', min: 5000, max: 450_000, status: 'paused', at: deps.clock() });
    expect(await setStatus(p, [c], 'live')).toEqual([{ id: c, status: 'live' }]);
  });

  it('caps are checked per offer as relisting checks them (per side, owner 2026-11-01); the others still switch (per-offer results)', async () => {
    const p = await poster();
    const a = await post(p, { currency: 'GBP' });
    const b = await post(p, { currency: 'CHF' });
    const c = await post(p, { currency: 'CHF', side: 'buy' });
    await setStatus(p, 'all', 'paused');
    await deps.db.query(`insert into owner_settings (key, value, updated_at) values ('offers_max_sell', 1, now())`);
    try {
      // a and b each count the other (both selling; paused offers count, as for relisting): both refused; c, buying, goes on.
      const on = await setStatus(p, [a, b, c], 'live');
      expect(on).toEqual([
        { id: a, status: 'paused', refused: 'too-many-offers' },
        { id: b, status: 'paused', refused: 'too-many-offers' },
        { id: c, status: 'live' },
      ]);
      // The same answer as the single relist route.
      expect((await p.browser.patch(`/v1/offers/${a}`, { status: 'live' })).json()).toEqual({ error: 'too-many-offers', buy: 3, sell: 1 });
      await p.browser.patch(`/v1/offers/${b}`, { status: 'removed' });
      expect(await setStatus(p, [a], 'live')).toEqual([{ id: a, status: 'live' }]);
    } finally {
      await deps.db.query(`delete from owner_settings where key = 'offers_max_sell'`);
    }
    const d = await post(p, { currency: 'EUR', side: 'buy' });
    await deps.db.query(`insert into owner_settings (key, value, updated_at) values ('offers_max_buy', 1, now())`);
    try {
      await setStatus(p, 'all', 'paused');
      // c and d are the buying ones and each counts the other: both refused; a, selling, goes on.
      const refused = Object.fromEntries((await setStatus(p, 'all', 'live')).map((r) => [r.id, r.refused ?? null]));
      expect(refused).toEqual({ [a]: null, [c]: 'too-many-offers', [d]: 'too-many-offers' });
    } finally {
      await deps.db.query(`delete from owner_settings where key = 'offers_max_buy'`);
    }
  });

  it('a fourth selling offer (over the default cap of 3 per side, e.g. after the cap was lowered) stays off; buying offers still go on', async () => {
    const p = await poster();
    const sells = [await post(p, { currency: 'GBP' }), await post(p, { currency: 'CHF' }), await post(p, { currency: 'EUR' })];
    const buy = await post(p, { side: 'buy', currency: 'EUR' });
    await setStatus(p, 'all', 'paused');
    // As if posted before the per-side cap: a fourth selling offer, paused (written straight to the
    // database in migration 490's shape: one currency, one band, one method).
    const fourth = await insertOffer(deps.db, { accountId: p.id, side: 'sell', methodId: 'ZELLE', currency: 'USD', min: 5000, max: 200_000, status: 'paused', at: deps.clock() });
    const on = await setStatus(p, [...sells, fourth, buy], 'live');
    for (const r of on.filter((x) => x.id !== buy)) expect(r).toEqual({ id: r.id, status: 'paused', refused: 'too-many-offers' });
    expect(on.find((r) => r.id === buy)).toEqual({ id: buy, status: 'live' });
  });

  it('an offer whose method went under legal review cannot go back on (method-unavailable)', async () => {
    const p = await poster();
    const a = await post(p);
    // As if SBP (removed, owner 12 Nov: Russian anything is banned) had been available when posted.
    await renameOfferMethod(deps.db, a, 'SBP');
    await deps.db.query(`update offers set status = 'paused' where id = $1`, [a]);
    expect(await setStatus(p, [a], 'live')).toEqual([{ id: a, status: 'paused', refused: 'method-unavailable' }]);
  });

  it("another account's offer, a removed one and an unknown id are not-found; mine still switch; an offer already in the status is done", async () => {
    const p = await poster();
    const other = await poster();
    const a = await post(p);
    const b = await post(p, { side: 'buy' });
    const gone = await post(p, { currency: 'EUR' });
    await p.browser.patch(`/v1/offers/${gone}`, { status: 'removed' });
    const theirs = await post(other);
    const unknown = '00000000-0000-4000-8000-000000000000';
    expect(await setStatus(p, [theirs, a, gone, unknown, a], 'paused')).toEqual([
      { id: theirs, refused: 'not-found' },
      { id: a, status: 'paused' },
      { id: gone, refused: 'not-found' },
      { id: unknown, refused: 'not-found' },
    ]);
    expect(await statuses(other.id)).toEqual({ [theirs]: 'live' });
    expect(await statuses(p.id)).toEqual({ [a]: 'paused', [b]: 'live', [gone]: 'removed' });
    expect(await setStatus(p, [b], 'live')).toEqual([{ id: b, status: 'live' }]);
    expect(await setStatus(other, [theirs], 'live')).toEqual([{ id: theirs, status: 'live' }]);
  });

  it('an account with no offers gets an empty result for "all"', async () => {
    const p = await poster();
    expect(await setStatus(p, 'all', 'paused')).toEqual([]);
    expect((await p.browser.get('/v1/account/offers')).json()).toEqual([]);
  });

  it('refuses malformed bodies with 400', async () => {
    const p = await poster();
    const a = await post(p);
    const many = Array.from({ length: SWITCH_MAX_IDS + 1 }, () => a);
    for (const body of [
      null, [], {}, { ids: 'all' }, { status: 'paused' }, { ids: 'all', status: 'removed' }, { ids: 'all', status: 'gone' },
      { ids: [], status: 'paused' }, { ids: ['x'.repeat(65)], status: 'paused' }, { ids: [1], status: 'paused' }, { ids: [null], status: 'paused' },
      { ids: 'ALL', status: 'paused' }, { ids: many, status: 'paused' }, { ids: [a], status: 'paused', extra: 1 },
    ]) {
      const res = await p.browser.post('/v1/account/offers/status', body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(await statuses(p.id)).toEqual({ [a]: 'live' });
  });

  it('runs with posts, relists, pauses and holds of the same account at once without deadlock, and the caps hold (real Postgres)', async () => {
    const p = await poster();
    const a = await post(p, { currency: 'SEK' });
    const b = await post(p, { currency: 'SEK' });
    await setStatus(p, 'all', 'paused');
    for (let round = 0; round < 3; round++) {
      const res = await Promise.all([
        p.browser.post('/v1/account/offers/status', { ids: 'all', status: 'live' }),
        p.browser.post('/v1/offers', flexBody({ ...BODY, currency: 'SEK' })),
        p.browser.post('/v1/offers', flexBody({ ...BODY, currency: 'SEK' })),
        p.browser.patch(`/v1/offers/${a}`, { status: 'paused' }),
        p.browser.patch(`/v1/offers/${b}`, { status: 'live' }),
        p.browser.post('/v1/account/offers/status', { ids: 'all', status: 'paused' }),
      ]);
      for (const r of res) expect([200, 201, 409], r.body).toContain(r.statusCode);
      const { rows } = await deps.db.query<{ n: number }>(
        `select count(*)::int as n from offers o join offer_currencies c on c.offer_id = o.id where o.account_id = $1 and c.currency = 'SEK' and o.status <> 'removed'`,
        [p.id],
      );
      expect(rows[0]!.n).toBeLessThanOrEqual(3);
    }
    // A hold and an emergency stop racing a pause-all: turning off still succeeds every time.
    const q = await poster();
    await post(q, { currency: 'SEK' });
    await post(q, { currency: 'SEK', side: 'buy' });
    const [off] = await Promise.all([
      q.browser.post('/v1/account/offers/status', { ids: 'all', status: 'paused' }),
      hold(q.id),
      deps.db.query('update site_flags set trading_paused = true'),
    ]);
    await deps.db.query('update site_flags set trading_paused = false');
    expect(off.statusCode, off.body).toBe(200);
    expect(Object.values(await statuses(q.id))).toEqual(['paused', 'paused']);
  });
});

describe('review fixes (Task 36 review 2026-10-29)', () => {
  it('M4: a live offer nobody can see says why (hold, emergency stop, method under review); paused ones do not', async () => {
    const p = await poster();
    const a = await post(p);
    const b = await post(p, { side: 'buy' });
    await setStatus(p, [b], 'paused');
    const hiddenOf = async () =>
      Object.fromEntries(((await p.browser.get('/v1/account/offers')).json() as { id: string; hidden?: string }[]).map((o) => [o.id, o.hidden ?? null]));
    expect(await hiddenOf()).toEqual({ [a]: null, [b]: null });
    await withStop(async () => {
      expect(await hiddenOf()).toEqual({ [a]: 'trading-paused', [b]: null });
    });
    await hold(p.id);
    expect(await hiddenOf()).toEqual({ [a]: 'trading-hold', [b]: null });
    await deps.db.query('update trading_holds set lifted_at = $2 where account_id = $1', [p.id, deps.clock()]);
    await renameOfferMethod(deps.db, a, 'SBP');
    expect(await hiddenOf()).toEqual({ [a]: 'method-unavailable', [b]: null });
  });

  it('N1: the refusal order matches PATCH (method before the account guards)', async () => {
    const p = await poster();
    const a = await post(p);
    await setStatus(p, [a], 'paused');
    await renameOfferMethod(deps.db, a, 'SBP');
    await hold(p.id);
    expect((await p.browser.patch(`/v1/offers/${a}`, { status: 'live' })).json()).toEqual({ error: 'method-unavailable' });
    expect(await setStatus(p, [a], 'live')).toEqual([{ id: a, status: 'paused', refused: 'method-unavailable' }]);
  });

  it('N2: an id that is not a lower-case UUID is not-found, as PATCH answers 404', async () => {
    const p = await poster();
    const a = await post(p);
    expect((await p.browser.patch(`/v1/offers/${a.toUpperCase()}`, { status: 'paused' })).statusCode).toBe(404);
    expect(await setStatus(p, [a.toUpperCase(), 'nope', a], 'paused')).toEqual([
      { id: a.toUpperCase(), refused: 'not-found' },
      { id: 'nope', refused: 'not-found' },
      { id: a, status: 'paused' },
    ]);
  });

  it('R10 (lead decision 2026-10-29): on a stale Terms version, turning off and removing work (bulk and PATCH) and turning on does not', async () => {
    const p = await poster();
    const a = await post(p);
    const b = await post(p, { side: 'buy' });
    const c = await post(p, { currency: 'EUR' });
    await deps.db.query(`update accounts set terms_version = 'stale-version' where id = $1`, [p.id]);
    const terms = { error: 'terms-required', version: deps.config.termsVersion };

    expect((await p.browser.get('/v1/account/offers')).statusCode).toBe(200);
    expect(await setStatus(p, [a], 'paused')).toEqual([{ id: a, status: 'paused' }]);
    expect((await p.browser.patch(`/v1/offers/${b}`, { status: 'paused' })).json()).toEqual({ id: b, status: 'paused' });
    expect(await statuses(p.id)).toEqual({ [a]: 'paused', [b]: 'paused', [c]: 'live' });
    expect(await setStatus(p, 'all', 'paused')).toHaveLength(3);

    const on = await p.browser.post('/v1/account/offers/status', { ids: [a], status: 'live' });
    expect(on.statusCode).toBe(403);
    expect(on.json()).toEqual(terms);
    const relist = await p.browser.patch(`/v1/offers/${a}`, { status: 'live' });
    expect(relist.statusCode).toBe(403);
    expect(relist.json()).toEqual(terms);
    // Round-2 m1 (lead decision 2026-10-29): removing is shutting off too, so it works on stale Terms.
    expect((await p.browser.patch(`/v1/offers/${c}`, { status: 'removed' })).json()).toEqual({ id: c, status: 'removed' });
    // Posting still needs the current Terms.
    expect((await p.browser.post('/v1/offers', flexBody(BODY))).json()).toEqual(terms);
    expect(await statuses(p.id)).toEqual({ [a]: 'paused', [b]: 'paused', [c]: 'removed' });

    await deps.db.query('update accounts set terms_version = $2 where id = $1', [p.id, deps.config.termsVersion]);
    expect(await setStatus(p, [a], 'live')).toEqual([{ id: a, status: 'live' }]);
  });

  it('round-2 m3: a take racing the poster\'s and the taker\'s pause-all neither deadlocks nor takes a paused offer (real Postgres)', async () => {
    const amount = 100_000_000_000n; // 0.1 XMR at the market's $330.00 (0%): $33.00, under any starter cap
    for (let round = 0; round < 3; round++) {
      const poster_ = await poster();
      const taker = await poster();
      const offer = await post(poster_, { pricing: { mode: 'market', marginBps: 0 }, minFiatCents: '1000' });
      await post(taker, { side: 'buy' });
      const { rows: w } = await deps.db.query<{ id: string }>('select id from wallets where account_id = $1', [taker.id]);
      const takeBody = {
        amountAtomic: amount.toString(), walletId: w[0]!.id, centsPerXmr: '33000',
        fiatCents: fiatCents(amount, { currency: 'USD', centsPerXmr: 33_000n }).toString(), methodId: 'ZELLE', currency: 'USD',
      };
      // Hold both account rows so all three requests queue inside their transactions, then let go.
      const holder = await deps.db.connect();
      let res: Awaited<ReturnType<Browser['post']>>[];
      try {
        await holder.query('begin');
        await holder.query('select 1 from accounts where id = any($1::uuid[]) order by id for update', [[poster_.id, taker.id]]);
        const holderPid = (await holder.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!.pid;
        const fire = [
          taker.browser.post(`/v1/offers/${offer}/take`, takeBody),
          poster_.browser.post('/v1/account/offers/status', { ids: 'all', status: 'paused' }),
          taker.browser.post('/v1/account/offers/status', { ids: 'all', status: 'paused' }),
        ];
        // Round order varies which request reaches the lock first.
        if (round === 1) fire.reverse();
        const pending = Promise.all(fire);
        const deadline = Date.now() + 10_000;
        for (;;) {
          const { rows } = await deps.db.query<{ n: number }>(
            `select count(*)::int as n from pg_stat_activity
              where datname = current_database() and pid <> $1 and wait_event_type = 'Lock' and state = 'active'`,
            [holderPid],
          );
          if (rows[0]!.n >= 3) break;
          if (Date.now() > deadline) throw new Error(`only ${rows[0]!.n} of 3 requests reached the lock`);
          await new Promise((r) => setTimeout(r, 10));
        }
        await holder.query('commit');
        res = await pending;
      } catch (e) {
        await holder.query('rollback').catch(() => {});
        throw e;
      } finally {
        holder.release();
      }
      if (round === 1) res.reverse();
      const [take, posterOff, takerOff] = res as [typeof res[0], typeof res[0], typeof res[0]];
      // No deadlock (40P01 would be a 500) and no fault.
      expect(posterOff.statusCode, posterOff.body).toBe(200);
      expect(takerOff.statusCode, takerOff.body).toBe(200);
      expect([200, 404, 409], take.body).toContain(take.statusCode);
      expect(Object.values(await statuses(poster_.id))).toEqual(['paused']);
      expect(Object.values(await statuses(taker.id))).toEqual(['paused']);
      // Either the take ran while the offer was live (a trade) or after the pause (no trade).
      const { rows: trades } = await deps.db.query<{ n: number }>('select count(*)::int as n from trades where offer_id = $1', [offer]);
      expect(trades[0]!.n).toBe(take.statusCode === 200 ? 1 : 0);
    }
  });
});
