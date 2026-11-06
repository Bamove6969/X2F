import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import type { Queryable } from '../src/db/pool.js';
import { hasPendingReview, pendingReviews } from '../src/reviews/gate.js';
import { REVIEW_DETACH_GRANULARITY, detachReviews, eraseOverturnedReviews, eraseReviewsOfTrade, insertReview, reviewableSince } from '../src/reviews/store.js';
import { applyEvent, loadTradeRow } from '../src/trades/store.js';
import { driveTo, seedTrade } from './helpers/trades.js';
import { tradeApp } from './helpers/tradeApp.js';

// Plan 5 Task 3: reviews (spec 5.1; no blind reveal since the owner's answer of 2026-11-02: a review
// shows as soon as it is submitted), and Skip review (owner 2026-11-01), real Postgres. The gate on the take,
// the poster's wallet route and the offer lists is in reviews-gate.test.ts.

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];
type Who = Awaited<ReturnType<typeof trader>>;

const START = new Date('2026-10-17T12:00:00Z');
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const tx = () => randomBytes(32).toString('hex');

beforeAll(async () => {
  ({ app, deps, trader, setNow } = await tradeApp());
});
afterAll(async () => {
  await app.close();
});

/** Moves the clock and logs both browsers in again (a jump of days ends their sessions). */
async function jump(to: Date, ...who: Who[]) {
  setNow(to);
  for (const w of who) expect((await w.browser.post('/t/login', { accountId: w.id })).statusCode).toBe(200);
}

async function tradeIn(state: Parameters<typeof driveTo>[2], usdCents?: bigint) {
  setNow(START);
  const seller = await trader();
  const buyer = await trader();
  const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller', methodId: 'ZELLE', ...(usdCents === undefined ? {} : { usdCents }) });
  const t = await driveTo(deps, trade, state);
  return { seller, buyer, t };
}

