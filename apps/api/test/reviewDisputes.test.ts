// Plan 5 Task 19 (Revision 2026-10-29b, owner): review disputes. The person a review is about can
// dispute it with a free-text reason; it shows "Under review" at once and counts in no figure until a
// moderator lets it stand, removes some comments (the stars stay) or removes it. One dispute per
// review (lead default). Real Postgres.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { SESSION_COOKIE } from '../src/auth/sessions.js';
import { recordText } from '../src/reputation/record.js';
import { insertReview } from '../src/reviews/store.js';
import { purgeTrades } from '../src/retention/tradePurge.js';
import { traderSummary } from '../src/traders/summary.js';
import { seedAccount } from './helpers/accounts.js';
import { StaffBrowser, TRADER_ORIGIN, errorOf, insertSession, logEntries, seedStaff, staffApps } from './helpers/staffApp.js';
import { driveTo, seedTrade } from './helpers/trades.js';

let app: FastifyInstance;
let trader: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let close: () => Promise<void>;
let logs: string[];
let mod: StaffBrowser;
let helper: StaffBrowser;

const T0 = new Date('2026-11-12T12:00:00Z');
const REASON = 'Retaliation: they left this after I opened a dispute.';
const DECISION = 'The review is fair and matches the trade chat.';

beforeAll(async () => {
  ({ app, trader, deps, setNow, close, logs } = await staffApps());
  setNow(T0);
  mod = new StaffBrowser(app).withSession((await insertSession(deps, (await seedStaff(deps, { role: 'mod' })).id, 'staff')).token);
  helper = new StaffBrowser(app).withSession((await insertSession(deps, (await seedStaff(deps, { role: 'helper' })).id, 'staff')).token);
});
afterAll(async () => close());

interface Who { id: string; token: string; name: string }
let n = 0;
async function person(): Promise<Who> {
  const name = `rd${++n}${Math.random().toString(36).slice(2, 8)}`;
  const id = await seedAccount(deps, { loginName: name });
  const { rows } = await deps.db.query<{ name: string }>('select display_name as name from accounts where id = $1', [id]);
  return { id, token: (await insertSession(deps, id, 'trader')).token, name: rows[0]!.name };
}
const call = (who: Who, method: 'GET' | 'POST', url: string, payload?: unknown) =>
  trader.inject({ method, url, headers: { origin: TRADER_ORIGIN }, cookies: { [SESSION_COOKIE]: who.token }, ...(payload === undefined ? {} : { payload: payload as object }) });

type Input = Parameters<typeof insertReview>[1]['input'];
const FIVE: Input = { neutral: false, stars: 5, phrases: ['Friendly'], tradeBadges: ['Smooth trade'], note: 'Quick and easy' };
const ONE: Input = { neutral: false, stars: 1, phrases: ['Slow', 'Went quiet'], tradeBadges: [], note: 'Never again, they were rude' };

/** A released trade between seller and buyer, the buyer's review of the seller; returns the review id and trade code. */
let tick = 0;
async function reviewed(seller: Who, buyer: Who, input: Input): Promise<{ id: string; code: string }> {
  // A minute apart, so the newest-first order is fixed.
  setNow(new Date(T0.getTime() + ++tick * 60_000));
  const { trade: t } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller', methodId: 'ZELLE' });
  await driveTo(deps, t, 'released');
  await insertReview(deps.db, { tradeCode: t.code, reviewerId: buyer.id, subjectId: seller.id, reviewerRole: 'buyer', input, methodId: 'ZELLE', createdAt: deps.clock() });
  await deps.db.query(`insert into review_skips (trade_code, side) values ($1, 'seller')`, [t.code]);
  const { rows } = await deps.db.query<{ id: string }>(`select id from reviews where trade_code = $1 and reviewer_role = 'buyer'`, [t.code]);
  return { id: rows[0]!.id, code: t.code };
}
const dispute = (who: Who, reviewId: string, reason: unknown = REASON) => call(who, 'POST', `/v1/reviews/${reviewId}/dispute`, { reason });
const openList = async () => {
  const res = await mod.get('/staff/v1/review-disputes');
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { items: { id: string; reason: string; tradeCode: string | null; review: { note: string | null; stars: number | null } }[] }).items;
};
const disputeIdOf = async (reviewId: string) =>
  (await deps.db.query<{ id: string }>('select id from review_disputes where review_id = $1', [reviewId])).rows[0]!.id;
