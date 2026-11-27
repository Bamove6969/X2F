import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { rolesToAbilities } from '../src/team/abilities.js';
import type { MarketPrices, MarketQuote } from '../src/price/market.js';
import { makeVendor, seedAccount } from './helpers/accounts.js';
import { flexBody } from './helpers/offers.js';
import { testDb } from './helpers/db.js';
import { Browser } from './helpers/totp.js';
import { fakeAddress } from './helpers/trades.js';
import { tradeApp } from './helpers/tradeApp.js';

// The Away switch (owner, 26 Nov 2026; migration 856): pauses every live offer, then turns back on
// only the ones it paused, through the relist checks. Real Postgres.

const DAY = 86_400_000;

function quote(currency: string): MarketQuote | null {
  if (currency !== 'USD') return null;
  return { price: { currency, centsPerXmr: 33_000n }, at: new Date('2026-10-17T11:59:00Z'), sources: 3, exponent: 2, usdCentsPerXmr: 33_000n, fx: null };
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
let setNow: (d: Date) => void;
const START = new Date('2026-10-17T12:00:00Z');
let n = 0;

beforeAll(async () => {
  ({ app, deps, trader, setNow } = await tradeApp({}, { prices, db: await testDb({ max: 8 }) }));
});
afterAll(async () => {
  await app.close();
  await deps.db.end();
});

type Who = Awaited<ReturnType<typeof trader>>;

async function addWallet(accountId: string): Promise<string> {
  const now = deps.clock();
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into wallets (account_id, app, label, address, created_at, usable_from) values ($1, 'cake', 'Main', $2, $3, $4) returning id`,
    [accountId, fakeAddress(), new Date(now.getTime() - 2 * DAY), new Date(now.getTime() - DAY)],
  );
  return rows[0]!.id;
}

async function vendor(): Promise<Who> {
  setNow(START);
  const t = await trader();
  await makeVendor(deps, t.id);
  await addWallet(t.id);
  return t;
}

const OFFER = (side: 'buy' | 'sell') => flexBody({
  side, methodId: 'ZELLE', currency: 'USD', pricing: { mode: 'market', marginBps: 0 },
  amountUnit: 'fiat', minFiatCents: '1000', maxFiatCents: '40000', minTrades: null, terms: 'Zelle only.',
});

async function post(who: Who, side: 'buy' | 'sell' = 'sell'): Promise<string> {
  const res = await who.browser.post('/v1/offers', OFFER(side));
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { id: string }).id;
}

async function statuses(ids: string[]): Promise<Record<string, { status: string; byAway: boolean }>> {
  const { rows } = await deps.db.query<{ id: string; status: string; paused_by_away: boolean }>(
    'select id, status, paused_by_away from offers where id = any($1::uuid[])', [ids],
  );
  return Object.fromEntries(rows.map((r) => [r.id, { status: r.status, byAway: r.paused_by_away }]));
}

async function profileAway(viewer: Who, of: Who): Promise<boolean> {
  const res = await viewer.browser.get(`/v1/traders/${of.tradeTag}`);
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { away: boolean }).away;
}

const setCap = (key: string, value: number) =>
  deps.db.query(`insert into owner_settings (key, value, updated_at) values ($1, $2, now()) on conflict (key) do update set value = excluded.value`, [key, value]);

describe('the Away switch', () => {
  it('pauses every live offer, shows Away on the profile, then turns back on only the offers it paused', async () => {
    const me = await vendor();
    const viewer = await trader();
    const a = await post(me);
    const b = await post(me, 'buy');
    const mine = await post(me);
    // Paused by hand before Away: Away leaves it alone both ways.
    expect((await me.browser.patch(`/v1/offers/${mine}`, { status: 'paused' })).statusCode).toBe(200);

    expect((await me.browser.get('/v1/account/away')).json()).toEqual({ away: false, since: null });
    expect(await profileAway(viewer, me)).toBe(false);

    const on = await me.browser.put('/v1/account/away', { away: true });
    expect(on.statusCode, on.body).toBe(200);
    const onBody = on.json() as { away: boolean; since: string; paused: string[] };
    expect(onBody.away).toBe(true);
    expect(onBody.since).toBe(START.toISOString());
    expect([...onBody.paused].sort()).toEqual([a, b].sort());
    expect(await statuses([a, b, mine])).toEqual({
      [a]: { status: 'paused', byAway: true }, [b]: { status: 'paused', byAway: true }, [mine]: { status: 'paused', byAway: false },
    });
    expect((await me.browser.get('/v1/account/away')).json()).toEqual({ away: true, since: START.toISOString() });
    expect(await profileAway(viewer, me)).toBe(true);

    // Turning it on again keeps the first time and pauses nothing more.
    setNow(new Date(START.getTime() + 60_000));
    const again = (await me.browser.put('/v1/account/away', { away: true })).json() as { since: string; paused: string[] };
    expect(again).toEqual({ away: true, since: START.toISOString(), paused: [] });

    const off = await me.browser.put('/v1/account/away', { away: false });
    expect(off.statusCode, off.body).toBe(200);
    const offBody = off.json() as { away: boolean; since: null; resumed: { id: string; status: string; refused?: string }[] };
    expect(offBody.away).toBe(false);
    expect(offBody.since).toBeNull();
    expect([...offBody.resumed].sort((x, y) => x.id.localeCompare(y.id))).toEqual([{ id: a, status: 'live' }, { id: b, status: 'live' }].sort((x, y) => x.id.localeCompare(y.id)));
    expect(await statuses([a, b, mine])).toEqual({
      [a]: { status: 'live', byAway: false }, [b]: { status: 'live', byAway: false }, [mine]: { status: 'paused', byAway: false },
    });
    expect(await profileAway(viewer, me)).toBe(false);
  });

  it('an offer switched by hand while Away is on is not turned back on by Away', async () => {
    const me = await vendor();
    const a = await post(me);
    const b = await post(me);
    await me.browser.put('/v1/account/away', { away: true });
    // Relisted, then paused again by hand: no longer Away's.
    expect((await me.browser.post('/v1/account/offers/status', { ids: [a], status: 'live' })).statusCode).toBe(200);
    expect((await me.browser.patch(`/v1/offers/${a}`, { status: 'paused' })).statusCode).toBe(200);
    const off = (await me.browser.put('/v1/account/away', { away: false })).json() as { resumed: { id: string }[] };
    expect(off.resumed.map((r) => r.id)).toEqual([b]);
    expect(await statuses([a, b])).toEqual({ [a]: { status: 'paused', byAway: false }, [b]: { status: 'live', byAway: false } });
  });

  it('an offer that fails a relist check stays paused and the answer says why; the others go back on', async () => {
    const me = await vendor();
    const buy = await post(me, 'buy');
    const s1 = await post(me);
    const s2 = await post(me);
    await me.browser.put('/v1/account/away', { away: true });
    // The owner lowers the sell cap to 1 meanwhile: each sell offer counts the other.
    await setCap('offers_max_sell', 1);
    try {
      const off = await me.browser.put('/v1/account/away', { away: false });
      expect(off.statusCode, off.body).toBe(200);
      const byId = Object.fromEntries((off.json() as { resumed: { id: string; status: string; refused?: string }[] }).resumed.map((r) => [r.id, r]));
      expect(byId).toEqual({
        [buy]: { id: buy, status: 'live' },
        [s1]: { id: s1, status: 'paused', refused: 'too-many-offers' },
        [s2]: { id: s2, status: 'paused', refused: 'too-many-offers' },
      });
      // Away is off and the refused offers are ordinary paused offers now.
      expect(await statuses([buy, s1, s2])).toEqual({
        [buy]: { status: 'live', byAway: false }, [s1]: { status: 'paused', byAway: false }, [s2]: { status: 'paused', byAway: false },
      });
      expect((await me.browser.get('/v1/account/away')).json()).toEqual({ away: false, since: null });
    } finally {
      await deps.db.query("delete from owner_settings where key = 'offers_max_sell'");
    }
  });

  it('an account-wide refusal (no usable wallet) leaves every offer paused with that reason', async () => {
    const me = await vendor();
    const a = await post(me);
    await me.browser.put('/v1/account/away', { away: true });
    await deps.db.query('update wallets set removed_at = now() where account_id = $1', [me.id]);
    const off = (await me.browser.put('/v1/account/away', { away: false })).json() as { away: boolean; resumed: unknown[] };
    expect(off).toEqual({ away: false, since: null, resumed: [{ id: a, status: 'paused', refused: 'no-wallet' }] });
  });

  it('a team member gets 403 owner-only, both ways; a bad body is 400', async () => {
    const me = await vendor();
    const a = await post(me);
    const name = `Awaymember${String(++n).padStart(4, '0')}`;
    const loginId = await seedAccount(deps, { loginName: `awaylogin${n}x`, tradeTag: `aw-${n}-placeholder`, kind: 'member' });
    const now = deps.clock();
    await deps.db.query(
      `insert into team_members (account_id, trade_tag, display_key, abilities, invite_expires_at, member_account_id, joined_at, created_at)
       values ($1, $2, $3, $4, $5, $6, $5, $5)`,
      [me.id, name, name.toLowerCase(), rolesToAbilities(['offers']), now, loginId],
    );
    const browser = new Browser(app);
    expect((await browser.post('/t/login', { accountId: loginId })).statusCode).toBe(200);
    for (const res of [await browser.get('/v1/account/away'), await browser.put('/v1/account/away', { away: true })]) {
      expect(res.statusCode, res.body).toBe(403);
      expect(res.json()).toMatchObject({ error: 'owner-only' });
    }
    expect((await statuses([a]))[a]!.status).toBe('live');
    for (const body of [{}, { away: 'yes' }, { away: true, extra: 1 }, [true]]) {
      expect((await me.browser.put('/v1/account/away', body)).statusCode).toBe(400);
    }
  });
});
