import type { FastifyInstance } from 'fastify';
import { GIFT_CARD_TERMS_VERSION, LAUNCH_TRADE_CAP_USD_CENTS, fiatCents, rateFor } from '@x2f/trade';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deps } from '../src/app.js';
import type { MarketPrices, MarketQuote } from '../src/price/market.js';
import { applyEvent, insertTrade, loadTradeRow, rowToTrade } from '../src/trades/store.js';
import { makeVendor, seedAccount } from './helpers/accounts.js';
import { testDb } from './helpers/db.js';
import { tradeApp } from './helpers/tradeApp.js';
import { FIAT, XMR, driveTo, fakeAddress, seedReviews, seedTrade } from './helpers/trades.js';
import { LIVE_SESSION_TRADING_ROUTES } from '../src/auth/hold.js';
import { flexBody, insertOffer, renameOfferMethod } from './helpers/offers.js';

// Plan 3 Task 5: taking an offer, and the poster's wallet route. Real Postgres (one database per
// file); a fake market so each test can move the price or take the feed down.

const DAY = 86_400_000;

/** The market: USD at `usdCentsPerXmr`, EUR at 0.9 of it, or nothing while down. */
const market = { usdCentsPerXmr: 33_000n as bigint | null };

function quote(currency: string): MarketQuote | null {
  const usd = market.usdCentsPerXmr;
  if (usd === null) return null;
  const local = currency === 'USD' ? usd : currency === 'EUR' ? (usd * 9n) / 10n : null;
  if (local === null) return null;
  return { price: { currency, centsPerXmr: local }, at: new Date('2026-10-17T11:59:00Z'), sources: 3, exponent: 2, usdCentsPerXmr: usd, fx: null };
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
type Who = Awaited<ReturnType<typeof trader>> & { wallet: string; address: string };

beforeAll(async () => {
  // A pool larger than any race below, so every racing take holds its own transaction at once.
  ({ app, deps, trader } = await tradeApp({}, { prices, db: await testDb({ max: 12 }) }));
  // Small stage thresholds for this file: Building at 1 completed trade and 7 days, Graduated at 2 and 30.
  await deps.db.query(
    `insert into owner_settings (key, value, updated_at) values
       ('building_min_trades', 1, now()), ('graduated_min_trades', 2, now())`,
  );
});
afterAll(async () => {
  await app.close();
  await deps.db.end();
});
beforeEach(() => {
  market.usdCentsPerXmr = 33_000n;
});

async function addWallet(accountId: string, usable = true): Promise<{ id: string; address: string }> {
  const now = deps.clock();
  const address = fakeAddress();
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into wallets (account_id, app, label, address, created_at, usable_from) values ($1, 'feather', 'Main', $2, $3, $4) returning id`,
    [accountId, address, new Date(now.getTime() - 2 * DAY), usable ? new Date(now.getTime() - DAY) : new Date(now.getTime() + DAY)],
  );
  return { id: rows[0]!.id, address };
}

/** A trader with one usable wallet; `stage` sets their history (Graduated: 40 days, 2 released trades). */
async function person(stage: 'starter' | 'building' | 'graduated' = 'graduated'): Promise<Who> {
  const t = await trader();
  const w = await addWallet(t.id);
  // Owner 2 Nov 2026: only vendors post; every person here may post.
  await makeVendor(deps, t.id);
  if (stage !== 'starter') {
    const now = deps.clock();
    await deps.db.query('update accounts set created_at = $2 where id = $1', [t.id, new Date(now.getTime() - (stage === 'graduated' ? 40 : 10) * DAY)]);
    for (let i = 0; i < (stage === 'graduated' ? 2 : 1); i++) {
      const other = await seedAccount(deps, { loginName: `cp${Math.random().toString(36).slice(2, 12)}` });
      const { code } = await seedTrade(deps, { sellerId: t.id, buyerId: other, poster: 'seller' });
      await deps.db.query(`update trades set state = 'released', closed_at = $2 where code = $1`, [code, now]);
      await seedReviews(deps, code);
    }
  }
  return { ...t, wallet: w.id, address: w.address };
}

const OFFER = {
  side: 'sell', methodId: 'ZELLE', currency: 'USD', pricing: { mode: 'market', marginBps: 0 },
  // At most $5,000 (the launch cap, owner p11-6).
  minFiatCents: '1000', maxFiatCents: '500000', minTrades: null, terms: 'Zelle only.',
};

async function postOffer(who: Who, over: Record<string, unknown> = {}): Promise<string> {
  const res = await who.browser.post('/v1/offers', flexBody({ ...OFFER, ...over }));
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { id: string }).id;
}

/** A take body at `centsPerXmr` (default: the USD market, margin 0), the total worked out as the quote does. */
function body(who: Who, amountAtomic: bigint, centsPerXmr = market.usdCentsPerXmr!, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    amountAtomic: amountAtomic.toString(), walletId: who.wallet, centsPerXmr: centsPerXmr.toString(),
    fiatCents: fiatCents(amountAtomic, { currency: 'USD', centsPerXmr }).toString(), methodId: 'ZELLE', currency: 'USD', ...over,
  };
}

async function take(who: Who, offerId: string, b: Record<string, unknown>) {
  return who.browser.post(`/v1/offers/${offerId}/take`, b);
}

async function taken(who: Who, offerId: string, b: Record<string, unknown>): Promise<string> {
  const res = await take(who, offerId, b);
  expect(res.statusCode, res.body).toBe(200);
  const code = (res.json() as { code: string }).code;
  expect(code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
  return code;
}

/**
 * Runs `fire()` while a separate transaction holds `lock` (row locks every racer must wait behind),
 * waits until `n` backends of `fire`'s requests are blocked inside their transactions on that lock,
 * and only then lets them all go. So a race test proves the requests overlapped in Postgres, not just
 * in the event loop: drop the take's account lock and the racers run their checks side by side.
 */
async function allAtOnce<T>(lock: string[], n: number, fire: () => Promise<T>[]): Promise<T[]> {
  const holder = await deps.db.connect();
  try {
    await holder.query('begin');
    for (const sql of lock) await holder.query(sql);
    const pending = Promise.all(fire());
    const deadline = Date.now() + 10_000;
    for (;;) {
      const { rows } = await deps.db.query<{ n: number }>(
        `select count(*)::int as n from pg_stat_activity
          where datname = current_database() and pid <> $1 and wait_event_type = 'Lock' and state = 'active'`,
        [(await holder.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!.pid],
      );
      if (rows[0]!.n >= n) break;
      if (Date.now() > deadline) throw new Error(`only ${rows[0]!.n} of ${n} racers reached the lock`);
      await new Promise((r) => setTimeout(r, 10));
    }
    await holder.query('commit');
    return await pending;
  } catch (e) {
    await holder.query('rollback').catch(() => {});
    throw e;
  } finally {
    holder.release();
  }
}

/** The rows every take reads under a lock: both accounts, the offer and the site pause. */
const takeLocks = (posterId: string, offerId: string): string[] => [
  `select 1 from accounts where id = '${posterId}' for update`,
  `select 1 from offers where id = '${offerId}' for update`,
  'select 1 from site_flags for update',
];

const refusal = (res: { statusCode: number; json(): unknown }) => ({ status: res.statusCode, ...(res.json() as object) });
const tenth = XMR / 10n; // $33.00 at $330

describe('POST /v1/offers/:id/take', () => {
  it('starts a trade in setup with the taker side filled in and the rate and total locked (OD-5)', async () => {
    const seller = await person();
    const buyer = await person();
    const offer = await postOffer(seller, { pricing: { mode: 'market', marginBps: 100 } });
    // Market $330.00 + 1% = $333.30 per XMR; 0.1 XMR = $33.33.
    const rate = rateFor({ currency: 'USD', centsPerXmr: 33_000n }, 100).centsPerXmr;
    expect(rate).toBe(33_330n);
    const code = await taken(buyer, offer, body(buyer, tenth, rate));
    const row = (await loadTradeRow(deps.db, code))!;
    const t = rowToTrade(row);
    expect(t).toMatchObject({
      offerId: offer, poster: 'seller', sellerId: seller.id, buyerId: buyer.id, methodId: 'ZELLE', state: 'setup',
      amountAtomic: tenth, lockedRate: { currency: 'USD', centsPerXmr: 33_330n }, fiatCents: 3_333n,
      minFiatCents: 1000n, maxFiatCents: 500_000n, confirmWindowMin: 90, payWindowMin: 90, takenAt: deps.clock(),
    });
    // The buyer took: their payout address is set; the seller (poster) picks on the accepted sheet.
    expect({ buyer: row.buyer_payout, seller: row.seller_refund, app: row.seller_wallet_app }).toEqual({ buyer: buyer.address, seller: null, app: null });
    // Both sides see it.
    expect((await seller.browser.get(`/v1/trades/${code}`)).json()).toMatchObject({ role: 'seller', state: 'setup', fiatCents: '3333' });
  });

  it("fixes the payment type's own timing at take (owner 2026-11-07 F9): SWIFT 3 days, a type with no profile the Custom one", async () => {
    for (const [methodId, confirm] of [['SWIFT', 4320], ['SPEI', 1440], ['FASTER_PAYMENTS', 180]] as const) {
      const seller = await person();
      const buyer = await person();
      const offer = await postOffer(seller, { methodId });
      const t = rowToTrade((await loadTradeRow(deps.db, await taken(buyer, offer, body(buyer, tenth, undefined, { methodId }))))!);
      expect([t.methodId, t.confirmWindowMin], methodId).toEqual([methodId, confirm]);
    }
  });

  it("fixes the payment method's time to pay and confirm window on the trade at take; they never change after (owner p9-4, p9-6)", async () => {
    const seller = await person();
    const buyer = await person();
    const swift = await postOffer(seller, { methodId: 'SWIFT', terms: 'SWIFT only.' });
    const code = await taken(buyer, swift, body(buyer, tenth, undefined, { methodId: 'SWIFT' }));
    expect(rowToTrade((await loadTradeRow(deps.db, code))!)).toMatchObject({ methodId: 'SWIFT', payWindowMin: 180, confirmWindowMin: 4320 });
    // A method with no profile of its own takes the Custom method's times.
    const other = await person();
    const chime = await postOffer(seller, { methodId: 'CHIME', terms: 'Chime only.' });
    const code2 = await taken(other, chime, body(other, tenth, undefined, { methodId: 'CHIME' }));
    expect(rowToTrade((await loadTradeRow(deps.db, code2))!)).toMatchObject({ payWindowMin: 180, confirmWindowMin: 1440 });
    // Part of the deal: the database refuses a change for every role.
    await expect(deps.db.query('update trades set pay_window_min = 90 where code = $1', [code])).rejects.toMatchObject({ code: '23000' });
    expect((await deps.db.query<{ m: number }>('select pay_window_min as m from trades where code = $1', [code])).rows[0]!.m).toBe(180);
  });

  it('answers with the rate, total and growth ceiling that locked, so the device records the deal that locked', async () => {
    const seller = await person();
    const buyer = await person();
    const offer = await postOffer(seller);
    market.usdCentsPerXmr = 33_100n;
    const res = await take(buyer, offer, body(buyer, tenth, 33_000n));
    expect(res.statusCode, res.body).toBe(200);
    const out = res.json() as { code: string; centsPerXmr: string; fiatCents: string; maxFiatCents: string };
    expect(Object.keys(out).sort()).toEqual(['centsPerXmr', 'code', 'fiatCents', 'maxFiatCents']);
    expect(out).toMatchObject({ centsPerXmr: '33100', fiatCents: '3310', maxFiatCents: '500000' });
    expect(rowToTrade((await loadTradeRow(deps.db, out.code))!)).toMatchObject({ lockedRate: { centsPerXmr: 33_100n }, fiatCents: 3_310n, maxFiatCents: 500_000n });
  });

  it("locks the server's rate now, never the quoted one, while it moved within 0.5%, and refuses price-changed past it", async () => {
    const seller = await person();
    const buyer = await person();
    const offer = await postOffer(seller);
    // Quoted at $330.00; the market is now $331.65 (+0.5% of the rate now, within): the take goes
    // through at $331.65, the live price (lead decision 2026-10-29, Task 5 review I2).
    market.usdCentsPerXmr = 33_165n;
    const code = await taken(buyer, offer, body(buyer, tenth, 33_000n));
    expect(rowToTrade((await loadTradeRow(deps.db, code))!)).toMatchObject({
      lockedRate: { centsPerXmr: 33_165n }, fiatCents: fiatCents(tenth, { currency: 'USD', centsPerXmr: 33_165n }),
    });

    // Another buyer quoted at $330.00 while the market is now $331.66 (just over 0.5%): refused, nothing created.
    const late = await person();
    market.usdCentsPerXmr = 33_166n;
    const before = await deps.db.query('select count(*)::int as n from trades where offer_id = $1', [offer]);
    expect(refusal(await take(late, offer, body(late, tenth, 33_000n)))).toEqual({ status: 409, error: 'price-changed' });
    // Down past 0.5% too.
    market.usdCentsPerXmr = 32_834n;
    expect(refusal(await take(late, offer, body(late, tenth, 33_000n)))).toEqual({ status: 409, error: 'price-changed' });
    expect((await deps.db.query('select count(*)::int as n from trades where offer_id = $1', [offer])).rows).toEqual(before.rows);
    // Re-quoted at the rate now, it goes through.
    await taken(late, offer, body(late, tenth, 32_834n));
  });

  it('a client rate 0.5% better for the taker than the rate now still locks the rate now (review I2 probe)', async () => {
    // Market $330.00, margin 0. A buyer on a sell ad quotes $328.35 (0.5% under): locks $330.00.
    const seller = await person();
    const buyer = await person();
    const sellAd = await postOffer(seller);
    const code = await taken(buyer, sellAd, body(buyer, XMR, 32_835n));
    expect(rowToTrade((await loadTradeRow(deps.db, code))!)).toMatchObject({ lockedRate: { centsPerXmr: 33_000n }, fiatCents: 33_000n });
    // A seller on a buy ad quotes $331.65 (0.5% over): locks $330.00 too.
    const poster = await person();
    const sellerTaker = await person();
    const buyAd = await postOffer(poster, { side: 'buy' });
    const code2 = await taken(sellerTaker, buyAd, body(sellerTaker, XMR, 33_165n));
    expect(rowToTrade((await loadTradeRow(deps.db, code2))!)).toMatchObject({ lockedRate: { centsPerXmr: 33_000n }, fiatCents: 33_000n });
  });

  it('while the feed is down no offer can be taken, at any margin: there is no fixed price to fall back on (owner Q1)', async () => {
    const seller = await person();
    const buyer = await person();
    // −50%, the lowest an offer can go (owner F1): $165.00 at the $330.00 market.
    const below = await postOffer(seller, { pricing: { mode: 'market', marginBps: -5000 } });
    const floating = await postOffer(seller);
    market.usdCentsPerXmr = null;
    for (const [offer, rate] of [[below, 16_500n], [floating, 33_000n]] as const) {
      expect(refusal(await take(buyer, offer, body(buyer, tenth, rate)))).toEqual({ status: 409, error: 'price-unavailable' });
    }
    expect((await deps.db.query('select 1 from trades where offer_id = any($1)', [[below, floating]])).rowCount).toBe(0);
    market.usdCentsPerXmr = 33_000n;
    expect(refusal(await take(buyer, below, body(buyer, tenth, 16_400n)))).toEqual({ status: 409, error: 'price-changed' });
    const code = await taken(buyer, below, body(buyer, tenth, 16_500n));
    expect(rowToTrade((await loadTradeRow(deps.db, code))!).lockedRate.centsPerXmr).toBe(16_500n);
  });

  it('an offer stored as fixed before the market-only rule (owner Q1) is not found, with or without the feed; its row is kept', async () => {
    const seller = await person();
    const buyer = await person();
    // Migration 345 refuses new fixed rows; lift it for this one insert, as a row from before the rule.
    await deps.db.query('alter table offers drop constraint if exists offers_market_only');
    const legacy = await insertOffer(deps.db, { accountId: seller.id, side: 'sell', methodId: 'ZELLE', currency: 'USD', min: 1000, max: 1000000, at: deps.clock() });
    await deps.db.query(`update offers set price_mode = 'fixed', fixed_cents_per_xmr = 34000 where id = $1`, [legacy]);
    await deps.db.query(`alter table offers add constraint offers_market_only check (price_mode = 'market' and fixed_cents_per_xmr is null) not valid`);
    expect(refusal(await take(buyer, legacy, body(buyer, tenth, 34_000n)))).toEqual({ status: 404, error: 'not-found' });
    market.usdCentsPerXmr = null;
    expect(refusal(await take(buyer, legacy, body(buyer, tenth, 34_000n)))).toEqual({ status: 404, error: 'not-found' });
    expect((await deps.db.query('select 1 from trades where offer_id = $1', [legacy])).rowCount).toBe(0);
    expect((await deps.db.query(`select price_mode, status from offers where id = $1`, [legacy])).rows).toEqual([{ price_mode: 'fixed', status: 'live' }]);
  });

  it('refuses a total that is not the quoted amount at the quoted rate, and malformed bodies', async () => {
    const seller = await person();
    const buyer = await person();
    const offer = await postOffer(seller);
    const good = body(buyer, tenth);
    for (const b of [
      { ...good, fiatCents: '3301' },
      { ...good, amountAtomic: '0' },
      { ...good, amountAtomic: '01' },
      { ...good, amountAtomic: 100 },
      { ...good, centsPerXmr: '0' },
      { ...good, walletId: 'nope' },
      { ...good, extra: 1 },
      { amountAtomic: good.amountAtomic, walletId: good.walletId },
    ]) {
      expect(refusal(await take(buyer, offer, b)), JSON.stringify(b)).toEqual({ status: 400, error: 'bad-request' });
    }
  });

  it('refuses the poster their own offer', async () => {
    const seller = await person();
    const offer = await postOffer(seller);
    expect(refusal(await take(seller, offer, body(seller, tenth)))).toEqual({ status: 409, error: 'own-offer' });
  });

  it('refuses amounts outside the offer range, and too few completed trades', async () => {
    const seller = await person();
    const buyer = await person();
    const offer = await postOffer(seller, { minFiatCents: '3000', maxFiatCents: '6000' });
    // $29.70 and $66.00 are outside $30–$60; the edges are inside.
    expect(refusal(await take(buyer, offer, body(buyer, XMR * 9n / 100n)))).toEqual({ status: 409, error: 'out-of-range' });
    expect(refusal(await take(buyer, offer, body(buyer, XMR / 5n)))).toEqual({ status: 409, error: 'out-of-range' });
    await taken(buyer, offer, body(buyer, (XMR * 3000n) / 33_000n + 1n));

    const picky = await postOffer(seller, { minTrades: 5 });
    // The band's rule goes with the refusal (Task 34 review I2, kept by J-16).
    expect(refusal(await take(buyer, picky, body(buyer, tenth)))).toEqual({ status: 409, error: 'not-enough-trades', minTrades: 5 });
  });

  it('a waiting wallet is wallet-not-ready; no usable wallet at all is no-wallet', async () => {
    const seller = await person();
    const offer = await postOffer(seller);
    const buyer = await person();
    const waiting = await addWallet(buyer.id, false);
    expect(refusal(await take(buyer, offer, body(buyer, tenth, undefined, { walletId: waiting.id })))).toEqual({ status: 409, error: 'wallet-not-ready' });
    // Someone else's wallet is not this taker's to use.
    expect(refusal(await take(buyer, offer, body(buyer, tenth, undefined, { walletId: seller.wallet })))).toEqual({ status: 409, error: 'wallet-not-ready' });

    const fresh = { ...(await trader()), wallet: '', address: '' };
    const only = await addWallet(fresh.id, false);
    expect(refusal(await take(fresh, offer, body(fresh, tenth, undefined, { walletId: only.id })))).toEqual({ status: 409, error: 'no-wallet' });
  });

  it('refuses while trading is paused, on a trading hold, and for an unavailable method; an unlisted offer is 404', async () => {
    const seller = await person();
    const buyer = await person();
    const offer = await postOffer(seller);
    await deps.db.query('update site_flags set trading_paused = true');
    try {
      expect(refusal(await take(buyer, offer, body(buyer, tenth)))).toEqual({ status: 409, error: 'trading-paused' });
    } finally {
      await deps.db.query('update site_flags set trading_paused = false');
    }
    await deps.db.query('insert into trading_holds (account_id, created_at) values ($1, $2)', [buyer.id, deps.clock()]);
    expect(refusal(await take(buyer, offer, body(buyer, tenth)))).toEqual({ status: 409, error: 'trading-hold' });

    const other = await person();
    await renameOfferMethod(deps.db, offer, 'SBP');
    expect(refusal(await take(other, offer, body(other, tenth, undefined, { methodId: 'SBP' })))).toEqual({ status: 409, error: 'method-unavailable' });
    await renameOfferMethod(deps.db, offer, 'ZELLE');
    await deps.db.query(`update offers set status = 'paused' where id = $1`, [offer]);
    expect(refusal(await take(other, offer, body(other, tenth)))).toEqual({ status: 404, error: 'not-found' });
    // A poster on a hold has no listed offers.
    await deps.db.query(`update offers set status = 'live' where id = $1`, [offer]);
    await deps.db.query('insert into trading_holds (account_id, created_at) values ($1, $2)', [seller.id, deps.clock()]);
    expect(refusal(await take(other, offer, body(other, tenth)))).toEqual({ status: 404, error: 'not-found' });
    expect(refusal(await take(other, '00000000-0000-4000-8000-000000000000', body(other, tenth)))).toEqual({ status: 404, error: 'not-found' });
    expect(refusal(await take(other, 'x', body(other, tenth)))).toEqual({ status: 404, error: 'not-found' });
  });

  it('needs a trader session', async () => {
    const seller = await person();
    const offer = await postOffer(seller);
    const res = await app.inject({ method: 'POST', url: `/v1/offers/${offer}/take`, headers: { origin: 'https://x2f.test' }, payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('five sellers racing for the same amount on one buy ad get one trade and four ad-busy (real Postgres)', async () => {
    const poster = await person();
    const offer = await postOffer(poster, { side: 'buy' });
    const sellers = await Promise.all([1, 2, 3, 4, 5].map(() => person()));
    const results = await allAtOnce(takeLocks(poster.id, offer), 5, () => sellers.map((s) => take(s, offer, body(s, tenth))));
    const ok = results.filter((r) => r.statusCode === 200);
    expect(ok).toHaveLength(1);
    expect(results.filter((r) => r.statusCode !== 200).map(refusal)).toEqual(Array(4).fill({ status: 409, error: 'ad-busy' }));
    const { rows } = await deps.db.query<{ code: string; seller_refund: string; seller_wallet_app: string; buyer_payout: string | null }>(
      'select code, seller_refund, seller_wallet_app, buyer_payout from trades where offer_id = $1',
      [offer],
    );
    expect(rows).toHaveLength(1);
    const winner = sellers.find((s) => s.address === rows[0]!.seller_refund)!;
    expect(rows[0]).toEqual({ code: (ok[0]!.json() as { code: string }).code, seller_refund: winner.address, seller_wallet_app: 'feather', buyer_payout: null });
    // Another amount on the same buy ad is a separate trade.
    const loser = sellers.find((s) => s !== winner)!;
    await taken(loser, offer, body(loser, tenth + 1n));
  });

  it('three buyers on one sell ad at once get three trades; the same buyer twice is already-waiting', async () => {
    const poster = await person();
    const offer = await postOffer(poster);
    const buyers = await Promise.all([1, 2, 3].map(() => person()));
    const results = await allAtOnce(takeLocks(poster.id, offer), 3, () => buyers.map((b) => take(b, offer, body(b, tenth))));
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect(new Set(results.map((r) => (r.json() as { code: string }).code)).size).toBe(3);

    // The same buyer again (any amount), and twice at once.
    expect(refusal(await take(buyers[0]!, offer, body(buyers[0]!, tenth * 2n)))).toEqual({ status: 409, error: 'already-waiting' });
    const fourth = await person();
    const twice = await allAtOnce(takeLocks(poster.id, offer), 2, () => [take(fourth, offer, body(fourth, tenth)), take(fourth, offer, body(fourth, tenth))]);
    expect(twice.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(refusal(twice.find((r) => r.statusCode === 409)!)).toEqual({ status: 409, error: 'already-waiting' });

    // Once that trade leaves setup/funding, the buyer may take the ad again.
    const code = (results[0]!.json() as { code: string }).code;
    expect(rowToTrade((await loadTradeRow(deps.db, code))!).buyerId).toBe(buyers[0]!.id);
    await deps.db.query(`update trades set state = 'cancelled', closed_at = $2 where code = $1`, [code, deps.clock()]);
    await taken(buyers[0]!, offer, body(buyers[0]!, tenth));
  });

  it('the partial unique indexes themselves refuse a second waiting trade (the race backstop)', async () => {
    const poster = await person();
    const a = await person();
    const b = await person();
    const sellAd = await postOffer(poster);
    await seedTrade(deps, { sellerId: poster.id, buyerId: a.id, poster: 'seller', offerId: sellAd });
    await expect(seedTrade(deps, { sellerId: poster.id, buyerId: a.id, poster: 'seller', offerId: sellAd })).rejects.toMatchObject({
      code: '23505', constraint: 'trades_waiting_per_buyer',
    });
    const buyAd = await postOffer(poster, { side: 'buy' });
    await seedTrade(deps, { sellerId: a.id, buyerId: poster.id, poster: 'buyer', offerId: buyAd });
    await expect(seedTrade(deps, { sellerId: b.id, buyerId: poster.id, poster: 'buyer', offerId: buyAd })).rejects.toMatchObject({
      code: '23505', constraint: 'trades_waiting_per_amount',
    });
    // A trade's offer must exist.
    const { trade, sides } = await seedTrade(deps, { sellerId: a.id, buyerId: b.id, poster: 'seller' });
    await expect(insertTrade(deps.db, { ...trade, code: 'ZZZZZZZZZZZZZZZZ', offerId: '00000000-0000-4000-8000-000000000000' }, sides)).rejects.toMatchObject({
      code: '23503',
    });
  });

  it('tells the poster "<display name> accepted your offer" on their live stream after the take commits', async () => {
    const seller = await person();
    const buyer = await person();
    const offer = await postOffer(seller);
    const publish = vi.spyOn(app.events, 'publish');
    try {
      const code = await taken(buyer, offer, body(buyer, tenth));
      await vi.waitFor(() => expect(publish).toHaveBeenCalledWith(seller.id, { type: 'accepted', code, by: buyer.displayName }));
      // Nothing to the taker.
      expect(publish.mock.calls.filter(([id]) => id === buyer.id)).toEqual([]);
    } finally {
      publish.mockRestore();
    }
  });
});

describe('starter limits at take (Revision 2026-10-24)', () => {
  it('a Starter taker is held to $200 and told only their own stage and cap', async () => {
    const seller = await person();
    const buyer = await person('starter');
    const offer = await postOffer(seller);
    // $200.00 is 0.60606... XMR at $330: the largest amount within the cap goes through.
    const atCap = (XMR * 20_000n) / 33_000n;
    // $200.01.
    const over = (XMR * 20_001n) / 33_000n + 1n;
    expect(fiatCents(over, { currency: 'USD', centsPerXmr: 33_000n })).toBe(20_001n);
    expect(refusal(await take(buyer, offer, body(buyer, over)))).toEqual({ status: 409, error: 'starter-limit', stage: 'starter', capUsdCents: '20000' });
    await taken(buyer, offer, body(buyer, atCap));
  });

  it('a Building taker is held to $1,000; Graduated on both sides has no stage cap (only the launch cap)', async () => {
    const seller = await person();
    const building = await person('building');
    const offer = await postOffer(seller);
    expect(refusal(await take(building, offer, body(building, 4n * XMR)))).toEqual({ status: 409, error: 'starter-limit', stage: 'building', capUsdCents: '100000' });
    const graduated = await person('graduated');
    // 15 XMR is $4,950: above every stage cap, within the launch cap.
    await taken(graduated, offer, body(graduated, 15n * XMR));
  });

  it("the other side's cap refuses too, without naming their stage", async () => {
    const seller = await person('starter');
    const buyer = await person('graduated');
    const offer = await postOffer(seller);
    expect(refusal(await take(buyer, offer, body(buyer, XMR)))).toEqual({ status: 409, error: 'starter-limit' });
  });

  it('counts the USD equivalent for other currencies, and fails closed without a price to count it with', async () => {
    const seller = await person();
    const buyer = await person('starter');
    // EUR at 0.9 USD: €210 is $233.34, above the Starter cap; €180 is $200.
    // At the market, 0%: €297.00. €4,500 is the most a euro band may reach ($5,000, the launch cap).
    const offer = await postOffer(seller, { currency: 'EUR', pricing: { mode: 'market', marginBps: 0 }, maxFiatCents: '450000' });
    const eur = (amount: bigint) => ({
      amountAtomic: amount.toString(), walletId: buyer.wallet, centsPerXmr: '29700',
      fiatCents: fiatCents(amount, { currency: 'EUR', centsPerXmr: 29_700n }).toString(), methodId: 'ZELLE', currency: 'EUR',
    });
    const over = (XMR * 21_000n) / 29_700n;
    expect(refusal(await take(buyer, offer, eur(over)))).toEqual({ status: 409, error: 'starter-limit', stage: 'starter', capUsdCents: '20000' });
    market.usdCentsPerXmr = null;
    expect(refusal(await take(buyer, offer, eur((XMR * 18_000n) / 29_700n)))).toEqual({ status: 409, error: 'price-unavailable' });
    market.usdCentsPerXmr = 33_000n;
    await taken(buyer, offer, eur((XMR * 18_000n) / 29_700n));
  });

  it('a Starter account has at most 3 open trades, counted as either side', async () => {
    const buyer = await person('starter');
    for (let i = 0; i < 3; i++) {
      const s = await person();
      // Two as buyer, one as seller; all still open.
      if (i < 2) await seedTrade(deps, { sellerId: s.id, buyerId: buyer.id, poster: 'seller' });
      else await seedTrade(deps, { sellerId: buyer.id, buyerId: s.id, poster: 'buyer' });
    }
    const seller = await person();
    const offer = await postOffer(seller);
    expect(refusal(await take(buyer, offer, body(buyer, tenth)))).toEqual({ status: 409, error: 'starter-limit', stage: 'starter', maxOpen: 3 });
    // A closed one does not count.
    await deps.db.query(
      `update trades set state = 'cancelled', closed_at = $2 where code = (select code from trades where buyer_account_id = $1 and closed_at is null limit 1)`,
      [buyer.id, deps.clock()],
    );
    await taken(buyer, offer, body(buyer, tenth));
  });

  it('a poster in a recovery-code hold starts no new trade: its offer is read under the account lock and hidden (404; lead hold v3 review, minor)', async () => {
    const seller = await person();
    const offer = await postOffer(seller);
    const buyer = await person();
    await deps.db.query(
      `insert into account_holds (account_id, started_at, hold_until, reason, started_methods) values ($1, $2, $3, 'recovery-code', '{}')`,
      [seller.id, deps.clock(), new Date(deps.clock().getTime() + 86_400_000)],
    );
    expect(refusal(await take(buyer, offer, body(buyer, tenth)))).toEqual({ status: 404, error: 'not-found' });
    await deps.db.query('delete from account_holds where account_id = $1', [seller.id]);
    await taken(buyer, offer, body(buyer, tenth));
  });

  it("a Starter poster's open-trade count holds under a race, and the taker learns nothing of it (offer-busy, review M6)", async () => {
    // Probabilistic on its own (review M2): released together, the racers reach the count read at
    // slightly different times. Three rounds make a missing lock show; the next test is the
    // deterministic one.
    for (let round = 0; round < 3; round++) {
      const poster = await person('starter');
      const offer = await postOffer(poster);
      const buyers = await Promise.all([1, 2, 3, 4, 5].map(() => person()));
      const results = await allAtOnce(takeLocks(poster.id, offer), 5, () => buyers.map((b) => take(b, offer, body(b, tenth))));
      expect(results.filter((r) => r.statusCode === 200)).toHaveLength(3);
      expect(results.filter((r) => r.statusCode !== 200).map(refusal)).toEqual(Array(2).fill({ status: 409, error: 'offer-busy' }));
    }
  });

  it('a take holds both accounts for update until it commits, so a hold or another take waits (review M1, M2)', async () => {
    const poster = await person();
    const buyer = await person();
    const offer = await postOffer(poster);
    // Park the take after its account locks: it waits on site_flags, which a holder keeps.
    const holder = await deps.db.connect();
    let pending: Promise<Awaited<ReturnType<typeof take>>> | null = null;
    try {
      await holder.query('begin');
      await holder.query('select 1 from site_flags for update');
      pending = take(buyer, offer, body(buyer, tenth));
      const deadline = Date.now() + 10_000;
      for (;;) {
        const { rows } = await deps.db.query<{ n: number }>(
          `select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%site_flags%'`,
        );
        if (rows[0]!.n >= 1) break;
        if (Date.now() > deadline) throw new Error('the take never reached site_flags');
        await new Promise((r) => setTimeout(r, 10));
      }
      // Both accounts are locked for update: another lock on either is refused at once, and a
      // trading hold insert (its foreign key's key-share lock) has to wait.
      for (const id of [poster.id, buyer.id]) {
        const probe = await deps.db.connect();
        try {
          await probe.query('begin');
          await expect(probe.query('select 1 from accounts where id = $1 for key share nowait', [id])).rejects.toMatchObject({ code: '55P03' });
          await probe.query('rollback');
          await probe.query('begin');
          await probe.query("set local lock_timeout = '100ms'");
          await expect(probe.query('insert into trading_holds (account_id, created_at) values ($1, $2)', [id, deps.clock()])).rejects.toMatchObject({ code: '55P03' });
          await probe.query('rollback');
        } finally {
          probe.release();
        }
      }
      await holder.query('commit');
    } catch (e) {
      await holder.query('rollback').catch(() => {});
      throw e;
    } finally {
      holder.release();
    }
    expect((await pending!).statusCode).toBe(200);
  });

  it("the poster's open-trade limit refuses with offer-busy and nothing else", async () => {
    const poster = await person('starter');
    for (let i = 0; i < 3; i++) {
      const b = await person();
      await seedTrade(deps, { sellerId: poster.id, buyerId: b.id, poster: 'seller' });
    }
    const offer = await postOffer(poster);
    const buyer = await person();
    expect(refusal(await take(buyer, offer, body(buyer, tenth)))).toEqual({ status: 409, error: 'offer-busy' });
  });

  it('the cap counts the XMR at the market price too, so an offer below the market moves no more XMR (review M5)', async () => {
    const seller = await person();
    const buyer = await person('starter');
    // 50% below the $330 market, the lowest an offer can go (owner F1): $165.00 per XMR.
    const offer = await postOffer(seller, { pricing: { mode: 'market', marginBps: -5000 }, minFiatCents: '100' });
    const belowBody = (amount: bigint) => body(buyer, amount, 16_500n);
    // 1 XMR is $165.00 at the offer's price but $330 at market: refused at the Starter cap.
    expect(refusal(await take(buyer, offer, belowBody(XMR)))).toEqual({ status: 409, error: 'starter-limit', stage: 'starter', capUsdCents: '20000' });
    // 0.6 XMR is $99.00 at the offer's price and $198 at market: within the cap.
    await taken(buyer, offer, belowBody((XMR * 6n) / 10n));
  });

  it('a blocked pair cannot take each other\'s offers, either way: 404 as if the offer did not exist (review M3, Task 37)', async () => {
    const poster = await person();
    const blocked = await person();
    const offer = await postOffer(poster);
    await deps.db.query('insert into account_blocks (account_id, blocked_id, created_at) values ($1, $2, $3)', [poster.id, blocked.id, deps.clock()]);
    expect(refusal(await take(blocked, offer, body(blocked, tenth)))).toEqual({ status: 404, error: 'not-found' });
    // The blocker cannot take the blocked person's offer either (lead default 2026-10-29).
    const theirs = await postOffer(blocked);
    expect(refusal(await take(poster, theirs, body(poster, tenth)))).toEqual({ status: 404, error: 'not-found' });
    // Before any other refusal: an out-of-range amount still answers 404.
    expect(refusal(await take(blocked, offer, body(blocked, XMR / 1000n)))).toEqual({ status: 404, error: 'not-found' });
    await deps.db.query('delete from account_blocks where account_id = $1', [poster.id]);
    await taken(blocked, offer, body(blocked, tenth));
  });

  it("links the pair's open pre-trade chat to the trade in the take's transaction (a take reuses the chat, Task 20)", async () => {
    const seller = await person();
    const buyer = await person();
    const other = await person();
    const offer = await postOffer(seller);
    const chat = await buyer.browser.post('/v1/chats', { offerId: offer });
    expect(chat.statusCode).toBe(201);
    const code = (chat.json() as { chat: string }).chat;
    const theirs = (await other.browser.post('/v1/chats', { offerId: offer })).json() as { chat: string };
    const trade = await taken(buyer, offer, body(buyer, tenth));
    const rows = (await deps.db.query('select code, trade_code from chats where code = any($1) order by code', [[code, theirs.chat]])).rows;
    expect(rows).toEqual(
      [
        { code, trade_code: trade },
        { code: theirs.chat, trade_code: null },
      ].sort((x, y) => (x.code < y.code ? -1 : 1)),
    );
    // The trade's chat is that one, for both sides.
    expect((await seller.browser.post(`/v1/trades/${trade}/chat`, {})).json()).toEqual({ chat: code, role: 'seller' });
  });
});

