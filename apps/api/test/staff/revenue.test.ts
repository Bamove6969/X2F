// Plan 4 Task 32 (B-004): the internal revenue ledger. The owner's rules (HANDOFF "Decided
// 2026-10-29c"): the poster pays the 1% on a released trade and on a settled dispute, never on a
// cancel; a loser with no money in the escrow still owes the 1%, taken from future trades, and the
// ledger books it when it is collected. The ledger is an aggregate by day, market and kind that
// keeps its amounts after the trade purge; the per-trade marker (code and amount only) goes with
// the trade. Owner only on the staff API. Real Postgres.
import { randomBytes } from 'node:crypto';
import { escrowPlan, payoutsFor, type RulingKind, type SettleKind, type Trade } from '@x2f/trade';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/app.js';
import { bookOwedFeeCollected, bookTradeRevenue, feeOutputAtomic, parseRevenueQuery, usdEstimateCents } from '../../src/staff/revenue.js';
import { applyEvent } from '../../src/trades/store.js';
import { seedAccount } from '../helpers/accounts.js';
import { StaffBrowser, errorOf, insertSession, seedStaff, staffApps, uniqueName } from '../helpers/staffApp.js';
import { driveTo, fakeAddress, seedTrade, XMR } from '../helpers/trades.js';

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let close: () => Promise<void>;
let ownerId: string;
/** The owner with a session started now (the tests move the clock by weeks; a session lasts hours). */
const asOwner = async (): Promise<StaffBrowser> => new StaffBrowser(app).withSession((await insertSession(deps, ownerId, 'staff')).token);

const tx = () => randomBytes(32).toString('hex');
const WIDE = { minFiatCents: 1n, maxFiatCents: 10n ** 15n };

beforeAll(async () => {
  ({ app, deps, setNow, close } = await staffApps());
  setNow(new Date('2026-03-01T12:00:00Z'));
  ownerId = (await seedStaff(deps, { role: 'owner' })).id;
});
afterAll(async () => close());

const trader = () => seedAccount(deps, { loginName: uniqueName('t') });

/** A fresh trade between two new traders, at the clock's time, in `secured` (or further, `to`). */
async function trade(o: { poster?: 'seller' | 'buyer'; amountAtomic?: bigint; usdCents?: bigint; to?: Trade['state'] } = {}): Promise<Trade> {
  const { trade: t } = await seedTrade(deps, {
    sellerId: await trader(), buyerId: await trader(), poster: o.poster ?? 'seller', amountAtomic: o.amountAtomic ?? XMR,
    usdCents: o.usdCents ?? 33_000n, ...WIDE,
  });
  return driveTo(deps, t, o.to ?? 'secured');
}

const ledgerDay = async (day: string) =>
  (await deps.db.query<{ kind: string; currency: string; trades: number; fee_atomic: string; usd_estimate_cents: string }>(
    'select kind, currency, trades, fee_atomic::text, usd_estimate_cents::text from revenue_ledger where day = $1 order by kind, currency', [day],
  )).rows;
const booked = async (code: string) =>
  (await deps.db.query<{ kind: string; fee_atomic: string }>('select kind, fee_atomic::text from revenue_booked where trade_code = $1 order by kind', [code])).rows;
const withClient = async <T>(f: (c: pg.PoolClient) => Promise<T>): Promise<T> => {
  const c = await deps.db.connect();
  try {
    return await f(c);
  } finally {
    c.release();
  }
};

describe('the fee each settlement pays to the fee wallet (feeOutputAtomic, as payoutsFor)', () => {
  const amount = 2n * XMR;
  const kinds: (SettleKind | RulingKind)[] = ['release', 'mutual-cancel', 'buyer-cancel', 'auto-refund', 'lapse-refund', 'dispute-buyer', 'dispute-seller'];
  for (const poster of ['seller', 'buyer'] as const) {
    for (const kind of kinds) {
      it(`${kind}, ${poster}'s ad: the ledger books exactly the payout set's fee output`, () => {
        const plan = escrowPlan({ amountAtomic: amount, poster });
        const feeWallet = fakeAddress();
        const outs = payoutsFor({
          kind, amountAtomic: amount, feeAtomic: plan.feeAtomic, poster, sellerFundsAtomic: plan.sellerFundsAtomic,
          balanceAtomic: plan.sellerFundsAtomic, buyerPayout: fakeAddress(), sellerRefund: fakeAddress(), feeWallet,
        });
        const paid = outs.filter((p) => p.address === feeWallet).reduce((s, p) => s + p.amountAtomic, 0n);
        expect(feeOutputAtomic(kind, poster, plan.feeAtomic)).toBe(paid);
      });
    }
  }

  it('released yes, settled dispute yes (except the buyer-ad poster who loses: owed), every cancel no', () => {
    const fee = 12_345n;
    expect(feeOutputAtomic('release', 'buyer', fee)).toBe(fee);
    expect(feeOutputAtomic('dispute-buyer', 'buyer', fee)).toBe(fee);
    expect(feeOutputAtomic('dispute-seller', 'seller', fee)).toBe(fee);
    expect(feeOutputAtomic('dispute-seller', 'buyer', fee)).toBe(0n);
    for (const k of ['mutual-cancel', 'buyer-cancel', 'auto-refund', 'lapse-refund', null, 'something-new']) expect(feeOutputAtomic(k, 'seller', fee)).toBe(0n);
  });

  it('the USD estimate is the fee at the take-time value, rounded down; no value, no estimate', () => {
    expect(usdEstimateCents(10n ** 10n, 33_000n, XMR)).toBe(330n);
    expect(usdEstimateCents(3n, 10n, 7n)).toBe(4n);
    expect(usdEstimateCents(10n ** 10n, null, XMR)).toBe(0n);
  });
});

