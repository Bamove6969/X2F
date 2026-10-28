import type { FastifyInstance } from 'fastify';
import { fiatCents, rateFor } from '@x2f/trade';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deps } from '../src/app.js';
import type { MarketPrices, MarketQuote } from '../src/price/market.js';
import { insertTrade, loadTradeRow, rowToTrade } from '../src/trades/store.js';
import { seedAccount } from './helpers/accounts.js';
import { tradeApp } from './helpers/tradeApp.js';
import { XMR, fakeAddress, seedTrade } from './helpers/trades.js';

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
  ({ app, deps, trader } = await tradeApp({}, { prices }));
  // Small stage thresholds for this file: Building at 1 completed trade and 7 days, Graduated at 2 and 30.
  await deps.db.query(
    `insert into owner_settings (key, value, updated_at) values
       ('building_min_trades', 1, now()), ('graduated_min_trades', 2, now())`,
  );
});
afterAll(async () => {
  await app.close();
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
  if (stage !== 'starter') {
    const now = deps.clock();
    await deps.db.query('update accounts set created_at = $2 where id = $1', [t.id, new Date(now.getTime() - (stage === 'graduated' ? 40 : 10) * DAY)]);
    for (let i = 0; i < (stage === 'graduated' ? 2 : 1); i++) {
      const other = await seedAccount(deps, { loginName: `cp${Math.random().toString(36).slice(2, 12)}` });
      const { code } = await seedTrade(deps, { sellerId: t.id, buyerId: other, poster: 'seller' });
      await deps.db.query(`update trades set state = 'released', closed_at = $2 where code = $1`, [code, now]);
    }
  }
  return { ...t, wallet: w.id, address: w.address };
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

/** A take body at `centsPerXmr` (default: the USD market, margin 0), the total worked out as the quote does. */
function body(who: Who, amountAtomic: bigint, centsPerXmr = market.usdCentsPerXmr!, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    amountAtomic: amountAtomic.toString(), walletId: who.wallet, centsPerXmr: centsPerXmr.toString(),
    fiatCents: fiatCents(amountAtomic, { currency: 'USD', centsPerXmr }).toString(), ...over,
  };
}

async function take(who: Who, offerId: string, b: Record<string, unknown>) {
  return who.browser.post(`/v1/offers/${offerId}/take`, b);
}

async function taken(who: Who, offerId: string, b: Record<string, unknown>): Promise<string> {
  const res = await take(who, offerId, b);
  expect(res.statusCode, res.body).toBe(200);
  const code = (res.json() as { code: string }).code;
  expect(code).toMatch(/^[0-9A-Z]{16}$/);
  return code;
}

const refusal = (res: { statusCode: number; json(): unknown }) => ({ status: res.statusCode, ...(res.json() as object) });
const tenth = XMR / 10n; // $33.00 at $330

describe('POST /v1/offers/:id/take', () => {
  it('starts a trade in setup with the taker side filled in and the quoted rate and total locked (OD-5)', async () => {
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
      minFiatCents: 1000n, maxFiatCents: 1_000_000n, confirmWindowMin: 120, takenAt: deps.clock(),
    });
    // The buyer took: their payout address is set; the seller (poster) picks on the accepted sheet.
    expect({ buyer: row.buyer_payout, seller: row.seller_refund, app: row.seller_wallet_app }).toEqual({ buyer: buyer.address, seller: null, app: null });
    // Both sides see it.
    expect((await seller.browser.get(`/v1/trades/${code}`)).json()).toMatchObject({ role: 'seller', state: 'setup', fiatCents: '3333' });
  });

  it('locks exactly the quoted rate while the offer rate moved within 0.5%, and refuses price-changed past it', async () => {
    const seller = await person();
    const buyer = await person();
    const offer = await postOffer(seller);
    // Quoted at $330.00; the market is now $331.65 (+0.5% exactly): still the quoted rate.
    market.usdCentsPerXmr = 33_165n;
    const code = await taken(buyer, offer, body(buyer, tenth, 33_000n));
    expect(rowToTrade((await loadTradeRow(deps.db, code))!)).toMatchObject({ lockedRate: { centsPerXmr: 33_000n }, fiatCents: 3_300n });

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

  it('a fixed-price offer compares exactly, and can be taken while the feed is down; a market offer cannot', async () => {
    const seller = await person();
    const buyer = await person();
    const fixed = await postOffer(seller, { pricing: { mode: 'fixed', centsPerXmr: '34000' } });
    expect(refusal(await take(buyer, fixed, body(buyer, tenth, 33_999n)))).toEqual({ status: 409, error: 'price-changed' });
    market.usdCentsPerXmr = null;
    const code = await taken(buyer, fixed, body(buyer, tenth, 34_000n));
    expect(rowToTrade((await loadTradeRow(deps.db, code))!).lockedRate.centsPerXmr).toBe(34_000n);

    const other = await person();
    const floating = await postOffer(seller);
    expect(refusal(await take(other, floating, body(other, tenth, 33_000n)))).toEqual({ status: 409, error: 'price-unavailable' });
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
    expect(refusal(await take(buyer, picky, body(buyer, tenth)))).toEqual({ status: 409, error: 'not-enough-trades' });
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
    await deps.db.query(`update offers set method_id = 'SBP' where id = $1`, [offer]);
    expect(refusal(await take(other, offer, body(other, tenth)))).toEqual({ status: 409, error: 'method-unavailable' });
    await deps.db.query(`update offers set method_id = 'ZELLE', status = 'paused' where id = $1`, [offer]);
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
    const results = await Promise.all(sellers.map((s) => take(s, offer, body(s, tenth))));
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
    const results = await Promise.all(buyers.map((b) => take(b, offer, body(b, tenth))));
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect(new Set(results.map((r) => (r.json() as { code: string }).code)).size).toBe(3);

    // The same buyer again (any amount), and twice at once.
    expect(refusal(await take(buyers[0]!, offer, body(buyers[0]!, tenth * 2n)))).toEqual({ status: 409, error: 'already-waiting' });
    const fourth = await person();
    const twice = await Promise.all([take(fourth, offer, body(fourth, tenth)), take(fourth, offer, body(fourth, tenth))]);
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
    expect(refusal(await take(buyer, offer, body(buyer, atCap + 2n)))).toEqual({ status: 409, error: 'starter-limit', stage: 'starter', capUsdCents: '20000' });
    await taken(buyer, offer, body(buyer, atCap));
  });

  it('a Building taker is held to $1,000; Graduated on both sides has no platform cap', async () => {
    const seller = await person();
    const building = await person('building');
    const offer = await postOffer(seller, { maxFiatCents: '100000000' });
    expect(refusal(await take(building, offer, body(building, 4n * XMR)))).toEqual({ status: 409, error: 'starter-limit', stage: 'building', capUsdCents: '100000' });
    const graduated = await person('graduated');
    await taken(graduated, offer, body(graduated, 100n * XMR));
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
    const offer = await postOffer(seller, { currency: 'EUR', pricing: { mode: 'fixed', centsPerXmr: '29700' } });
    const eur = (amount: bigint) => ({
      amountAtomic: amount.toString(), walletId: buyer.wallet, centsPerXmr: '29700',
      fiatCents: fiatCents(amount, { currency: 'EUR', centsPerXmr: 29_700n }).toString(),
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

  it("a Starter poster's open-trade count holds under a race, and the taker is not told the poster's stage", async () => {
    const poster = await person('starter');
    const offer = await postOffer(poster);
    const buyers = await Promise.all([1, 2, 3, 4, 5].map(() => person()));
    const results = await Promise.all(buyers.map((b) => take(b, offer, body(b, tenth))));
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(3);
    expect(results.filter((r) => r.statusCode !== 200).map(refusal)).toEqual(Array(2).fill({ status: 409, error: 'starter-limit' }));
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
