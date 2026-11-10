import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { applyEvent } from '../src/trades/store.js';
import { toTradeView, type TraderSummary } from '../src/trades/view.js';
import { AMOUNT, driveTo, fakeAddress, happyPath, seedTrade } from './helpers/trades.js';
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

/** Every object key and every leaf value (as a string) in a JSON value, at any depth. */
function walk(v: unknown): { keys: string[]; leaves: string[] } {
  if (v === null || typeof v !== 'object') return { keys: [], leaves: [String(v)] };
  const entries: [string | null, unknown][] = Array.isArray(v) ? v.map((x) => [null, x]) : Object.entries(v);
  const out = { keys: [] as string[], leaves: [] as string[] };
  for (const [k, x] of entries) {
    const w = walk(x);
    if (k !== null) out.keys.push(k);
    out.keys.push(...w.keys);
    out.leaves.push(...w.leaves);
  }
  return out;
}

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
        expect(walk(p).leaves).toContain(FEE); // the check below would see a leaked fee
        expect(tk.role).not.toBe(poster);
        expect('fee' in tk, tk.state).toBe(false);
        // No key names a fee anywhere in the view, and no value is the fee amount. Not a text search
        // for "fee": random values (the tx hash, the trade code, the base58 escrow address and its
        // monero: link a seller taker sees while funding) can spell it (flakes 2026-10-28/30).
        const { keys, leaves } = walk(tk);
        expect(keys.filter((k) => /fee/i.test(k)), tk.state).toEqual([]);
        expect(leaves, tk.state).not.toContain(FEE);
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
      counterparty: { displayName: seller.displayName, completedTrades: 0, online: true },
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
        confirmWindowMin: 120, // fixed at take (seedTrade's); either side's wait before a dispute (owner p9-4)
        lockedRate: { currency: 'USD', centsPerXmr: '33000' }, maxFiatCents: '100000',
      });
    }
  });

  it('shows both traders when a release was claimed while settling, and nothing else about the mod (Task 9 I/O, open edge 2)', async () => {
    const seller = await trader();
    const buyer = await trader();
    const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
    await driveTo(deps, trade, 'settling');
    for (const who of [seller, buyer]) {
      const v = (await who.browser.get(`/v1/trades/${trade.code}`)).json() as View;
      expect(v).toMatchObject({ state: 'settling', releaseClaimedAt: null });
      expect(v.settleBy).not.toBeNull();
      expect(v.nextDeadline).toBe(v.settleBy);
    }
    const claimed = await applyEvent(deps, trade.code, { type: 'release-claimed' }, 'system');
    for (const who of [seller, buyer]) {
      const v = (await who.browser.get(`/v1/trades/${trade.code}`)).json() as View;
      // The claim time only; the settle window stays as it was (a party may still dispute after it).
      expect(v).toMatchObject({
        state: 'settling', releaseClaimedAt: claimed.releaseClaimedAt!.toISOString(),
        settleBy: claimed.settleBy!.toISOString(), nextDeadline: null,
      });
      expect(Object.keys(v).filter((k) => /claim|mod/i.test(k))).toEqual(['releaseClaimedAt']);
    }
  });

  it('sends no claim outside settling: an escalated claimed trade shows releaseClaimedAt null (lead decision M5)', async () => {
    const seller = await trader();
    const buyer = await trader();
    const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
    await driveTo(deps, trade, 'settling');
    await applyEvent(deps, trade.code, { type: 'release-claimed' }, 'system');
    const escalated = await applyEvent(deps, trade.code, { type: 'escalate' }, 'system');
    expect(escalated.state).toBe('disputed');
    // The stored claim survives the escalation; the view does not publish it.
    expect(escalated.releaseClaimedAt).not.toBeNull();
    for (const who of [seller, buyer]) {
      const v = (await who.browser.get(`/v1/trades/${trade.code}`)).json() as View;
      expect(v).toMatchObject({ state: 'disputed', releaseClaimedAt: null });
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
    const cp: TraderSummary = { displayName: 'x', completedTrades: 0, online: false, lastSeenAt: null, typicalMinutes: null, positivePct: null, badges: [], stage: 'starter', tradedOverXmr: null, imported: [] };
    expect(() => toTradeView(trade, '00000000-0000-0000-0000-000000000000', new Date(), { counterparty: cp, profile: null, sellerWalletApp: null })).toThrow();
    expect(toTradeView(trade, buyer.id, new Date(), { counterparty: cp, profile: null, sellerWalletApp: null }).fee).toEqual({ atomic: FEE });
    expect('fee' in toTradeView(trade, seller.id, new Date(), { counterparty: cp, profile: null, sellerWalletApp: null })).toBe(false);
  });
});