describe('taking a gift-card offer (J-17, F13 tick-box terms)', () => {
  const GIFT = { methodId: 'STEAM_GIFT_CARD', country: 'US', giftCardTerms: GIFT_CARD_TERMS_VERSION };

  it('the taker ticks the gift-card terms of the version the API shows; the trade keeps it', async () => {
    const poster = await person();
    const taker = await person();
    const offer = await postOffer(poster, GIFT);
    // Unticked, an older page's version, or not a string: refused, and no trade.
    for (const over of [{}, { giftCardTerms: 'gift-card-terms-unsigned-0' }, { giftCardTerms: true }]) {
      const res = await take(taker, offer, body(taker, XMR, undefined, { methodId: GIFT.methodId, ...over }));
      expect(res.statusCode, JSON.stringify(over)).toBe(400);
    }
    expect((await deps.db.query('select 1 from trades where offer_id = $1', [offer])).rowCount).toBe(0);
    const code = await taken(taker, offer, body(taker, XMR, undefined, { methodId: GIFT.methodId, giftCardTerms: GIFT_CARD_TERMS_VERSION }));
    const { rows } = await deps.db.query<{ gift_card_terms: string | null; confirm_window_min: number }>(
      'select gift_card_terms, confirm_window_min from trades where code = $1',
      [code],
    );
    // G50: 45 minutes to check the card.
    expect(rows[0]).toEqual({ gift_card_terms: GIFT_CARD_TERMS_VERSION, confirm_window_min: 45 });
    // What the taker agreed to never changes (355_gift_card_terms.sql).
    await expect(deps.db.query('update trades set gift_card_terms = null where code = $1', [code])).rejects.toThrow(/never change/);
  });

  it('a two-method offer (J-16 x J-17): the chosen method decides; a gift-card take keeps the terms and the gift-card windows (G50; lead p11-130)', async () => {
    const poster = await person();
    const taker = await person();
    const other = await person();
    const bands = [{ min: '10', max: '5000', marginBps: 0, minTrades: null }];
    const res = await poster.browser.post('/v1/offers', {
      side: 'sell', terms: 'Zelle or a Steam card.', country: 'US', giftCardTerms: GIFT_CARD_TERMS_VERSION,
      currencies: [{ currency: 'USD', bands }],
      methods: [{ methodId: 'ZELLE', adjustBps: 0, instructions: '' }, { methodId: 'STEAM_GIFT_CARD', adjustBps: 0, instructions: '' }],
    });
    expect(res.statusCode, res.body).toBe(201);
    const offer = (res.json() as { id: string }).id;
    // Zelle: no terms; the card: the terms, exactly.
    expect((await take(taker, offer, body(taker, XMR, undefined, { methodId: 'ZELLE', giftCardTerms: GIFT_CARD_TERMS_VERSION }))).statusCode).toBe(400);
    expect((await take(other, offer, body(other, XMR, undefined, { methodId: 'STEAM_GIFT_CARD' }))).statusCode).toBe(400);
    expect((await deps.db.query('select 1 from trades where offer_id = $1', [offer])).rowCount).toBe(0);
    const zelle = await taken(taker, offer, body(taker, XMR, undefined, { methodId: 'ZELLE' }));
    const card = await taken(other, offer, body(other, XMR, undefined, { methodId: 'STEAM_GIFT_CARD', giftCardTerms: GIFT_CARD_TERMS_VERSION }));
    const rows = async (code: string) =>
      (await deps.db.query('select method_id, gift_card_terms, confirm_window_min, pay_window_min from trades where code = $1', [code])).rows[0];
    expect(await rows(zelle)).toEqual({ method_id: 'ZELLE', gift_card_terms: null, confirm_window_min: 90, pay_window_min: 90 });
    // The gift-card profile (one lookup, tradeProfile): 45 minutes to check the card (owner G50), 90 to send it (lead default, p11-130).
    expect(await rows(card)).toEqual({ method_id: 'STEAM_GIFT_CARD', gift_card_terms: GIFT_CARD_TERMS_VERSION, confirm_window_min: 45, pay_window_min: 90 });
  });

  it('a take of any other offer carries no gift-card terms', async () => {
    const poster = await person();
    const taker = await person();
    const offer = await postOffer(poster);
    const res = await take(taker, offer, body(taker, XMR, undefined, { giftCardTerms: GIFT_CARD_TERMS_VERSION }));
    expect(res.statusCode).toBe(400);
    const code = await taken(taker, offer, body(taker, XMR));
    expect((await deps.db.query('select gift_card_terms from trades where code = $1', [code])).rows[0]).toEqual({ gift_card_terms: null });
  });
});