const GOOD = { neutral: false, stars: 5, phrases: ['Friendly'], tradeBadges: ['Smooth trade'], note: 'Smooth one' };
const review = (who: Who, code: string, body: unknown = GOOD) => who.browser.post(`/v1/trades/${code}/review`, body);
const view = async (who: Who, code: string) => {
  const res = await who.browser.get(`/v1/trades/${code}/review`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { reviewable: boolean; mine: unknown; theirs: unknown; skipped: boolean };
};
const refusal = (res: { statusCode: number; json(): unknown }) => ({ status: res.statusCode, ...(res.json() as object) });

/** What Plan 4 writes when the trade's current dispute ends: a final ruling, then `closed`. */
async function closeDispute(code: string, at: Date) {
  await deps.db.query(`update disputes set status = 'closed', closed_at = $2 where code = $1`, [code, at]);
}

describe('who may review which trade', () => {
  it('a released trade: both sides can review once, a third account gets 404, a second POST is review-exists', async () => {
    const { seller, buyer, t } = await tradeIn('released');
    expect((await view(buyer, t.code)).reviewable).toBe(true);
    expect((await review(buyer, t.code)).statusCode).toBe(201);
    expect(refusal(await review(buyer, t.code))).toEqual({ status: 409, error: 'review-exists' });
    expect((await review(seller, t.code, { neutral: true })).statusCode).toBe(201);
    const stranger = await trader();
    expect(refusal(await review(stranger, t.code))).toEqual({ status: 404, error: 'not-found' });
    expect((await stranger.browser.get(`/v1/trades/${t.code}/review`)).statusCode).toBe(404);
    expect((await stranger.browser.get(`/v1/trades/NOPE/review`)).statusCode).toBe(404);
    // The reviewer's side and subject come from the trade, never the body.
    const { rows } = await deps.db.query('select reviewer_role, reviewer_id, subject_id from reviews where trade_code = $1 order by reviewer_role', [t.code]);
    expect(rows).toEqual([
      { reviewer_role: 'buyer', reviewer_id: buyer.id, subject_id: seller.id },
      { reviewer_role: 'seller', reviewer_id: seller.id, subject_id: buyer.id },
    ]);
  });

  it('refuses a body the rules refuse, with the ReviewError code (the side being rated picks the Fast phrase)', async () => {
    const { seller, buyer, t } = await tradeIn('released');
    // The buyer rates the seller: "Fast release" is right, "Fast payment" is not.
    expect(refusal(await review(buyer, t.code, { ...GOOD, phrases: ['Fast payment'] }))).toEqual({ status: 400, error: 'bad-phrase' });
    expect(refusal(await review(buyer, t.code, { ...GOOD, stars: 6 }))).toEqual({ status: 400, error: 'bad-stars' });
    expect(refusal(await review(buyer, t.code, { neutral: true, stars: 3 }))).toEqual({ status: 400, error: 'neutral-with-details' });
    expect(refusal(await review(buyer, t.code, { ...GOOD, note: 'a\nb' }))).toEqual({ status: 400, error: 'note-multiline' });
    expect(refusal(await review(buyer, t.code, { ...GOOD, note: 'x'.repeat(121) }))).toEqual({ status: 400, error: 'note-too-long' });
    // NEEDS_TASK_7_SENSITIVE_TEXT: the local stand-in for @x2f/proof's detectSensitiveText.
    for (const note of ['mail me at bob@example.com', 'call +1 555 123 4567', 'IBAN DE89 3704 0044 0532 0130 00', `4${'A'.repeat(94)}`]) {
      expect(refusal(await review(buyer, t.code, { ...GOOD, note })), note).toEqual({ status: 400, error: 'note-personal-details' });
    }
    expect((await review(buyer, t.code, { ...GOOD, phrases: ['Fast release'] })).statusCode).toBe(201);
    expect((await review(seller, t.code, { ...GOOD, phrases: ['Fast payment'] })).statusCode).toBe(201);
  });

  it('a mutual-cancelled, buyer-cancelled or auto-refunded trade with no dispute is not-reviewable', async () => {
    for (const kind of ['mutual-cancel', 'buyer-cancel', 'auto-refund'] as const) {
      const { buyer, t } = await tradeIn('secured');
      await applyEvent(deps, t.code, { type: 'settled', kind, txHash: tx() }, 'system');
      expect(await reviewableSince(deps.db, t.code), kind).toBeNull();
      expect(refusal(await review(buyer, t.code)), kind).toEqual({ status: 409, error: 'not-reviewable' });
      expect(await view(buyer, t.code)).toEqual({ reviewable: false, mine: null, theirs: null, skipped: false });
    }
  });

  it('an open trade is not-reviewable', async () => {
    const { buyer, t } = await tradeIn('paid');
    expect(refusal(await review(buyer, t.code))).toEqual({ status: 409, error: 'not-reviewable' });
  });

  it('a disputed trade is not-reviewable while the dispute is open, reviewable from its close', async () => {
    const { seller, buyer, t } = await tradeIn('secured');
    expect((await buyer.browser.post(`/v1/trades/${t.code}/dispute`, { reason: 'paid', note: '' })).statusCode).toBe(200);
    expect(refusal(await review(buyer, t.code))).toEqual({ status: 409, error: 'not-reviewable' });
    // The ruling is carried out (the trade ends) but the dispute is not closed yet: still not.
    await jump(new Date(START.getTime() + DAY), buyer, seller);
    await applyEvent(deps, t.code, { type: 'settled', kind: 'release', txHash: tx() }, 'system');
    expect(refusal(await review(seller, t.code))).toEqual({ status: 409, error: 'not-reviewable' });
    const closedAt = new Date(START.getTime() + 2 * DAY);
    await closeDispute(t.code, closedAt);
    expect(await reviewableSince(deps.db, t.code)).toEqual(closedAt);
    await jump(new Date(START.getTime() + 3 * DAY), buyer, seller);
    expect((await review(seller, t.code, { neutral: true })).statusCode).toBe(201);
    // Whatever the outcome: a refund to the seller after a dispute is reviewable too.
    const b = await tradeIn('secured');
    expect((await b.seller.browser.post(`/v1/trades/${b.t.code}/dispute`, { reason: 'paid', note: '' })).statusCode).toBe(200);
    await applyEvent(deps, b.t.code, { type: 'settled', kind: 'mutual-cancel', txHash: tx() }, 'system');
    await deps.db.query(`update disputes set status = 'final' where code = $1`, [b.t.code]);
    expect(await reviewableSince(deps.db, b.t.code)).toEqual(START);
    expect((await review(b.buyer, b.t.code)).statusCode).toBe(201);
  });

  it('a no-show refund is not-reviewable; after a dispute-after-refund opens and closes, reviewable from the close', async () => {
    const { seller, buyer, t } = await tradeIn('secured');
    await applyEvent(deps, t.code, { type: 'settled', kind: 'auto-refund', txHash: tx() }, 'system');
    expect(refusal(await review(buyer, t.code))).toEqual({ status: 409, error: 'not-reviewable' });
    setNow(new Date(START.getTime() + 60 * MIN));
    expect((await buyer.browser.post(`/v1/trades/${t.code}/dispute`, { reason: 'paid', note: '' })).statusCode).toBe(200);
    expect(refusal(await review(buyer, t.code))).toEqual({ status: 409, error: 'not-reviewable' });
    // Plan 4 ends it: the trade ends again and the dispute closes.
    setNow(new Date(START.getTime() + DAY));
    await applyEvent(deps, t.code, { type: 'settled', kind: 'mutual-cancel', txHash: tx() }, 'system');
    const closedAt = new Date(START.getTime() + DAY + 5 * MIN);
    await closeDispute(t.code, closedAt);
    expect(await reviewableSince(deps.db, t.code)).toEqual(closedAt);
    await jump(new Date(START.getTime() + DAY + 10 * MIN), buyer, seller);
    expect((await review(buyer, t.code)).statusCode).toBe(201);
    expect((await view(seller, t.code)).theirs).toMatchObject({ stars: 5 });
  });
});

describe('a review shows at once (owner 2026-11-02: no blind reveal)', () => {
  it("the other side sees a review as soon as it is submitted, before rating themselves", async () => {
    const { seller, buyer, t } = await tradeIn('released');
    await jump(new Date(START.getTime() + DAY), buyer, seller);
    expect((await review(seller, t.code, { neutral: false, stars: 2, phrases: ['Slow'], tradeBadges: [] })).statusCode).toBe(201);
    expect(await view(buyer, t.code)).toEqual({
      reviewable: true,
      mine: null,
      theirs: { neutral: false, stars: 2, phrases: ['Slow'], tradeBadges: [], note: null, method: 'Zelle', age: 'Oct 2026' },
      skipped: false,
    });
    expect(await view(seller, t.code)).toMatchObject({ reviewable: false, theirs: null, mine: { neutral: false, stars: 2, phrases: ['Slow'] } });
    expect((await review(buyer, t.code)).statusCode).toBe(201);
    expect(await view(buyer, t.code)).toEqual({
      reviewable: false,
      mine: { neutral: false, stars: 5, phrases: ['Friendly'], tradeBadges: ['Smooth trade'], note: 'Smooth one', method: 'Zelle', age: 'Oct 2026' },
      theirs: { neutral: false, stars: 2, phrases: ['Slow'], tradeBadges: [], note: null, method: 'Zelle', age: 'Oct 2026' },
      skipped: false,
    });
    expect((await view(seller, t.code)).theirs).toMatchObject({ stars: 5 });
  });

  it('a second review after the first is visible may still carry stars (no late-review rule any more)', async () => {
    const { seller, buyer, t } = await tradeIn('released');
    expect((await review(seller, t.code, { neutral: false, stars: 1, phrases: [], tradeBadges: [] })).statusCode).toBe(201);
    await jump(new Date(START.getTime() + 30 * DAY), buyer);
    expect((await view(buyer, t.code)).reviewable).toBe(true);
    expect((await review(buyer, t.code, { neutral: false, stars: 1, phrases: [], tradeBadges: [] })).statusCode).toBe(201);
  });

  // Owner 2026-11-02 (review I2): the review STAYS through the dispute and after it, UNLESS the
  // dispute's ruling is overturned; then eraseReviewsOfTrade deletes it (the overturn tests below;
  // tripwire NEEDS_P4_OVERTURN_ERASES_REVIEWS for Plan 4's ruling executor).
  it('a review given while the trade was reviewable stays visible to the other side if late funds escalate the trade (unless the ruling is later overturned)', async () => {
    const { seller, buyer, t } = await tradeIn('released');
    await jump(new Date(START.getTime() + DAY), seller);
    expect((await review(seller, t.code)).statusCode).toBe(201);
    await applyEvent(deps, t.code, { type: 'escalate' }, 'system');
    expect((await loadTradeRow(deps.db, t.code))!.state).toBe('disputed');
    await jump(new Date(START.getTime() + 2 * DAY), buyer);
    expect(await view(buyer, t.code)).toMatchObject({ reviewable: false, mine: null, theirs: { stars: 5 } });
    expect(refusal(await review(buyer, t.code))).toEqual({ status: 409, error: 'not-reviewable' });
  });
});

describe('Skip review (owner 2026-11-01, item 28)', () => {
  const skip = (who: Who, code: string) => who.browser.post(`/v1/trades/${code}/review/skip`, {});

  it('a participant skips a reviewable trade: 204, nothing stored in reviews, only their own view says skipped', async () => {
    const { seller, buyer, t } = await tradeIn('released');
    const res = await skip(buyer, t.code);
    expect(res.statusCode, res.body).toBe(204);
    expect(res.body).toBe('');
    expect(await view(buyer, t.code)).toEqual({ reviewable: false, mine: null, theirs: null, skipped: true });
    // The other side learns nothing: their view is what it was before the skip.
    expect(await view(seller, t.code)).toEqual({ reviewable: true, mine: null, theirs: null, skipped: false });
    expect((await deps.db.query('select 1 from reviews where trade_code = $1', [t.code])).rowCount).toBe(0);
    // The skip names no account: only the trade and the side, while the trade exists.
    const cols = (await deps.db.query<{ c: string }>(`select column_name as c from information_schema.columns where table_name = 'review_skips' order by 1`)).rows.map((r) => r.c);
    expect(cols).toEqual(['side', 'trade_code']);
    // The seller can still review (and the buyer sees it at once).
    expect((await review(seller, t.code)).statusCode).toBe(201);
    expect((await view(buyer, t.code)).theirs).toMatchObject({ stars: 5 });
    expect((await view(seller, t.code)).theirs).toBeNull();
  });

  it('refuses a second skip, a review after a skip and a skip after a review with review-exists', async () => {
    const { seller, buyer, t } = await tradeIn('released');
    expect((await skip(buyer, t.code)).statusCode).toBe(204);
    expect(refusal(await skip(buyer, t.code))).toEqual({ status: 409, error: 'review-exists' });
    expect(refusal(await review(buyer, t.code))).toEqual({ status: 409, error: 'review-exists' });
    expect((await review(seller, t.code, { neutral: true })).statusCode).toBe(201);
    expect(refusal(await skip(seller, t.code))).toEqual({ status: 409, error: 'review-exists' });
  });

  it('the same rules as a review: 404 for a stranger or an unknown code, not-reviewable for an open or cancelled trade, refused without a session', async () => {
    const { buyer, t } = await tradeIn('paid');
    expect(refusal(await skip(buyer, t.code))).toEqual({ status: 409, error: 'not-reviewable' });
    const c = await tradeIn('secured');
    await applyEvent(deps, c.t.code, { type: 'settled', kind: 'mutual-cancel', txHash: tx() }, 'system');
    expect(refusal(await skip(c.buyer, c.t.code))).toEqual({ status: 409, error: 'not-reviewable' });
    const stranger = await trader();
    expect(refusal(await skip(stranger, t.code))).toEqual({ status: 404, error: 'not-found' });
    expect(refusal(await skip(stranger, 'NOPE'))).toEqual({ status: 404, error: 'not-found' });
    // No session (and no browser origin): refused before any trade lookup.
    expect([401, 403]).toContain((await app.inject({ method: 'POST', url: `/v1/trades/${t.code}/review/skip`, payload: {} })).statusCode);
  });

  it('a skip goes with its trade (on delete cascade): nothing of it outlives the trade', async () => {
    const { rows } = await deps.db.query<{ confdeltype: string }>(
      `select confdeltype from pg_constraint where conrelid = 'review_skips'::regclass and contype = 'f'`,
    );
    expect(rows).toEqual([{ confdeltype: 'c' }]);
  });
});

describe('GET /v1/reviews/pending', () => {
  it("lists the caller's unrated reviewable trades with the counterparty's display name, oldest first", async () => {
    const { seller, buyer, t } = await tradeIn('released');
    setNow(new Date(START.getTime() + MIN));
    const other = await trader();
    const { trade } = await seedTrade(deps, { sellerId: other.id, buyerId: buyer.id, poster: 'seller' });
    await driveTo(deps, trade, 'released');
    const res = await buyer.browser.get('/v1/reviews/pending');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      trades: [
        { code: t.code, counterparty: seller.displayName, reviewableSince: START.toISOString() },
        { code: trade.code, counterparty: other.displayName, reviewableSince: new Date(START.getTime() + MIN).toISOString() },
      ],
    });
    expect(res.body).not.toContain(seller.loginName);
    expect((await review(buyer, t.code, { neutral: true })).statusCode).toBe(201);
    expect(((await buyer.browser.get('/v1/reviews/pending')).json() as { trades: unknown[] }).trades).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: '/v1/reviews/pending' })).statusCode).toBe(401);
  });
});