describe('booking through the trade store', () => {
  it('a released trade books its 1% once, even if the hook runs again', async () => {
    setNow(new Date('2026-03-02T10:00:00Z'));
    const t = await trade({ to: 'released', usdCents: 33_000n });
    const fee = escrowPlan({ amountAtomic: XMR, poster: 'seller' }).feeAtomic;
    expect(await ledgerDay('2026-03-02')).toEqual([{ kind: 'fee', currency: 'USD', trades: 1, fee_atomic: fee.toString(), usd_estimate_cents: '330' }]);
    expect(await booked(t.code)).toEqual([{ kind: 'fee', fee_atomic: fee.toString() }]);
    expect(await withClient((c) => bookTradeRevenue(c, t.code))).toBe(false);
    expect(await withClient((c) => bookTradeRevenue(c, t.code, 'release'))).toBe(false);
    expect((await ledgerDay('2026-03-02'))[0]!.trades).toBe(1);
    // A second release the same day adds to the same row.
    await trade({ to: 'released', poster: 'buyer' });
    expect(await ledgerDay('2026-03-02')).toEqual([{ kind: 'fee', currency: 'USD', trades: 2, fee_atomic: (2n * fee).toString(), usd_estimate_cents: '660' }]);
  });

  it('every cancel kind books nothing: buyer cancel, mutual cancel, auto (no-show) refund, lapse refund, walk-away', async () => {
    setNow(new Date('2026-03-03T10:00:00Z'));
    for (const kind of ['buyer-cancel', 'mutual-cancel', 'auto-refund', 'lapse-refund'] as const) {
      const t = await trade();
      const after = await applyEvent(deps, t.code, { type: 'settled', kind, txHash: tx() }, 'system');
      expect(after.state).toBe('refunded');
      expect(await booked(t.code)).toEqual([]);
      expect(await withClient((c) => bookTradeRevenue(c, t.code))).toBe(false);
    }
    // Walk-away and a cancel before funding close the trade as `cancelled`, with no settlement at all.
    const { trade: w } = await seedTrade(deps, { sellerId: await trader(), buyerId: await trader(), poster: 'seller' });
    expect((await applyEvent(deps, w.code, { type: 'walk-away' }, 'seller')).state).toBe('cancelled');
    const { trade: b } = await seedTrade(deps, { sellerId: await trader(), buyerId: await trader(), poster: 'buyer' });
    expect((await applyEvent(deps, b.code, { type: 'buyer-cancel' }, 'buyer')).state).toBe('cancelled');
    for (const code of [w.code, b.code]) {
      expect(await withClient((c) => bookTradeRevenue(c, code, 'release'))).toBe(false);
      expect(await booked(code)).toEqual([]);
    }
    expect(await ledgerDay('2026-03-03')).toEqual([]);
  });

  it('an open trade books nothing, whatever kind is named', async () => {
    const t = await trade({ to: 'paid' });
    expect(await withClient((c) => bookTradeRevenue(c, t.code, 'release'))).toBe(false);
    expect(await booked(t.code)).toEqual([]);
  });

  it('a settled dispute: released to the buyer books the 1% once; a seller win on a seller ad books it when the ruling names its payout set', async () => {
    setNow(new Date('2026-03-04T10:00:00Z'));
    const fee = escrowPlan({ amountAtomic: XMR, poster: 'seller' }).feeAtomic;
    // Escalated while settling: the dispute ends with the release (the ruling's dispute-buyer set).
    const won = await trade({ to: 'settling' });
    expect((await applyEvent(deps, won.code, { type: 'escalate' }, 'system')).state).toBe('disputed');
    const released = await applyEvent(deps, won.code, { type: 'settled', kind: 'release', txHash: tx() }, 'system');
    expect({ state: released.state, disputed: released.dispute !== null }).toEqual({ state: 'released', disputed: true });
    expect(await booked(won.code)).toEqual([{ kind: 'fee', fee_atomic: fee.toString() }]);
    expect(await withClient((c) => bookTradeRevenue(c, won.code, 'dispute-buyer'))).toBe(false);

    // Seller wins on a seller's ad: Task 14's execution names `dispute-seller` (the row's own
    // settling is a refund kind on this tree, which pays nothing): the 1% is booked once.
    const lost = await trade({ to: 'settling' });
    await applyEvent(deps, lost.code, { type: 'escalate' }, 'system');
    expect((await applyEvent(deps, lost.code, { type: 'settled', kind: 'auto-refund', txHash: tx() }, 'system')).state).toBe('refunded');
    expect(await booked(lost.code)).toEqual([]);
    expect(await withClient((c) => bookTradeRevenue(c, lost.code, 'dispute-seller'))).toBe(true);
    expect(await withClient((c) => bookTradeRevenue(c, lost.code, 'dispute-seller'))).toBe(false);
    expect(await booked(lost.code)).toEqual([{ kind: 'fee', fee_atomic: fee.toString() }]);

    // Seller wins on a BUYER's ad: no fee in the escrow, nothing booked now (the poster owes it).
    const owes = await trade({ to: 'settling', poster: 'buyer' });
    await applyEvent(deps, owes.code, { type: 'escalate' }, 'system');
    await applyEvent(deps, owes.code, { type: 'settled', kind: 'auto-refund', txHash: tx() }, 'system');
    expect(await withClient((c) => bookTradeRevenue(c, owes.code, 'dispute-seller'))).toBe(false);
    expect(await booked(owes.code)).toEqual([]);

    expect(await ledgerDay('2026-03-04')).toEqual([{ kind: 'fee', currency: 'USD', trades: 2, fee_atomic: (2n * fee).toString(), usd_estimate_cents: '660' }]);
  });

  it('an owed fee is booked as revenue on the day it is collected, on the collecting trade, once', async () => {
    setNow(new Date('2026-03-05T10:00:00Z'));
    const next = await trade({ to: 'released', poster: 'buyer', usdCents: 33_000n });
    const owed = 7_000_000_000n;
    const at = new Date('2026-03-05T11:00:00Z');
    expect(await withClient((c) => bookOwedFeeCollected(c, { code: next.code, collectedAtomic: owed, at }))).toBe(true);
    expect(await withClient((c) => bookOwedFeeCollected(c, { code: next.code, collectedAtomic: owed, at }))).toBe(false);
    expect(await withClient((c) => bookOwedFeeCollected(c, { code: next.code, collectedAtomic: 0n, at }))).toBe(false);
    const fee = escrowPlan({ amountAtomic: XMR, poster: 'buyer' }).feeAtomic;
    expect(await ledgerDay('2026-03-05')).toEqual([
      { kind: 'fee', currency: 'USD', trades: 1, fee_atomic: fee.toString(), usd_estimate_cents: '330' },
      { kind: 'owed', currency: 'USD', trades: 1, fee_atomic: owed.toString(), usd_estimate_cents: '231' },
    ]);
    expect(await booked(next.code)).toEqual([{ kind: 'fee', fee_atomic: fee.toString() }, { kind: 'owed', fee_atomic: owed.toString() }]);
    await expect(withClient((c) => bookOwedFeeCollected(c, { code: next.code, collectedAtomic: -1n, at }))).rejects.toThrow(RangeError);
  });
});