describe('the launch cap: $5,000 per trade (owner p11-6)', () => {
  const CAP = { status: 409, error: 'launch-cap', capUsdCents: '500000' };
  /** An offer from before the cap (J-16: bands are written once, so it is inserted as migration 490 moved it), live, margin 0. */
  const beforeTheCap = (who: Who, currency: string, maxMinor: number) =>
    insertOffer(deps.db, { accountId: who.id, side: 'sell', methodId: 'ZELLE', currency, min: 1000, max: maxMinor, at: deps.clock() });

  it('is one constant: $5,000 in US cents', () => {
    expect(LAUNCH_TRADE_CAP_USD_CENTS).toBe(500_000n);
  });

  it("posting: every band's top edge is at most $5,000, counted in US dollars by the app's own price", async () => {
    const p = await person();
    await postOffer(p, { maxFiatCents: '500000' });
    expect(refusal(await p.browser.post('/v1/offers', flexBody({ ...OFFER, maxFiatCents: '500100' })))).toEqual(CAP);
    // EUR at 0.9 USD: €4,500 is $5,000.00; €4,501 is over.
    await postOffer(p, { currency: 'EUR', maxFiatCents: '450000' });
    expect(refusal(await p.browser.post('/v1/offers', flexBody({ ...OFFER, currency: 'EUR', maxFiatCents: '450100' })))).toEqual(CAP);
    // Nothing was written by a refusal.
    const { rows } = await deps.db.query<{ max: string }>(
      'select max(t.max_amount)::text as max from offer_tiers t join offers o on o.id = t.offer_id where o.account_id = $1', [p.id],
    );
    expect(rows[0]!.max).toBe('500000');
  });

  it('posting fails closed without a price to convert with; US dollars need none', async () => {
    const p = await person();
    market.usdCentsPerXmr = null;
    expect(refusal(await p.browser.post('/v1/offers', flexBody({ ...OFFER, currency: 'EUR', maxFiatCents: '1000' })))).toEqual({ status: 409, error: 'price-unavailable' });
    expect((await deps.db.query("select 1 from offer_currencies c join offers o on o.id = c.offer_id where o.account_id = $1 and c.currency = 'EUR'", [p.id])).rowCount).toBe(0);
    await postOffer(p, { maxFiatCents: '500000' });
    expect(refusal(await p.browser.post('/v1/offers', flexBody({ ...OFFER, maxFiatCents: '500100' })))).toEqual(CAP);
  });

  it("taking: the trade's USD value is at most $5,000 for Graduated traders too (an offer from before the cap)", async () => {
    const seller = await person();
    const buyer = await person();
    // An offer posted before the cap existed can have a larger maximum; the take still refuses.
    const offer = await beforeTheCap(seller, 'USD', 10_000_000);
    // $5,000.00 exactly goes through; one atomic unit more is over.
    const atCap = (XMR * 500_000n) / 33_000n;
    expect(fiatCents(atCap, { currency: 'USD', centsPerXmr: 33_000n })).toBe(500_000n);
    const over = (XMR * 500_001n) / 33_000n + 1n;
    expect(refusal(await take(buyer, offer, body(buyer, over)))).toEqual(CAP);
    expect((await deps.db.query('select 1 from trades where offer_id = $1', [offer])).rowCount).toBe(0);
    await taken(buyer, offer, body(buyer, atCap));
  });

  it('taking counts the XMR at the market price too, and other currencies in US dollars', async () => {
    const seller = await person();
    const buyer = await person();
    // −50%, the lowest an offer can go (owner F1): $165.00 per XMR at the $330 market. 15.2 XMR is
    // $2,508 at the offer's price but $5,016 at market; 15 XMR is $4,950 at market.
    const below = await postOffer(seller, { pricing: { mode: 'market', marginBps: -5000 } });
    expect(refusal(await take(buyer, below, body(buyer, (XMR * 152n) / 10n, 16_500n)))).toEqual(CAP);
    await taken(buyer, below, body(buyer, 15n * XMR, 16_500n));
    // EUR at 0.9 USD, from an offer from before the cap: €4,600 is $5,111.12.
    const other = await person();
    const eur = await beforeTheCap(seller, 'EUR', 10_000_000);
    const eurBody = (amount: bigint) => ({
      amountAtomic: amount.toString(), walletId: other.wallet, centsPerXmr: '29700',
      fiatCents: fiatCents(amount, { currency: 'EUR', centsPerXmr: 29_700n }).toString(), methodId: 'ZELLE', currency: 'EUR',
    });
    expect(refusal(await take(other, eur, eurBody((XMR * 460_000n) / 29_700n)))).toEqual(CAP);
    await taken(other, eur, eurBody((XMR * 440_000n) / 29_700n));
  });
});

