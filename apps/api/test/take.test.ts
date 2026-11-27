import type { FastifyInstance } from 'fastify';
import { GIFT_CARD_TERMS_VERSION, LAUNCH_TRADE_CAP_USD_CENTS, LIEN_BUYER_KEEPS_ATOMIC, LIEN_RECOVERY_MAX_BPS, WATCH_CLOSED_DAYS, atomicForFiat, escrowPlan, fiatCents, lienRecoveryCap, rateFor } from '@x2f/trade';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deps } from '../src/app.js';
import type { MarketPrices, MarketQuote } from '../src/price/market.js';
import { applyEvent, insertTrade, loadTradeRow, rowToTrade } from '../src/trades/store.js';
import { makeVendor, seedAccount } from './helpers/accounts.js';
import { approvedLimit } from './helpers/limits.js';
import { testDb } from './helpers/db.js';
import { tradeApp } from './helpers/tradeApp.js';
import { FIAT, XMR, driveTo, fakeAddress, seedReviews, seedTrade } from './helpers/trades.js';
import sodium from 'libsodium-wrappers';
import { signRecoveryAddress } from '@x2f/trade';
import { LIVE_SESSION_TRADING_ROUTES } from '../src/auth/hold.js';
import { issueConfirmToken } from '../src/auth/confirm.js';
import { addressEnd, addressHash } from '@x2f/accounts';
import { insertBan } from './helpers/bans.js';
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
  ({ app, deps, trader } = await tradeApp({}, { prices, db: await testDb({ max: 12 }), addresses: { check: async () => 'ok' } }));
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
    // Plan 4 Task 27: a trade-banned taker is refused; past its end (by the clock) the take goes on.
    const bannedTaker = await person();
    const banEnds = new Date(deps.clock().getTime() + 3_600_000);
    await insertBan(deps, bannedTaker.id, 'trade', banEnds);
    // Lead call (Q4): the refusal carries the general reason and the end, for the popup.
    expect(refusal(await take(bannedTaker, offer, body(bannedTaker, tenth)))).toEqual({ status: 409, error: 'trade-ban', reasonCode: 'abuse', until: banEnds.toISOString() });

    const other = await person();
    // A row from before SBP was removed (owner 12 Nov: Russian anything is banned): unknown now, so unavailable.
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
      await vi.waitFor(() => expect(publish).toHaveBeenCalledWith(seller.id, { type: 'accepted', code, by: buyer.displayName }, { closed: false }));
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

  const limit = (accountId: string, l: Parameters<typeof approvedLimit>[2]) => approvedLimit(deps, accountId, l);

  // Review B1: the listed maximum of a poster held by an account limit is what the take allows, by
  // the take's own rule (the larger of the fiat total and the XMR at the market), at any margin.
  for (const marginBps of [-500, 0, 500]) {
    it(`a limited poster's listed maximum takes, and one past it refuses, at a ${marginBps / 100}% margin (Task 26, review B1)`, async () => {
      const poster = await person();
      await limit(poster.id, { capUsd: 300 });
      const fiatOffer = await postOffer(poster, { pricing: { mode: 'market', marginBps } });
      const xmrOffer = await postOffer(poster, { pricing: { mode: 'market', marginBps }, amountUnit: 'xmr', minFiatCents: undefined, maxFiatCents: undefined, minAtomic: (XMR / 100n).toString(), maxAtomic: (10n * XMR).toString() });
      const viewer = await person();
      const listed = (await viewer.browser.get('/v1/offers?side=sell&method=ZELLE&currency=USD')).json() as Array<{ id: string; rate: string; maxFiatCents: string; maxAtomic: string }>;
      const fiatCard = listed.find((c) => c.id === fiatOffer)!;
      const xmrCard = listed.find((c) => c.id === xmrOffer)!;
      // The fiat band: a take of exactly the listed total, and one cent past it.
      {
        const rate = BigInt(fiatCard.rate);
        const max = BigInt(fiatCard.maxFiatCents);
        expect(max).toBeLessThanOrEqual(30_000n);
        const buyer = await person();
        expect(refusal(await take(buyer, fiatOffer, body(buyer, atomicForFiat(max + 1n, { currency: 'USD', centsPerXmr: rate }), rate)))).toEqual({ status: 409, error: 'starter-limit' });
        await taken(buyer, fiatOffer, body(buyer, atomicForFiat(max, { currency: 'USD', centsPerXmr: rate }), rate));
      }
      // The XMR band: exactly the listed amount, and one atomic unit past it.
      {
        const rate = BigInt(xmrCard.rate);
        const max = BigInt(xmrCard.maxAtomic);
        const buyer = await person();
        expect(refusal(await take(buyer, xmrOffer, body(buyer, max + 1n, rate)))).toEqual({ status: 409, error: 'starter-limit' });
        await taken(buyer, xmrOffer, body(buyer, max, rate));
      }
    });
  }

  it('an account limit holds a Graduated taker to its cap, named as their own account limit (Task 26)', async () => {
    const seller = await person();
    const buyer = await person('graduated');
    await limit(buyer.id, { capUsd: 300 });
    const offer = await postOffer(seller);
    // $330 is over the $300 limit; $297 is within it.
    expect(refusal(await take(buyer, offer, body(buyer, XMR)))).toEqual({ status: 409, error: 'account-limit', capUsdCents: '30000' });
    await taken(buyer, offer, body(buyer, (XMR * 9n) / 10n));
  });

  it("a stage limit holds the taker to that stage's limits; the poster's limit refuses without naming it (Task 26)", async () => {
    const seller = await person();
    const buyer = await person('graduated');
    await limit(buyer.id, { stage: 'starter' });
    const offer = await postOffer(seller);
    expect(refusal(await take(buyer, offer, body(buyer, XMR)))).toEqual({ status: 409, error: 'starter-limit', stage: 'starter', capUsdCents: '20000' });
    const poster = await person('graduated');
    await limit(poster.id, { capUsd: 100 });
    const theirs = await postOffer(poster);
    const taker = await person('graduated');
    expect(refusal(await take(taker, theirs, body(taker, XMR)))).toEqual({ status: 409, error: 'starter-limit' });
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

  // Security review of bans onto main, m1: the poster's side of a take. A trade-banned or a
  // site-banned poster's offer, taken by its id, is hidden (poster_ok, take.ts OFFER_SQL) and starts
  // no trade; once the ban is lifted the same offer is taken.
  it('a trade-banned or site-banned poster\'s offer taken by id is hidden (404) and writes no trade (bans review m1)', async () => {
    const seen: Record<string, unknown> = {};
    const lifts: (() => Promise<void>)[] = [];
    for (const kind of ['trade', 'site'] as const) {
      const seller = await person();
      const offer = await postOffer(seller);
      const buyer = await person();
      const banId = await insertBan(deps, seller.id, kind, null);
      const answer = refusal(await take(buyer, offer, body(buyer, tenth)));
      const { rows } = await deps.db.query<{ n: number }>('select count(*)::int as n from trades where offer_id = $1', [offer]);
      seen[kind] = { answer, trades: rows[0]!.n };
      lifts.push(async () => {
        await deps.db.query('update account_bans set lifted_at = $2, lifted_by = account_id where id = $1', [banId, deps.clock()]);
        await taken(buyer, offer, body(buyer, tenth));
      });
    }
    // Both kinds checked before either is asserted, so a mutant shows on each.
    const hidden = { answer: { status: 404, error: 'not-found' }, trades: 0 };
    expect(seen).toEqual({ trade: hidden, site: hidden });
    for (const lift of lifts) await lift();
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

  it('owner option b (16 Nov 2026): a poster with an active lien sets up as usual; a freeze still refuses', async () => {
    const owing = await setupTrade('sell');
    await deps.db.query(
      `insert into liens (debtor_account_id, creditor_account_id, amount_atomic, from_code, dispute_seq, round, cause, created_at, changed_at)
     values ($1, $2, 1000, gen_random_uuid()::text, 1, 1, 'restitution', $3, $3)`,
      [owing.poster.id, owing.taker.id, deps.clock()],
    );
    expect((await owing.poster.browser.post(`/v1/trades/${owing.code}/wallet`, { walletId: owing.poster.wallet })).statusCode).toBe(204);
    expect((await loadTradeRow(deps.db, owing.code))!.seller_refund).not.toBeNull();
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
    'PUT /v1/account/away': async () => {
      const who = await person();
      const offer = await postOffer(who);
      await revokedWhileWaiting([`select 1 from accounts where id = '${who.id}' for update`], who.id, () => who.browser.put('/v1/account/away', { away: true }));
      expect((await deps.db.query<{ status: string }>('select status from offers where id = $1', [offer])).rows[0]!.status).toBe('live');
      expect((await deps.db.query<{ away_since: Date | null }>('select away_since from accounts where id = $1', [who.id])).rows[0]!.away_since).toBeNull();
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

/**
 * Owner demo note #6 (16 Nov 2026): a one-time payout wallet is used for the trade being started
 * only, and the server never lets a trade use an address that is not one of the account's own
 * usable wallets (a weak account's new address waits 24 hours, staged by hold model v3).
 */
describe('one-time wallets and the per-trade address (owner demo note #6)', () => {
  async function oneTimeWallet(accountId: string): Promise<{ id: string; address: string }> {
    const w = await addWallet(accountId);
    await deps.db.query('update wallets set one_time = true where id = $1', [w.id]);
    return w;
  }
  // The open wallets: a used-up one-time wallet whose trade is still in setup is listed too, as in
  // use by that trade (review 17 Nov (b) M1), and is left out here.
  const listed = async (who: Who) =>
    ((await who.browser.get('/v1/wallets')).json() as Array<{ id: string; inUseByTrade: string | null }>).filter((w) => w.inUseByTrade === null).map((w) => w.id);

  it("a take with a one-time wallet pays to it, then the wallet is no longer listed or usable", async () => {
    const seller = await person();
    const offer = await postOffer(seller);
    const buyer = await person();
    const once = await oneTimeWallet(buyer.id);
    expect(await listed(buyer)).toContain(once.id);
    const code = await taken(buyer, offer, body(buyer, tenth, undefined, { walletId: once.id }));
    expect((await loadTradeRow(deps.db, code))!.buyer_payout).toBe(once.address);
    expect(await listed(buyer)).not.toContain(once.id);
    expect(await listed(buyer)).toContain(buyer.wallet);
    // The trade keeps its own copy: the address written at take is unchanged.
    const second = await postOffer(seller);
    expect(refusal(await take(buyer, second, body(buyer, tenth, undefined, { walletId: once.id })))).toEqual({ status: 409, error: 'wallet-not-ready' });
    expect((await loadTradeRow(deps.db, code))!.buyer_payout).toBe(once.address);
  });

  it('a refused take leaves the one-time wallet listed', async () => {
    const seller = await person();
    const offer = await postOffer(seller, { minFiatCents: '3000', maxFiatCents: '6000' });
    const buyer = await person();
    const once = await oneTimeWallet(buyer.id);
    expect(refusal(await take(buyer, offer, body(buyer, XMR / 5n, undefined, { walletId: once.id })))).toEqual({ status: 409, error: 'out-of-range' });
    expect(await listed(buyer)).toContain(once.id);
  });

  it("the poster's one-time wallet is used up by the poster's wallet route", async () => {
    const poster = await person();
    const taker = await person();
    const offer = await postOffer(poster, { side: 'sell' });
    const code = await taken(taker, offer, body(taker, tenth));
    const once = await oneTimeWallet(poster.id);
    const res = await poster.browser.post(`/v1/trades/${code}/wallet`, { walletId: once.id });
    expect(res.statusCode, res.body).toBe(204);
    expect((await loadTradeRow(deps.db, code))!.seller_refund).toBe(once.address);
    expect(await listed(poster)).not.toContain(once.id);
  });

  it('a saved wallet stays listed after a take', async () => {
    const seller = await person();
    const offer = await postOffer(seller);
    const buyer = await person();
    await taken(buyer, offer, body(buyer, tenth));
    expect(await listed(buyer)).toContain(buyer.wallet);
  });

  it("a weak account's new address cannot reach a trade: staged, waiting, foreign or sent as an address, the take is refused", async () => {
    const seller = await person();
    const offer = await postOffer(seller);
    const weak = await person();
    // A username-and-password login (weak account): an add from it is staged (202), so there is no wallet row to use.
    await deps.db.query(`update sessions set strength = 'weak-single' where account_id = $1`, [weak.id]);
    const sessionId = (await deps.db.query<{ id: string }>('select id from sessions where account_id = $1 and revoked_at is null', [weak.id])).rows[0]!.id;
    const fresh = fakeAddress();
    const confirmToken = await issueConfirmToken(deps, {
      sessionId, accountId: weak.id, method: 'password',
      action: { kind: 'add-wallet', addressHash: await addressHash(fresh), addressEnd: addressEnd(fresh) },
    });
    const staged = await weak.browser.post('/v1/wallets', { app: 'cake', label: 'New', address: fresh, confirmToken, oneTime: true });
    expect(staged.statusCode, staged.body).toBe(202);
    const { rows: rowsOfFresh } = await deps.db.query('select 1 from wallets where address = $1', [fresh]);
    expect(rowsOfFresh).toEqual([]);
    expect(refusal(await take(weak, offer, { ...body(weak, tenth), address: fresh }))).toEqual({ status: 400, error: 'bad-request' });
    const waiting = await addWallet(weak.id, false);
    expect(refusal(await take(weak, offer, body(weak, tenth, undefined, { walletId: waiting.id })))).toEqual({ status: 409, error: 'wallet-not-ready' });
    // The take names a wallet, never an address: an address in the body is refused.
    expect(refusal(await take(weak, offer, { ...body(weak, tenth), address: fakeAddress() }))).toEqual({ status: 400, error: 'bad-request' });
    expect(refusal(await take(weak, offer, { ...body(weak, tenth), walletId: undefined, address: fakeAddress() }))).toEqual({ status: 400, error: 'bad-request' });
    // A wallet of another account is not this account's to use.
    expect(refusal(await take(weak, offer, body(weak, tenth, undefined, { walletId: seller.wallet })))).toEqual({ status: 409, error: 'wallet-not-ready' });
    // Its own usable wallet works as before.
    await taken(weak, offer, body(weak, tenth));
  });
});

/**
 * Review of wip/third-trade-wallet, M2 (claude3, 17 Nov 2026): the use-up of a one-time wallet under
 * races and rollbacks. It runs in the trade's own transaction under the account lock, so exactly one
 * trade gets the address, and a trade that does not commit leaves the wallet open.
 */
describe('one-time wallets under races and rollbacks (review M2)', () => {
  async function oneTimeWallet(accountId: string): Promise<{ id: string; address: string }> {
    const w = await addWallet(accountId);
    await deps.db.query('update wallets set one_time = true where id = $1', [w.id]);
    return w;
  }
  const open = async (id: string) => (await deps.db.query('select 1 from wallets where id = $1 and removed_at is null', [id])).rows.length === 1;
  const tradesPayingTo = async (address: string) =>
    (await deps.db.query('select code from trades where buyer_payout = $1 or seller_refund = $1', [address])).rows.length;

  it('two takes at once with the same one-time wallet: one trade, the other wallet-not-ready', async () => {
    const seller = await person();
    const first = await postOffer(seller);
    const second = await postOffer(seller);
    const buyer = await person();
    const once = await oneTimeWallet(buyer.id);
    const results = await allAtOnce([`select 1 from accounts where id = '${buyer.id}' for update`], 2, () => [
      take(buyer, first, body(buyer, tenth, undefined, { walletId: once.id })),
      take(buyer, second, body(buyer, tenth, undefined, { walletId: once.id })),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(refusal(results.find((r) => r.statusCode === 409)!)).toEqual({ status: 409, error: 'wallet-not-ready' });
    expect(await tradesPayingTo(once.address)).toBe(1);
    expect(await open(once.id)).toBe(false);
  });

  it("a take and the poster's wallet route at once with the same one-time wallet: one uses it, the other is refused", async () => {
    const poster = await person();
    const taker = await person();
    const code = await taken(taker, await postOffer(poster, { side: 'sell' }), body(taker, tenth));
    const other = await person();
    const offer = await postOffer(other);
    const once = await oneTimeWallet(poster.id);
    const results = await allAtOnce([`select 1 from accounts where id = '${poster.id}' for update`], 2, () => [
      take(poster, offer, body(poster, tenth, undefined, { walletId: once.id })),
      poster.browser.post(`/v1/trades/${code}/wallet`, { walletId: once.id }),
    ]);
    const statuses = results.map((r) => r.statusCode);
    expect(statuses.filter((s) => s === 200 || s === 204)).toHaveLength(1);
    const lost = results.find((r) => r.statusCode === 409)!;
    expect(refusal(lost)).toEqual({ status: 409, error: 'wallet-not-ready' });
    expect(await tradesPayingTo(once.address)).toBe(1);
    expect(await open(once.id)).toBe(false);
  });

  it('a take that fails at commit, after the use-up, leaves the one-time wallet open', async () => {
    const seller = await person();
    const offer = await postOffer(seller);
    const buyer = await person();
    const once = await oneTimeWallet(buyer.id);
    // A deferred constraint trigger fails this buyer's trade insert at commit, after the take's use-up ran.
    await deps.db.query(`create function x2f_test_fail_commit() returns trigger language plpgsql as $$
      begin if new.buyer_account_id = '${buyer.id}' then raise exception 'test: fail at commit'; end if; return null; end $$`);
    await deps.db.query(`create constraint trigger x2f_test_fail_commit after insert on trades deferrable initially deferred
      for each row execute function x2f_test_fail_commit()`);
    try {
      const res = await take(buyer, offer, body(buyer, tenth, undefined, { walletId: once.id }));
      expect(res.statusCode).toBe(500);
    } finally {
      await deps.db.query('drop trigger x2f_test_fail_commit on trades');
      await deps.db.query('drop function x2f_test_fail_commit()');
    }
    expect(await open(once.id)).toBe(true);
    expect(await tradesPayingTo(once.address)).toBe(0);
    await taken(buyer, offer, body(buyer, tenth, undefined, { walletId: once.id }));
    expect(await open(once.id)).toBe(false);
  });

  it("a refused poster's wallet route leaves the one-time wallet listed", async () => {
    const poster = await person();
    const taker = await person();
    const code = await taken(taker, await postOffer(poster, { side: 'sell' }), body(taker, tenth));
    expect((await poster.browser.post(`/v1/trades/${code}/wallet`, { walletId: poster.wallet })).statusCode).toBe(204);
    const once = await oneTimeWallet(poster.id);
    expect(refusal(await poster.browser.post(`/v1/trades/${code}/wallet`, { walletId: once.id }))).toEqual({ status: 409, error: 'wrong-state' });
    expect(await open(once.id)).toBe(true);
  });
});

/**
 * Owner, 17 Nov 2026 (note #6 Q10): "Monero wallets can be used over and over again ... they have the
 * option of reusing the wallet over again, but by no means do they have to." A one-time wallet used up
 * by a trade that ends in `setup` (cancelled, walked away from, or expired) before any XMR was funded
 * is open again (still one-time), in the cancel's own transaction. Never once the trade got past setup.
 */
describe('a one-time wallet comes back when its trade ends in setup (owner, Q10)', () => {
  async function oneTimeWallet(accountId: string): Promise<{ id: string; address: string }> {
    const w = await addWallet(accountId);
    await deps.db.query('update wallets set one_time = true where id = $1', [w.id]);
    return w;
  }
  const isOpen = async (id: string) => (await deps.db.query('select 1 from wallets where id = $1 and removed_at is null', [id])).rows.length === 1;
  const event = (who: Who, code: string, type: string) => who.browser.post(`/v1/trades/${code}/events`, { type });

  /** A buyer taking a sell ad with a one-time wallet: the trade waits in setup for the poster. */
  async function takenWithOnce() {
    const seller = await person();
    const offer = await postOffer(seller);
    const buyer = await person();
    const once = await oneTimeWallet(buyer.id);
    const code = await taken(buyer, offer, body(buyer, tenth, undefined, { walletId: once.id }));
    expect(await isOpen(once.id)).toBe(false);
    return { seller, buyer, once, code, offer };
  }

  it("the buyer's cancel in setup restores it, still one-time and usable once more", async () => {
    const { seller, buyer, once, code } = await takenWithOnce();
    const res = await event(buyer, code, 'buyer-cancel');
    expect(res.statusCode, res.body).toBe(200);
    expect((await loadTradeRow(deps.db, code))!.state).toBe('cancelled');
    expect(await isOpen(once.id)).toBe(true);
    const { rows } = await deps.db.query<{ one_time: boolean; address: string }>('select one_time, address from wallets where id = $1', [once.id]);
    expect(rows[0]).toEqual({ one_time: true, address: once.address });
    // Used once more by a new trade, and gone again.
    const again = await postOffer(seller);
    await taken(buyer, again, body(buyer, tenth, undefined, { walletId: once.id }));
    expect(await isOpen(once.id)).toBe(false);
  });

  it("the seller walking away in setup restores the buyer's one-time wallet", async () => {
    const { seller, once, code } = await takenWithOnce();
    expect((await event(seller, code, 'walk-away')).statusCode).toBe(200);
    expect(await isOpen(once.id)).toBe(true);
  });

  it('expiry in setup (setup_by passed) restores it', async () => {
    const { once, code } = await takenWithOnce();
    const row = (await loadTradeRow(deps.db, code))!;
    const after = new Date(row.setup_by!.getTime() + 1000);
    const t = await applyEvent({ db: deps.db, clock: () => after }, code, { type: 'tick' }, 'system');
    expect(t.state).toBe('cancelled');
    expect(await isOpen(once.id)).toBe(true);
  });

  it("the poster's one-time refund wallet comes back too", async () => {
    const poster = await person();
    const taker = await person();
    const code = await taken(taker, await postOffer(poster, { side: 'sell' }), body(taker, tenth));
    const once = await oneTimeWallet(poster.id);
    expect((await poster.browser.post(`/v1/trades/${code}/wallet`, { walletId: once.id })).statusCode).toBe(204);
    expect(await isOpen(once.id)).toBe(false);
    expect((await event(poster, code, 'walk-away')).statusCode).toBe(200);
    expect(await isOpen(once.id)).toBe(true);
  });

  it('a trade past setup (funding, then cancelled with nothing funded) does not restore it', async () => {
    const { buyer, once, code } = await takenWithOnce();
    await deps.db.query('update trades set seller_refund = $2, seller_wallet_app = $3 where code = $1', [code, fakeAddress(), 'cake']);
    await applyEvent(deps, code, { type: 'setup-done', escrowAddress: fakeAddress() }, 'system');
    expect((await loadTradeRow(deps.db, code))!.state).toBe('funding');
    expect((await event(buyer, code, 'buyer-cancel')).statusCode).toBe(200);
    expect((await loadTradeRow(deps.db, code))!.state).toBe('cancelled');
    expect(await isOpen(once.id)).toBe(false);
  });

  it('a funded trade does not restore it', async () => {
    const { once, code } = await takenWithOnce();
    await deps.db.query('update trades set seller_refund = $2, seller_wallet_app = $3 where code = $1', [code, fakeAddress(), 'cake']);
    await applyEvent(deps, code, { type: 'setup-done', escrowAddress: fakeAddress() }, 'system');
    const t = rowToTrade((await loadTradeRow(deps.db, code))!);
    await applyEvent(deps, code, { type: 'chain', receivedAtomic: t.sellerFundsAtomic, unlockedAtomic: 0n, confirmations: 1 }, 'system');
    expect(await isOpen(once.id)).toBe(false);
  });

  it('a removal of the wallet that applied while the trade used it wins: no restore', async () => {
    const { buyer, once, code } = await takenWithOnce();
    // A removal staged before the take, applied by the hold while the trade had it.
    const { applyWalletRemoval } = await import('../src/wallets/routes.js');
    await applyWalletRemoval(deps.db, buyer.id, once.id, deps.clock());
    expect((await event(buyer, code, 'buyer-cancel')).statusCode).toBe(200);
    expect(await isOpen(once.id)).toBe(false);
  });

  it('the same address added again meanwhile: the old row stays removed (no duplicate)', async () => {
    const { buyer, once, code } = await takenWithOnce();
    await deps.db.query(
      `insert into wallets (account_id, app, label, address, created_at, usable_from) values ($1, 'cake', 'Again', $2, $3, $3)`,
      [buyer.id, once.address, deps.clock()],
    );
    expect((await event(buyer, code, 'buyer-cancel')).statusCode).toBe(200);
    expect(await isOpen(once.id)).toBe(false);
    const { rows } = await deps.db.query('select 1 from wallets where account_id = $1 and address = $2 and removed_at is null', [buyer.id, once.address]);
    expect(rows).toHaveLength(1);
  });

  // Review of wip/third-trade-wallet 17 Nov (b), M1: a used-up one-time wallet is visible while its
  // trade is in setup, can be removed then (for good: it does not come back), and its return is told.
  type Listed = { id: string; usable: boolean; inUseByTrade: string | null };
  const listAll = async (who: Who) => (await who.browser.get('/v1/wallets')).json() as Listed[];
  const alertsOf = async (id: string, kind: string) =>
    (await deps.db.query<{ detail: unknown }>('select detail from alerts where account_id = $1 and kind = $2 order by created_at', [id, kind])).rows.map((r) => r.detail);

  it('M1: while its trade is in setup the used-up wallet is listed as in use by that trade, not usable', async () => {
    const { buyer, once, code } = await takenWithOnce();
    const entry = (await listAll(buyer)).find((w) => w.id === once.id);
    expect(entry).toMatchObject({ usable: false, inUseByTrade: code, isDefault: false });
    // Still not usable for a take.
    const seller2 = await person();
    expect(refusal(await take(buyer, await postOffer(seller2), body(buyer, tenth, undefined, { walletId: once.id })))).toEqual({ status: 409, error: 'wallet-not-ready' });
    // Once the trade is past setup it leaves the list.
    await deps.db.query('update trades set seller_refund = $2, seller_wallet_app = $3 where code = $1', [code, fakeAddress(), 'cake']);
    await applyEvent(deps, code, { type: 'setup-done', escrowAddress: fakeAddress() }, 'system');
    expect((await listAll(buyer)).map((w) => w.id)).not.toContain(once.id);
  });

  it('M1: the owner can remove it while its trade is in setup; it then never comes back, and the removal is told', async () => {
    const { seller, buyer, once, code } = await takenWithOnce();
    const res = await buyer.browser.delete(`/v1/wallets/${once.id}`);
    expect(res.statusCode, res.body).toBe(204);
    expect((await listAll(buyer)).map((w) => w.id)).not.toContain(once.id);
    expect(await alertsOf(buyer.id, 'wallet-removed')).toEqual([{ app: 'feather', label: 'Main', addressEnd: addressEnd(once.address) }]);
    expect((await event(seller, code, 'walk-away')).statusCode).toBe(200);
    expect(await isOpen(once.id)).toBe(false);
    expect(await alertsOf(buyer.id, 'wallet-restored')).toEqual([]);
    // Removed already: a second removal is 404.
    expect((await buyer.browser.delete(`/v1/wallets/${once.id}`)).statusCode).toBe(404);
  });

  it('M1: a wallet given back writes one wallet-restored alert with the end of the address only', async () => {
    const { seller, buyer, once, code } = await takenWithOnce();
    expect((await event(seller, code, 'walk-away')).statusCode).toBe(200);
    expect(await isOpen(once.id)).toBe(true);
    const alerts = await alertsOf(buyer.id, 'wallet-restored');
    expect(alerts).toEqual([{ app: 'feather', label: 'Main', addressEnd: addressEnd(once.address) }]);
    expect(JSON.stringify(alerts)).not.toContain(once.address);
    expect(await alertsOf(seller.id, 'wallet-restored')).toEqual([]);
  });

  // Review of wip/third-trade-wallet 17 Nov (b), B2: the poster's cancel gives back the taker's
  // one-time wallet (so it locks the taker's account) while the taker takes another of the poster's
  // offers (which locks [taker, poster] in id order). With the taker's id the lower, the cancel used
  // to hold the poster and wait for the taker while the take held the taker and waited for the
  // poster: a deadlock, one side 500. `applyEvent` now locks both parties in id order right after
  // the trade row, so the take simply waits. Lined up the same way each run: the cancel is stopped
  // at its trade_events write (holding what it holds by then), the take is fired and stopped at the
  // account lock it cannot get, then both go. Run several times: no run may give a 500.
  it('B2: the poster walks away (restoring the taker\'s one-time wallet) while the taker takes another offer: no deadlock, both answer 200', async () => {
    const lockWaiters = async (holderPid: number) =>
      (await deps.db.query<{ n: number }>(
        `select count(*)::int as n from pg_stat_activity
          where datname = current_database() and pid <> $1 and wait_event_type = 'Lock' and state = 'active'`,
        [holderPid],
      )).rows[0]!.n;
    const untilWaiters = async (holderPid: number, n: number) => {
      const deadline = Date.now() + 10_000;
      while ((await lockWaiters(holderPid)) < n) {
        if (Date.now() > deadline) throw new Error(`fewer than ${n} requests reached a lock`);
        await new Promise((r) => setTimeout(r, 10));
      }
    };
    for (let run = 0; run < 5; run++) {
      const a = await person();
      const c = await person();
      // The case that deadlocked: the taker (wallet owner) sorts before the poster (canceller).
      const [buyer, seller] = a.id < c.id ? [a, c] : [c, a];
      const offer = await postOffer(seller);
      const once = await oneTimeWallet(buyer.id);
      const code = await taken(buyer, offer, body(buyer, tenth, undefined, { walletId: once.id }));
      const second = await postOffer(seller);
      const holder = await deps.db.connect();
      let results: Array<{ statusCode: number; body: string }>;
      try {
        await holder.query('begin');
        await holder.query('lock table trade_events in share mode');
        const pid = (await holder.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!.pid;
        const cancel = event(seller, code, 'walk-away');
        await untilWaiters(pid, 1);
        const took = take(buyer, second, body(buyer, tenth));
        await untilWaiters(pid, 2);
        await holder.query('commit');
        results = await Promise.all([cancel, took]);
      } catch (e) {
        await holder.query('rollback').catch(() => {});
        throw e;
      } finally {
        holder.release();
      }
      expect(results.map((r) => `${r.statusCode} ${r.statusCode === 200 ? '' : r.body}`), `run ${run}`).toEqual(['200 ', '200 ']);
      expect((await loadTradeRow(deps.db, code))!.state).toBe('cancelled');
      expect(await isOpen(once.id)).toBe(true);
      const { rows } = await deps.db.query('select 1 from trades where buyer_account_id = $1 and seller_account_id = $2 and closed_at is null', [buyer.id, seller.id]);
      expect(rows).toHaveLength(1);
    }
  });

  it("a cancel and a new take with the same wallet at once: never two open trades on it, never a lost wallet", async () => {
    const { seller, buyer, once, code } = await takenWithOnce();
    const again = await postOffer(seller);
    const results = await allAtOnce([`select 1 from accounts where id = '${buyer.id}' for update`], 2, () => [
      event(buyer, code, 'buyer-cancel'),
      take(buyer, again, body(buyer, tenth, undefined, { walletId: once.id })),
    ]);
    expect(results[0]!.statusCode).toBe(200);
    const open = await isOpen(once.id);
    const { rows } = await deps.db.query<{ code: string }>(
      'select code from trades where buyer_payout = $1 and closed_at is null', [once.address],
    );
    if (results[1]!.statusCode === 200) {
      // The take came after the restore: it used the wallet up again.
      expect(rows).toHaveLength(1);
      expect(open).toBe(false);
    } else {
      // The take came first and found it used up; the cancel then gave it back.
      expect(refusal(results[1]!)).toEqual({ status: 409, error: 'wallet-not-ready' });
      expect(rows).toHaveLength(0);
      expect(open).toBe(true);
    }
  });
});

// Lien recovery (owner 16 Nov 2026, docs/lien-recovery.md): a buyer who owes a lien keeps trading
// and part of each trade's proceeds is reserved at take for the creditor (signed into the terms).
describe('lien recovery at take', () => {
  /**
   * A lien on `debtor`, owed to `creditor`. Q2 (provisional, 17 Nov): recoveries go only to the
   * address the creditor's device signed (`creditor_address`, set by the creditor's route: tested
   * below with a real signature); here written directly with a placeholder statement, the creditor's
   * wallet address unless `address` says otherwise (null: none signed yet).
   */
  async function lienOn(debtor: Who, creditor: { id: string; address?: string }, amountAtomic: bigint, over: { fee?: bigint; rate?: number; address?: string | null; fromCode?: string } = {}): Promise<string> {
    const address = over.address !== undefined ? over.address : (creditor.address ?? fakeAddress());
    const { rows } = await deps.db.query<{ id: string }>(
      `insert into liens (debtor_account_id, creditor_account_id, amount_atomic, fee_atomic, from_code, dispute_seq, round, cause, created_at, changed_at, recovery_rate_bps,
         creditor_address, creditor_address_statement, creditor_address_sig)
       values ($1, $2, $3, $4, coalesce($8, gen_random_uuid()::text), 1, 1, 'restitution', $5, $5, $6, $7::text,
         case when $7::text is null then null else '{}'::jsonb end, case when $7::text is null then null else repeat('0', 128) end) returning id::text`,
      // 5000 unless `rate` says otherwise: a lower rate a senior approved (the default is 100% since
      // migration 890), so these tests' figures stay readable halves.
      [debtor.id, creditor.id, amountAtomic.toString(), (over.fee ?? 0n).toString(), deps.clock(), over.rate ?? 5000, address, over.fromCode ?? null],
    );
    return rows[0]!.id;
  }
  const holds = async (code: string) =>
    (await deps.db.query<{ lien: string; amount: string; address: string | null; status: string }>(
      `select lien_id::text as lien, amount_atomic::text as amount, address, status from lien_recovery_holds where trade_code = $1`, [code],
    )).rows;
  /** Review B1: what the buyer's quote shows (`GET /v1/account/liens/preview`), as a string. */
  const preview = async (who: Who, offerId: string, b: Record<string, unknown>): Promise<string> => {
    const res = await who.browser.get(`/v1/account/liens/preview?offerId=${offerId}&amountAtomic=${String(b.amountAtomic)}&walletId=${String(b.walletId)}`);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { lienRecoveryAtomic: string }).lienRecoveryAtomic;
  };
  /** In this describe a take sends the figure its quote showed, as the web does (review B1). */
  const take = async (who: Who, offerId: string, b: Record<string, unknown>) =>
    who.browser.post(`/v1/offers/${offerId}/take`, { ...b, lienRecoveryAtomic: await preview(who, offerId, b) });
  const taken = async (who: Who, offerId: string, b: Record<string, unknown>): Promise<string> => {
    const res = await take(who, offerId, b);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { code: string }).code;
  };

  it('the buyer (taker) owes 2 XMR: 50% of their proceeds is reserved to the creditor\'s wallet and returned to them; logged', async () => {
    const seller = await person();
    const debtor = await person();
    const creditor = await person();
    const lien = await lienOn(debtor, creditor, 2n * XMR);
    const offer = await postOffer(seller);
    const res = await take(debtor, offer, body(debtor, XMR));
    expect(res.statusCode, res.body).toBe(200);
    const out = res.json() as { code: string; lienRecoveryAtomic?: string };
    expect(out.lienRecoveryAtomic).toBe((XMR / 2n).toString());
    expect(await holds(out.code)).toEqual([{ lien, amount: (XMR / 2n).toString(), address: creditor.address, status: 'open' }]);
    const log = await deps.db.query<{ action: string; detail: string }>(`select action, detail from activity_log where trade_code = $1 and action like 'lien.%'`, [out.code]);
    expect(log.rows.map((r) => [r.action, JSON.parse(r.detail)])).toEqual([['lien.recovery-reserved', { lienId: lien, amountAtomic: (XMR / 2n).toString() }]]);
    // The buyer's trade view carries it; the seller's never does.
    expect(((await debtor.browser.get(`/v1/trades/${out.code}`)).json() as { lienRecoveryAtomic?: string }).lienRecoveryAtomic).toBe((XMR / 2n).toString());
    expect((await seller.browser.get(`/v1/trades/${out.code}`)).json()).not.toHaveProperty('lienRecoveryAtomic');
  });

  // Owner 26 Nov 2026 (lien grace; review of feat/lien-grace): a lien in its 7 days to pay the agreed
  // way, or ended as paid off the platform, reserves nothing at take; once switched to collecting it does.
  it('grace: nothing is reserved at take while the lien waits for payment the agreed way; after the switch it is', async () => {
    const debtor = await person();
    const creditor = await person();
    const lien = await lienOn(debtor, creditor, 2n * XMR);
    await deps.db.query(`update liens set grace_method = 'PayPal again', grace_until = $2 where id = $1`, [lien, new Date(deps.clock().getTime() + 7 * 86_400_000)]);
    const during = await take(debtor, await postOffer(await person()), body(debtor, XMR));
    expect(during.statusCode, during.body).toBe(200);
    const d = during.json() as { code: string; lienRecoveryAtomic?: string };
    expect(d.lienRecoveryAtomic).toBeUndefined();
    expect(await holds(d.code)).toEqual([]);
    await deps.db.query('update liens set collect_started_at = $2 where id = $1', [lien, deps.clock()]);
    const after = (await take(debtor, await postOffer(await person()), body(debtor, XMR))).json() as { code: string; lienRecoveryAtomic?: string };
    expect(after.lienRecoveryAtomic).toBe((XMR / 2n).toString());
    expect(await holds(after.code)).toEqual([{ lien, amount: (XMR / 2n).toString(), address: creditor.address, status: 'open' }]);
    // Ended as paid off the platform (the lien carries a fee, so it stays active): nothing more.
    const debtor2 = await person();
    const other = await lienOn(debtor2, creditor, 2n * XMR, { fee: 1n });
    await deps.db.query('update liens set repaid_off_platform_at = $2 where id = $1', [other, deps.clock()]);
    const none = await take(debtor2, await postOffer(await person()), body(debtor2, XMR));
    expect(none.statusCode, none.body).toBe(200);
    expect((none.json() as { lienRecoveryAtomic?: string }).lienRecoveryAtomic).toBeUndefined();
    expect(await holds((none.json() as { code: string }).code)).toEqual([]);
  });

  it('partial: a second trade in progress reserves only what is not already reserved; nothing past the amount', async () => {
    const seller = await person();
    const debtor = await person();
    const creditor = await person();
    await lienOn(debtor, creditor, (3n * XMR) / 4n);
    const offer = await postOffer(seller);
    const offer2 = await postOffer(await person());
    const offer3 = await postOffer(await person());
    const a = (await take(debtor, offer, body(debtor, XMR))).json() as { code: string; lienRecoveryAtomic?: string };
    const rb = await take(debtor, offer2, body(debtor, XMR));
    expect(rb.statusCode, rb.body).toBe(200);
    const b = rb.json() as { code: string; lienRecoveryAtomic?: string };
    expect([a.lienRecoveryAtomic, b.lienRecoveryAtomic]).toEqual([(XMR / 2n).toString(), (XMR / 4n).toString()]);
    const rc = await take(debtor, offer3, body(debtor, XMR));
    expect(rc.statusCode, rc.body).toBe(200);
    expect((rc.json() as { lienRecoveryAtomic?: string }).lienRecoveryAtomic).toBeUndefined();
  });

  it('nothing is reserved when the lien has no creditor address, the creditor is the seller, or liens are off', async () => {
    const seller = await person();
    const debtor = await person();
    const creditor = await person();
    await lienOn(debtor, creditor, XMR, { address: null });
    const offer = await postOffer(seller);
    expect(((await take(debtor, offer, body(debtor, XMR))).json() as { lienRecoveryAtomic?: string }).lienRecoveryAtomic).toBeUndefined();

    const debtor2 = await person();
    await lienOn(debtor2, seller, XMR);
    expect(((await take(debtor2, offer, body(debtor2, XMR))).json() as { lienRecoveryAtomic?: string }).lienRecoveryAtomic).toBeUndefined();

    const debtor3 = await person();
    const creditor3 = await person();
    await lienOn(debtor3, creditor3, XMR);
    await deps.db.query('update site_flags set liens_enabled = false');
    try {
      expect(((await take(debtor3, offer, body(debtor3, XMR))).json() as { lienRecoveryAtomic?: string }).lienRecoveryAtomic).toBeUndefined();
    } finally {
      await deps.db.query('update site_flags set liens_enabled = true');
    }
  });

  // Owner 27 Nov 2026, option (a) of docs/lien-recovery.md "Debtor is the seller": "Extra XMR on
  // each sale: they keep selling, but each sale's escrow must also hold the lien payment, which goes
  // to the person owed until it's paid off." The seller funds amount + fee + the extra; the extra is
  // min(take × rate, left), nothing under 0.01 XMR; a completed trade pays it to the creditor and
  // records it, every refund returns it and releases the hold.
  describe('seller debtor (owner 27 Nov 2026)', () => {
    const sideHolds = async (code: string) =>
      (await deps.db.query<{ lien: string; side: string; amount: string; status: string }>(
        `select lien_id::text as lien, debtor_side as side, amount_atomic::text as amount, status from lien_recovery_holds where trade_code = $1 order by debtor_side`, [code],
      )).rows;
    const tradeOf = async (code: string) => rowToTrade((await loadTradeRow(deps.db, code))!);
    const recovered = async (lien: string) =>
      (await deps.db.query<{ a: string }>('select coalesce(sum(amount_atomic), 0)::text as a from lien_recoveries where lien_id = $1', [lien])).rows[0]!.a;
    const sellerPreview = async (who: Who, offerId: string, b: Record<string, unknown>): Promise<string> => {
      const res = await who.browser.get(`/v1/account/liens/preview?offerId=${offerId}&amountAtomic=${String(b.amountAtomic)}&walletId=${String(b.walletId)}`);
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { sellerLienRecoveryAtomic?: string }).sellerLienRecoveryAtomic ?? 'none';
    };
    /** A seller who posts: the buyer takes; the seller accepts the figure on the sheet and sets up with it. */
    const sellerPosts = async (debtor: Who, buyer: Who, amount = XMR) => {
      const code = await taken(buyer, await postOffer(debtor), body(buyer, amount));
      const view = (await debtor.browser.get(`/v1/trades/${code}`)).json() as { sellerLienRecoveryAtomic?: string };
      const set = await debtor.browser.post(`/v1/trades/${code}/wallet`, { walletId: debtor.wallet, ...(view.sellerLienRecoveryAtomic !== undefined ? { sellerLienRecoveryAtomic: view.sellerLienRecoveryAtomic } : {}) });
      expect(set.statusCode, set.body).toBe(204);
      return code;
    };

    it('a posting seller: the extra is held (side seller), is part of what the escrow must hold, and only the seller sees it', async () => {
      const debtor = await person();
      const creditor = await person();
      const buyer = await person();
      const lien = await lienOn(debtor, creditor, 2n * XMR);
      const offer = await postOffer(debtor);
      // The buyer's quote never shows the seller's lien: nothing of it for the buyer.
      expect(await preview(buyer, offer, body(buyer, XMR))).toBe('0');
      const code = await taken(buyer, offer, body(buyer, XMR));
      // 50% (these tests' rate) of the earnings (the trade amount), within what is owed.
      expect(await sideHolds(code)).toEqual([{ lien, side: 'seller', amount: (XMR / 2n).toString(), status: 'open' }]);
      const t = await tradeOf(code);
      const plan = escrowPlan({ amountAtomic: XMR, poster: 'seller' });
      expect(t.sellerLienRecoveryAtomic).toBe(XMR / 2n);
      expect(t.sellerFundsAtomic).toBe(plan.sellerFundsAtomic + XMR / 2n);
      expect(t.amountAtomic).toBe(XMR);
      const sv = (await debtor.browser.get(`/v1/trades/${code}`)).json() as { sellerLienRecoveryAtomic?: string; lienRecoveryAtomic?: string };
      expect(sv.sellerLienRecoveryAtomic).toBe((XMR / 2n).toString());
      expect(sv).not.toHaveProperty('lienRecoveryAtomic');
      const bv = (await buyer.browser.get(`/v1/trades/${code}`)).json() as Record<string, unknown>;
      expect(bv).not.toHaveProperty('sellerLienRecoveryAtomic');
      expect(bv).not.toHaveProperty('lienRecoveryAtomic');
      expect(bv.funding).toBeNull();
      // Review item 2: what the escrow received, as the buyer sees it, leaves out the seller's extra.
      await deps.db.query(`update trades set received_atomic = $2 where code = $1`, [code, (plan.sellerFundsAtomic + XMR / 2n).toString()]);
      expect(((await buyer.browser.get(`/v1/trades/${code}`)).json() as { receivedAtomic: string }).receivedAtomic).toBe(plan.sellerFundsAtomic.toString());
      expect(((await debtor.browser.get(`/v1/trades/${code}`)).json() as { receivedAtomic: string }).receivedAtomic).toBe((plan.sellerFundsAtomic + XMR / 2n).toString());
      await deps.db.query(`update trades set received_atomic = $2 where code = $1`, [code, (XMR / 4n).toString()]);
      expect(((await buyer.browser.get(`/v1/trades/${code}`)).json() as { receivedAtomic: string }).receivedAtomic).toBe('0');
      await deps.db.query(`update trades set received_atomic = 0 where code = $1`, [code]);
      const log = await deps.db.query<{ action: string; detail: string }>(`select action, detail from activity_log where trade_code = $1 and action like 'lien.%'`, [code]);
      expect(log.rows.map((r) => [r.action, JSON.parse(r.detail)])).toEqual([['lien.recovery-reserved', { lienId: lien, amountAtomic: (XMR / 2n).toString(), side: 'seller' }]]);
      // Set-up carries the accepted figure: none, or another one, is 409 and nothing is set.
      for (const shown of [undefined, '0', (XMR / 2n - 1n).toString()]) {
        const res = await debtor.browser.post(`/v1/trades/${code}/wallet`, { walletId: debtor.wallet, ...(shown === undefined ? {} : { sellerLienRecoveryAtomic: shown }) });
        expect(res.statusCode, res.body).toBe(409);
        expect(res.json()).toMatchObject({ error: 'lien-recovery-changed' });
      }
      expect((await loadTradeRow(deps.db, code))!.seller_refund).toBeNull();
      expect((await debtor.browser.post(`/v1/trades/${code}/wallet`, { walletId: debtor.wallet, sellerLienRecoveryAtomic: (XMR / 2n).toString() })).statusCode).toBe(204);
      // Once set up the seller's view funds amount + fee + extra.
      const funding = ((await debtor.browser.get(`/v1/trades/${code}`)).json() as { funding: { sellerFundsAtomic: string } }).funding;
      expect(funding.sellerFundsAtomic).toBe((plan.sellerFundsAtomic + XMR / 2n).toString());
    });

    it('a taking seller: the quote shows the extra, the take refuses another figure (409) and answers with it; a buy ad funds amount + extra', async () => {
      const debtor = await person();
      const creditor = await person();
      const poster = await person();
      await lienOn(debtor, creditor, 2n * XMR);
      const offer = await postOffer(poster, { side: 'buy' });
      const b = body(debtor, XMR);
      expect(await sellerPreview(debtor, offer, b)).toBe((XMR / 2n).toString());
      for (const shown of [undefined, '0', (XMR / 2n + 1n).toString()]) {
        const res = await debtor.browser.post(`/v1/offers/${offer}/take`, { ...b, ...(shown === undefined ? {} : { sellerLienRecoveryAtomic: shown }) });
        expect(res.statusCode, res.body).toBe(409);
        expect(res.json()).toMatchObject({ error: 'lien-recovery-changed' });
      }
      expect((await deps.db.query('select count(*)::int as n from trades where seller_account_id = $1 and state = $2', [debtor.id, 'setup'])).rows[0]).toEqual({ n: 0 });
      const ok = await debtor.browser.post(`/v1/offers/${offer}/take`, { ...b, sellerLienRecoveryAtomic: (XMR / 2n).toString() });
      expect(ok.statusCode, ok.body).toBe(200);
      const out = ok.json() as { code: string; sellerLienRecoveryAtomic?: string; lienRecoveryAtomic?: string };
      expect(out.sellerLienRecoveryAtomic).toBe((XMR / 2n).toString());
      expect(out).not.toHaveProperty('lienRecoveryAtomic');
      expect((await tradeOf(out.code)).sellerFundsAtomic).toBe(XMR + XMR / 2n);
      // The poster (the buyer) sets up without any figure; one that is not 0 is refused.
      expect((await poster.browser.post(`/v1/trades/${out.code}/wallet`, { walletId: poster.wallet, sellerLienRecoveryAtomic: '5' })).statusCode).toBe(400);
      expect((await poster.browser.post(`/v1/trades/${out.code}/wallet`, { walletId: poster.wallet })).statusCode).toBe(204);
      // A seller with no lien previews '0' and takes with '0' or nothing.
      const clean = await person();
      const offer2 = await postOffer(await person(), { side: 'buy' });
      expect(await sellerPreview(clean, offer2, body(clean, XMR))).toBe('0');
      const plain = await clean.browser.post(`/v1/offers/${offer2}/take`, { ...body(clean, XMR), sellerLienRecoveryAtomic: '0' });
      expect(plain.statusCode, plain.body).toBe(200);
    });

    // Owner 26 Nov 2026 (lien grace; coordinator, after #43): a selling debtor whose lien waits in its
    // 7 days to pay the agreed way, or was paid off the platform, funds no extra; after the switch it does.
    it('grace: a selling debtor whose lien is in grace reserves no extra and funds only amount + fee; after the switch the extra is back', async () => {
      const debtor = await person();
      const creditor = await person();
      const lien = await lienOn(debtor, creditor, 2n * XMR);
      await deps.db.query(`update liens set grace_method = 'PayPal again', grace_until = $2 where id = $1`, [lien, new Date(deps.clock().getTime() + 7 * 86_400_000)]);
      const plan = escrowPlan({ amountAtomic: XMR, poster: 'seller' });
      const during = await sellerPosts(debtor, await person());
      expect(await sideHolds(during)).toEqual([]);
      const t = await tradeOf(during);
      expect(t.sellerLienRecoveryAtomic ?? 0n).toBe(0n);
      expect(t.sellerFundsAtomic).toBe(plan.sellerFundsAtomic);
      await deps.db.query('update liens set collect_started_at = $2 where id = $1', [lien, deps.clock()]);
      const after = await sellerPosts(debtor, await person());
      expect(await sideHolds(after)).toEqual([{ lien, side: 'seller', amount: (XMR / 2n).toString(), status: 'open' }]);
      expect((await tradeOf(after)).sellerFundsAtomic).toBe(plan.sellerFundsAtomic + XMR / 2n);
      // Paid off the platform (a lien with a fee stays active): no extra again.
      const debtor2 = await person();
      const other = await lienOn(debtor2, creditor, 2n * XMR, { fee: 1n });
      await deps.db.query('update liens set repaid_off_platform_at = $2 where id = $1', [other, deps.clock()]);
      const off = await sellerPosts(debtor2, await person());
      expect(await sideHolds(off)).toEqual([]);
      expect((await tradeOf(off)).sellerFundsAtomic).toBe(plan.sellerFundsAtomic);
    });

    it('at the 100% default the extra is the whole trade amount, capped by what is still owed; under 0.01 XMR nothing (carried forward)', async () => {
      const debtor = await person();
      const creditor = await person();
      const lien = await lienOn(debtor, creditor, 3n * XMR, { rate: LIEN_RECOVERY_MAX_BPS });
      const code = await sellerPosts(debtor, await person());
      expect(await sideHolds(code)).toEqual([{ lien, side: 'seller', amount: XMR.toString(), status: 'open' }]);
      const debtor2 = await person();
      await lienOn(debtor2, creditor, XMR / 4n, { rate: LIEN_RECOVERY_MAX_BPS });
      expect((await sideHolds(await sellerPosts(debtor2, await person())))[0]!.amount).toBe((XMR / 4n).toString());
      const debtor3 = await person();
      await lienOn(debtor3, creditor, 9_999_999_999n, { rate: LIEN_RECOVERY_MAX_BPS });
      const code3 = await sellerPosts(debtor3, await person());
      expect(await sideHolds(code3)).toEqual([]);
      expect((await tradeOf(code3)).sellerFundsAtomic).toBe(escrowPlan({ amountAtomic: XMR, poster: 'seller' }).sellerFundsAtomic);
    });

    it('funding: amount + fee alone does not secure the trade; the extra does; growth never counts it', async () => {
      const debtor = await person();
      const creditor = await person();
      await lienOn(debtor, creditor, 2n * XMR);
      const code = await sellerPosts(debtor, await person());
      const plan = escrowPlan({ amountAtomic: XMR, poster: 'seller' });
      await applyEvent(deps, code, { type: 'setup-done', escrowAddress: fakeAddress() }, 'system');
      const short = await applyEvent(deps, code, { type: 'chain', receivedAtomic: plan.sellerFundsAtomic, unlockedAtomic: plan.sellerFundsAtomic, confirmations: 10 }, 'system');
      expect(short.state).toBe('funding');
      expect(short.amountAtomic).toBe(XMR);
      const full = plan.sellerFundsAtomic + XMR / 2n;
      const ok = await applyEvent(deps, code, { type: 'chain', receivedAtomic: full, unlockedAtomic: full, confirmations: 10 }, 'system');
      expect(ok.state).toBe('secured');
      expect(ok.amountAtomic).toBe(XMR);
      expect(ok.grown).toBeNull();
      // Stored as the trade record keeps it, and the column never changes.
      await expect(deps.db.query('update trades set seller_lien_recovery_atomic = 0 where code = $1', [code])).rejects.toThrow(/never changes/);
    });

    it('a completed sale records the extra for the creditor (only on the settled payout); a refund releases it and records nothing', async () => {
      const debtor = await person();
      const creditor = await person();
      const lien = await lienOn(debtor, creditor, 2n * XMR);
      const code = await sellerPosts(debtor, await person());
      const t = await tradeOf(code);
      await driveTo(deps, t, 'settling');
      expect(await recovered(lien)).toBe('0');
      await applyEvent(deps, code, { type: 'settled', kind: 'release', txHash: 'ab'.repeat(32) }, 'system');
      expect(await recovered(lien)).toBe((XMR / 2n).toString());
      expect(await sideHolds(code)).toMatchObject([{ side: 'seller', status: 'recovered' }]);
      // A refunded sale: the extra went back to the seller, nothing recovered, the remainder free again.
      await seedReviews(deps, code);
      const code2 = await sellerPosts(debtor, await person());
      await driveTo(deps, await tradeOf(code2), 'secured');
      await applyEvent(deps, code2, { type: 'buyer-cancel' }, 'buyer');
      await applyEvent(deps, code2, { type: 'settled', kind: 'buyer-cancel', txHash: 'cd'.repeat(32) }, 'system');
      expect(await sideHolds(code2)).toMatchObject([{ side: 'seller', status: 'released' }]);
      expect(await recovered(lien)).toBe((XMR / 2n).toString());
    });

    it('a ruling for the seller (a full reversal) releases the extra; one for the buyer records it', async () => {
      const debtor = await person();
      const creditor = await person();
      const lien = await lienOn(debtor, creditor, 2n * XMR);
      const code = await sellerPosts(debtor, await person());
      await driveTo(deps, await tradeOf(code), 'paid');
      await deps.db.query(`update trades set state = 'disputed' where code = $1`, [code]);
      await applyEvent(deps, code, { type: 'settled', kind: 'dispute-seller', txHash: 'ef'.repeat(32) }, 'system');
      expect(await sideHolds(code)).toMatchObject([{ side: 'seller', status: 'released' }]);
      expect(await recovered(lien)).toBe('0');
      await seedReviews(deps, code);
      const code2 = await sellerPosts(debtor, await person());
      await driveTo(deps, await tradeOf(code2), 'paid');
      await deps.db.query(`update trades set state = 'disputed' where code = $1`, [code2]);
      await applyEvent(deps, code2, { type: 'settled', kind: 'dispute-buyer', txHash: '12'.repeat(32) }, 'system');
      expect(await sideHolds(code2)).toMatchObject([{ side: 'seller', status: 'recovered' }]);
      expect(await recovered(lien)).toBe((XMR / 2n).toString());
    });

    it('review item 1: a sale cancelled with an escrow but no coin releases the extra at once (no 30-day block); late coins ruled for the buyer still record it from the signed terms', async () => {
      const debtor = await person();
      const creditor = await person();
      const lien = await lienOn(debtor, creditor, 2n * XMR);
      const code = await sellerPosts(debtor, await person());
      await driveTo(deps, await tradeOf(code), 'funding');
      await applyEvent(deps, code, { type: 'buyer-cancel' }, 'buyer');
      expect(await sideHolds(code)).toMatchObject([{ side: 'seller', status: 'released' }]);
      const log = await deps.db.query<{ detail: string }>(`select detail from activity_log where trade_code = $1 and action = 'lien.recovery-released'`, [code]);
      expect(log.rows.map((r) => JSON.parse(r.detail))).toEqual([{ lienId: lien, amountAtomic: (XMR / 2n).toString() }]);
      // The remainder is free for the next sale at once.
      const next = await sellerPosts(debtor, await person());
      expect(await sideHolds(next)).toMatchObject([{ side: 'seller', status: 'open', amount: (XMR / 2n).toString() }]);
      // HOLD_COUNTS_SQL agrees: a seller hold whose trade closed without a coin no longer counts at
      // once (here the close is written directly, as if settle had missed it), and the job releases it.
      await deps.db.query(`update trades set state = 'cancelled', closed_at = $2 where code = $1`, [next, deps.clock()]);
      const { releaseStaleRecoveryHolds } = await import('../src/disputes/recovery.js');
      expect(await releaseStaleRecoveryHolds(deps.db, deps.clock())).toBeGreaterThanOrEqual(1);
      expect(await sideHolds(next)).toMatchObject([{ side: 'seller', status: 'released' }]);
      // Late coins on the cancelled escrow, ruled for the buyer: the signed terms paid the extra, so it is recorded.
      await deps.db.query(`insert into trade_attestations (code, attestation, sig) values ($1, $2, $3)`, [
        code, { trade: code, terms: { sellerLienRecovery: { address: creditor.address, amountAtomic: (XMR / 2n).toString() } } }, '00'.repeat(64),
      ]);
      await deps.db.query(`update trades set state = 'disputed', received_atomic = $2 where code = $1`, [code, (XMR + XMR / 100n + XMR / 2n).toString()]);
      await applyEvent(deps, code, { type: 'settled', kind: 'dispute-buyer', txHash: 'fa'.repeat(32) }, 'system');
      expect(await recovered(lien)).toBe((XMR / 2n).toString());
    });

    it('review item 1: a sale cancelled after coins arrived keeps the extra held (late coins can still complete it)', async () => {
      const debtor = await person();
      const creditor = await person();
      await lienOn(debtor, creditor, 2n * XMR);
      const code = await sellerPosts(debtor, await person());
      await driveTo(deps, await tradeOf(code), 'funding');
      await deps.db.query(`update trades set received_atomic = 1000 where code = $1`, [code]);
      await applyEvent(deps, code, { type: 'buyer-cancel' }, 'buyer');
      expect(await sideHolds(code)).toMatchObject([{ side: 'seller', status: 'open' }]);
    });

    it('review item 3: a lien voided or written off before a sale is signed releases the extra and the sale is closed as a no-fault system cancel; a signed sale is untouched', async () => {
      const { applyLienVoid, applyLienUncollectible } = await import('../src/disputes/lien.js');
      const { startTimers, stalledSellerLienSales } = await import('../src/trades/timers.js');
      const inTx = async (f: (c: import('pg').PoolClient) => Promise<unknown>) => {
        const c = await deps.db.connect();
        try {
          await c.query('begin');
          await f(c);
          await c.query('commit');
        } finally {
          c.release();
        }
      };
      const timers = startTimers({ db: deps.db, clock: deps.clock, intervalMs: 0 });
      for (const end of ['void', 'uncollectible'] as const) {
        const debtor = await person();
        const creditor = await person();
        const lien = await lienOn(debtor, creditor, 2n * XMR);
        const unsigned = await sellerPosts(debtor, await person());
        const signedCode = await sellerPosts(debtor, await person());
        await deps.db.query(`insert into trade_attestations (code, attestation, sig, created_at) values ($1, '{}'::jsonb, 'x', now())`, [signedCode]);
        if (end === 'void') await inTx((c) => applyLienVoid(c, lien, deps.clock(), unsigned));
        else await inTx((c) => applyLienUncollectible(c, lien, creditor.id, '00000000-0000-4000-8000-000000000000', deps.clock()));
        expect(await sideHolds(unsigned)).toMatchObject([{ side: 'seller', status: 'released' }]);
        expect(await stalledSellerLienSales(deps.db)).toContain(unsigned);
        const pass = await timers.tick();
        expect(pass.applied).toContainEqual({ code: unsigned, type: 'system-cancel' });
        expect((await tradeOf(unsigned)).state).toBe('cancelled');
        const log = await deps.db.query<{ action: string }>(`select action from activity_log where trade_code = $1 order by id`, [unsigned]);
        expect(log.rows.map((r) => r.action)).toEqual(expect.arrayContaining(['lien.recovery-released', 'trade.system-cancel']));
        // The signed sale keeps its hold and its trade.
        expect(await sideHolds(signedCode)).toMatchObject([{ side: 'seller', status: 'open' }]);
        expect((await tradeOf(signedCode)).state).toBe('setup');
        expect(await stalledSellerLienSales(deps.db)).not.toContain(signedCode);
      }
      await timers.stop();
    });

    it('one remainder for buying and selling: a debtor who sells and buys never reserves more than is left', async () => {
      const debtor = await person();
      const creditor = await person();
      const lien = await lienOn(debtor, creditor, (3n * XMR) / 4n);
      const sale = await sellerPosts(debtor, await person());
      expect(await sideHolds(sale)).toEqual([{ lien, side: 'seller', amount: (XMR / 2n).toString(), status: 'open' }]);
      const buy = await taken(debtor, await postOffer(await person()), body(debtor, XMR));
      expect(await sideHolds(buy)).toEqual([{ lien, side: 'buyer', amount: (XMR / 4n).toString(), status: 'open' }]);
      const sale2 = await sellerPosts(debtor, await person());
      expect(await sideHolds(sale2)).toEqual([]);
    });

    it('both parties owe: the buyer\'s and the seller\'s recoveries are held independently on one trade and both recorded', async () => {
      const seller = await person();
      const buyer = await person();
      const c1 = await person();
      const c2 = await person();
      const sLien = await lienOn(seller, c1, 2n * XMR);
      const bLien = await lienOn(buyer, c2, 2n * XMR);
      const code = await sellerPosts(seller, buyer);
      expect(await sideHolds(code)).toEqual([
        { lien: bLien, side: 'buyer', amount: (XMR / 2n).toString(), status: 'open' },
        { lien: sLien, side: 'seller', amount: (XMR / 2n).toString(), status: 'open' },
      ]);
      expect(((await buyer.browser.get(`/v1/trades/${code}`)).json() as { lienRecoveryAtomic?: string }).lienRecoveryAtomic).toBe((XMR / 2n).toString());
      await driveTo(deps, await tradeOf(code), 'released');
      expect([await recovered(sLien), await recovered(bLien)]).toEqual([(XMR / 2n).toString(), (XMR / 2n).toString()]);
    });

    it('never one address for both: a creditor owed by both parties is paid by the seller\'s extra only; the creditor being the buyer reserves nothing', async () => {
      const seller = await person();
      const buyer = await person();
      const creditor = await person();
      await lienOn(seller, creditor, 2n * XMR);
      await lienOn(buyer, creditor, 2n * XMR);
      const offer = await postOffer(seller);
      // The buyer's quote leaves out the address the seller's extra uses.
      expect(await preview(buyer, offer, body(buyer, XMR))).toBe('0');
      const code = await taken(buyer, offer, body(buyer, XMR));
      expect((await sideHolds(code)).map((h) => h.side)).toEqual(['seller']);
      const debtor = await person();
      const owed = await person();
      await lienOn(debtor, owed, 2n * XMR);
      expect(await sideHolds(await taken(owed, await postOffer(debtor), body(owed, XMR)))).toEqual([]);
    });

    it('review B2 for the seller: a poster wallet that is the seller hold\'s creditor address is refused; the extra is never released for it', async () => {
      const debtor = await person();
      const creditor = await person();
      const buyer = await person();
      const lien = await lienOn(debtor, creditor, 2n * XMR, { address: fakeAddress() });
      const code = await taken(buyer, await postOffer(debtor), body(buyer, XMR));
      const address = (await deps.db.query<{ a: string }>('select creditor_address as a from liens where id = $1', [lien])).rows[0]!.a;
      const w = await addWallet(debtor.id);
      await deps.db.query('update wallets set address = $2 where id = $1', [w.id, address]);
      const res = await debtor.browser.post(`/v1/trades/${code}/wallet`, { walletId: w.id, sellerLienRecoveryAtomic: (XMR / 2n).toString() });
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json()).toMatchObject({ error: 'wallet-not-ready' });
      expect(await sideHolds(code)).toMatchObject([{ side: 'seller', status: 'open' }]);
    });
  });

  it('a completed trade records the recovery against the lien (rule 4: only on the settled payout), carries the rest forward, and repays at 0', async () => {
    const seller = await person();
    const debtor = await person();
    const creditor = await person();
    const lien = await lienOn(debtor, creditor, XMR);
    const offer = await postOffer(seller);
    const code = await taken(debtor, offer, body(debtor, XMR));
    const recovered = async () => (await deps.db.query<{ a: string }>('select coalesce(sum(amount_atomic), 0)::text as a from lien_recoveries where lien_id = $1', [lien])).rows[0]!.a;
    const t = rowToTrade((await loadTradeRow(deps.db, code))!);
    await deps.db.query(`update trades set seller_refund = $2 where code = $1`, [code, fakeAddress()]);
    // "I've paid" and the release start record nothing (a claim is not money arriving).
    await driveTo(deps, t, 'settling');
    expect(await recovered()).toBe('0');
    await applyEvent(deps, code, { type: 'settled', kind: 'release', txHash: 'ab'.repeat(32) }, 'system');
    expect(await recovered()).toBe((XMR / 2n).toString());
    expect((await holds(code))[0]).toMatchObject({ status: 'recovered', address: null });
    expect((await deps.db.query('select status from liens where id = $1', [lien])).rows[0]).toEqual({ status: 'active' });
    // The next completed trade recovers the remaining 0.5 XMR and the lien is repaid.
    await seedReviews(deps, code);
    const code2 = await taken(debtor, await postOffer(await person()), body(debtor, XMR));
    await deps.db.query(`update trades set seller_refund = $2 where code = $1`, [code2, fakeAddress()]);
    await driveTo(deps, rowToTrade((await loadTradeRow(deps.db, code2))!), 'released');
    expect(await recovered()).toBe(XMR.toString());
    expect((await deps.db.query('select status, repayment_code from liens where id = $1', [lien])).rows[0]).toEqual({ status: 'repaid', repayment_code: code2 });
    const log = await deps.db.query<{ action: string }>(`select action from activity_log where trade_code = $1 and action like 'lien.%' order by id`, [code2]);
    expect(log.rows.map((r) => r.action)).toEqual(['lien.recovery-reserved', 'lien.recovered', 'lien.repaid']);
  });

  it('NEEDS_OWNER_LIEN_FEE_AFTER_COMPLY: a lien that carries X2F\'s 1% stops recovering at 0 but stays active', async () => {
    const seller = await person();
    const debtor = await person();
    const creditor = await person();
    const lien = await lienOn(debtor, creditor, XMR / 4n, { fee: 1000n });
    const offer = await postOffer(seller);
    const code = await taken(debtor, offer, body(debtor, XMR));
    await deps.db.query(`update trades set seller_refund = $2 where code = $1`, [code, fakeAddress()]);
    await driveTo(deps, rowToTrade((await loadTradeRow(deps.db, code))!), 'released');
    expect((await deps.db.query('select status from liens where id = $1', [lien])).rows[0]).toEqual({ status: 'active' });
    const next = (await take(debtor, offer, body(debtor, XMR))).json() as { lienRecoveryAtomic?: string };
    expect(next.lienRecoveryAtomic).toBeUndefined();
  });

  it('review B1/Q2: the hold pays the address the creditor signed for the lien, never a wallet added since', async () => {
    const seller = await person();
    const debtor = await person();
    const creditor = await person();
    const bound = fakeAddress();
    const lien = await lienOn(debtor, creditor, 2n * XMR, { address: bound });
    await addWallet(creditor.id); // newer, usable: ignored
    const res = await take(debtor, await postOffer(seller), body(debtor, XMR));
    expect(res.statusCode, res.body).toBe(200);
    expect(await holds((res.json() as { code: string }).code)).toEqual([{ lien, amount: (XMR / 2n).toString(), address: bound, status: 'open' }]);
  });

  it('review B2: nothing is reserved when the signed address is one of the trade\'s own (the debtor\'s payout) or another account\'s wallet; the remainder carries forward', async () => {
    const seller = await person();
    const debtor = await person();
    const creditor = await person();
    await lienOn(debtor, creditor, 2n * XMR, { address: debtor.address });
    const res = await take(debtor, await postOffer(seller), body(debtor, XMR));
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { lienRecoveryAtomic?: string }).lienRecoveryAtomic).toBeUndefined();
    expect(await holds((res.json() as { code: string }).code)).toEqual([]);
  });

  it('review B2: a poster-buyer whose payout, chosen after the take, is the signed address keeps nothing reserved', async () => {
    const debtor = await person();
    const creditor = await person();
    const seller = await person();
    const address = fakeAddress();
    await lienOn(debtor, creditor, 2n * XMR, { address });
    const code = await taken(seller, await postOffer(debtor, { side: 'buy' }), body(seller, XMR));
    expect(await holds(code)).toMatchObject([{ status: 'open', address }]);
    // The debtor adds that address as a wallet of their own after the take, and chooses it.
    const shared = await addWallet(debtor.id);
    await deps.db.query('update wallets set address = $2 where id = $1', [shared.id, address]);
    expect((await debtor.browser.post(`/v1/trades/${code}/wallet`, { walletId: shared.id })).statusCode).toBe(204);
    expect(await holds(code)).toMatchObject([{ status: 'released', address: null }]);
    expect((await debtor.browser.get(`/v1/trades/${code}`)).json()).not.toHaveProperty('lienRecoveryAtomic');
  });

  it('the poster-buyer path: a seller takes the debtor\'s buy ad, the hold is reserved and reaches the poster\'s view only (review M6)', async () => {
    const debtor = await person();
    const creditor = await person();
    const seller = await person();
    await lienOn(debtor, creditor, 2n * XMR);
    const code = await taken(seller, await postOffer(debtor, { side: 'buy' }), body(seller, XMR));
    const plan = escrowPlan({ amountAtomic: XMR, poster: 'buyer' });
    const want = ((XMR - plan.feeAtomic) / 2n).toString();
    expect(await holds(code)).toMatchObject([{ status: 'open', amount: want }]);
    expect((await debtor.browser.post(`/v1/trades/${code}/wallet`, { walletId: debtor.wallet })).statusCode).toBe(204);
    expect(((await debtor.browser.get(`/v1/trades/${code}`)).json() as { lienRecoveryAtomic?: string }).lienRecoveryAtomic).toBe(want);
    expect((await seller.browser.get(`/v1/trades/${code}`)).json()).not.toHaveProperty('lienRecoveryAtomic');
  });

  it('Q1 (owner, 26 Nov 2026): a rate is at most 100% (SQL refuses more) and 100% by default; a 1 XMR purchase reserves all of it but the buyer\'s floor', async () => {
    const debtor = await person();
    const creditor = await person();
    await expect(lienOn(debtor, creditor, 100n * XMR, { rate: LIEN_RECOVERY_MAX_BPS + 1 })).rejects.toThrow(/check/);
    const lien = await lienOn(debtor, creditor, 100n * XMR);
    // The column's own default (migration 890), not the 5000 these tests write for readable halves.
    await deps.db.query('update liens set recovery_rate_bps = default where id = $1', [lien]);
    expect((await deps.db.query<{ r: number }>('select recovery_rate_bps as r from liens where id = $1', [lien])).rows[0]!.r).toBe(LIEN_RECOVERY_MAX_BPS);
    const res = await take(debtor, await postOffer(await person()), body(debtor, XMR));
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { lienRecoveryAtomic?: string }).lienRecoveryAtomic).toBe((XMR - LIEN_BUYER_KEEPS_ATOMIC).toString());
    expect(lienRecoveryCap(XMR)).toBe(XMR - LIEN_BUYER_KEEPS_ATOMIC);
  });

  it('PROBE-B3 (review): at 100% a small purchase still leaves the buyer MAX_NETWORK_FEE + 1 atomic unit; nothing at all when under 0.01 XMR would fit', async () => {
    const debtor = await person();
    const creditor = await person();
    await lienOn(debtor, creditor, 100n * XMR, { rate: LIEN_RECOVERY_MAX_BPS });
    const small = XMR / 10n;
    const res = await take(debtor, await postOffer(await person()), body(debtor, small));
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { lienRecoveryAtomic?: string }).lienRecoveryAtomic).toBe((small - LIEN_BUYER_KEEPS_ATOMIC).toString());
    // 0.015 XMR: 0.004999999999 XMR would fit above the floor, under the 0.01 XMR minimum (Q5): nothing reserved, carried forward.
    const tiny = (XMR * 15n) / 1000n;
    const res2 = await take(debtor, await postOffer(await person(), { minFiatCents: '100' }), body(debtor, tiny));
    expect(res2.statusCode, res2.body).toBe(200);
    expect((res2.json() as { lienRecoveryAtomic?: string }).lienRecoveryAtomic).toBeUndefined();
  });

  it('Q5 (provisional): a remainder under 0.01 XMR is not paid; it carries forward', async () => {
    const debtor = await person();
    const creditor = await person();
    const lien = await lienOn(debtor, creditor, XMR / 100n - 1n);
    const res = await take(debtor, await postOffer(await person()), body(debtor, XMR));
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { lienRecoveryAtomic?: string }).lienRecoveryAtomic).toBeUndefined();
    expect((await deps.db.query('select status from liens where id = $1', [lien])).rows[0]).toEqual({ status: 'active' });
  });

  it('review M2: a trade cancelled after its escrow was set up keeps its hold (late coins can still complete it), and a late dispute-buyer payout records it', async () => {
    const seller = await person();
    const debtor = await person();
    const creditor = await person();
    const lien = await lienOn(debtor, creditor, 2n * XMR);
    const code = await taken(debtor, await postOffer(seller), body(debtor, XMR));
    await deps.db.query(`update trades set seller_refund = $2 where code = $1`, [code, fakeAddress()]);
    const t = rowToTrade((await loadTradeRow(deps.db, code))!);
    await driveTo(deps, t, 'funding');
    expect((await applyEvent(deps, code, { type: 'buyer-cancel' }, 'buyer')).state).toBe('cancelled');
    expect((await holds(code))[0]).toMatchObject({ status: 'open' });
    // Late coins: the trade is escalated, and a ruling pays the buyer (the signed terms pay the recovery).
    await deps.db.query(`update trades set state = 'disputed', received_atomic = $2 where code = $1`, [code, (XMR + XMR / 100n).toString()]);
    await applyEvent(deps, code, { type: 'settled', kind: 'dispute-buyer', txHash: 'cd'.repeat(32) }, 'system');
    expect((await deps.db.query('select coalesce(sum(amount_atomic), 0)::text as a from lien_recoveries where lien_id = $1', [lien])).rows[0]).toEqual({ a: (XMR / 2n).toString() });
  });

  it('review M2: a hold of a trade closed with no coins for longer than the moderation watch is free again', async () => {
    const seller = await person();
    const debtor = await person();
    const creditor = await person();
    await lienOn(debtor, creditor, XMR / 2n);
    const code = await taken(debtor, await postOffer(seller), body(debtor, XMR));
    await driveTo(deps, rowToTrade((await loadTradeRow(deps.db, code))!), 'funding');
    await applyEvent(deps, code, { type: 'buyer-cancel' }, 'buyer');
    // Within the window the remainder stays reserved for it.
    const again = await take(debtor, await postOffer(await person()), body(debtor, XMR));
    expect((again.json() as { lienRecoveryAtomic?: string }).lienRecoveryAtomic).toBeUndefined();
    await deps.db.query(`update trades set closed_at = $2 where code = $1`, [code, new Date(deps.clock().getTime() - (WATCH_CLOSED_DAYS + 1) * DAY)]);
    const later = await take(debtor, await postOffer(await person()), body(debtor, XMR));
    expect((later.json() as { lienRecoveryAtomic?: string }).lienRecoveryAtomic).toBe((XMR / 2n).toString());
  });

  it('re-review N3: a hold that stopped counting is released (the retention job, logged); a late payout its signed terms carry is still recorded', async () => {
    const { releaseStaleRecoveryHolds } = await import('../src/disputes/recovery.js');
    const { RETENTION_JOBS } = await import('../src/retentionJobs.js');
    expect(RETENTION_JOBS.map((j) => j.name)).toContain('releaseStaleRecoveryHolds');
    const seller = await person();
    const debtor = await person();
    const creditor = await person();
    const lien = await lienOn(debtor, creditor, 2n * XMR);
    const code = await taken(debtor, await postOffer(seller), body(debtor, XMR));
    await deps.db.query(`update trades set seller_refund = $2 where code = $1`, [code, fakeAddress()]);
    await driveTo(deps, rowToTrade((await loadTradeRow(deps.db, code))!), 'funding');
    await applyEvent(deps, code, { type: 'buyer-cancel' }, 'buyer');
    // Closed with an escrow and no coin: within the watch it stays open.
    await releaseStaleRecoveryHolds(deps.db, deps.clock());
    expect((await holds(code))[0]).toMatchObject({ status: 'open' });
    await deps.db.query(`update trades set closed_at = $2 where code = $1`, [code, new Date(deps.clock().getTime() - (WATCH_CLOSED_DAYS + 1) * DAY)]);
    expect(await releaseStaleRecoveryHolds(deps.db, deps.clock())).toBeGreaterThanOrEqual(1);
    expect(await holds(code)).toEqual([{ lien, amount: (XMR / 2n).toString(), address: null, status: 'released' }]);
    const log = await deps.db.query<{ action: string; detail: string }>(`select action, detail from activity_log where trade_code = $1 and action = 'lien.recovery-released'`, [code]);
    expect(log.rows.map((r) => JSON.parse(r.detail))).toEqual([{ lienId: lien, amountAtomic: (XMR / 2n).toString() }]);
    // Review M2 still holds: its signed terms carried the recovery, so a late payout to the buyer pays it, and the ledger records it.
    await deps.db.query(`insert into trade_attestations (code, attestation, sig) values ($1, $2, $3)`, [
      code, { trade: code, terms: { lienRecovery: { address: creditor.address, amountAtomic: (XMR / 2n).toString() } } }, '00'.repeat(64),
    ]);
    await deps.db.query(`update trades set state = 'disputed', received_atomic = $2 where code = $1`, [code, (XMR + XMR / 100n).toString()]);
    await applyEvent(deps, code, { type: 'settled', kind: 'dispute-buyer', txHash: 'ce'.repeat(32) }, 'system');
    expect((await deps.db.query('select coalesce(sum(amount_atomic), 0)::text as a from lien_recoveries where lien_id = $1', [lien])).rows[0]).toEqual({ a: (XMR / 2n).toString() });
  });

  it('re-review N3: a hold released before its terms were signed (they carry no recovery) records nothing on a later payout', async () => {
    const { releaseStaleRecoveryHolds } = await import('../src/disputes/recovery.js');
    const seller = await person();
    const debtor = await person();
    const creditor = await person();
    const lien = await lienOn(debtor, creditor, 2n * XMR);
    const code = await taken(debtor, await postOffer(seller), body(debtor, XMR));
    await deps.db.query(`update trades set seller_refund = $2 where code = $1`, [code, fakeAddress()]);
    await driveTo(deps, rowToTrade((await loadTradeRow(deps.db, code))!), 'funding');
    await applyEvent(deps, code, { type: 'buyer-cancel' }, 'buyer');
    await deps.db.query(`update trades set closed_at = $2 where code = $1`, [code, new Date(deps.clock().getTime() - (WATCH_CLOSED_DAYS + 1) * DAY)]);
    await releaseStaleRecoveryHolds(deps.db, deps.clock());
    await deps.db.query(`insert into trade_attestations (code, attestation, sig) values ($1, $2, $3)`, [code, { trade: code, terms: {} }, '00'.repeat(64)]);
    await deps.db.query(`update trades set state = 'disputed', received_atomic = $2 where code = $1`, [code, (XMR + XMR / 100n).toString()]);
    await applyEvent(deps, code, { type: 'settled', kind: 'dispute-buyer', txHash: 'cf'.repeat(32) }, 'system');
    expect((await deps.db.query('select count(*)::int as n from lien_recoveries where lien_id = $1', [lien])).rows[0]).toEqual({ n: 0 });
  });

  it('review I2: a released hold is not shown to the buyer', async () => {
    const debtor = await person();
    const creditor = await person();
    await lienOn(debtor, creditor, XMR);
    const code = await taken(debtor, await postOffer(await person()), body(debtor, XMR));
    await applyEvent(deps, code, { type: 'buyer-cancel' }, 'buyer');
    expect((await debtor.browser.get(`/v1/trades/${code}`)).json()).not.toHaveProperty('lienRecoveryAtomic');
  });

  it('a cancelled trade releases its hold and records nothing; the remainder is free again', async () => {
    const seller = await person();
    const debtor = await person();
    const creditor = await person();
    const lien = await lienOn(debtor, creditor, XMR);
    const offer = await postOffer(seller);
    const code = await taken(debtor, offer, body(debtor, XMR));
    // Cancelled in setup (the buyer's cancel there closes it with nothing in escrow).
    expect((await applyEvent(deps, code, { type: 'buyer-cancel' }, 'buyer')).state).toBe('cancelled');
    expect((await holds(code))[0]).toMatchObject({ status: 'released', address: null });
    expect((await deps.db.query('select count(*)::int as n from lien_recoveries where lien_id = $1', [lien])).rows[0]).toEqual({ n: 0 });
  });

  it('review B1: the buyer accepts the figure before the take; a take that would reserve another figure, or one the buyer was not shown, is refused and nothing is kept', async () => {
    const seller = await person();
    const debtor = await person();
    const creditor = await person();
    await lienOn(debtor, creditor, 2n * XMR);
    const offer = await postOffer(seller);
    const b = body(debtor, XMR);
    expect(await preview(debtor, offer, b)).toBe((XMR / 2n).toString());
    for (const shown of [undefined, '0', (XMR / 2n - 1n).toString(), (XMR / 2n + 1n).toString()]) {
      const res = await debtor.browser.post(`/v1/offers/${offer}/take`, { ...b, ...(shown === undefined ? {} : { lienRecoveryAtomic: shown }) });
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json()).toMatchObject({ error: 'lien-recovery-changed' });
    }
    expect((await deps.db.query('select count(*)::int as n from lien_recovery_holds h join liens l on l.id = h.lien_id where l.debtor_account_id = $1', [debtor.id])).rows[0]).toEqual({ n: 0 });
    expect((await deps.db.query('select count(*)::int as n from trades where buyer_account_id = $1 and state = $2', [debtor.id, 'setup'])).rows[0]).toEqual({ n: 0 });
    const ok = await debtor.browser.post(`/v1/offers/${offer}/take`, { ...b, lienRecoveryAtomic: (XMR / 2n).toString() });
    expect(ok.statusCode, ok.body).toBe(200);
    // A buyer with no lien sends '0' (or nothing) and is never refused for it.
    const clean = await person();
    expect(await preview(clean, offer, body(clean, XMR))).toBe('0');
    expect((await clean.browser.post(`/v1/offers/${offer}/take`, { ...body(clean, XMR), lienRecoveryAtomic: '0' })).statusCode).toBe(200);
  });

  it('Q2: nothing is reserved until the creditor\'s device signs an address; the creditor sees that it is missing (M4: totals only, never the debtor\'s purchases)', async () => {
    const debtor = await person();
    const creditor = await person();
    const lien = await lienOn(debtor, creditor, 2n * XMR, { address: null });
    const res = await take(debtor, await postOffer(await person()), body(debtor, XMR));
    expect((res.json() as { lienRecoveryAtomic?: string }).lienRecoveryAtomic).toBeUndefined();
    const view = (await creditor.browser.get('/v1/account/liens')).json() as { owedTo: Array<Record<string, unknown>> };
    expect(view.owedTo).toHaveLength(1);
    expect(view.owedTo[0]).toMatchObject({ id: lien, recoveryAddressSet: false, amountAtomic: (2n * XMR).toString(), recoveredAtomic: '0', remainingAtomic: (2n * XMR).toString() });
    expect(Object.keys(view.owedTo[0]!).sort()).toEqual(['amountAtomic', 'fromCode', 'id', 'recoveredAtomic', 'recoveryAddressSet', 'remainingAtomic', 'status']);
  });

  describe('Q2: the creditor\'s signed recovery address (POST /v1/account/liens/:id/recovery-address)', () => {
    /** A disputed trade between `creditor` (the seller) and `debtor`, with the creditor's trade identity on record. */
    async function sourceTrade(debtor: Who, creditor: Who): Promise<{ code: string; secret: Uint8Array; lien: string }> {
      await sodium.ready;
      const { code } = await seedTrade(deps, { sellerId: creditor.id, buyerId: debtor.id, poster: 'seller' });
      const kp = sodium.crypto_sign_keypair();
      await deps.db.query(`insert into trade_identities (code, role, sign_public, box_public, proof) values ($1, 'seller', $2, $3, 'x')`, [
        code, sodium.to_hex(kp.publicKey), sodium.to_hex(sodium.crypto_box_keypair().publicKey),
      ]);
      const lien = await lienOn(debtor, creditor, 2n * XMR, { address: null, fromCode: code });
      return { code, secret: kp.privateKey, lien };
    }
    const statement = (code: string, address: string, issuedAt = deps.clock().toISOString()) =>
      ({ v: 1 as const, fromCode: code, creditorSide: 'seller' as const, address, issuedAt });

    it('signed by the creditor\'s identity in the disputed trade: set, logged, and then reserved to; a newer one replaces it', async () => {
      const debtor = await person();
      const creditor = await person();
      const src = await sourceTrade(debtor, creditor);
      const address = fakeAddress();
      const s = statement(src.code, address);
      const res = await creditor.browser.post(`/v1/account/liens/${src.lien}/recovery-address`, { statement: s, sig: await signRecoveryAddress(s, src.secret) });
      expect(res.statusCode, res.body).toBe(204);
      expect((await deps.db.query('select creditor_address from liens where id = $1', [src.lien])).rows[0]).toEqual({ creditor_address: address });
      const log = await deps.db.query<{ action: string; detail: string }>(`select action, detail from activity_log where action = 'lien.recovery-address-set'`);
      expect(log.rows.map((r) => JSON.parse(r.detail))).toContainEqual({ lienId: src.lien });
      const code = await taken(debtor, await postOffer(await person()), body(debtor, XMR));
      expect(await holds(code)).toMatchObject([{ address, amount: (XMR / 2n).toString() }]);
      // A replay of the same (or an older) statement is refused; a newer one is taken.
      expect((await creditor.browser.post(`/v1/account/liens/${src.lien}/recovery-address`, { statement: s, sig: await signRecoveryAddress(s, src.secret) })).statusCode).toBe(409);
      const s2 = statement(src.code, fakeAddress(), new Date(deps.clock().getTime() + 1000).toISOString());
      expect((await creditor.browser.post(`/v1/account/liens/${src.lien}/recovery-address`, { statement: s2, sig: await signRecoveryAddress(s2, src.secret) })).statusCode).toBe(204);
    });

    it('refused: another key, another trade or side, the debtor, a malformed body', async () => {
      const debtor = await person();
      const creditor = await person();
      const src = await sourceTrade(debtor, creditor);
      const s = statement(src.code, fakeAddress());
      const other = sodium.crypto_sign_keypair().privateKey;
      expect((await creditor.browser.post(`/v1/account/liens/${src.lien}/recovery-address`, { statement: s, sig: await signRecoveryAddress(s, other) })).statusCode).toBe(400);
      const buyerSide = { ...s, creditorSide: 'buyer' as const };
      expect((await creditor.browser.post(`/v1/account/liens/${src.lien}/recovery-address`, { statement: buyerSide, sig: await signRecoveryAddress(buyerSide, src.secret) })).statusCode).toBe(400);
      expect((await debtor.browser.post(`/v1/account/liens/${src.lien}/recovery-address`, { statement: s, sig: await signRecoveryAddress(s, src.secret) })).statusCode).toBe(404);
      expect((await creditor.browser.post(`/v1/account/liens/${src.lien}/recovery-address`, { statement: s })).statusCode).toBe(400);
      expect((await deps.db.query('select creditor_address from liens where id = $1', [src.lien])).rows[0]).toEqual({ creditor_address: null });
    });

    it('PROBE-B2 (review): a creditor cannot point recoveries at the debtor\'s payout address, even after adding it as a wallet of their own', async () => {
      const debtor = await person();
      const creditor = await person();
      const src = await sourceTrade(debtor, creditor);
      // The review's probe: the creditor registers the debtor's payout address as their own wallet.
      await deps.db.query('update wallets set address = $2 where account_id = $1', [creditor.id, debtor.address]);
      const s = statement(src.code, debtor.address);
      const res = await creditor.browser.post(`/v1/account/liens/${src.lien}/recovery-address`, { statement: s, sig: await signRecoveryAddress(s, src.secret) });
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json()).toMatchObject({ error: 'recovery-address-refused' });
      // And a lien that somehow carries it reserves nothing: the debtor's purchases stay payable.
      await deps.db.query(`update liens set creditor_address = $2, creditor_address_statement = '{}'::jsonb, creditor_address_sig = repeat('0', 128) where id = $1`, [src.lien, debtor.address]);
      const r = await take(debtor, await postOffer(await person()), body(debtor, XMR));
      expect(r.statusCode, r.body).toBe(200);
      expect((r.json() as { lienRecoveryAtomic?: string }).lienRecoveryAtomic).toBeUndefined();
    });

    it('review B2: X2F\'s fee wallet (X2F_FEE_WALLET) is never accepted or reserved as a recovery address', async () => {
      const debtor = await person();
      const creditor = await person();
      const src = await sourceTrade(debtor, creditor);
      const fee = fakeAddress();
      const before = deps.config.feeWallet;
      deps.config.feeWallet = fee;
      try {
        const s = statement(src.code, fee);
        const res = await creditor.browser.post(`/v1/account/liens/${src.lien}/recovery-address`, { statement: s, sig: await signRecoveryAddress(s, src.secret) });
        expect(res.statusCode, res.body).toBe(409);
        expect(res.json()).toMatchObject({ error: 'recovery-address-refused' });
        // A lien that somehow carries it reserves nothing, and the quote shows nothing.
        await deps.db.query(`update liens set creditor_address = $2, creditor_address_statement = '{}'::jsonb, creditor_address_sig = repeat('0', 128) where id = $1`, [src.lien, fee]);
        const offer = await postOffer(await person());
        expect(await preview(debtor, offer, body(debtor, XMR))).toBe('0');
        const r = await take(debtor, offer, body(debtor, XMR));
        expect(r.statusCode, r.body).toBe(200);
        expect((r.json() as { lienRecoveryAtomic?: string }).lienRecoveryAtomic).toBeUndefined();
        expect(await holds((r.json() as { code: string }).code)).toEqual([]);
      } finally {
        if (before === undefined) delete deps.config.feeWallet;
        else deps.config.feeWallet = before;
      }
    });
  });

  it('a rate approved after the take changes nothing the trade carries: the hold keeps the rate and the creditor\'s statement it was reserved at', async () => {
    const debtor = await person();
    const creditor = await person();
    const lien = await lienOn(debtor, creditor, 100n * XMR);
    const code = await taken(debtor, await postOffer(await person()), body(debtor, XMR));
    await deps.db.query(`update liens set recovery_rate_bps = 9000 where id = $1`, [lien]);
    const row = (await deps.db.query<{ rate_bps: number; address_statement: unknown; address_sig: string }>(
      'select rate_bps, address_statement, address_sig from lien_recovery_holds where trade_code = $1', [code],
    )).rows[0]!;
    expect(row).toEqual({ rate_bps: 5000, address_statement: {}, address_sig: '0'.repeat(128) });
  });

  it('Q6 (provisional): a lien voided while a trade not yet signed holds a recovery releases the hold; a signed trade still pays it, recorded and flagged for staff', async () => {
    const debtor = await person();
    const creditor = await person();
    const { code: from } = await seedTrade(deps, { sellerId: creditor.id, buyerId: debtor.id, poster: 'seller' });
    const lien = await lienOn(debtor, creditor, 2n * XMR, { fromCode: from });
    const unsigned = await taken(debtor, await postOffer(await person()), body(debtor, XMR));
    const signedCode = await taken(debtor, await postOffer(await person()), body(debtor, XMR));
    await deps.db.query(`insert into trade_attestations (code, attestation, sig, created_at) values ($1, '{}'::jsonb, 'x', now())`, [signedCode]);
    // The void step as applyLienRules runs it (a round-2 overturn), through the same code.
    const { applyLienVoid } = await import('../src/disputes/lien.js');
    const c = await deps.db.connect();
    try {
      await c.query('begin');
      expect(await applyLienVoid(c, lien, deps.clock())).toBe(true);
      await c.query('commit');
    } finally {
      c.release();
    }
    expect((await holds(unsigned))[0]).toMatchObject({ status: 'released' });
    expect((await holds(signedCode))[0]).toMatchObject({ status: 'open' });
    await deps.db.query(`update trades set seller_refund = $2 where code = $1`, [signedCode, fakeAddress()]);
    await driveTo(deps, rowToTrade((await loadTradeRow(deps.db, signedCode))!), 'released');
    const log = await deps.db.query<{ action: string; detail: string }>(`select action, detail from activity_log where trade_code = $1 and action like 'lien.%' order by id`, [signedCode]);
    expect(log.rows.map((r) => r.action)).toContain('lien.recovered-after-end');
    expect((await deps.db.query('select coalesce(sum(amount_atomic), 0)::text as a from lien_recoveries where lien_id = $1', [lien])).rows[0]).toEqual({ a: (XMR / 2n).toString() });
  });

  it('SQL guards: the ledger is add-only and never sums past the amount owed', async () => {
    const debtor = await person();
    const creditor = await person();
    const lien = await lienOn(debtor, creditor, 1000n);
    const ins = (code: string, a: bigint) =>
      deps.db.query('insert into lien_recoveries (lien_id, trade_code, amount_atomic, at) values ($1, $2, $3, now())', [lien, code, a.toString()]);
    await ins('AAAA-AAAA-AAAA-AAA1', 600n);
    await expect(ins('AAAA-AAAA-AAAA-AAA2', 401n)).rejects.toThrow(/never recovers more/);
    await ins('AAAA-AAAA-AAAA-AAA2', 400n);
    await expect(deps.db.query('update lien_recoveries set amount_atomic = 1 where lien_id = $1', [lien])).rejects.toThrow(/add-only/);
    await expect(deps.db.query('delete from lien_recoveries where lien_id = $1', [lien])).rejects.toThrow(/add-only/);
  });
});
