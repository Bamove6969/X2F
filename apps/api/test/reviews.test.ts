import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { REVIEW_WEIGHT_FLOOR_USD_CENTS, reviewWeight } from '@x2f/reputation';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { setLateReviewMode } from '../src/reviews/gate.js';
import { REVIEW_DETACH_GRANULARITY, detachReviews, insertReview, reviewableSince } from '../src/reviews/store.js';
import { applyEvent, loadTradeRow } from '../src/trades/store.js';
import { driveTo, seedTrade } from './helpers/trades.js';
import { tradeApp } from './helpers/tradeApp.js';

// Plan 5 Task 3: reviews with blind reveal (spec 5.1, 5.3), real Postgres. The gate on the take,
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
afterEach(() => {
  setLateReviewMode('any');
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
  return res.json() as { reviewable: boolean; mine: unknown; theirs: unknown; revealAt: string | null };
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
      expect(await view(buyer, t.code)).toEqual({ reviewable: false, mine: null, theirs: null, revealAt: null });
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
    expect((await view(seller, t.code)).revealAt).toBe(new Date(closedAt.getTime() + 7 * DAY).toISOString());
  });
});

describe('blind reveal (spec 5.3)', () => {
  it("neither sees the other's review until both rated", async () => {
    const { seller, buyer, t } = await tradeIn('released');
    await jump(new Date(START.getTime() + DAY), buyer, seller);
    expect((await review(seller, t.code, { neutral: false, stars: 2, phrases: ['Slow'], tradeBadges: [] })).statusCode).toBe(201);
    const early = await view(buyer, t.code);
    expect(early).toMatchObject({ reviewable: true, mine: null, theirs: null, revealAt: new Date(START.getTime() + 7 * DAY).toISOString() });
    // The seller sees their own review, not the buyer's (there is none yet).
    expect(await view(seller, t.code)).toMatchObject({ reviewable: false, theirs: null, mine: { neutral: false, stars: 2, phrases: ['Slow'] } });
    await jump(new Date(START.getTime() + 2 * DAY), buyer, seller);
    expect((await review(buyer, t.code)).statusCode).toBe(201);
    const both = new Date(START.getTime() + 2 * DAY).toISOString();
    expect(await view(buyer, t.code)).toEqual({
      reviewable: false,
      mine: { neutral: false, stars: 5, phrases: ['Friendly'], tradeBadges: ['Smooth trade'], note: 'Smooth one', method: 'Zelle', age: 'Oct 2026' },
      theirs: { neutral: false, stars: 2, phrases: ['Slow'], tradeBadges: [], note: null, method: 'Zelle', age: 'Oct 2026' },
      revealAt: both,
    });
    expect((await view(seller, t.code)).theirs).toMatchObject({ stars: 5 });
  });

  it('with only one review, theirs appears at reviewableSince + 7 days exactly and not 1 ms earlier', async () => {
    const { seller, buyer, t } = await tradeIn('released');
    expect((await review(seller, t.code)).statusCode).toBe(201);
    const at = START.getTime() + 7 * DAY;
    await jump(new Date(at - 1), buyer);
    expect((await view(buyer, t.code)).theirs).toBeNull();
    setNow(new Date(at));
    expect((await view(buyer, t.code)).theirs).toMatchObject({ stars: 5 });
  });
});

describe("the reveal anchor is never the other side's review (round 1 M1)", () => {
  it('A rates a released trade, then late funds escalate it: B sees exactly what B sees with no review stored, also after the old deadline', async () => {
    const { seller, buyer, t } = await tradeIn('released');
    const control = await tradeIn('released');
    await jump(new Date(START.getTime() + DAY), seller);
    expect((await review(seller, t.code)).statusCode).toBe(201);
    // The system escalates both (late funds after the close): state disputed, no live reviewable time.
    for (const code of [t.code, control.t.code]) await applyEvent(deps, code, { type: 'escalate' }, 'system');
    expect((await loadTradeRow(deps.db, t.code))!.state).toBe('disputed');
    const none = { reviewable: false, mine: null, theirs: null, revealAt: null };
    await jump(new Date(START.getTime() + 2 * DAY), buyer, control.buyer);
    expect(await view(control.buyer, control.t.code)).toEqual(none);
    expect(await view(buyer, t.code)).toEqual(none);
    // Past the old deadline (START + 7 days): still nothing, and the buyer still cannot rate.
    await jump(new Date(START.getTime() + 8 * DAY), buyer, seller);
    expect(await view(buyer, t.code)).toEqual(none);
    expect(refusal(await review(buyer, t.code))).toEqual({ status: 409, error: 'not-reviewable' });
    // The seller's own view keeps its own anchor.
    expect((await view(seller, t.code)).revealAt).toBe(new Date(START.getTime() + 7 * DAY).toISOString());
  });
});

