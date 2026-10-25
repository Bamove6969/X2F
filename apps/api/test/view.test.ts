import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { applyEvent } from '../src/trades/store.js';
import { toTradeView, type TraderSummary } from '../src/trades/view.js';
import { AMOUNT, fakeAddress, happyPath, seedTrade } from './helpers/trades.js';
import { tradeApp } from './helpers/tradeApp.js';

let app: FastifyInstance;
let deps: Deps;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];

beforeAll(async () => {
  ({ app, deps, trader } = await tradeApp());
});
afterAll(async () => {
  await app.close();
});

const FEE = (AMOUNT / 100n).toString(); // 12500000000
type View = Record<string, unknown> & { role: string; state: string; funding: Record<string, unknown> | null };

describe('GET /v1/trades/:code', () => {
  for (const poster of ['seller', 'buyer'] as const) {
    it(`shows the fee only to the poster in every state (poster ${poster})`, async () => {
      const seller = await trader();
      const buyer = await trader();
      const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster });
      const posterB = poster === 'seller' ? seller : buyer;
      const takerB = poster === 'seller' ? buyer : seller;
      const escrow = fakeAddress();
      const steps = happyPath(trade, escrow);
      for (let i = 0; i <= steps.length; i++) {
        const p = (await posterB.browser.get(`/v1/trades/${trade.code}`)).json() as View;
        const tk = (await takerB.browser.get(`/v1/trades/${trade.code}`)).json() as View;
        expect(p.role).toBe(poster);
        expect(p.fee).toEqual({ atomic: FEE });
        expect(tk.role).not.toBe(poster);
        expect('fee' in tk, tk.state).toBe(false);
        expect(JSON.stringify(tk)).not.toMatch(/fee/i);
        const step = steps[i];
        if (step) await applyEvent(deps, trade.code, step.e, step.by);
      }
    });
  }

  it('gives the escrow address and funding link to the seller only, and never once funded (Revision 2026-10-21)', async () => {
    const seller = await trader();
    const buyer = await trader();
    const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
    const escrow = fakeAddress();
    const steps = happyPath(trade, escrow);
    await applyEvent(deps, trade.code, steps[0]!.e, steps[0]!.by); // funding
    const s = (await seller.browser.get(`/v1/trades/${trade.code}`)).json() as View;
    expect(s.funding).toEqual({
      sellerFundsAtomic: trade.sellerFundsAtomic.toString(), escrowAddress: escrow,
      uri: `monero:${escrow}?tx_amount=1.2625`, walletApp: 'cake',
    });
    const b = await buyer.browser.get(`/v1/trades/${trade.code}`);
    expect(b.json()).toMatchObject({ funding: null });
    expect(b.body).not.toContain(escrow);
    for (const step of steps.slice(1)) {
      await applyEvent(deps, trade.code, step.e, step.by);
      for (const who of [seller, buyer]) {
        const r = await who.browser.get(`/v1/trades/${trade.code}`);
        expect(r.body).not.toContain(escrow);
        expect(r.body).not.toContain('monero:');
      }
    }
  });

  it('carries the server clock, ISO deadlines, the counterparty and nothing about payout addresses', async () => {
    const seller = await trader();
    const buyer = await trader();
    const { trade, sides } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
    const now = deps.clock();
    const res = await buyer.browser.get(`/v1/trades/${trade.code}`);
    expect(res.statusCode).toBe(200);
    const v = res.json() as View;
    expect(v).toMatchObject({
      code: trade.code, role: 'buyer', poster: 'seller', state: 'setup', serverNow: now.toISOString(),
      setupBy: trade.setupBy!.toISOString(), takenAt: trade.takenAt.toISOString(), fiatCents: '41250',
      amountAtomic: AMOUNT.toString(), confirmations: 0, releasableEtaMin: null, profile: null,
      counterparty: { username: seller.username, completedTrades: 0, online: true },
    });
    expect(res.body).not.toContain(sides.buyerPayout!);
    expect(res.body).not.toContain(sides.sellerRefund!);
  });

  it('carries the locked rate and the offer maximum fixed at take, as the escrow runtime reads them (Task 12)', async () => {
    const seller = await trader();
    const buyer = await trader();
    const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'buyer' });
    for (const who of [seller, buyer]) {
      const v = (await who.browser.get(`/v1/trades/${trade.code}`)).json() as View;
      expect(v).toMatchObject({
        poster: 'buyer', state: 'setup', amountAtomic: AMOUNT.toString(), settling: null, paidAt: null,
        lockedRate: { currency: 'USD', centsPerXmr: '33000' }, maxFiatCents: '100000',
      });
    }
  });

  it('answers 404 to a third trader and for an unknown code, 403 to staff, 401 without a session', async () => {
    const seller = await trader();
    const buyer = await trader();
    const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
    const third = await trader();
    const res = await third.browser.get(`/v1/trades/${trade.code}`);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not-found' });
    expect((await third.browser.get('/v1/trades/ZZZZ-ZZZZ-ZZZZ-ZZZZ')).json()).toEqual({ error: 'not-found' });
    expect((await (await trader('staff')).browser.get(`/v1/trades/${trade.code}`)).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/v1/trades/${trade.code}` })).statusCode).toBe(401);
  });
});

describe('toTradeView', () => {
  it('refuses a viewer who is not a participant', async () => {
    const seller = await trader();
    const buyer = await trader();
    const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'buyer' });
    const cp: TraderSummary = { username: 'x', completedTrades: 0, online: false, lastSeenAt: null, typicalMinutes: null, positivePct: null, badges: [] };
    expect(() => toTradeView(trade, '00000000-0000-0000-0000-000000000000', new Date(), { counterparty: cp, profile: null, sellerWalletApp: null })).toThrow();
    expect(toTradeView(trade, buyer.id, new Date(), { counterparty: cp, profile: null, sellerWalletApp: null }).fee).toEqual({ atomic: FEE });
    expect('fee' in toTradeView(trade, seller.id, new Date(), { counterparty: cp, profile: null, sellerWalletApp: null })).toBe(false);
  });
});