const decide = (who: StaffBrowser, id: string, body: unknown) => who.post(`/staff/v1/review-disputes/${id}/decide`, body);
const profileOf = async (viewer: Who, subject: Who) => {
  const res = await call(viewer, 'GET', `/v1/traders/${encodeURIComponent(subject.name)}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { stats: { positivePct: number | null; ratedReviews: number; reviewCount: number }; reviews: Record<string, unknown>[] };
};

describe('who may dispute (POST /v1/reviews/:id/dispute)', () => {
  it('only the subject; the reviewer and a stranger get the same 404 as an unknown id', async () => {
    const [seller, buyer, stranger] = [await person(), await person(), await person()];
    const { id } = await reviewed(seller, buyer, ONE);
    for (const who of [buyer, stranger]) {
      const res = await dispute(who, id);
      expect(res.statusCode).toBe(404);
      expect(errorOf(res)).toBe('not-found');
    }
    expect((await dispute(seller, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect((await dispute(seller, 'nope')).statusCode).toBe(404);
    expect((await dispute(seller, id)).statusCode).toBe(201);
  });

  it('needs a reason: blank, missing, over 1000 characters or an extra field is 400', async () => {
    const [seller, buyer] = [await person(), await person()];
    const { id } = await reviewed(seller, buyer, ONE);
    for (const body of [{ reason: '   ' }, {}, { reason: 'x'.repeat(1001) }, { reason: REASON, kind: 'other' }, { reason: 7 }]) {
      const res = await call(seller, 'POST', `/v1/reviews/${id}/dispute`, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect((await dispute(seller, id, 'x'.repeat(1000))).statusCode).toBe(201);
  });

  it('a second dispute is 409, while open and after a decision (one per review, lead default)', async () => {
    const [seller, buyer] = [await person(), await person()];
    const { id } = await reviewed(seller, buyer, ONE);
    expect((await dispute(seller, id)).statusCode).toBe(201);
    const again = await dispute(seller, id);
    expect(again.statusCode).toBe(409);
    expect(errorOf(again)).toBe('review-disputed');
    expect((await decide(mod, await disputeIdOf(id), { outcome: 'stands', reason: DECISION })).statusCode).toBe(200);
    expect(errorOf(await dispute(seller, id))).toBe('review-disputed');
  });

  it('logs the dispute id only, never the reason or the trade', async () => {
    const [seller, buyer] = [await person(), await person()];
    const { id, code } = await reviewed(seller, buyer, ONE);
    const before = (await logEntries(deps, 'review.disputed')).length;
    expect((await dispute(seller, id)).statusCode).toBe(201);
    const entries = await logEntries(deps, 'review.disputed');
    expect(entries).toHaveLength(before + 1);
    const last = entries.at(-1)!;
    expect(JSON.parse(String(last.detail))).toEqual({ disputeId: await disputeIdOf(id) });
    const { rows } = await deps.db.query<{ trade_code: string | null }>(`select trade_code from activity_log where action = 'review.disputed' order by id desc limit 1`);
    expect(rows[0]!.trade_code).toBeNull();
    expect(JSON.stringify(entries)).not.toContain('Retaliation');
    expect(logs.join('\n')).not.toContain('Retaliation');
    expect(logs.join('\n')).not.toContain(code);
  });
});

describe('Under review: shown with its label, counted nowhere', () => {
  it('drops out of % positive and the signed record at once; still listed, labelled; counts again if it stands', async () => {
    const [seller, buyer, viewer] = [await person(), await person(), await person()];
    await reviewed(seller, buyer, FIVE);
    const bad = await reviewed(seller, buyer, ONE);
    expect((await profileOf(viewer, seller)).stats).toMatchObject({ positivePct: 50, ratedReviews: 2, reviewCount: 2 });
    expect((await dispute(seller, bad.id)).statusCode).toBe(201);
    const p = await profileOf(viewer, seller);
    expect(p.stats).toMatchObject({ positivePct: 100, ratedReviews: 1, reviewCount: 2 });
    expect(p.reviews.map((r) => r.underReview)).toEqual([true, false]);
    expect((await traderSummary(deps.db, seller.id, deps.clock(), null)).positivePct).toBe(100);
    const record = await recordText(deps.db, seller.id, deps.clock(), { fingerprints: false });
    expect(record).toContain('Reviews: 1');
    expect(record).not.toContain('1 star');

    expect((await decide(mod, await disputeIdOf(bad.id), { outcome: 'stands', reason: DECISION })).statusCode).toBe(200);
    const after = await profileOf(viewer, seller);
    expect(after.stats).toMatchObject({ positivePct: 50, ratedReviews: 2, reviewCount: 2 });
    expect(after.reviews.map((r) => r.underReview)).toEqual([false, false]);
  });

  it('a review id and "disputable" go only to the subject, on their own profile', async () => {
    const [seller, buyer] = [await person(), await person()];
    const { id } = await reviewed(seller, buyer, ONE);
    const own = await profileOf(seller, seller);
    expect(own.reviews[0]).toMatchObject({ id, disputable: true, underReview: false });
    const theirs = await profileOf(buyer, seller);
    expect(theirs.reviews[0]).not.toHaveProperty('id');
    expect(theirs.reviews[0]).not.toHaveProperty('disputable');
    expect(JSON.stringify(theirs)).not.toContain(id);
    await dispute(seller, id);
    expect((await profileOf(seller, seller)).reviews[0]).toMatchObject({ id, disputable: false, underReview: true });
  });
});

describe('the moderator (staff API, perm reputation.review)', () => {
  it('sees the open disputes: the review and the reason, never a name; the trade code until the trade is purged', async () => {
    const [seller, buyer] = [await person(), await person()];
    const { id, code } = await reviewed(seller, buyer, ONE);
    await dispute(seller, id);
    const did = await disputeIdOf(id);
    const item = (await openList()).find((i) => i.id === did)!;
    expect(item).toMatchObject({ reason: REASON, tradeCode: code, review: { stars: 1, note: ONE.neutral ? null : ONE.note } });
    const body = JSON.stringify(item);
    for (const s of [seller.name, buyer.name, seller.id, buyer.id]) expect(body).not.toContain(s);

    // 30 days after the trade ended it is purged: the dispute and its review stay, with no code.
    await purgeTrades(deps.db, new Date(deps.clock().getTime() + 31 * 86_400_000));
    const later = (await openList()).find((i) => i.id === did)!;
    expect(later.tradeCode).toBeNull();
    expect(later.reason).toBe(REASON);
  });

  it('a helper gets forbidden for the list and the decision', async () => {
    const [seller, buyer] = [await person(), await person()];
    const { id } = await reviewed(seller, buyer, ONE);
    await dispute(seller, id);
    const list = await helper.get('/staff/v1/review-disputes');
    expect(list.statusCode).toBe(403);
    expect(errorOf(list)).toBe('forbidden');
    const res = await decide(helper, await disputeIdOf(id), { outcome: 'removed', reason: DECISION });
    expect(res.statusCode).toBe(403);
    expect(errorOf(res)).toBe('forbidden');
  });

  it('removed: gone from the profile, % positive, the count and the record; the row stays, marked; decided once', async () => {
    const [seller, buyer, viewer] = [await person(), await person(), await person()];
    await reviewed(seller, buyer, FIVE);
    const bad = await reviewed(seller, buyer, ONE);
    await dispute(seller, bad.id);
    const did = await disputeIdOf(bad.id);
    expect((await decide(mod, did, { outcome: 'removed', reason: 'short' })).statusCode).toBe(400);
    const before = (await logEntries(deps, 'review.dispute-decided')).length;
    expect((await decide(mod, did, { outcome: 'removed', reason: DECISION })).statusCode).toBe(200);
    const p = await profileOf(viewer, seller);
    expect(p.stats).toMatchObject({ positivePct: 100, ratedReviews: 1, reviewCount: 1 });
    expect(p.reviews).toHaveLength(1);
    expect(JSON.stringify(p)).not.toContain('Never again');
    const { rows } = await deps.db.query<{ removed: boolean; stars: number }>('select removed, stars from reviews where id = $1', [bad.id]);
    expect(rows[0]!.removed).toBe(true);
    expect(rows[0]!.stars).toBe(1);
    const again = await decide(mod, did, { outcome: 'stands', reason: DECISION });
    expect(again.statusCode).toBe(409);
    expect(errorOf(again)).toBe('dispute-decided');
    expect((await openList()).some((i) => i.id === did)).toBe(false);
    const entries = await logEntries(deps, 'review.dispute-decided');
    expect(entries).toHaveLength(before + 1);
    expect(JSON.parse(String(entries.at(-1)!.detail))).toEqual({ disputeId: did, outcome: 'removed' });
    expect(JSON.stringify(entries)).not.toContain(DECISION);
    // The subject's trade view no longer shows it either.
    const view = await call(buyer, 'GET', `/v1/trades/${bad.code}/review`);
    expect(view.json()).toMatchObject({ mine: null, reviewable: false });
  });

  it('comments-removed: the chosen note, phrases and badges go, the stars stay and count', async () => {
    const [seller, buyer, viewer] = [await person(), await person(), await person()];
    const bad = await reviewed(seller, buyer, ONE);
    await dispute(seller, bad.id);
    const did = await disputeIdOf(bad.id);
    // Something the review does not have, nothing at all, or no removal list is refused.
    expect((await decide(mod, did, { outcome: 'comments-removed', reason: DECISION, remove: { phrases: ['Friendly'] } })).statusCode).toBe(400);
    expect((await decide(mod, did, { outcome: 'comments-removed', reason: DECISION, remove: {} })).statusCode).toBe(400);
    expect((await decide(mod, did, { outcome: 'comments-removed', reason: DECISION })).statusCode).toBe(400);
    expect((await decide(mod, did, { outcome: 'removed', reason: DECISION, remove: { note: true } })).statusCode).toBe(400);
    const res = await decide(mod, did, { outcome: 'comments-removed', reason: DECISION, remove: { note: true, phrases: ['Went quiet'] } });
    expect(res.statusCode, res.body).toBe(200);
    const p = await profileOf(viewer, seller);
    expect(p.reviews[0]).toMatchObject({ stars: 1, note: null, phrases: ['Slow'], underReview: false });
    expect(p.stats).toMatchObject({ positivePct: 0, ratedReviews: 1, reviewCount: 1 });
  });

  it('an unknown id is 404; a bad outcome is 400', async () => {
    expect((await decide(mod, '00000000-0000-4000-8000-000000000000', { outcome: 'stands', reason: DECISION })).statusCode).toBe(404);
    const [seller, buyer] = [await person(), await person()];
    const { id } = await reviewed(seller, buyer, ONE);
    await dispute(seller, id);
    expect((await decide(mod, await disputeIdOf(id), { outcome: 'kept', reason: DECISION })).statusCode).toBe(400);
  });
});

describe('the database holds the rules', () => {
  it('a review cannot be removed or have comments removed without a decided dispute saying so; reviews stay final otherwise', async () => {
    const [seller, buyer] = [await person(), await person()];
    const { id } = await reviewed(seller, buyer, ONE);
    await expect(deps.db.query('update reviews set removed = true where id = $1', [id])).rejects.toThrow(/final/);
    await expect(deps.db.query(`update reviews set note = null, comments_removed = true where id = $1`, [id])).rejects.toThrow(/final/);
    await dispute(seller, id);
    // Open is not decided.
    await expect(deps.db.query('update reviews set removed = true where id = $1', [id])).rejects.toThrow(/final/);
    await decide(mod, await disputeIdOf(id), { outcome: 'comments-removed', reason: DECISION, remove: { note: true } });
    // Comments-removed never allows a removal, nor raising the stars or adding a phrase.
    await expect(deps.db.query('update reviews set removed = true where id = $1', [id])).rejects.toThrow(/final/);
    await expect(deps.db.query('update reviews set stars = 5 where id = $1', [id])).rejects.toThrow(/final/);
    await expect(deps.db.query(`update reviews set phrases = '{Friendly}' where id = $1`, [id])).rejects.toThrow(/final/);
    await expect(deps.db.query(`update review_disputes set status = 'removed' where review_id = $1`, [id])).rejects.toThrow(/decided once/);
  });

  it('an overturned trade erases its reviews and their disputes (R-011)', async () => {
    const [seller, buyer] = [await person(), await person()];
    const { id, code } = await reviewed(seller, buyer, ONE);
    await dispute(seller, id);
    const { eraseReviewsOfTrade } = await import('../src/reviews/store.js');
    const c = await deps.db.connect();
    try {
      await c.query('begin');
      await eraseReviewsOfTrade(c, code);
      await c.query('commit');
    } finally {
      c.release();
    }
    expect((await deps.db.query('select 1 from review_disputes where review_id = $1', [id])).rowCount).toBe(0);
  });
});
