import { randomBytes } from 'node:crypto';
import { addressEnd } from '@x2f/accounts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { applyEvent } from '../src/trades/store.js';
import { driveTo, fakeAddress, seedTrade } from './helpers/trades.js';
import { tradeApp } from './helpers/tradeApp.js';

// GET /v1/trades/:code/confirmations (Task 24): the released screen's live "1 of 10", read from
// X2F's own node for this trade's settlement tx only. Auth and role rules are Task 6's: a trader
// session, participants only, everyone else the same 404 as an unknown code.

let app: FastifyInstance;
let deps: Deps;
let logs: string[];
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];

/** What the stubbed node answers per tx hash; `asked` records every hash the route looked up. */
const node = new Map<string, number | null | Error>();
const asked: string[] = [];

beforeAll(async () => {
  ({ app, deps, trader, logs } = await tradeApp({
    txConfirmations: async (txHash: string) => {
      asked.push(txHash);
      const v = node.get(txHash);
      if (v instanceof Error) throw v;
      return v ?? null;
    },
  }));
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  asked.length = 0;
});

const url = (code: string) => `/v1/trades/${code}/confirmations`;
const errorOf = (res: { json(): unknown }) => (res.json() as { error?: string }).error;

async function released(o: { poster?: 'seller' | 'buyer'; buyerPayout?: string | null } = {}) {
  const seller = await trader();
  const buyer = await trader();
  const { trade, sides } = await seedTrade(deps, {
    sellerId: seller.id, buyerId: buyer.id, poster: o.poster ?? 'seller',
    ...(o.buyerPayout !== undefined ? { buyerPayout: o.buyerPayout } : {}),
  });
  const t = await driveTo(deps, trade, 'released');
  return { seller, buyer, t, sides, txHash: t.txHash! };
}

