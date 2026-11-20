// Plan 5 Task 20 (Revisions 2026-10-29, 2026-10-29b and 2026-10-29c, owner): permanent reviews and
// running totals. As built, the totals are the live trades' figures plus what the whole-trade purge
// moved into account_traded_totals.purged_* (701, retention/tradePurge.ts) in the same transaction,
// so nothing a profile or a starter-limit stage shows changes when a trade is deleted. Real Postgres.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { SESSION_COOKIE } from '../src/auth/sessions.js';
import { insertReview } from '../src/reviews/store.js';
import { purgeTrades } from '../src/retention/tradePurge.js';
import { tradeCap } from '../src/traders/stage.js';
import { traderSummary } from '../src/traders/summary.js';
import { seedAccount } from './helpers/accounts.js';
import { TRADER_ORIGIN, insertSession, staffApps } from './helpers/staffApp.js';
import { driveTo, seedTrade } from './helpers/trades.js';

const DAY = 86_400_000;
let trader: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ trader, deps, setNow, close } = await staffApps());
});
afterAll(async () => close());

interface Who { id: string; token: string; name: string }
let n = 0;
async function person(): Promise<Who> {
  const login = `rt${++n}${Math.random().toString(36).slice(2, 8)}`;
  const id = await seedAccount(deps, { loginName: login });
  const { rows } = await deps.db.query<{ name: string }>('select display_name as name from accounts where id = $1', [id]);
  return { id, token: (await insertSession(deps, id, 'trader')).token, name: rows[0]!.name };
}
const plus = (t: Date, days: number) => new Date(t.getTime() + days * DAY);

/** A released trade taken at `at`, closed a day later. */
async function released(seller: Who, buyer: Who, at: Date): Promise<string> {
  setNow(at);
  const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller', methodId: 'ZELLE' });
  await driveTo(deps, trade, 'released');
  await deps.db.query('update trades set closed_at = $2 where code = $1', [trade.code, plus(at, 1)]);
  return trade.code;
}

async function addDispute(code: string, status: string, openedAt: Date, closedAt: Date | null): Promise<void> {
  await deps.db.query(
    `insert into disputes (code, seq, opened_by, reason, opened_at, status, reply_due_at, ruling_due_at, usd_cents, limit_usd_cents,
       published_at, appeal_ends_at, closed_at)
     values ($1, 1, 'buyer', 'paid', $2, $3, $2, $2, 0, 100000, $2, $2, $4)`,
    [code, openedAt, status, closedAt],
  );
  await deps.db.query(`update trades set dispute_by = 'buyer', dispute_at = $2 where code = $1`, [code, openedAt]);
}

async function ruling(code: string, round: number, outcome: string, at: Date): Promise<void> {
  await deps.db.query(
    `insert into dispute_rulings (code, seq, round, outcome, reason, evidence, moderator_name, ruled_at, appeal_until)
     values ($1, 1, $2, $3, 'The payment is in the seller''s activity.', '["The trade chat"]', 'sarah.v', $4, $5)`,
    // Only round 1 has an appeal window.
    [code, round, outcome, at, round === 1 ? at : null],
  );
}

const disputesOf = async (who: Who, at: Date) => (await traderSummary(deps.db, who.id, at, null)).disputes;

describe('"Disputes: N won, M lost" (Revision 2026-10-29c)', () => {
  it('a settled dispute adds one won to the winner and one lost to the loser, once, and still counts as a completed trade', async () => {
    const [seller, buyer] = [await person(), await person()];
    const t0 = new Date('2026-02-01T00:00:00Z');
    const code = await released(seller, buyer, t0);
    await addDispute(code, 'closed', t0, plus(t0, 2));
    await ruling(code, 1, 'release-to-buyer', plus(t0, 1));
    const at = plus(t0, 10);
    expect(await disputesOf(seller, at)).toEqual({ won: 0, lost: 1 });
    expect(await disputesOf(buyer, at)).toEqual({ won: 1, lost: 0 });
    expect((await traderSummary(deps.db, seller.id, at, null)).completedTrades).toBe(1);
  });

  it('while the appeal is pending the dispute counts for neither side, won as well as lost (R-011 / R-012)', async () => {
    const [seller, buyer] = [await person(), await person()];
    const t0 = new Date('2026-02-03T00:00:00Z');
    const code = await released(seller, buyer, t0);
    await addDispute(code, 'appealed', t0, null);
    await ruling(code, 1, 'release-to-buyer', plus(t0, 1));
    const at = plus(t0, 3);
    expect(await disputesOf(seller, at)).toEqual({ won: 0, lost: 0 });
    expect(await disputesOf(buyer, at)).toEqual({ won: 0, lost: 0 });
  });

  it('an appeal that overturns round 1 swaps the two counts', async () => {
    const [seller, buyer] = [await person(), await person()];
    const t0 = new Date('2026-02-05T00:00:00Z');
    const code = await released(seller, buyer, t0);
    await addDispute(code, 'closed', t0, plus(t0, 4));
    await ruling(code, 1, 'release-to-buyer', plus(t0, 1));
    await ruling(code, 2, 'refund-to-seller', plus(t0, 3));
    const at = plus(t0, 10);
    expect(await disputesOf(seller, at)).toEqual({ won: 1, lost: 0 });
    expect(await disputesOf(buyer, at)).toEqual({ won: 0, lost: 1 });
  });
});