describe('the growth ceiling: extra XMR never grows a trade past the launch cap (launch-rules review F1)', () => {
  /** The trade's ceiling as the take answered it and as the row keeps it. */
  async function ceilingOf(res: Awaited<ReturnType<typeof take>>): Promise<{ code: string; answered: string; stored: string }> {
    expect(res.statusCode, res.body).toBe(200);
    const out = res.json() as { code: string; maxFiatCents: string };
    return { code: out.code, answered: out.maxFiatCents, stored: (await loadTradeRow(deps.db, out.code))!.max_fiat_cents };
  }
  const beforeTheCap = (who: Who, currency: string, maxMinor: number) =>
    insertOffer(deps.db, { accountId: who.id, side: 'sell', methodId: 'ZELLE', currency, min: 1000, max: maxMinor, at: deps.clock() });

  it("an offer within the cap keeps its band's maximum as the ceiling", async () => {
    const seller = await person();
    const buyer = await person();
    const offer = await postOffer(seller, { maxFiatCents: '200000' });
    expect(await ceilingOf(await take(buyer, offer, body(buyer, XMR)))).toMatchObject({ answered: '200000', stored: '200000' });
    const atCap = await postOffer(seller, { side: 'buy', maxFiatCents: '500000' });
    expect(await ceilingOf(await take(buyer, atCap, body(buyer, XMR)))).toMatchObject({ answered: '500000', stored: '500000' });
  });

  it('an over-funded trade on an offer from before the cap grows to $5,000 and no further', async () => {
    const seller = await person();
    const buyer = await person();
    // A $100,000 band from before the cap: the trade's ceiling is $5,000 all the same.
    const offer = await beforeTheCap(seller, 'USD', 10_000_000);
    const { code, answered, stored } = await ceilingOf(await take(buyer, offer, body(buyer, XMR)));
    expect({ answered, stored }).toEqual({ answered: '500000', stored: '500000' });
    // The seller sends 30 XMR before "I've paid": $9,900 at the locked $330. The trade stays 1 XMR.
    await applyEvent(deps, code, { type: 'setup-done', escrowAddress: fakeAddress() }, 'system');
    const lots = 30n * XMR;
    const kept = await applyEvent(deps, code, { type: 'chain', receivedAtomic: lots, unlockedAtomic: lots, confirmations: 10 }, 'system');
    expect({ amount: kept.amountAtomic, fiat: kept.fiatCents, grown: kept.grown }).toEqual({ amount: XMR, fiat: 33_000n, grown: null });
    // 15.15 XMR and its fee ($4,999.50) is within the ceiling: it grows to that.
    const within = (XMR * 1515n) / 100n;
    const funds = within + within / 100n;
    const grown = await applyEvent(deps, code, { type: 'chain', receivedAtomic: funds, unlockedAtomic: funds, confirmations: 10 }, 'system');
    expect(grown.amountAtomic).toBe(within);
    expect(grown.fiatCents).toBe(499_950n);
  });

  it('a margin far below market: the ceiling counts the XMR at market, as the take does', async () => {
    const seller = await person();
    const buyer = await person();
    // −50%: $165 per XMR at the $330 market. 15.15 XMR is $2,499.75 at the offer's price but $4,999.50
    // at market: the ceiling is the largest total at $165 no amount over $5,000 at market reaches.
    const below = await postOffer(seller, { pricing: { mode: 'market', marginBps: -5000 } });
    const { code, answered } = await ceilingOf(await take(buyer, below, body(buyer, XMR, 16_500n)));
    expect(answered).toBe('249999');
    await applyEvent(deps, code, { type: 'setup-done', escrowAddress: fakeAddress() }, 'system');
    // 15.16 XMR is $2,501.40 at the offer's price, within its $5,000 band, but $5,002.80 at market: no growth.
    const over = (XMR * 1516n) / 100n;
    const overFunds = over + over / 100n;
    expect((await applyEvent(deps, code, { type: 'chain', receivedAtomic: overFunds, unlockedAtomic: overFunds, confirmations: 10 }, 'system')).amountAtomic).toBe(XMR);
    // 15.15 XMR ($2,499.75 at the offer's price) is within the ceiling: it grows to that.
    const within = (XMR * 1515n) / 100n;
    const funds = within + within / 100n;
    expect((await applyEvent(deps, code, { type: 'chain', receivedAtomic: funds, unlockedAtomic: funds, confirmations: 10 }, 'system')).amountAtomic).toBe(within);
  });

  it("a euro offer from before the cap: the ceiling is $5,000 in euros at the take's price", async () => {
    const seller = await person();
    const buyer = await person();
    const eur = await beforeTheCap(seller, 'EUR', 10_000_000);
    const res = await take(buyer, eur, {
      amountAtomic: XMR.toString(), walletId: buyer.wallet, centsPerXmr: '29700', fiatCents: '29700', methodId: 'ZELLE', currency: 'EUR',
    });
    // €4,500.00 is $5,000.00 at 0.9.
    expect((await ceilingOf(res)).answered).toBe('450000');
  });
});