describe('late reviews (P5-A31)', () => {
  it("'neutral-only': a star review after the reveal is refused, Neutral passes", async () => {
    setLateReviewMode('neutral-only');
    const { seller, buyer, t } = await tradeIn('released');
    expect((await review(seller, t.code)).statusCode).toBe(201);
    await jump(new Date(START.getTime() + 7 * DAY), buyer);
    expect(refusal(await review(buyer, t.code))).toEqual({ status: 400, error: 'late-review-neutral-only' });
    expect((await review(buyer, t.code, { neutral: true })).statusCode).toBe(201);
  });

  it("'neutral-only' before the reveal takes any review", async () => {
    setLateReviewMode('neutral-only');
    const { seller, buyer, t } = await tradeIn('released');
    expect((await review(seller, t.code)).statusCode).toBe(201);
    await jump(new Date(START.getTime() + 7 * DAY - 1), buyer);
    expect((await review(buyer, t.code)).statusCode).toBe(201);
  });

  it("'closed': no review once the other side's is revealed", async () => {
    setLateReviewMode('closed');
    const { seller, buyer, t } = await tradeIn('released');
    expect((await review(seller, t.code)).statusCode).toBe(201);
    await jump(new Date(START.getTime() + 7 * DAY), buyer);
    expect((await view(buyer, t.code)).reviewable).toBe(false);
    expect(refusal(await review(buyer, t.code, { neutral: true }))).toEqual({ status: 400, error: 'late-review-closed' });
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
  it('stores only the weight from the take-time USD value, and no answer carries an amount, a weight or an id', async () => {
    // The take stores the trade's USD value (301; tested in reviews-gate.test.ts); seeded here.
    const { seller, buyer, t } = await tradeIn('released', 54_321n);
    expect((await review(buyer, t.code)).statusCode).toBe(201);
    expect((await review(seller, t.code, { neutral: true })).statusCode).toBe(201);
    const { rows } = await deps.db.query<{ weight: string }>('select weight from reviews where trade_code = $1', [t.code]);
    expect(rows.map((r) => r.weight)).toEqual([reviewWeight(54_321n).toString(), reviewWeight(54_321n).toString()]);
    // No column of reviews holds money.
    const cols = (await deps.db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'reviews'`)).rows.map((r) => r.column_name);
    expect(cols.filter((c) => /usd|cent|amount|atomic|fiat/.test(c))).toEqual([]);
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

  it('a trade with no stored USD value weighs the floor', async () => {
    const { buyer, t } = await tradeIn('released');
    expect((await review(buyer, t.code)).statusCode).toBe(201);
    const { rows } = await deps.db.query<{ weight: string }>('select weight from reviews where trade_code = $1', [t.code]);
    expect(rows[0]!.weight).toBe(REVIEW_WEIGHT_FLOOR_USD_CENTS.toString());
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
    // START + 7 days has passed (real time), so both times are truncated down to the UTC month.
    const month = new Date('2026-10-01T00:00:00Z');
    const { rows } = await deps.db.query('select trade_code, reviewer_id, stars, method_id from reviews where trade_code is null and reviewable_since = $1 and created_at = $1', [month]);
    expect(rows).toContainEqual({ trade_code: null, reviewer_id: null, stars: 5, method_id: 'ZELLE' });
    // A detached review stays final for the app, and the purge cannot write a code back.
    await expect(deps.db.query('delete from reviews where trade_code is null')).rejects.toThrow(/reviews are final/);
    const code2 = await oneReview();
    const n = await asPurge(async (c) => (await c.query('delete from reviews where trade_code = $1', [code2])).rowCount);
    expect(n).toBe(1);
  });

  /** A review inserted directly (no trade: the table has no foreign key to trades), with exact times. */
  async function rawReview(reviewableSince: Date, createdAt: Date): Promise<string> {
    const a = await trader();
    const b = await trader();
    const code = `RAW${randomBytes(6).toString('hex')}`;
    await insertReview(deps.db, {
      tradeCode: code, reviewerId: a.id, subjectId: b.id, reviewerRole: 'buyer', input: { neutral: true }, weight: 1_000n,
      methodId: 'ZELLE', reviewableSince, createdAt,
    });
    return code;
  }
  const times = async (id: string) =>
    (await deps.db.query<{ rs: Date; ca: Date }>('select reviewable_since as rs, created_at as ca from reviews where id = $1', [id])).rows[0]!;
  const idOf = async (code: string) => (await deps.db.query<{ id: string }>('select id from reviews where trade_code = $1', [code])).rows[0]!.id;

  it(`detach coarsens both times to the ${REVIEW_DETACH_GRANULARITY} (UTC), and no time column stays finer (round 1 I2)`, async () => {
    expect(['day', 'week', 'month']).toContain(REVIEW_DETACH_GRANULARITY);
    const code = await rawReview(new Date('2026-03-14T15:09:26.535Z'), new Date('2026-03-15T01:02:03.004Z'));
    const id = await idOf(code);
    expect(await asPurge((c) => detachReviews(c, code))).toBe(1);
    const { rows } = await deps.db.query<{ fine: boolean }>(
      `select reviewable_since <> date_trunc($2, reviewable_since, 'UTC') or created_at <> date_trunc($2, created_at, 'UTC') as fine
         from reviews where id = $1`,
      [id, REVIEW_DETACH_GRANULARITY],
    );
    expect(rows[0]!.fine).toBe(false);
    if (REVIEW_DETACH_GRANULARITY === 'month') {
      expect(await times(id)).toEqual({ rs: new Date('2026-03-01T00:00:00Z'), ca: new Date('2026-03-01T00:00:00Z') });
    }
    // Every column the trigger compares as a whole, and every time column of the table, is listed here.
    const { rows: cols } = await deps.db.query<{ c: string }>(
      `select column_name as c from information_schema.columns where table_name = 'reviews' and data_type like 'timestamp%' order by 1`,
    );
    expect(cols.map((r) => r.c)).toEqual(['created_at', 'reviewable_since']);
  });

  it('a review not yet revealed at detach: its reveal is rounded up, never brought forward', async () => {
    // Reviewable one hour ago (database clock): its reveal deadline is still 7 days off.
    const { rows } = await deps.db.query<{ t: Date }>(`select now() - interval '1 hour' as t`);
    const since = rows[0]!.t;
    const code = await rawReview(since, since);
    const id = await idOf(code);
    // Truncating it down by hand is refused, even for x2f_purge.
    await expect(
      asPurge((c) =>
        c.query(
          `update reviews set trade_code = null, reviewer_id = null, created_at = date_trunc($2, created_at, 'UTC'),
                  reviewable_since = date_trunc($2, reviewable_since, 'UTC') where trade_code = $1 and reviewable_since <> date_trunc($2, reviewable_since, 'UTC')`,
          [code, REVIEW_DETACH_GRANULARITY],
        ),
      ),
    ).rejects.toThrow(/reviews are final/);
    expect(await asPurge((c) => detachReviews(c, code))).toBe(1);
    const after = await times(id);
    expect(after.rs.getTime()).toBeGreaterThanOrEqual(since.getTime());
    const { rows: ok } = await deps.db.query<{ up: boolean }>(
      `select $1::timestamptz = date_trunc($3, $2::timestamptz, 'UTC') + ('1 ' || $3)::interval
           or ($1::timestamptz = $2::timestamptz and $2::timestamptz = date_trunc($3, $2::timestamptz, 'UTC')) as up`,
      [after.rs, since, REVIEW_DETACH_GRANULARITY],
    );
    expect(ok[0]!.up).toBe(true);
    expect(after.ca.getTime()).toBeLessThanOrEqual(since.getTime());
  });

  it('only x2f_purge may coarsen, only by a whole unit, only while detaching; a second detach changes nothing', async () => {
    const code = await rawReview(new Date('2026-03-14T15:09:26.535Z'), new Date('2026-03-15T01:02:03.004Z'));
    const id = await idOf(code);
    // The app role (table owner) cannot coarsen or detach.
    await expect(deps.db.query(`update reviews set created_at = date_trunc('month', created_at, 'UTC') where id = $1`, [id])).rejects.toThrow(/reviews are final/);
    await expect(
      deps.db.query(`update reviews set trade_code = null, reviewer_id = null, created_at = date_trunc('month', created_at, 'UTC') where id = $1`, [id]),
    ).rejects.toThrow(/reviews are final/);
    // x2f_purge: a time change without the detach, a unit not allowed, or a moved time are refused.
    await expect(asPurge((c) => c.query(`update reviews set created_at = date_trunc('month', created_at, 'UTC') where id = $1`, [id]))).rejects.toThrow(/reviews are final/);
    await expect(
      asPurge((c) => c.query(`update reviews set trade_code = null, reviewer_id = null, created_at = date_trunc('year', created_at, 'UTC'), reviewable_since = date_trunc('year', reviewable_since, 'UTC') where id = $1`, [id])),
    ).rejects.toThrow(/reviews are final/);
    await expect(
      asPurge((c) => c.query(`update reviews set trade_code = null, reviewer_id = null, created_at = created_at + interval '1 day' where id = $1`, [id])),
    ).rejects.toThrow(/reviews are final/);
    await expect(
      asPurge((c) => c.query(`update reviews set trade_code = null, reviewer_id = null, created_at = date_trunc('month', created_at, 'UTC'), reviewable_since = date_trunc('day', reviewable_since, 'UTC') where id = $1`, [id])),
    ).rejects.toThrow(/reviews are final/);
    expect(await times(id)).toEqual({ rs: new Date('2026-03-14T15:09:26.535Z'), ca: new Date('2026-03-15T01:02:03.004Z') });
    expect(await asPurge((c) => detachReviews(c, code))).toBe(1);
    const once = await times(id);
    expect(await asPurge((c) => detachReviews(c, code))).toBe(0);
    expect(await times(id)).toEqual(once);
    // A detached row stays final for x2f_purge too (it cannot be coarsened again or re-attached).
    await expect(asPurge((c) => c.query(`update reviews set created_at = date_trunc('year', created_at, 'UTC') where id = $1`, [id]))).rejects.toThrow(/reviews are final/);
  });

  it('a trade USD value is written once and never changes', async () => {
    const { t } = await tradeIn('released');
    await expect(deps.db.query('update trades set usd_cents = 1 where code = $1', [t.code])).rejects.toThrow(/USD value never changes/);
  });
});
