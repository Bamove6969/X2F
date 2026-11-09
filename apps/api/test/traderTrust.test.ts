import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import type { Trade } from '@x2f/trade';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import type { MarketPrices, MarketQuote } from '../src/price/market.js';
import { countActionTimes } from '../src/traders/actionTimes.js';
import { applyEvent } from '../src/trades/store.js';
import { makeVendor, seedAccount } from './helpers/accounts.js';
import { Browser } from './helpers/totp.js';
import { tradeApp } from './helpers/tradeApp.js';
import { XMR, fakeAddress, happyPath, seedReviews, seedTrade } from './helpers/trades.js';

// The offer card's trust row (design review 8 Nov, item 5; boards SellOffers/BuyOffers): trades, %
// positive, earned badges, and "Releases in ~8 min" / "Pays in ~6 min". Every figure comes from real
// data: completed trades, submitted reviews (@x2f/reputation classify / positivePct), the badge
// rules of @x2f/reputation earnedBadges with the spec 5.4 default visibility, and P5-A8 typical
// times kept as running lists (migration 325) so they survive the 30-day trade delete. Real Postgres.

const DAY = 86_400_000;
const MIN = 60_000;
const USD = 33_000n;

function quote(currency: string): MarketQuote | null {
  if (currency !== 'USD') return null;
  return { price: { currency, centsPerXmr: USD }, at: new Date('2026-10-17T11:59:00Z'), sources: 3, exponent: 2, usdCentsPerXmr: USD, fx: null };
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
let setNow: (d: Date) => void;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];
let anon: Browser;
type Who = Awaited<ReturnType<typeof trader>> & { wallet: string };

let clock = new Date('2026-10-17T12:00:00Z').getTime();
const tick = (ms: number) => {
  clock += ms;
  setNow(new Date(clock));
};

beforeAll(async () => {
  ({ app, deps, trader, setNow } = await tradeApp({}, { prices }));
  setNow(new Date(clock));
  anon = new Browser(app);
  // As offerUnits.test.ts: Graduated at 2 completed trades, so the lists carry no starter caps.
  await deps.db.query(
    `insert into owner_settings (key, value, updated_at) values ('building_min_trades', 1, now()), ('graduated_min_trades', 2, now())`,
  );
});
afterAll(async () => {
  await app.close();
});

