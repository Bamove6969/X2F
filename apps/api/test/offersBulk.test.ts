import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { SWITCH_MAX_IDS } from '../src/offers/routes.js';
import type { MarketPrices, MarketQuote } from '../src/price/market.js';
import { Browser } from './helpers/totp.js';
import { tradeApp } from './helpers/tradeApp.js';

// Plan 3 Task 36: My offers. GET /v1/account/offers and POST /v1/account/offers/status (turn some
// or all of my offers on or off). Real Postgres, one database for the file; each test uses its own
// accounts, and tests that flip site_flags or owner_settings put them back.

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
let setNow: (d: Date) => void;

beforeAll(async () => {
  ({ app, deps, trader, setNow } = await tradeApp({}, { prices }));
  anon = new Browser(app);
});
afterAll(async () => {
  await app.close();
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
  return t;
}

const BODY = {
  side: 'sell', methodId: 'ZELLE', currency: 'USD', pricing: { mode: 'market', marginBps: 50 },
  minFiatCents: '5000', maxFiatCents: '200000', minTrades: 0, terms: 'Zelle only.',
};

async function post(who: Who, over: Record<string, unknown> = {}): Promise<string> {
  const res = await who.browser.post('/v1/offers', { ...BODY, ...over });
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
    const b = await post(p, { side: 'buy', methodId: 'REVOLUT', currency: 'EUR', pricing: { mode: 'fixed', centsPerXmr: '30000' } });
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
      id: b, side: 'buy', methodId: 'REVOLUT', methodName: expect.any(String), currency: 'EUR', rate: '30000',
      pricing: { mode: 'fixed', centsPerXmr: '30000' }, minFiatCents: '5000', maxFiatCents: '200000', minTrades: 0,
      status: 'paused', createdAt: expect.any(String),
    });
    expect(list[1]).toMatchObject({ id: a, methodId: 'ZELLE', methodName: 'Zelle', rate: '33165', status: 'live', pricing: { mode: 'market', marginBps: 50 } });
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
    // Paused offers leave the public list.
    expect(((await anon.get('/v1/offers?side=sell&method=ZELLE&currency=USD')).json() as { id: string }[]).map((o) => o.id)).not.toContain(a);

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

  it('caps are checked per offer as relisting checks them; the others still switch (per-offer results)', async () => {
    const p = await poster();
    const a = await post(p, { currency: 'GBP' });
    const b = await post(p, { currency: 'GBP' });
    const c = await post(p, { currency: 'CHF' });
    await setStatus(p, 'all', 'paused');
    await deps.db.query(`insert into owner_settings (key, value, updated_at) values ('offers_max_per_market', 1, now())`);
    try {
      // a and b each count the other (paused offers count, as for relisting): both refused; c goes on.
      const on = await setStatus(p, [a, b, c], 'live');
      expect(on).toEqual([
        { id: a, status: 'paused', refused: 'too-many-offers' },
        { id: b, status: 'paused', refused: 'too-many-offers' },
        { id: c, status: 'live' },
      ]);
      // The same answer as the single relist route.
      expect((await p.browser.patch(`/v1/offers/${a}`, { status: 'live' })).json()).toEqual({ error: 'too-many-offers' });
      await p.browser.patch(`/v1/offers/${b}`, { status: 'removed' });
      expect(await setStatus(p, [a], 'live')).toEqual([{ id: a, status: 'live' }]);
    } finally {
      await deps.db.query(`delete from owner_settings where key = 'offers_max_per_market'`);
    }
    await deps.db.query(`insert into owner_settings (key, value, updated_at) values ('offers_max_total', 1, now())`);
    try {
      await setStatus(p, 'all', 'paused');
      expect((await setStatus(p, 'all', 'live')).map((r) => r.refused)).toEqual(['too-many-offers', 'too-many-offers']);
    } finally {
      await deps.db.query(`delete from owner_settings where key = 'offers_max_total'`);
    }
  });

  it('an offer whose method went under legal review cannot go back on (method-unavailable)', async () => {
    const p = await poster();
    const a = await post(p);
    // As if SBP had been available when posted.
    await deps.db.query(`update offers set method_id = 'SBP', status = 'paused' where id = $1`, [a]);
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
      { ids: [], status: 'paused' }, { ids: ['not-a-uuid'], status: 'paused' }, { ids: [1], status: 'paused' },
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
        p.browser.post('/v1/offers', { ...BODY, currency: 'SEK' }),
        p.browser.post('/v1/offers', { ...BODY, currency: 'SEK' }),
        p.browser.patch(`/v1/offers/${a}`, { status: 'paused' }),
        p.browser.patch(`/v1/offers/${b}`, { status: 'live' }),
        p.browser.post('/v1/account/offers/status', { ids: 'all', status: 'paused' }),
      ]);
      for (const r of res) expect([200, 201, 409], r.body).toContain(r.statusCode);
      const { rows } = await deps.db.query<{ n: number }>(
        `select count(*)::int as n from offers where account_id = $1 and currency = 'SEK' and status <> 'removed'`,
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