describe('GET /v1/trades/:code/confirmations', () => {
  it('needs a trader session: 401 without one, 403 wrong-account-kind for staff', async () => {
    const { t } = await released();
    const anon = await app.inject({ method: 'GET', url: url(t.code) });
    expect(anon.statusCode).toBe(401);
    const staff = await trader('staff');
    const res = await staff.browser.get(url(t.code));
    expect(res.statusCode).toBe(403);
    expect(errorOf(res)).toBe('wrong-account-kind');
    expect(asked).toEqual([]);
  });

  it('answers a non-participant exactly like an unknown or malformed code, and never asks the node', async () => {
    const { t } = await released();
    node.set(t.txHash!, 4);
    const other = await trader();
    const mine = await other.browser.get(url(t.code));
    const unknown = await other.browser.get(url('ZZZZ-ZZZZ-ZZZZ-ZZZZ'));
    const malformed = await other.browser.get(url('not-a-code'));
    for (const res of [mine, unknown, malformed]) {
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not-found' });
    }
    expect(asked).toEqual([]);
  });

  it('gives the buyer the count and their own payout ending, nothing else', async () => {
    const { buyer, t, sides, txHash } = await released();
    node.set(txHash, 3);
    const res = await buyer.browser.get(url(t.code));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ confirmations: 3, target: 10, payoutEnd: addressEnd(sides.buyerPayout!) });
    expect(asked).toEqual([txHash]);
  });

  it('gives the seller the count only: no payout ending, no address, no tx hash (no data leak)', async () => {
    for (const poster of ['seller', 'buyer'] as const) {
      const { seller, t, sides, txHash } = await released({ poster });
      node.set(txHash, 1);
      const res = await seller.browser.get(url(t.code));
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ confirmations: 1, target: 10 });
      const body = res.body;
      for (const secret of [sides.buyerPayout!, sides.sellerRefund!, addressEnd(sides.buyerPayout!), txHash]) {
        expect(body).not.toContain(secret);
      }
    }
  });

  it('looks up only this trade\'s own settlement tx, whatever the request says', async () => {
    const a = await released();
    const b = await released();
    node.set(a.txHash, 2);
    node.set(b.txHash, 7);
    const forged = randomBytes(32).toString('hex');
    node.set(forged, 99);
    const res = await a.buyer.browser.get(`${url(a.t.code)}?txHash=${forged}&tx=${b.txHash}&code=${b.t.code}`);
    expect(res.json()).toMatchObject({ confirmations: 2 });
    expect((await b.seller.browser.get(url(b.t.code))).json()).toMatchObject({ confirmations: 7 });
    expect(asked).toEqual([a.txHash, b.txHash]);
    // A participant of one trade cannot read the other through it.
    expect((await a.buyer.browser.get(url(b.t.code))).statusCode).toBe(404);
  });

  it('accepts a code in any spelling normalizeTradeCode accepts', async () => {
    const { buyer, t, txHash } = await released();
    node.set(txHash, 5);
    const res = await buyer.browser.get(url(t.code.toLowerCase().replaceAll('-', '')));
    expect(res.json()).toMatchObject({ confirmations: 5 });
  });

  it('refuses a trade with no settlement tx yet with 409 wrong-state, before asking the node', async () => {
    for (const state of ['setup', 'secured', 'paid', 'settling'] as const) {
      const seller = await trader();
      const buyer = await trader();
      const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
      await driveTo(deps, trade, state);
      for (const who of [seller, buyer]) {
        const res = await who.browser.get(url(trade.code));
        expect(res.statusCode, state).toBe(409);
        expect(errorOf(res), state).toBe('wrong-state');
      }
    }
    expect(asked).toEqual([]);
  });

  it('serves a refunded trade too, with no payout ending for anyone (the buyer received nothing)', async () => {
    const seller = await trader();
    const buyer = await trader();
    const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'buyer' });
    await driveTo(deps, trade, 'secured');
    await applyEvent(deps, trade.code, { type: 'buyer-cancel' }, 'buyer');
    const txHash = randomBytes(32).toString('hex');
    await applyEvent(deps, trade.code, { type: 'settled', kind: 'buyer-cancel', txHash }, 'system');
    node.set(txHash, 6);
    for (const who of [seller, buyer]) {
      const res = await who.browser.get(url(trade.code));
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ confirmations: 6, target: 10 });
    }
  });

  it('leaves out the payout ending once the address has been purged', async () => {
    const { buyer, t, txHash } = await released({ buyerPayout: null });
    node.set(txHash, 10);
    expect((await buyer.browser.get(url(t.code))).json()).toEqual({ confirmations: 10, target: 10 });
  });

  it('answers null when the node does not know the tx or cannot be reached, and logs nothing about the trade', async () => {
    const { buyer, t, txHash, sides } = await released();
    node.set(txHash, null);
    expect((await buyer.browser.get(url(t.code))).json()).toMatchObject({ confirmations: null, target: 10 });
    const before = logs.length;
    node.set(txHash, new Error(`daemon at http://127.0.0.1:18081 refused ${txHash} for ${t.code}`));
    const res = await buyer.browser.get(url(t.code));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ confirmations: null, target: 10 });
    const lines = logs.slice(before).join('\n');
    expect(lines).toContain('confirmations lookup failed');
    for (const secret of [txHash, t.code, sides.buyerPayout!, '127.0.0.1']) expect(lines).not.toContain(secret);
  });

  it('never stores or returns anything for a POST', async () => {
    const { buyer, t } = await released();
    const res = await buyer.browser.post(url(t.code), {});
    expect(res.statusCode).toBe(404);
  });
});

describe('the default lookup', () => {
  it('answers null when no node is configured', async () => {
    const t = await tradeApp();
    try {
      const seller = await t.trader();
      const buyer = await t.trader();
      const { trade } = await seedTrade(t.deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller', buyerPayout: fakeAddress() });
      await driveTo(t.deps, trade, 'released');
      expect((await buyer.browser.get(url(trade.code))).json()).toMatchObject({ confirmations: null, target: 10 });
    } finally {
      await t.app.close();
    }
  });
});