describe('POST /v1/trades/:code/wallet (the poster\'s side, Task 19\'s accepted sheet)', () => {
  async function setupTrade(side: 'sell' | 'buy') {
    const poster = await person();
    const taker = await person();
    const offer = await postOffer(poster, { side });
    const code = await taken(taker, offer, body(taker, tenth));
    return { poster, taker, code };
  }

  it('sets the poster-seller refund address and wallet app once; a second call is refused', async () => {
    const { poster, code } = await setupTrade('sell');
    const res = await poster.browser.post(`/v1/trades/${code}/wallet`, { walletId: poster.wallet });
    expect(res.statusCode, res.body).toBe(204);
    const row = (await loadTradeRow(deps.db, code))!;
    expect({ refund: row.seller_refund, app: row.seller_wallet_app }).toEqual({ refund: poster.address, app: 'feather' });
    const second = await addWallet(poster.id);
    expect(refusal(await poster.browser.post(`/v1/trades/${code}/wallet`, { walletId: second.id }))).toEqual({ status: 409, error: 'wrong-state' });
    expect((await loadTradeRow(deps.db, code))!.seller_refund).toBe(poster.address);
    // The seller's view now carries the wallet app for the funding button.
    expect((await poster.browser.get(`/v1/trades/${code}`)).json()).toMatchObject({ funding: { walletApp: 'feather' } });
  });

  it('two wallet calls at once set the address once; the other is refused', async () => {
    const { poster, code } = await setupTrade('sell');
    const second = await addWallet(poster.id);
    const results = await allAtOnce([`select 1 from trades where code = '${code}' for update`], 2, () => [
      poster.browser.post(`/v1/trades/${code}/wallet`, { walletId: poster.wallet }),
      poster.browser.post(`/v1/trades/${code}/wallet`, { walletId: second.id }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([204, 409]);
    expect(refusal(results.find((r) => r.statusCode === 409)!)).toEqual({ status: 409, error: 'wrong-state' });
    const winner = results[0]!.statusCode === 204 ? poster.address : second.address;
    expect((await loadTradeRow(deps.db, code))!.seller_refund).toBe(winner);
  });

  it('sets the poster-buyer payout address', async () => {
    const { poster, code } = await setupTrade('buy');
    expect((await poster.browser.post(`/v1/trades/${code}/wallet`, { walletId: poster.wallet })).statusCode).toBe(204);
    expect((await loadTradeRow(deps.db, code))!.buyer_payout).toBe(poster.address);
  });

  it('refuses the taker and strangers, and a trade that has left setup', async () => {
    const { poster, taker, code } = await setupTrade('sell');
    expect(refusal(await taker.browser.post(`/v1/trades/${code}/wallet`, { walletId: taker.wallet }))).toEqual({ status: 409, error: 'wrong-party' });
    const stranger = await person();
    expect(refusal(await stranger.browser.post(`/v1/trades/${code}/wallet`, { walletId: stranger.wallet }))).toEqual({ status: 404, error: 'not-found' });
    expect(refusal(await poster.browser.post('/v1/trades/NOPE/wallet', { walletId: poster.wallet }))).toEqual({ status: 404, error: 'not-found' });
    await deps.db.query(`update trades set state = 'cancelled', closed_at = $2 where code = $1`, [code, deps.clock()]);
    expect(refusal(await poster.browser.post(`/v1/trades/${code}/wallet`, { walletId: poster.wallet }))).toEqual({ status: 409, error: 'wrong-state' });
  });

  /** Runs `sql` as the retention purge's role (as purgeTradeAddresses does). */
  async function asPurge(sql: string, params: unknown[]): Promise<void> {
    const c = await deps.db.connect();
    try {
      await c.query('begin');
      await c.query('set local role x2f_purge');
      await c.query(sql, params);
      await c.query('commit');
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }

  it('an address, once set, never changes for any role; only the purge nulls it, after close, and it is never written again (review I1)', async () => {
    const { poster, code } = await setupTrade('sell');
    expect((await poster.browser.post(`/v1/trades/${code}/wallet`, { walletId: poster.wallet })).statusCode).toBe(204);
    for (const col of ['buyer_payout', 'seller_refund', 'seller_wallet_app']) {
      await expect(deps.db.query(`update trades set ${col} = $2 where code = $1`, [code, fakeAddress()])).rejects.toMatchObject({ code: '23000' });
      // The app role may not null one either (null, then write another, was the hole).
      await expect(deps.db.query(`update trades set ${col} = null where code = $1`, [code])).rejects.toMatchObject({ code: '23000' });
    }
    // The purge may not null an open trade's address.
    await expect(asPurge('update trades set buyer_payout = null, seller_refund = null where code = $1', [code])).rejects.toMatchObject({ code: '23000' });
    await deps.db.query(`update trades set state = 'cancelled', closed_at = $2 where code = $1`, [code, deps.clock()]);
    await asPurge('update trades set buyer_payout = null, seller_refund = null where code = $1', [code]);
    const row = (await loadTradeRow(deps.db, code))!;
    expect({ payout: row.buyer_payout, refund: row.seller_refund }).toEqual({ payout: null, refund: null });
    // A purged address is never written again.
    for (const col of ['buyer_payout', 'seller_refund']) {
      await expect(deps.db.query(`update trades set ${col} = $2 where code = $1`, [code, fakeAddress()])).rejects.toMatchObject({ code: '23000' });
    }
  });

  it('an unset address is set only in setup: not once the trade has left it (review I1)', async () => {
    const { code } = await setupTrade('sell');
    await deps.db.query(`update trades set state = 'funding' where code = $1`, [code]);
    await expect(deps.db.query('update trades set seller_refund = $2 where code = $1', [code, fakeAddress()])).rejects.toMatchObject({ code: '23000' });
  });

  it("the deal never changes for any role; state, timers, escrow and dispute fields stay writable (review I1)", async () => {
    const { code } = await setupTrade('sell');
    const other = await person();
    const otherOffer = await postOffer(other);
    for (const [col, v] of [
      ['locked_cents_per_xmr', 1], ['locked_currency', 'EUR'], ['fiat_cents', 1], ['amount_atomic', 1], ['method_id', 'CUSTOM'],
      ['offer_id', otherOffer], ['seller_account_id', other.id], ['buyer_account_id', other.id], ['poster', 'buyer'],
      ['confirm_window_min', 1], ['min_fiat_cents', 1], ['max_fiat_cents', 1], ['taken_at', new Date(0)],
    ] as const) {
      await expect(deps.db.query(`update trades set ${col} = $2 where code = $1`, [code, v]), col).rejects.toMatchObject({ code: '23000' });
    }
    // Growth keeps the take's amount and total in grown_from_* (spec 11.1): allowed.
    const t = rowToTrade((await loadTradeRow(deps.db, code))!);
    await deps.db.query(
      `update trades set amount_atomic = $2, fiat_cents = $3, grown_at = $4, grown_from_atomic = $5, grown_from_fiat_cents = $6 where code = $1`,
      [code, (t.amountAtomic * 2n).toString(), (t.fiatCents * 2n).toString(), deps.clock(), t.amountAtomic.toString(), t.fiatCents.toString()],
    );
    // Growth that rewrites the take's amount is not.
    await expect(deps.db.query('update trades set grown_from_atomic = $2 where code = $1', [code, '1'])).rejects.toMatchObject({ code: '23000' });
    await deps.db.query(
      `update trades set state = 'disputed', dispute_by = 'buyer', dispute_at = $2, setup_by = $2, escrow_address = 'x', confirmations = 3, closed_at = null where code = $1`,
      [code, deps.clock()],
    );
  });

  it('refuses a poster on a trading hold, and a trade past setup_by (review M4)', async () => {
    const held = await setupTrade('sell');
    await deps.db.query('insert into trading_holds (account_id, created_at) values ($1, $2)', [held.poster.id, deps.clock()]);
    expect(refusal(await held.poster.browser.post(`/v1/trades/${held.code}/wallet`, { walletId: held.poster.wallet }))).toEqual({ status: 409, error: 'trading-hold' });
    expect((await loadTradeRow(deps.db, held.code))!.seller_refund).toBeNull();

    const late = await setupTrade('sell');
    await deps.db.query('update trades set setup_by = $2 where code = $1', [late.code, new Date(deps.clock().getTime() - 1000)]);
    expect(refusal(await late.poster.browser.post(`/v1/trades/${late.code}/wallet`, { walletId: late.poster.wallet }))).toEqual({ status: 409, error: 'wrong-state' });
  });

  it('refuses a waiting or foreign wallet (wallet-not-ready), no usable wallet (no-wallet) and a bad body', async () => {
    const { poster, taker, code } = await setupTrade('sell');
    const waiting = await addWallet(poster.id, false);
    expect(refusal(await poster.browser.post(`/v1/trades/${code}/wallet`, { walletId: waiting.id }))).toEqual({ status: 409, error: 'wallet-not-ready' });
    expect(refusal(await poster.browser.post(`/v1/trades/${code}/wallet`, { walletId: taker.wallet }))).toEqual({ status: 409, error: 'wallet-not-ready' });
    expect(refusal(await poster.browser.post(`/v1/trades/${code}/wallet`, { walletId: 'x' }))).toEqual({ status: 400, error: 'bad-request' });
    expect(refusal(await poster.browser.post(`/v1/trades/${code}/wallet`, { walletId: poster.wallet, more: 1 }))).toEqual({ status: 400, error: 'bad-request' });
    await deps.db.query('update wallets set removed_at = $2 where account_id = $1', [poster.id, deps.clock()]);
    expect(refusal(await poster.browser.post(`/v1/trades/${code}/wallet`, { walletId: poster.wallet }))).toEqual({ status: 409, error: 'no-wallet' });
  });
});

/**
 * Tasks 16-17 review round 5 M2 (the reviewer's reproduction): a session revoked while its request
 * waits inside the route's transaction (the owner's proof, a logout) acts for nobody: 401
 * `not-authenticated` and nothing written. Each row's request is fired while a separate transaction
 * holds the rows it must wait for; once it waits, that transaction revokes the session and commits.
 */
describe('a session revoked while its trading request waits (review round 5 M2)', () => {
  const sessionOf = async (accountId: string) =>
    (await deps.db.query<{ id: string }>('select id from sessions where account_id = $1 and revoked_at is null', [accountId])).rows.map((r) => r.id);

  async function revokedWhileWaiting(lock: string[], accountId: string, fire: () => Promise<{ statusCode: number; body: string; json(): unknown }>) {
    const sids = await sessionOf(accountId);
    expect(sids).toHaveLength(1);
    const holder = await deps.db.connect();
    try {
      await holder.query('begin');
      for (const sql of lock) await holder.query(sql);
      const pending = fire();
      const me = (await holder.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!.pid;
      const deadline = Date.now() + 10_000;
      for (;;) {
        const { rows } = await deps.db.query<{ n: number }>(
          `select count(*)::int as n from pg_stat_activity
            where datname = current_database() and pid <> $1 and wait_event_type = 'Lock' and state = 'active'`,
          [me],
        );
        if (rows[0]!.n >= 1) break;
        if (Date.now() > deadline) throw new Error('the request never waited on the lock');
        await new Promise((r) => setTimeout(r, 10));
      }
      await holder.query('update sessions set revoked_at = $2 where id = $1', [sids[0], deps.clock()]);
      await holder.query('commit');
      const res = await pending;
      expect(res.statusCode, res.body).toBe(401);
      expect(res.json()).toEqual({ error: 'not-authenticated' });
    } catch (e) {
      await holder.query('rollback').catch(() => {});
      throw e;
    } finally {
      holder.release();
    }
  }

  const ROWS: Record<string, () => Promise<void>> = {
    'POST /v1/offers/:id/take': async () => {
      const seller = await person();
      const buyer = await person();
      const offer = await postOffer(seller);
      // The reviewer's shape: the poster's account row is held, so the take waits inside its transaction.
      await revokedWhileWaiting([`select 1 from accounts where id = '${seller.id}' for update`], buyer.id, () => take(buyer, offer, body(buyer, tenth)));
      expect((await deps.db.query('select 1 from trades where offer_id = $1', [offer])).rows).toHaveLength(0);
    },
    'POST /v1/offers': async () => {
      const who = await person();
      await revokedWhileWaiting([`select 1 from accounts where id = '${who.id}' for update`], who.id, () => who.browser.post('/v1/offers', flexBody(OFFER)));
      // (person() seeds removed offers for its history trades.)
      expect((await deps.db.query("select 1 from offers where account_id = $1 and status <> 'removed'", [who.id])).rows).toHaveLength(0);
    },
    'PATCH /v1/offers/:id': async () => {
      const who = await person();
      const offer = await postOffer(who);
      await revokedWhileWaiting(
        [`select 1 from accounts where id = '${who.id}' for update`, `select 1 from offers where id = '${offer}' for update`],
        who.id,
        () => who.browser.patch(`/v1/offers/${offer}`, { status: 'paused' }),
      );
      expect((await deps.db.query<{ status: string }>('select status from offers where id = $1', [offer])).rows[0]!.status).toBe('live');
    },
    'POST /v1/account/offers/status': async () => {
      const who = await person();
      const offer = await postOffer(who);
      await revokedWhileWaiting(
        [`select 1 from accounts where id = '${who.id}' for update`, `select 1 from offers where id = '${offer}' for update`],
        who.id,
        () => who.browser.post('/v1/account/offers/status', { ids: [offer], status: 'paused' }),
      );
      expect((await deps.db.query<{ status: string }>('select status from offers where id = $1', [offer])).rows[0]!.status).toBe('live');
    },
    'POST /v1/trades/:code/events': async () => {
      const seller = await person();
      const buyer = await person();
      const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
      const secured = await driveTo(deps, trade, 'secured');
      await revokedWhileWaiting([`select 1 from trades where code = '${secured.code}' for update`], buyer.id, () =>
        buyer.browser.post(`/v1/trades/${secured.code}/events`, { type: 'mark-paid', fiatCents: FIAT.toString() }),
      );
      expect((await loadTradeRow(deps.db, secured.code))!.state).toBe('secured');
    },
  };

  it('the table covers exactly LIVE_SESSION_TRADING_ROUTES', () => {
    expect(Object.keys(ROWS).sort()).toEqual([...LIVE_SESSION_TRADING_ROUTES].sort());
  });

  for (const route of Object.keys(ROWS)) it(`${route}: 401, nothing written`, ROWS[route]!);
});
