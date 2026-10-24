import { TradeRuleError, type Trade } from '@x2f/trade';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { ApiError } from '../src/errors.js';
import { applyEvent, eventRecord, loadTrade, type TradePublisher } from '../src/trades/store.js';
import { seedAccount } from './helpers/accounts.js';
import { testConfig } from './helpers/app.js';
import { testDb } from './helpers/db.js';
import { driveTo, fakeAddress, happyPath, seedTrade } from './helpers/trades.js';

let deps: Pick<Deps, 'db' | 'clock' | 'config'>;
let now = new Date('2026-10-17T12:00:00Z');
let n = 0;

beforeAll(async () => {
  deps = { db: await testDb(), clock: () => now, config: testConfig() };
});
afterAll(async () => {
  await deps.db.end();
});

async function pair() {
  const seller = await seedAccount(deps, { username: `seller${++n}x` });
  const buyer = await seedAccount(deps, { username: `buyer${n}x` });
  return { seller, buyer };
}

async function eventsOf(code: string): Promise<{ by: string; event: Record<string, unknown> }[]> {
  const { rows } = await deps.db.query<{ by: string; event: Record<string, unknown> }>(
    'select by, event from trade_events where code = $1 order by id', [code],
  );
  return rows;
}

describe('trade store', () => {
  it('round-trips every Trade field through insert and load', async () => {
    const p = await pair();
    const { trade } = await seedTrade(deps, { sellerId: p.seller, buyerId: p.buyer, poster: 'buyer' });
    expect(await loadTrade(deps.db, trade.code)).toEqual(trade);
    const done = await driveTo(deps, trade, 'released');
    expect(await loadTrade(deps.db, trade.code)).toEqual(done);
  });

  it('applies an event, writes the row and appends one event in the same step', async () => {
    const p = await pair();
    const { trade } = await seedTrade(deps, { sellerId: p.seller, buyerId: p.buyer, poster: 'seller' });
    const escrow = fakeAddress();
    const next = await applyEvent(deps, trade.code, { type: 'setup-done', escrowAddress: escrow }, 'system');
    expect(next.state).toBe('funding');
    expect(await loadTrade(deps.db, trade.code)).toEqual(next);
    expect(await eventsOf(trade.code)).toEqual([{ by: 'system', event: { type: 'setup-done', escrowAddressEnd: escrow.slice(-6) } }]);
  });

  it('writes nothing on a rule refusal and passes the TradeRuleError through', async () => {
    const p = await pair();
    const { trade } = await seedTrade(deps, { sellerId: p.seller, buyerId: p.buyer, poster: 'seller' });
    await expect(applyEvent(deps, trade.code, { type: 'release-started' }, 'seller')).rejects.toBeInstanceOf(TradeRuleError);
    await expect(applyEvent(deps, trade.code, { type: 'tick' }, 'buyer')).rejects.toMatchObject({ code: 'wrong-party' });
    expect(await loadTrade(deps.db, trade.code)).toEqual(trade);
    expect(await eventsOf(trade.code)).toEqual([]);
  });

  it('answers 404 not-found for an unknown code', async () => {
    const err = await applyEvent(deps, 'ZZZZ-ZZZZ-ZZZZ-ZZZZ', { type: 'tick' }, 'system').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, code: 'not-found' });
  });

  it('serialises concurrent events on one trade (SELECT ... FOR UPDATE)', async () => {
    const p = await pair();
    const { trade } = await seedTrade(deps, { sellerId: p.seller, buyerId: p.buyer, poster: 'seller' });
    const secured = await driveTo(deps, trade, 'secured');
    const saved = now;
    now = new Date(secured.payBy!.getTime() + 60_000);
    try {
      // Five extends at once past payBy: exactly one moves payBy; the rest see the new deadline.
      // Another connection holds the row first, so all five are in flight together when it lets go.
      const holder = await deps.db.connect();
      await holder.query('begin');
      await holder.query('select 1 from trades where code = $1 for update', [trade.code]);
      const pending = Promise.allSettled(Array.from({ length: 5 }, () => applyEvent(deps, trade.code, { type: 'extend' }, 'seller')));
      await new Promise((r) => setTimeout(r, 300));
      await holder.query('commit');
      holder.release();
      const results = await pending;
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const r of results) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(TradeRuleError);
      expect((await loadTrade(deps.db, trade.code))!.extensions).toBe(1);
      expect((await eventsOf(trade.code)).filter((e) => e.event.type === 'extend')).toHaveLength(1);
    } finally {
      now = saved;
    }
  });

  it('publishes after commit, and a failing publish neither fails nor undoes the event', async () => {
    const p = await pair();
    const { trade } = await seedTrade(deps, { sellerId: p.seller, buyerId: p.buyer, poster: 'seller' });
    const seen: { state: string; committed: string | undefined }[] = [];
    const publish: TradePublisher = async (t: Trade) => {
      // Read through another connection: the row must already be committed.
      seen.push({ state: t.state, committed: (await loadTrade(deps.db, t.code))?.state });
    };
    await applyEvent({ ...deps, publish }, trade.code, { type: 'setup-done', escrowAddress: fakeAddress() }, 'system');
    expect(seen).toEqual([{ state: 'funding', committed: 'funding' }]);
    const boom: TradePublisher = () => {
      throw new Error('down');
    };
    const next = await applyEvent({ ...deps, publish: boom }, trade.code, { type: 'propose-cancel' }, 'buyer');
    expect(next.cancelProposedBy).toBe('buyer');
    expect((await loadTrade(deps.db, trade.code))!.cancelProposedBy).toBe('buyer');
  });

  it('never stores a full address in trade_events over a whole trade (P3-I12)', async () => {
    const p = await pair();
    const { trade, sides } = await seedTrade(deps, { sellerId: p.seller, buyerId: p.buyer, poster: 'seller' });
    const escrow = fakeAddress();
    for (const step of happyPath(trade, escrow)) await applyEvent(deps, trade.code, step.e, step.by);
    const { rows } = await deps.db.query<{ text: string }>('select event::text as text from trade_events where code = $1', [trade.code]);
    expect(rows).toHaveLength(6);
    for (const { text } of rows) {
      for (const a of [escrow, sides.buyerPayout!, sides.sellerRefund!]) {
        // No 12-character run of an address (more than its last 6) appears.
        for (let i = 0; i + 12 <= a.length; i++) expect(text).not.toContain(a.slice(i, i + 12));
      }
    }
  });

  it('eventRecord replaces any address-named field with its last 6 and writes bigints as strings', () => {
    expect(eventRecord({ type: 'chain', receivedAtomic: 5n, unlockedAtomic: 2n, confirmations: 3 })).toEqual({
      type: 'chain', receivedAtomic: '5', unlockedAtomic: '2', confirmations: 3,
    });
    const future = { type: 'setup-done', escrowAddress: '5'.repeat(90) + 'abcdef', refundAddress: '4xyz123456' } as never;
    expect(eventRecord(future)).toEqual({ type: 'setup-done', escrowAddressEnd: 'abcdef', refundAddressEnd: '123456' });
  });
});