describe('the trade purge changes nothing a profile or a stage shows', () => {
  it('the summary, the profile and tradeCap are the same before and after; a second pass adds nothing', async () => {
    const [seller, buyer] = [await person(), await person()];
    const t0 = new Date('2026-03-01T00:00:00Z');
    const disputed = await released(seller, buyer, t0);
    await addDispute(disputed, 'closed', t0, plus(t0, 2));
    await ruling(disputed, 1, 'release-to-buyer', plus(t0, 1));
    const plain = await released(seller, buyer, plus(t0, 1));
    const at = plus(t0, 200);
    setNow(at);
    buyer.token = (await insertSession(deps, buyer.id, 'trader')).token;
    const profile = async () => {
      const res = await trader.inject({ method: 'GET', url: `/v1/traders/${encodeURIComponent(seller.name)}`, headers: { origin: TRADER_ORIGIN }, cookies: { [SESSION_COOKIE]: buyer.token } });
      expect(res.statusCode, res.body).toBe(200);
      return res.json() as Record<string, unknown>;
    };
    const before = { s: await traderSummary(deps.db, seller.id, at, null), b: await traderSummary(deps.db, buyer.id, at, null), cap: await tradeCap(deps.db, seller.id, at), p: await profile() };
    expect(before.s.completedTrades).toBe(2);
    expect(before.s.disputes).toEqual({ won: 0, lost: 1 });
    await purgeTrades(deps.db, at);
    expect((await deps.db.query('select 1 from trades where code = any($1)', [[disputed, plain]])).rowCount).toBe(0);
    for (let pass = 0; pass < 2; pass++) {
      expect(await traderSummary(deps.db, seller.id, at, null)).toEqual(before.s);
      expect(await traderSummary(deps.db, buyer.id, at, null)).toEqual(before.b);
      expect(await tradeCap(deps.db, seller.id, at)).toEqual(before.cap);
      expect(await profile()).toEqual(before.p);
      await purgeTrades(deps.db, at);
    }
  });
});

describe('permanent, anonymous reviews (Revision 2026-10-29b)', () => {
  it('a review survives its trade with its method name and month; afterwards no column holds the reviewer or the trade code', async () => {
    const [seller, buyer] = [await person(), await person()];
    const t0 = new Date('2026-04-14T09:30:00Z');
    const code = await released(seller, buyer, t0);
    await insertReview(deps.db, {
      tradeCode: code, reviewerId: buyer.id, subjectId: seller.id, reviewerRole: 'buyer',
      input: { neutral: false, stars: 4, phrases: ['Friendly'], tradeBadges: [], note: 'Smooth' }, methodId: 'ZELLE', createdAt: plus(t0, 1),
    });
    const at = plus(t0, 60);
    setNow(at);
    buyer.token = (await insertSession(deps, buyer.id, 'trader')).token;
    const view = async () => {
      const res = await trader.inject({ method: 'GET', url: `/v1/traders/${encodeURIComponent(seller.name)}`, headers: { origin: TRADER_ORIGIN }, cookies: { [SESSION_COOKIE]: buyer.token } });
      expect(res.statusCode, res.body).toBe(200);
      return res;
    };
    const before = await view();
    await purgeTrades(deps.db, at);
    const after = await view();
    const reviews = (after.json() as { reviews: unknown[] }).reviews;
    expect(reviews).toEqual([{ neutral: false, stars: 4, phrases: ['Friendly'], tradeBadges: [], note: 'Smooth', method: 'Zelle', age: 'Apr 2026', underReview: false }]);
    expect(after.json()).toEqual(before.json());
    // Neither response, at any time, holds the reviewer's name or id, or the trade code.
    for (const res of [before, after]) for (const s of [buyer.name, buyer.id, code]) expect(res.body).not.toContain(s);
    // No column of the review holds the reviewer's id or the trade code once the trade is gone.
    const { rows } = await deps.db.query<Record<string, unknown>>('select * from reviews where subject_id = $1', [seller.id]);
    expect(rows).toHaveLength(1);
    const all = JSON.stringify(rows[0]);
    expect(all).not.toContain(buyer.id);
    expect(all).not.toContain(code);
    expect(rows[0]!.created_at).toEqual(new Date('2026-04-01T00:00:00Z'));
  });
});