describe('retention: the ledger keeps amounts, not codes', () => {
  it('holds no trade or account column; the per-trade marker goes with its trade (on delete cascade)', async () => {
    const cols = (await deps.db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'revenue_ledger' order by ordinal_position`,
    )).rows.map((r) => r.column_name);
    expect(cols).toEqual(['day', 'currency', 'kind', 'trades', 'fee_atomic', 'usd_estimate_cents']);
    const fk = await deps.db.query<{ confdeltype: string }>(
      `select confdeltype from pg_constraint where conrelid = 'revenue_booked'::regclass and contype = 'f'`,
    );
    expect(fk.rows).toEqual([{ confdeltype: 'c' }]);
  });

  it('after the trade is purged the ledger is unchanged, and the code can never be booked again', async () => {
    setNow(new Date('2026-03-06T10:00:00Z'));
    const t = await trade({ to: 'released' });
    const before = await ledgerDay('2026-03-06');
    expect(before).toHaveLength(1);
    // Plan 7's whole-trade purge is not on this tree: remove the trade directly (triggers and
    // foreign keys off for this transaction only, as tradedTotal.test.ts does) with its marker.
    await withClient(async (c) => {
      await c.query('begin');
      await c.query("set local session_replication_role = 'replica'");
      await c.query('delete from revenue_booked where trade_code = $1', [t.code]);
      await c.query('delete from trades where code = $1', [t.code]);
      await c.query('commit');
    });
    expect(await ledgerDay('2026-03-06')).toEqual(before);
    expect(await withClient((c) => bookTradeRevenue(c, t.code, 'release'))).toBe(false);
    expect(await ledgerDay('2026-03-06')).toEqual(before);
  });

  it('the ledger is add-only: lowering, deleting or truncating is refused', async () => {
    await expect(deps.db.query("update revenue_ledger set fee_atomic = 0 where day = '2026-03-02'")).rejects.toMatchObject({ code: '42501' });
    await expect(deps.db.query("delete from revenue_ledger where day = '2026-03-02'")).rejects.toMatchObject({ code: '42501' });
    await expect(deps.db.query('truncate revenue_ledger')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('GET /staff/v1/revenue (owner only)', () => {
  it('totals by day and by month, with the owed collections apart and the outstanding total not yet known', async () => {
    setNow(new Date('2026-04-10T10:00:00Z'));
    await trade({ to: 'released', amountAtomic: 3n * XMR });
    const fee3 = escrowPlan({ amountAtomic: 3n * XMR, poster: 'seller' }).feeAtomic;
    const fee1 = escrowPlan({ amountAtomic: XMR, poster: 'seller' }).feeAtomic;
    const owner = await asOwner();

    const byDay = await owner.get('/staff/v1/revenue?by=day&from=2026-03-02&to=2026-03-03');
    expect(byDay.statusCode, byDay.body).toBe(200);
    expect(byDay.json()).toMatchObject({
      by: 'day', from: '2026-03-02', to: '2026-03-03',
      buckets: [{ period: '2026-03-02', trades: 2, feeAtomic: (2n * fee1).toString(), owedCollectedAtomic: '0', owedCollections: 0, totalAtomic: (2n * fee1).toString(), usdEstimateCents: '660' }],
      owedOutstandingAtomic: null,
    });

    const byMonth = await owner.get('/staff/v1/revenue?by=month&from=2026-03-01&to=2026-04-30');
    expect(byMonth.statusCode, byMonth.body).toBe(200);
    const body = byMonth.json() as { buckets: Array<{ period: string; trades: number; owedCollectedAtomic: string; totalAtomic: string }>; total: { trades: number; owedCollections: number }; byCurrency: Array<{ period: string }> };
    expect(body.buckets.map((b) => b.period)).toEqual(['2026-03', '2026-04']);
    // March: 2 (Mar 2) + 2 (Mar 4) + 1 (Mar 5) + 1 (Mar 6, purged trade, still counted) released or settled.
    expect(body.buckets[0]).toMatchObject({ trades: 6, owedCollectedAtomic: '7000000000' });
    expect(body.buckets[1]).toMatchObject({ trades: 1, totalAtomic: fee3.toString() });
    expect(body.total).toMatchObject({ trades: 7, owedCollections: 1 });
    expect(body.byCurrency.map((b) => b.period)).toEqual(['USD']);

    // Defaults: by month, to today, from eleven months back.
    const dflt = await owner.get('/staff/v1/revenue');
    expect(dflt.json()).toMatchObject({ by: 'month', from: '2025-05-01', to: '2026-04-10' });
  });

  it('refuses a malformed or too-long range', async () => {
    const owner = await asOwner();
    for (const q of ['by=week', 'from=2026-02-30', 'from=2026-05-01&to=2026-04-01', 'by=day&from=2025-01-01&to=2026-04-01', 'from=yesterday', 'code=AAAA']) {
      const res = await owner.get(`/staff/v1/revenue?${q}`);
      expect({ q, status: res.statusCode, error: errorOf(res) }).toEqual({ q, status: 400, error: 'bad-request' });
    }
    expect(parseRevenueQuery({ by: 'day' }, new Date('2026-04-10T23:00:00Z'))).toEqual({ by: 'day', from: '2026-03-11', to: '2026-04-10' });
  });

  it('a senior moderator, a moderator and a helper get forbidden', async () => {
    for (const role of ['senior', 'mod', 'helper'] as const) {
      const id = (await seedStaff(deps, { role })).id;
      const res = await new StaffBrowser(app).withSession((await insertSession(deps, id, 'staff')).token).get('/staff/v1/revenue');
      expect({ role, status: res.statusCode, error: errorOf(res) }).toEqual({ role, status: 403, error: 'forbidden' });
    }
  });
});