/** A trader with a usable wallet; `graduated` gives them 40 days and 2 untimed released trades. */
async function person(o: { graduated?: boolean; ageDays?: number } = {}): Promise<Who> {
  const t = await trader();
  const now = deps.clock();
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into wallets (account_id, app, label, address, created_at, usable_from) values ($1, 'feather', 'Main', $2, $3, $4) returning id`,
    [t.id, fakeAddress(), new Date(now.getTime() - 2 * DAY), new Date(now.getTime() - DAY)],
  );
  if (o.graduated !== false) {
    await deps.db.query('update accounts set created_at = $2 where id = $1', [t.id, new Date(now.getTime() - (o.ageDays ?? 40) * DAY)]);
    for (let i = 0; i < 2; i++) {
      const other = await seedAccount(deps, { loginName: `cp${randomBytes(5).toString('hex')}` });
      const { code } = await seedTrade(deps, { sellerId: t.id, buyerId: other, poster: 'seller' });
      await deps.db.query(`update trades set state = 'released', closed_at = $2 where code = $1`, [code, now]);
      await seedReviews(deps, code);
    }
  }
  return { ...t, wallet: rows[0]!.id };
}

/** A released trade where the buyer paid `pay` minutes after the escrow was secured and the seller released `release` minutes after that. */
async function timedTrade(sellerId: string, buyerId: string, pay: number, release: number): Promise<string> {
  const { trade } = await seedTrade(deps, { sellerId, buyerId, poster: 'seller' });
  let t: Trade = trade;
  for (const step of happyPath(trade, fakeAddress())) {
    if (step.to === 'paid') tick(pay * MIN);
    if (step.to === 'settling') tick(release * MIN);
    t = await applyEvent(deps, trade.code, step.e, step.by);
  }
  expect(t.state).toBe('released');
  await seedReviews(deps, trade.code);
  tick(MIN);
  return trade.code;
}

const OFFER = { methodId: 'ZELLE', currency: 'USD', pricing: { mode: 'market', marginBps: 0 }, minTrades: null, terms: '', amountUnit: 'xmr', minAtomic: (XMR / 10n).toString(), maxAtomic: XMR.toString() };

async function post(who: Who, side: 'sell' | 'buy'): Promise<string> {
  // Only vendors post offers (owner 2 Nov 2026, vendor.test.ts); the poster becomes one here.
  await makeVendor(deps, who.id);
  const res = await who.browser.post('/v1/offers', { ...OFFER, side });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { id: string }).id;
}

type Poster = { completedTrades: number; positivePct: number | null; typicalMinutes: number | null; badges: string[]; stage: string };
async function posterOn(side: 'sell' | 'buy', id: string): Promise<Poster> {
  const res = await anon.get(`/v1/offers?side=${side}&method=ZELLE&currency=USD`);
  expect(res.statusCode, res.body).toBe(200);
  const c = (res.json() as { id: string; poster: Poster }[]).find((x) => x.id === id);
  expect(c, 'offer listed').toBeDefined();
  return c!.poster;
}

/** A review about `subjectId` as it stands after its trade was purged (no trade code, no reviewer). */
async function review(subjectId: string, r: { stars: number } | 'neutral'): Promise<void> {
  await deps.db.query(
    `insert into reviews (trade_code, reviewer_id, subject_id, reviewer_role, neutral, stars, method_id, created_at)
     values (null, null, $1, 'buyer', $2, $3, 'ZELLE', $4)`,
    [subjectId, r === 'neutral', r === 'neutral' ? null : r.stars, deps.clock()],
  );
}

describe('typical times (P5-A8): "Releases in" for a seller, "Pays in" for a buyer', () => {
  it('a sell ad shows the poster\'s median release time, a buy ad the poster\'s median payment time', async () => {
    const seller = await person();
    const buyer = await person();
    for (const [pay, release] of [[4, 8], [6, 7], [9, 20]] as const) await timedTrade(seller.id, buyer.id, pay, release);
    expect((await posterOn('sell', await post(seller, 'sell'))).typicalMinutes).toBe(8);
    expect((await posterOn('buy', await post(buyer, 'buy'))).typicalMinutes).toBe(6);
  });

  it('below 3 completed trades there is no typical time', async () => {
    const seller = await person();
    const buyer = await person();
    for (let i = 0; i < 2; i++) await timedTrade(seller.id, buyer.id, 5, 5);
    expect((await posterOn('sell', await post(seller, 'sell'))).typicalMinutes).toBeNull();
  });

  it('kept as running lists with no trade code or date, added once per trade, so they outlive the trade delete', async () => {
    const seller = await person();
    const buyer = await person();
    const code = await timedTrade(seller.id, buyer.id, 3, 11);
    const c = await deps.db.connect();
    try {
      await countActionTimes(c, code);
    } finally {
      c.release();
    }
    const rows = await deps.db.query('select * from account_action_minutes where account_id = any($1) order by kind', [[seller.id, buyer.id]]);
    expect(rows.rows).toEqual([
      { account_id: buyer.id, kind: 'pay', minutes: [3] },
      { account_id: seller.id, kind: 'release', minutes: [11] },
    ]);
    // No foreign key to trades: deleting the trade's rows cannot take them.
    const fks = await deps.db.query(
      `select confrelid::regclass::text as ref from pg_constraint where conrelid = 'account_action_minutes'::regclass and contype = 'f'`,
    );
    expect(fks.rows).toEqual([{ ref: 'accounts' }]);
  });

  it('keeps the last 20 only', async () => {
    const id = await seedAccount(deps, { loginName: `lst${randomBytes(4).toString('hex')}` });
    await deps.db.query(`insert into account_action_minutes (account_id, kind, minutes) values ($1, 'pay', $2)`, [id, Array.from({ length: 20 }, (_, i) => i)]);
    const seller = await seedAccount(deps, { loginName: `ls${randomBytes(4).toString('hex')}` });
    await timedTrade(seller, id, 99, 1);
    const { rows } = await deps.db.query<{ minutes: number[] }>(`select minutes from account_action_minutes where account_id = $1 and kind = 'pay'`, [id]);
    expect(rows[0]!.minutes).toEqual([...Array.from({ length: 19 }, (_, i) => i + 1), 99]);
  });
});

describe('% positive (P5-A2): positive over positive plus negative reviews, rounded down', () => {
  it('null with no rated review; Neutral and 3 stars count for neither', async () => {
    const p = await person();
    const id = await post(p, 'sell');
    expect((await posterOn('sell', id)).positivePct).toBeNull();
    await review(p.id, 'neutral');
    await review(p.id, { stars: 3 });
    expect((await posterOn('sell', id)).positivePct).toBeNull();
    for (const stars of [5, 4, 5, 4, 2]) await review(p.id, { stars });
    expect((await posterOn('sell', id)).positivePct).toBe(80);
    await review(p.id, { stars: 1 });
    // 4 of 6: 66.67 rounds down.
    expect((await posterOn('sell', id)).positivePct).toBe(66);
  });
});

describe('badges (spec 5.4, @x2f/reputation earnedBadges and the default visibility)', () => {
  it('a new account carries New only', async () => {
    const p = await person({ graduated: false });
    const poster = await posterOn('sell', await post(p, 'sell'));
    expect(poster.stage).toBe('starter');
    expect(poster.badges).toEqual(['new']);
  });

  it('earned from facts: Fast (5 quick actions), Veteran (1+ year), PGP and security key; featured first, then the rest', async () => {
    const p = await person({ ageDays: 400 });
    const buyer = await person();
    for (let i = 0; i < 5; i++) await timedTrade(p.id, buyer.id, 1, 3);
    await deps.db.query(
      `insert into pgp_keys (account_id, fingerprint, armored_enc, created_at) values ($1, $2, '\\x00', now())`,
      [p.id, randomBytes(20).toString('hex')],
    );
    await deps.db.query(
      `insert into webauthn_credentials (account_id, credential_id, public_key, counter, kind, backed_up, device_type, label, created_at)
       values ($1, $2, '\\x00', 0, 'security-key', false, 'singleDevice', 'Key', now())`,
      [p.id, randomBytes(16)],
    );
    const poster = await posterOn('sell', await post(p, 'sell'));
    expect(poster.stage).toBe('graduated');
    expect(poster.completedTrades).toBe(7);
    // Featured by default: Trusted, a milestone, Fast, Veteran (two slots); the rest after them.
    expect(poster.badges).toEqual(['fast', 'veteran-1', 'pgp', 'security-key']);
  });

  it('Fast weighs both lists: 20 payments at 240 min and 20 releases at 1 min is not Fast (review 2, I2)', async () => {
    const p = await person();
    const lists = (pay: number, release: number) =>
      deps.db.query(
        `insert into account_action_minutes (account_id, kind, minutes) values ($1, 'pay', $2), ($1, 'release', $3)
         on conflict (account_id, kind) do update set minutes = excluded.minutes`,
        [p.id, Array.from({ length: 20 }, () => pay), Array.from({ length: 20 }, () => release)],
      );
    await lists(240, 1);
    const sell = await post(p, 'sell');
    const buy = await post(p, 'buy');
    const seller = await posterOn('sell', sell);
    expect(seller.typicalMinutes).toBe(1);
    expect(seller.badges).not.toContain('fast');
    expect((await posterOn('buy', buy)).typicalMinutes).toBe(240);
    // Quick on both sides is Fast.
    await lists(2, 1);
    expect((await posterOn('sell', sell)).badges).toContain('fast');
  });

  it('a passkey is not a security key; a graduated trader with nothing earned carries no badge', async () => {
    const p = await person();
    await deps.db.query(
      `insert into webauthn_credentials (account_id, credential_id, public_key, counter, kind, backed_up, device_type, label, created_at)
       values ($1, $2, '\\x00', 0, 'passkey', true, 'multiDevice', 'Phone', now())`,
      [p.id, randomBytes(16)],
    );
    expect((await posterOn('sell', await post(p, 'sell'))).badges).toEqual([]);
  });
});