describe('what a review stores and shows', () => {
  it('stores no weight and no amount (owner 2026-11-01: no dollar weighting), and no answer carries an amount or an id', async () => {
    // The take stores the trade's USD value (tested in reviews-gate.test.ts); seeded here.
    const { seller, buyer, t } = await tradeIn('released', 54_321n);
    expect((await review(buyer, t.code)).statusCode).toBe(201);
    expect((await review(seller, t.code, { neutral: true })).statusCode).toBe(201);
    // No column of reviews holds money or a weight, and none holds a reveal anchor any more.
    const cols = (await deps.db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'reviews'`)).rows.map((r) => r.column_name);
    expect(cols.filter((c) => /usd|cent|amount|atomic|fiat|weight|reviewable/.test(c))).toEqual([]);
    const bodies = [
      (await buyer.browser.get(`/v1/trades/${t.code}/review`)).body,
      (await seller.browser.get(`/v1/trades/${t.code}/review`)).body,
      (await buyer.browser.get('/v1/reviews/pending')).body,
      (await buyer.browser.get(`/v1/trades/${t.code}`)).body,
    ];
    for (const b of bodies) {
      // The trade view names its currency ("USD") and its own fiat total; never the take-time USD value.
      expect(b).not.toMatch(/54321|54_321|usd_?cents|weight/i);
      expect(b).not.toContain(buyer.id);
      expect(b).not.toContain(seller.id);
    }
    // The review answers carry no amount at all, no trade code and no exact time either.
    for (const b of bodies.slice(0, 3)) expect(b).not.toMatch(/usd|cents|atomic|amount|fiat/i);
    for (const b of bodies.slice(0, 2)) {
      const v = JSON.parse(b) as { mine: Record<string, unknown>; theirs: Record<string, unknown> };
      expect(Object.keys(v.mine).sort()).toEqual(['age', 'method', 'neutral', 'note', 'phrases', 'stars', 'tradeBadges']);
      expect(JSON.stringify([v.mine, v.theirs])).not.toContain(t.code);
      expect(JSON.stringify([v.mine, v.theirs])).not.toMatch(/T\d\d:\d\d/);
    }
  });
});

describe('reviews are final (301 triggers)', () => {
  async function oneReview() {
    const { buyer, t } = await tradeIn('released');
    expect((await review(buyer, t.code)).statusCode).toBe(201);
    return t.code;
  }

  it('UPDATE, DELETE and TRUNCATE by the app role are refused', async () => {
    const code = await oneReview();
    await expect(deps.db.query('update reviews set stars = 1 where trade_code = $1', [code])).rejects.toThrow(/reviews are final/);
    await expect(deps.db.query('update reviews set trade_code = null, reviewer_id = null where trade_code = $1', [code])).rejects.toThrow(/reviews are final/);
    await expect(deps.db.query('delete from reviews where trade_code = $1', [code])).rejects.toThrow(/reviews are final/);
    await expect(deps.db.query('truncate reviews')).rejects.toThrow(/reviews are final/);
  });

  async function asPurge<T>(fn: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
    const c = await deps.db.connect();
    try {
      await c.query('begin');
      await c.query('set local role x2f_purge');
      const out = await fn(c);
      await c.query('commit');
      return out;
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }

  it('x2f_purge may detach a review from its trade and reviewer (nothing else), and may delete', async () => {
    const code = await oneReview();
    await expect(asPurge((c) => c.query('update reviews set stars = 1 where trade_code = $1', [code]))).rejects.toThrow(/permission denied|reviews are final/);
    await expect(asPurge((c) => c.query('update reviews set trade_code = null where trade_code = $1', [code]))).rejects.toThrow(/reviews_check|reviews are final|violates/);
    expect(await asPurge((c) => detachReviews(c, code))).toBe(1);
    // The review time is truncated down to the UTC month (owner 2026-11-01: month and year).
    const month = new Date('2026-10-01T00:00:00Z');
    const { rows } = await deps.db.query('select trade_code, reviewer_id, stars, method_id from reviews where trade_code is null and created_at = $1', [month]);
    expect(rows).toContainEqual({ trade_code: null, reviewer_id: null, stars: 5, method_id: 'ZELLE' });
    // A detached review stays final for the app, and the purge cannot write a code back.
    await expect(deps.db.query('delete from reviews where trade_code is null')).rejects.toThrow(/reviews are final/);
    const code2 = await oneReview();
    const n = await asPurge(async (c) => (await c.query('delete from reviews where trade_code = $1', [code2])).rowCount);
    expect(n).toBe(1);
  });

  /** A review inserted directly (no trade: the table has no foreign key to trades), with an exact time. */
  async function rawReview(createdAt: Date): Promise<string> {
    const a = await trader();
    const b = await trader();
    const code = `RAW${randomBytes(6).toString('hex')}`;
    await insertReview(deps.db, { tradeCode: code, reviewerId: a.id, subjectId: b.id, reviewerRole: 'buyer', input: { neutral: true }, methodId: 'ZELLE', createdAt });
    return code;
  }
  const createdAt = async (id: string) => (await deps.db.query<{ ca: Date }>('select created_at as ca from reviews where id = $1', [id])).rows[0]!.ca;
  const idOf = async (code: string) => (await deps.db.query<{ id: string }>('select id from reviews where trade_code = $1', [code])).rows[0]!.id;

  it('detach coarsens the review time to month and year (UTC, owner 2026-11-01), and it is the only time column', async () => {
    expect(REVIEW_DETACH_GRANULARITY).toBe('month');
    const code = await rawReview(new Date('2026-03-15T01:02:03.004Z'));
    const id = await idOf(code);
    expect(await asPurge((c) => detachReviews(c, code))).toBe(1);
    expect(await createdAt(id)).toEqual(new Date('2026-03-01T00:00:00Z'));
    const { rows: cols } = await deps.db.query<{ c: string }>(
      `select column_name as c from information_schema.columns where table_name = 'reviews' and data_type like 'timestamp%' order by 1`,
    );
    expect(cols.map((r) => r.c)).toEqual(['created_at']);
  });

  it('only x2f_purge may coarsen, only to the month, only while detaching; a second detach changes nothing', async () => {
    const code = await rawReview(new Date('2026-03-15T01:02:03.004Z'));
    const id = await idOf(code);
    // The app role (table owner) cannot coarsen or detach.
    await expect(deps.db.query(`update reviews set created_at = date_trunc('month', created_at, 'UTC') where id = $1`, [id])).rejects.toThrow(/reviews are final/);
    await expect(
      deps.db.query(`update reviews set trade_code = null, reviewer_id = null, created_at = date_trunc('month', created_at, 'UTC') where id = $1`, [id]),
    ).rejects.toThrow(/reviews are final/);
    // x2f_purge: a time change without the detach, any unit but the month, or a moved time are refused.
    await expect(asPurge((c) => c.query(`update reviews set created_at = date_trunc('month', created_at, 'UTC') where id = $1`, [id]))).rejects.toThrow(/reviews are final/);
    for (const unit of ['day', 'week', 'year']) {
      await expect(
        asPurge((c) => c.query(`update reviews set trade_code = null, reviewer_id = null, created_at = date_trunc($2, created_at, 'UTC') where id = $1`, [id, unit])),
        unit,
      ).rejects.toThrow(/reviews are final/);
    }
    await expect(
      asPurge((c) => c.query(`update reviews set trade_code = null, reviewer_id = null, created_at = created_at + interval '1 day' where id = $1`, [id])),
    ).rejects.toThrow(/reviews are final/);
    expect(await createdAt(id)).toEqual(new Date('2026-03-15T01:02:03.004Z'));
    expect(await asPurge((c) => detachReviews(c, code))).toBe(1);
    const once = await createdAt(id);
    expect(await asPurge((c) => detachReviews(c, code))).toBe(0);
    expect(await createdAt(id)).toEqual(once);
    // A detached row stays final for x2f_purge too (it cannot be coarsened again or re-attached).
    await expect(asPurge((c) => c.query(`update reviews set created_at = date_trunc('year', created_at, 'UTC') where id = $1`, [id]))).rejects.toThrow(/reviews are final/);
  });

  it('a trade USD value is written once and never changes', async () => {
    const { t } = await tradeIn('released');
    await expect(deps.db.query('update trades set usd_cents = 1 where code = $1', [t.code])).rejects.toThrow(/USD value never changes/);
  });
});

describe('an overturned trade loses its reviews (C12, owner 2026-11-02)', () => {
  // "If the trade is OVERTURNED like it never happened, then the feedback is ERASED. If all ends well
  // and finishes like a normal trade after the dispute, the feedback remains." Overturned = an
  // appeal's round 2 differing from round 1 (Plan 4's Dispute.overturned). Plan 4's staff routes are
  // not built: the rulings are written here as it will write them, and the overturn's transaction
  // calls eraseOverturnedReviews.
  const skip = (who: Who, code: string) => who.browser.post(`/v1/trades/${code}/review/skip`, {});
  const CURRENT = `(select max(seq) from disputes where code = $1)`;

  async function ruling(q: Queryable, code: string, round: 1 | 2, outcome: string, at: Date) {
    await q.query(
      `insert into dispute_rulings (code, seq, round, outcome, reason, moderator_name, ruled_at, appeal_until)
       values ($1, ${CURRENT}, $2, $3, 'The chain shows it.', 'sarah.v', $4, $5)`,
      [code, round, outcome, at, round === 1 ? new Date(at.getTime() + 2 * DAY) : null],
    );
  }

  /**
   * A released trade the seller reviewed and the buyer skipped; then late funds escalate it (a system
   * dispute, seq 2) and its round-1 ruling is appealed. Returns once the appeal is pending.
   */
  async function reviewedThenAppealed() {
    const { seller, buyer, t } = await tradeIn('released');
    await jump(new Date(START.getTime() + DAY), buyer, seller);
    expect((await review(seller, t.code)).statusCode).toBe(201);
    expect((await skip(buyer, t.code)).statusCode).toBe(204);
    await applyEvent(deps, t.code, { type: 'escalate' }, 'system');
    await ruling(deps.db, t.code, 1, 'release-to-buyer', new Date(START.getTime() + 2 * DAY));
    await deps.db.query(`update disputes set status = 'appealed' where code = $1 and seq = ${CURRENT}`, [t.code]);
    return { seller, buyer, t };
  }

  /** Round 2 is published (final) and the dispute ends, in one transaction, as Plan 4 will. */
  async function appealRuled(code: string, outcome: string) {
    const at = new Date(START.getTime() + 3 * DAY);
    const c = await deps.db.connect();
    try {
      await c.query('begin');
      await ruling(c, code, 2, outcome, at);
      await c.query(`update disputes set status = 'final' where code = $1 and seq = ${CURRENT}`, [code]);
      const erased = await eraseOverturnedReviews(c, code);
      // The caller's role is back for the rest of its transaction.
      expect((await c.query<{ u: string }>('select current_user as u')).rows[0]!.u).not.toBe('x2f_purge');
      await c.query('commit');
      await applyEvent(deps, code, { type: 'settled', kind: 'release', txHash: tx() }, 'system');
      await closeDispute(code, at);
      return erased;
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }

  const counts = async (code: string) => ({
    reviews: (await deps.db.query('select 1 from reviews where trade_code = $1', [code])).rowCount,
    skips: (await deps.db.query('select 1 from review_skips where trade_code = $1', [code])).rowCount,
  });

  it('a dispute that ends like a normal trade ("Decision stands") keeps the reviews and the skip', async () => {
    const { seller, buyer, t } = await reviewedThenAppealed();
    expect(await appealRuled(t.code, 'release-to-buyer')).toEqual({ reviews: 0, skips: 0 });
    expect(await counts(t.code)).toEqual({ reviews: 1, skips: 1 });
    await jump(new Date(START.getTime() + 4 * DAY), buyer, seller);
    expect(await view(buyer, t.code)).toMatchObject({ reviewable: false, theirs: { stars: 5 }, skipped: true });
    expect(await view(seller, t.code)).toMatchObject({ reviewable: false, mine: { stars: 5 } });
    expect(await reviewableSince(deps.db, t.code)).not.toBeNull();
    // A dispute with no appeal at all is a normal finish too.
    const n = await tradeIn('released');
    expect((await review(n.seller, n.t.code)).statusCode).toBe(201);
    await applyEvent(deps, n.t.code, { type: 'escalate' }, 'system');
    await ruling(deps.db, n.t.code, 1, 'refund-to-seller', new Date(START.getTime() + DAY));
    await applyEvent(deps, n.t.code, { type: 'settled', kind: 'mutual-cancel', txHash: tx() }, 'system');
    await closeDispute(n.t.code, new Date(START.getTime() + 2 * DAY));
    expect(await asTx((c) => eraseOverturnedReviews(c, n.t.code))).toEqual({ reviews: 0, skips: 0 });
    expect(await counts(n.t.code)).toEqual({ reviews: 1, skips: 0 });
  });

  it('an overturned trade ("Decision overruled"): reviews and skips erased, shown nowhere, not reviewable, the gate clear; a second erase does nothing', async () => {
    const { seller, buyer, t } = await reviewedThenAppealed();
    expect(await appealRuled(t.code, 'refund-to-seller')).toEqual({ reviews: 1, skips: 1 });
    expect(await counts(t.code)).toEqual({ reviews: 0, skips: 0 });
    expect((await deps.db.query('select 1 from reviews where subject_id = any($1) or reviewer_id = any($1)', [[buyer.id, seller.id]])).rowCount).toBe(0);
    await jump(new Date(START.getTime() + 4 * DAY), buyer, seller);
    for (const who of [buyer, seller]) {
      expect(await view(who, t.code)).toEqual({ reviewable: false, mine: null, theirs: null, skipped: false });
      expect(refusal(await review(who, t.code))).toEqual({ status: 409, error: 'not-reviewable' });
      expect(refusal(await skip(who, t.code))).toEqual({ status: 409, error: 'not-reviewable' });
      expect(await hasPendingReview(deps.db, who.id, deps.clock())).toBe(false);
      expect(await pendingReviews(deps.db, who.id, deps.clock())).toEqual([]);
      expect(((await who.browser.get('/v1/reviews/pending')).json() as { trades: unknown[] }).trades).toEqual([]);
    }
    expect(await reviewableSince(deps.db, t.code)).toBeNull();
    expect(await asTx((c) => eraseOverturnedReviews(c, t.code))).toEqual({ reviews: 0, skips: 0 });
  });

  it('race: a review committed while the overturn waits on the trade lock is erased with the rest', async () => {
    const { seller, buyer, t } = await reviewedThenAppealed();
    // Stand-in for a reviewer holding the trade lock mid-submit (routes.ts reviewableSide's order).
    const c1 = await deps.db.connect();
    const c2 = await deps.db.connect();
    try {
      await c1.query('begin');
      const row = (await loadTradeRow(c1, t.code, true))!;
      await c2.query('begin');
      await ruling(c2, t.code, 2, 'refund-to-seller', new Date(START.getTime() + 3 * DAY));
      let done = false;
      const erase = eraseOverturnedReviews(c2, t.code).then((r) => { done = true; return r; });
      await new Promise((r) => setTimeout(r, 300));
      expect(done).toBe(false);
      await insertReview(c1, {
        tradeCode: t.code, reviewerId: buyer.id, subjectId: seller.id, reviewerRole: 'buyer', input: { neutral: true },
        methodId: row.method_id, createdAt: deps.clock(),
      });
      await c1.query('commit');
      expect(await erase).toEqual({ reviews: 2, skips: 1 });
      await c2.query('commit');
    } finally {
      c1.release();
      c2.release();
    }
    expect(await counts(t.code)).toEqual({ reviews: 0, skips: 0 });
  });

  it('race: a review sent while the overturn holds the trade lock waits, then is refused not-reviewable', async () => {
    // The seller reviewed; the dispute ended with no appeal (reviewable again); round 2 lands later.
    const { seller, buyer, t } = await tradeIn('released');
    expect((await review(seller, t.code)).statusCode).toBe(201);
    await applyEvent(deps, t.code, { type: 'escalate' }, 'system');
    await ruling(deps.db, t.code, 1, 'release-to-buyer', new Date(START.getTime() + DAY));
    await applyEvent(deps, t.code, { type: 'settled', kind: 'release', txHash: tx() }, 'system');
    await closeDispute(t.code, new Date(START.getTime() + DAY));
    await jump(new Date(START.getTime() + 2 * DAY), buyer);
    expect((await view(buyer, t.code)).reviewable).toBe(true);
    const c = await deps.db.connect();
    try {
      await c.query('begin');
      await ruling(c, t.code, 2, 'refund-to-seller', new Date(START.getTime() + 2 * DAY));
      expect(await eraseOverturnedReviews(c, t.code)).toEqual({ reviews: 1, skips: 0 });
      let settled = false;
      const late = review(buyer, t.code).then((r) => { settled = true; return r; });
      await new Promise((r) => setTimeout(r, 300));
      expect(settled).toBe(false);
      await c.query('commit');
      expect(refusal(await late)).toEqual({ status: 409, error: 'not-reviewable' });
    } finally {
      c.release();
    }
    expect(await counts(t.code)).toEqual({ reviews: 0, skips: 0 });
  });

  it('a trade that was not overturned is left alone by the seam; the app role still cannot delete a review', async () => {
    const { seller, buyer, t } = await tradeIn('released');
    expect((await review(seller, t.code)).statusCode).toBe(201);
    expect((await skip(buyer, t.code)).statusCode).toBe(204);
    await expect(deps.db.query('delete from reviews where trade_code = $1', [t.code])).rejects.toThrow(/reviews are final/);
    // Not overturned: the seam deletes nothing.
    expect(await asTx((c) => eraseOverturnedReviews(c, t.code))).toEqual({ reviews: 0, skips: 0 });
    expect(await counts(t.code)).toEqual({ reviews: 1, skips: 1 });
  });

  it('eraseReviewsOfTrade (the Plan 4 seam) deletes the trade\'s reviews and skips as x2f_purge, only that trade, idempotent, and gives the role back', async () => {
    const { seller, buyer, t } = await tradeIn('released');
    expect((await review(seller, t.code)).statusCode).toBe(201);
    expect((await skip(buyer, t.code)).statusCode).toBe(204);
    const other = await tradeIn('released');
    expect((await review(other.seller, other.t.code)).statusCode).toBe(201);
    expect(await asTx(async (c) => {
      const before = (await c.query<{ u: string }>('select current_user as u')).rows[0]!.u;
      const erased = await eraseReviewsOfTrade(c, t.code);
      expect((await c.query<{ u: string }>('select current_user as u')).rows[0]!.u).toBe(before);
      return erased;
    })).toEqual({ reviews: 1, skips: 1 });
    expect(await counts(t.code)).toEqual({ reviews: 0, skips: 0 });
    expect(await counts(other.t.code)).toEqual({ reviews: 1, skips: 0 });
    expect(await asTx((c) => eraseReviewsOfTrade(c, t.code))).toEqual({ reviews: 0, skips: 0 });
  });

  async function asTx<T>(fn: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
    const c = await deps.db.connect();
    try {
      await c.query('begin');
      const out = await fn(c);
      await c.query('commit');
      return out;
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }
});
