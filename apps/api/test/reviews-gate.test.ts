import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { fiatCents } from '@x2f/trade';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import type { MarketPrices, MarketQuote } from '../src/price/market.js';
import { hasPendingReview } from '../src/reviews/gate.js';
import { loadTradeRow } from '../src/trades/store.js';
import { testDb } from './helpers/db.js';
import { tradeApp } from './helpers/tradeApp.js';
import { XMR, driveTo, fakeAddress, seedTrade } from './helpers/trades.js';

// Plan 5 Task 3: the rate-first gate (spec 5.1, P5-A4; Review Focus 5). A trader with a reviewable
// trade they have not rated cannot take an offer, cannot be taken as a poster, cannot set up a trade
// as the poster, and their offers are left out of every list until they rate. Real Postgres.

const DAY = 86_400_000;
/** USD at $330.00 per XMR, EUR at 0.9 of it. */
function quote(currency: string): MarketQuote | null {
  const local = currency === 'USD' ? 33_000n : currency === 'EUR' ? 29_700n : null;
  if (local === null) return null;
  return { price: { currency, centsPerXmr: local }, at: new Date('2026-10-17T11:59:00Z'), sources: 3, exponent: 2, usdCentsPerXmr: 33_000n, fx: null };
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
type Who = Awaited<ReturnType<typeof trader>> & { wallet: string };

const START = new Date('2026-10-17T12:00:00Z');

beforeAll(async () => {
  ({ app, deps, trader, setNow } = await tradeApp({}, { prices, db: await testDb() }));
});
afterAll(async () => {
  await app.close();
  await deps.db.end();
});
afterEach(() => {
  setNow(START);
});

async function person(): Promise<Who> {
  setNow(START);
  const t = await trader();
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into wallets (account_id, app, label, address, created_at, usable_from) values ($1, 'feather', 'Main', $2, $3, $4) returning id`,
    [t.id, fakeAddress(), new Date(START.getTime() - 2 * DAY), new Date(START.getTime() - DAY)],
  );
  return { ...t, wallet: rows[0]!.id };
}

/** A released trade of `who` with a fresh counterparty (as seller when `role` is seller). */
async function released(who: Who, role: 'buyer' | 'seller' = 'buyer'): Promise<string> {
  const other = await trader();
  const ids = role === 'seller' ? { sellerId: who.id, buyerId: other.id } : { sellerId: other.id, buyerId: who.id };
  const { trade } = await seedTrade(deps, { ...ids, poster: 'seller', methodId: 'ZELLE' });
  await driveTo(deps, trade, 'released');
  return trade.code;
}

const OFFER = {
  side: 'sell', methodId: 'ZELLE', currency: 'USD', pricing: { mode: 'market', marginBps: 0 },
  minFiatCents: '1000', maxFiatCents: '1000000', minTrades: 0, terms: 'Zelle only.',
};

async function postOffer(who: Who, over: Record<string, unknown> = {}): Promise<string> {
  const res = await who.browser.post('/v1/offers', { ...OFFER, ...over });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { id: string }).id;
}

const tenth = XMR / 10n;
const takeBody = (who: Who) => ({
  amountAtomic: tenth.toString(), walletId: who.wallet, centsPerXmr: '33000', fiatCents: fiatCents(tenth, { currency: 'USD', centsPerXmr: 33_000n }).toString(),
});
const take = (who: Who, offer: string) => who.browser.post(`/v1/offers/${offer}/take`, takeBody(who));
const refusal = (res: { statusCode: number; json(): unknown }) => ({ status: res.statusCode, ...(res.json() as object) });
const rate = (who: Who, code: string, body: unknown = { neutral: true }) => who.browser.post(`/v1/trades/${code}/review`, body);
const skip = (who: Who, code: string) => who.browser.post(`/v1/trades/${code}/review/skip`, {});
const listed = async (offer: string, viewer?: Who) => {
  const url = '/v1/offers?side=sell&method=ZELLE&currency=USD';
  const res = viewer ? await viewer.browser.get(url) : await app.inject({ method: 'GET', url });
  expect(res.statusCode).toBe(200);
  return (res.json() as { id: string }[]).some((c) => c.id === offer);
};
/** Zelle's live sell-offer count on /v1/methods for this viewer. */
const zelleCount = async (viewer: Who): Promise<number> => {
  const res = await viewer.browser.get('/v1/methods?side=sell&currency=USD');
  expect(res.statusCode).toBe(200);
  return (res.json() as { all: { id: string; offers: number }[] }).all.find((m) => m.id === 'ZELLE')!.offers;
};
const tradesOf = async (accountId: string) =>
  (await deps.db.query<{ n: number }>('select count(*)::int as n from trades where buyer_account_id = $1 or seller_account_id = $1', [accountId])).rows[0]!.n;

describe('the taker', () => {
  it('with an unrated released trade is refused review-pending; after a Neutral review the same take succeeds', async () => {
    const seller = await person();
    const buyer = await person();
    const offer = await postOffer(seller);
    const code = await released(buyer);
    expect(refusal(await take(buyer, offer))).toEqual({ status: 409, error: 'review-pending' });
    expect(await tradesOf(buyer.id)).toBe(1);
    expect((await rate(buyer, code)).statusCode).toBe(201);
    expect((await take(buyer, offer)).statusCode).toBe(200);
  });

  it('two pending reviews need two submissions', async () => {
    const seller = await person();
    const buyer = await person();
    const offer = await postOffer(seller);
    const a = await released(buyer);
    const b = await released(buyer, 'seller');
    expect(((await buyer.browser.get('/v1/reviews/pending')).json() as { trades: unknown[] }).trades).toHaveLength(2);
    expect((await rate(buyer, a)).statusCode).toBe(201);
    expect(refusal(await take(buyer, offer))).toEqual({ status: 409, error: 'review-pending' });
    expect((await rate(buyer, b)).statusCode).toBe(201);
    expect((await take(buyer, offer)).statusCode).toBe(200);
  });

  it('only their OWN missing review blocks: the counterparty having rated changes nothing, and rating unblocks only the rater', async () => {
    const seller = await person();
    const buyer = await person();
    const offer = await postOffer(seller);
    const other = await person();
    const { trade } = await seedTrade(deps, { sellerId: other.id, buyerId: buyer.id, poster: 'seller', methodId: 'ZELLE' });
    await driveTo(deps, trade, 'released');
    expect((await rate(other, trade.code)).statusCode).toBe(201);
    expect(refusal(await take(buyer, offer))).toEqual({ status: 409, error: 'review-pending' });
  });

  it('a cancelled trade (not reviewable) never blocks', async () => {
    const seller = await person();
    const buyer = await person();
    const offer = await postOffer(seller);
    const other = await trader();
    const { trade } = await seedTrade(deps, { sellerId: other.id, buyerId: buyer.id, poster: 'seller' });
    await deps.db.query(`update trades set state = 'cancelled', closed_at = $2 where code = $1`, [trade.code, START]);
    expect((await take(buyer, offer)).statusCode).toBe(200);
  });

  it('keeps blocking past 7 days: there is no review deadline (owner 2026-11-02: no reveal wait)', async () => {
    const seller = await person();
    const buyer = await person();
    const offer = await postOffer(seller);
    await released(buyer);
    setNow(new Date(START.getTime() + 30 * DAY));
    for (const w of [buyer, seller]) await w.browser.post('/t/login', { accountId: w.id });
    expect(refusal(await take(buyer, offer))).toEqual({ status: 409, error: 'review-pending' });
    expect(((await buyer.browser.get('/v1/reviews/pending')).json() as { trades: unknown[] }).trades).toHaveLength(1);
  });

  it('Skip review clears the gate for that trade like a review does (owner 2026-11-01, item 28)', async () => {
    const seller = await person();
    const buyer = await person();
    const offer = await postOffer(seller);
    const a = await released(buyer);
    const b = await released(buyer, 'seller');
    expect((await skip(buyer, a)).statusCode).toBe(204);
    expect(((await buyer.browser.get('/v1/reviews/pending')).json() as { trades: { code: string }[] }).trades.map((t) => t.code)).toEqual([b]);
    expect(refusal(await take(buyer, offer))).toEqual({ status: 409, error: 'review-pending' });
    expect((await skip(buyer, b)).statusCode).toBe(204);
    expect(await hasPendingReview(deps.db, buyer.id, START)).toBe(false);
    expect((await take(buyer, offer)).statusCode).toBe(200);
  });

  it('stores the trade USD value at take (the starter-limit number), never returned; a review stores no weight', async () => {
    const seller = await person();
    const buyer = await person();
    const offer = await postOffer(seller);
    const res = await take(buyer, offer);
    expect(res.statusCode, res.body).toBe(200);
    const { code } = res.json() as { code: string };
    expect((await loadTradeRow(deps.db, code))!.usd_cents).toBe('3300');
    expect(res.body).not.toMatch(/usd/i);
    // Ended as released (by hand), then the buyer rates: nothing of the value goes into the review.
    await deps.db.query(`update trades set state = 'released', closed_at = $2 where code = $1`, [code, START]);
    expect((await rate(buyer, code, { neutral: false, stars: 4, phrases: [], tradeBadges: [] })).statusCode).toBe(201);
    const { rows } = await deps.db.query('select * from reviews where trade_code = $1', [code]);
    expect(Object.keys(rows[0]!)).not.toContain('weight');
  });
});

describe('the poster (Review Focus 5)', () => {
  it('a poster who skips: their offer is listed again at once', async () => {
    const seller = await person();
    const offer = await postOffer(seller);
    const code = await released(seller, 'seller');
    expect(await listed(offer)).toBe(false);
    expect((await skip(seller, code)).statusCode).toBe(204);
    expect(await listed(offer)).toBe(true);
  });

  it('with a pending review: their offer is absent from every list, a take of it anyway refuses and creates no trade', async () => {
    const seller = await person();
    const buyer = await person();
    const offer = await postOffer(seller);
    expect(await listed(offer)).toBe(true);
    const code = await released(seller, 'seller');
    expect(await listed(offer)).toBe(false);
    expect(await listed(offer, buyer)).toBe(false);
    // The single-offer read and the method counts agree with the list (Task 37 review I1).
    expect((await buyer.browser.get(`/v1/offers/${offer}`)).statusCode).toBe(404);
    expect((await seller.browser.get(`/v1/offers/${offer}`)).statusCode).toBe(200);
    const shown = await zelleCount(buyer);
    await rate(seller, code);
    expect(await zelleCount(buyer)).toBe(shown + 1);
    // Pending again with a second trade, for the take below.
    const code2 = await released(seller, 'seller');
    // A take of its id anyway: the generic offer-busy (nothing about the poster's account), no trade.
    const before = await tradesOf(buyer.id);
    expect(refusal(await take(buyer, offer))).toEqual({ status: 409, error: 'offer-busy' });
    expect(await tradesOf(buyer.id)).toBe(before);
    // Posting is still allowed while a review is pending.
    await postOffer(seller, { currency: 'EUR' });
    expect((await rate(seller, code2)).statusCode).toBe(201);
    expect(await listed(offer)).toBe(true);
    expect((await take(buyer, offer)).statusCode).toBe(200);
  });

  it('their POST /v1/trades/:code/wallet on an earlier setup trade is refused review-pending, and succeeds once rated', async () => {
    const seller = await person();
    const buyer = await person();
    const offer = await postOffer(seller);
    const res = await take(buyer, offer);
    expect(res.statusCode, res.body).toBe(200);
    const { code } = res.json() as { code: string };
    const old = await released(seller, 'seller');
    expect(refusal(await seller.browser.post(`/v1/trades/${code}/wallet`, { walletId: seller.wallet }))).toEqual({ status: 409, error: 'review-pending' });
    expect((await loadTradeRow(deps.db, code))!.seller_refund).toBeNull();
    expect((await rate(seller, old)).statusCode).toBe(201);
    expect((await seller.browser.post(`/v1/trades/${code}/wallet`, { walletId: seller.wallet })).statusCode).toBe(204);
  });
});

describe('My offers (review round 1 M3)', () => {
  it("names review-pending as why a live offer is hidden, after the stop and the hold, and drops it once rated", async () => {
    const seller = await person();
    const offer = await postOffer(seller);
    const mine = async () => {
      const res = await seller.browser.get('/v1/account/offers');
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { id: string; hidden?: string }[]).find((o) => o.id === offer)!;
    };
    expect((await mine()).hidden).toBeUndefined();
    const code = await released(seller, 'seller');
    expect((await mine()).hidden).toBe('review-pending');
    // The site's stop outranks it, as it outranks the trading hold.
    await deps.db.query('update site_flags set trading_paused = true');
    try {
      expect((await mine()).hidden).toBe('trading-paused');
    } finally {
      await deps.db.query('update site_flags set trading_paused = false');
    }
    expect((await rate(seller, code)).statusCode).toBe(201);
    expect((await mine()).hidden).toBeUndefined();
  });
});

describe('the 301 cutoff (review round 1 M4)', () => {
  it('a trade that became reviewable before site_flags.reviews_since never gates (but stays reviewable); one at or after it does', async () => {
    const { rows } = await deps.db.query<{ since: string }>('select reviews_since::text as since from site_flags');
    const saved = rows[0]!.since;
    try {
      const seller = await person();
      const buyer = await person();
      const offer = await postOffer(seller);
      const code = await released(buyer);
      expect((await loadTradeRow(deps.db, code))!.closed_at).toEqual(START);
      const pending = async () => ((await buyer.browser.get('/v1/reviews/pending')).json() as { trades: unknown[] }).trades.length;
      // Released 1 ms before the cutoff: no pending review, the offer stays listed, a take succeeds.
      await deps.db.query('update site_flags set reviews_since = $1', [new Date(START.getTime() + 1)]);
      expect(await hasPendingReview(deps.db, buyer.id, START)).toBe(false);
      expect(await pending()).toBe(0);
      expect(((await buyer.browser.get(`/v1/trades/${code}/review`)).json() as { reviewable: boolean }).reviewable).toBe(true);
      // Released exactly at the cutoff: it gates.
      await deps.db.query('update site_flags set reviews_since = $1', [START]);
      expect(await hasPendingReview(deps.db, buyer.id, START)).toBe(true);
      expect(await pending()).toBe(1);
      expect(refusal(await take(buyer, offer))).toEqual({ status: 409, error: 'review-pending' });
      await deps.db.query('update site_flags set reviews_since = $1', [new Date(START.getTime() + 1)]);
      expect((await take(buyer, offer)).statusCode).toBe(200);
    } finally {
      await deps.db.query('update site_flags set reviews_since = $1::timestamptz', [saved]);
    }
  });

  it('with no site_flags row the gate fails closed: every reviewable trade counts (round 2, m1)', async () => {
    const buyer = await person();
    await released(buyer);
    const c = await deps.db.connect();
    try {
      await c.query('begin');
      await c.query('update site_flags set reviews_since = $1', [new Date(START.getTime() + DAY)]);
      expect(await hasPendingReview(c, buyer.id, START)).toBe(false);
      await c.query('delete from site_flags');
      expect(await hasPendingReview(c, buyer.id, START)).toBe(true);
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
});

describe('301 trigger (owner 2026-11-01, item 27; review m3)', () => {
  it("the reviews_final trigger allows the month only: no other unit and no reveal deadline in the migration", () => {
    const sql = readFileSync(new URL('../migrations/301_reviews.sql', import.meta.url), 'utf8');
    expect(sql).toContain("date_trunc('month', old.created_at, 'UTC')");
    expect(sql).not.toMatch(/'day'|'week'|interval '\d+ days'/);
  });
});
