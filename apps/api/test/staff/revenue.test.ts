// Plan 4 Task 32 (B-004): the internal revenue ledger. The owner's rules (HANDOFF "Decided
// 2026-10-29c"; owner g63, 7 Nov): the poster pays the 1% on a released trade and on a ruling that
// completes the trade, never on a cancel or a full reversal (everything back to the original
// parties); a loser who still owes the 1% (a lien) has it taken from future trades, and the ledger
// books it when it is collected. The ledger is an aggregate by day, market and kind that
// keeps its amounts after the trade purge; the per-trade marker (code and amount only) goes with
// the trade. Owner only on the staff API. Real Postgres.
import { randomBytes } from 'node:crypto';
import { escrowPlan, payoutsFor, type RulingKind, type SettleKind, type Trade } from '@x2f/trade';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/app.js';
import { bookOwedFeeCollected, bookSettlementNetworkFee, bookTradeRevenue, feeOutputAtomic, parseRevenueQuery, usdEstimateCents } from '../../src/staff/revenue.js';
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
        const payrollWallet = fakeAddress();
        const outs = payoutsFor({
          kind, amountAtomic: amount, feeAtomic: plan.feeAtomic, poster, sellerFundsAtomic: plan.sellerFundsAtomic,
          balanceAtomic: plan.sellerFundsAtomic, buyerPayout: fakeAddress(), sellerRefund: fakeAddress(), feeWallet, payrollWallet,
        });
        const paid = outs.filter((p) => p.address === feeWallet || p.address === payrollWallet).reduce((s, p) => s + p.amountAtomic, 0n);
        expect(feeOutputAtomic(kind, poster, plan.feeAtomic)).toBe(paid);
      });
    }
  }

  it('released yes, a ruling that completes the trade yes, a full reversal no (owner g63), every cancel no', () => {
    const fee = 12_345n;
    expect(feeOutputAtomic('release', 'buyer', fee)).toBe(fee);
    expect(feeOutputAtomic('dispute-buyer', 'buyer', fee)).toBe(fee);
    expect(feeOutputAtomic('dispute-buyer', 'seller', fee)).toBe(fee);
    // Owner g63 (7 Nov): a full reversal (everything back to the seller) takes no 1%, whoever posted.
    expect(feeOutputAtomic('dispute-seller', 'seller', fee)).toBe(0n);
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

  it('a refunded trade books nothing, whatever kind the caller names (owner g63: only a completed trade pays the 1%)', async () => {
    setNow(new Date('2026-03-07T10:00:00Z'));
    for (const poster of ['seller', 'buyer'] as const) {
      const t = await trade({ poster });
      expect((await applyEvent(deps, t.code, { type: 'settled', kind: 'auto-refund', txHash: tx() }, 'system')).state).toBe('refunded');
      for (const kind of [undefined, 'release', 'dispute-buyer', 'dispute-seller', 'auto-refund'] as const) {
        expect(await withClient((c) => bookTradeRevenue(c, t.code, kind)), `${poster} ${kind}`).toBe(false);
      }
      expect(await booked(t.code), poster).toEqual([]);
    }
    expect(await ledgerDay('2026-03-07')).toEqual([]);
  });

  it('a settled dispute: a ruling that completes the trade (released to the buyer) books the 1% once; a full reversal books nothing (owner g63)', async () => {
    setNow(new Date('2026-03-04T10:00:00Z'));
    const fee = escrowPlan({ amountAtomic: XMR, poster: 'seller' }).feeAtomic;
    // Escalated while settling: the dispute ends with the release (the ruling's dispute-buyer set):
    // the trade completes, the poster pays the 1%, as before.
    const won = await trade({ to: 'settling' });
    expect((await applyEvent(deps, won.code, { type: 'escalate' }, 'system')).state).toBe('disputed');
    const released = await applyEvent(deps, won.code, { type: 'settled', kind: 'release', txHash: tx() }, 'system');
    expect({ state: released.state, disputed: released.dispute !== null }).toEqual({ state: 'released', disputed: true });
    expect(await booked(won.code)).toEqual([{ kind: 'fee', fee_atomic: fee.toString() }]);
    expect(await withClient((c) => bookTradeRevenue(c, won.code, 'dispute-buyer'))).toBe(false);

    // Owner g63 (7 Nov): a full reversal (the ruling returns everything to the seller) charges no 1%
    // and books no revenue, whoever posted, even when the ruling's execution names its own
    // `dispute-seller` set (the row's own settling is a refund kind, which pays nothing either).
    for (const poster of ['seller', 'buyer'] as const) {
      const reversed = await trade({ to: 'settling', poster });
      await applyEvent(deps, reversed.code, { type: 'escalate' }, 'system');
      expect((await applyEvent(deps, reversed.code, { type: 'settled', kind: 'auto-refund', txHash: tx() }, 'system')).state).toBe('refunded');
      expect(await booked(reversed.code)).toEqual([]);
      expect(await withClient((c) => bookTradeRevenue(c, reversed.code, 'dispute-seller')), poster).toBe(false);
      expect(await withClient((c) => bookTradeRevenue(c, reversed.code)), poster).toBe(false);
      expect(await booked(reversed.code), poster).toEqual([]);
    }

    expect(await ledgerDay('2026-03-04')).toEqual([{ kind: 'fee', currency: 'USD', trades: 1, fee_atomic: fee.toString(), usd_estimate_cents: '330' }]);
  });

  it('an owed fee is booked as revenue on the day it is collected, on the collecting trade, once', async () => {
    setNow(new Date('2026-03-05T10:00:00Z'));
    const next = await trade({ to: 'released', poster: 'buyer', usdCents: 33_000n });
    const owed = 7_000_000_000n;
    const at = new Date('2026-03-05T11:00:00Z');
    expect(await withClient((c) => bookOwedFeeCollected(c, { code: next.code, debtId: 'debt-1', collectedAtomic: owed, at }))).toBe(true);
    expect(await withClient((c) => bookOwedFeeCollected(c, { code: next.code, debtId: 'debt-1', collectedAtomic: owed, at }))).toBe(false);
    expect(await withClient((c) => bookOwedFeeCollected(c, { code: next.code, debtId: 'debt-0', collectedAtomic: 0n, at }))).toBe(false);
    const fee = escrowPlan({ amountAtomic: XMR, poster: 'buyer' }).feeAtomic;
    expect(await ledgerDay('2026-03-05')).toEqual([
      { kind: 'fee', currency: 'USD', trades: 1, fee_atomic: fee.toString(), usd_estimate_cents: '330' },
      { kind: 'owed', currency: 'USD', trades: 1, fee_atomic: owed.toString(), usd_estimate_cents: '231' },
    ]);
    expect(await booked(next.code)).toEqual([{ kind: 'fee', fee_atomic: fee.toString() }, { kind: 'owed', fee_atomic: owed.toString() }]);
    await expect(withClient((c) => bookOwedFeeCollected(c, { code: next.code, debtId: 'debt-9', collectedAtomic: -1n, at }))).rejects.toThrow(RangeError);
  });
});

describe('retention: the ledger keeps amounts, not codes', () => {
  it('holds no trade or account column; the per-trade marker goes with its trade (on delete cascade)', async () => {
    const cols = (await deps.db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'revenue_ledger' order by ordinal_position`,
    )).rows.map((r) => r.column_name);
    // network_fee_atomic (migration 830) is an amount too, so the retention property holds.
    expect(cols).toEqual(['day', 'currency', 'kind', 'trades', 'fee_atomic', 'usd_estimate_cents', 'network_fee_atomic']);
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
  it('totals by day and by month, with the owed collections apart and the outstanding owed total (none here; migration 400)', async () => {
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
      owedOutstandingAtomic: '0',
    });

    const byMonth = await owner.get('/staff/v1/revenue?by=month&from=2026-03-01&to=2026-04-30');
    expect(byMonth.statusCode, byMonth.body).toBe(200);
    const body = byMonth.json() as { buckets: Array<{ period: string; trades: number; owedCollectedAtomic: string; totalAtomic: string }>; total: { trades: number; owedCollections: number }; byCurrency: Array<{ period: string }> };
    expect(body.buckets.map((b) => b.period)).toEqual(['2026-03', '2026-04']);
    // March: 2 (Mar 2) + 1 (Mar 4: the dispute released to the buyer; the full reversals book
    // nothing, owner g63) + 1 (Mar 5) + 1 (Mar 6, purged trade, still counted) released or settled.
    expect(body.buckets[0]).toMatchObject({ trades: 5, owedCollectedAtomic: '7000000000' });
    expect(body.buckets[1]).toMatchObject({ trades: 1, totalAtomic: fee3.toString() });
    expect(body.total).toMatchObject({ trades: 6, owedCollections: 1 });
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

describe('owed fees collected (the Task 12 seam, review F5)', () => {
  // One collecting trade can settle several debts; each is booked once (keyed by the debt).
  it('several owed fees collected by one trade: each debt is booked once, the trade counts as one collection', async () => {
    setNow(new Date('2026-06-07T10:00:00Z'));
    const next = await trade({ to: 'released', poster: 'seller', usdCents: 33_000n });
    const at = new Date('2026-06-07T11:00:00Z');
    const a = 2_000_000_000n;
    const b = 3_000_000_000n;
    expect(await withClient((c) => bookOwedFeeCollected(c, { code: next.code, debtId: 'debt-a', collectedAtomic: a, at }))).toBe(true);
    expect(await withClient((c) => bookOwedFeeCollected(c, { code: next.code, debtId: 'debt-b', collectedAtomic: b, at }))).toBe(true);
    expect(await withClient((c) => bookOwedFeeCollected(c, { code: next.code, debtId: 'debt-a', collectedAtomic: a, at }))).toBe(false);
    expect((await ledgerDay('2026-06-07')).filter((r) => r.kind === 'owed')).toEqual([
      { kind: 'owed', currency: 'USD', trades: 1, fee_atomic: (a + b).toString(), usd_estimate_cents: (66n + 99n).toString() },
    ]);
    expect((await booked(next.code)).filter((r) => r.kind === 'owed').map((r) => r.fee_atomic).sort()).toEqual([a.toString(), b.toString()]);
  });

  it('refuses to book an owed fee on a collecting trade that is not released', async () => {
    setNow(new Date('2026-06-07T12:00:00Z'));
    const open = await trade({ to: 'secured' });
    const at = new Date('2026-06-07T12:30:00Z');
    await expect(withClient((c) => bookOwedFeeCollected(c, { code: open.code, debtId: 'debt-c', collectedAtomic: XMR / 100n, at }))).rejects.toThrow(/not released/);
    const refunded = await trade({ to: 'settling' });
    await applyEvent(deps, refunded.code, { type: 'escalate' }, 'system');
    await applyEvent(deps, refunded.code, { type: 'settled', kind: 'auto-refund', txHash: tx() }, 'system');
    await expect(withClient((c) => bookOwedFeeCollected(c, { code: refunded.code, debtId: 'debt-d', collectedAtomic: XMR / 100n, at }))).rejects.toThrow(/not released/);
    expect(await booked(open.code)).toEqual([]);
    expect(await booked(refunded.code)).toEqual([]);
  });
});

// Owner 16 Nov: each receiver pays the network fee for its own payout output; X2F's fee output pays its wallet2 share.
// The books show the network fees X2F paid and the total after them.
describe('the network fee X2F\'s fee output paid (bookSettlementNetworkFee, migration 830)', () => {
  const netDay = async (day: string) =>
    (await deps.db.query<{ kind: string; fee_atomic: string; network_fee_atomic: string }>(
      'select kind, fee_atomic::text, network_fee_atomic::text from revenue_ledger where day = $1 order by kind, currency', [day],
    )).rows;
  const bookedNet = async (code: string) =>
    (await deps.db.query<{ network_fee_atomic: string | null }>("select network_fee_atomic::text from revenue_booked where trade_code = $1 and kind = 'fee'", [code])).rows;

  it('a released trade books the fee and payroll outputs\' shares of the tx fee (owner 26 Nov; the odd unit is the buyer\'s), once', async () => {
    setNow(new Date('2026-05-02T10:00:00Z'));
    const t = await trade({ to: 'released' });
    const fee = escrowPlan({ amountAtomic: XMR, poster: 'seller' }).feeAtomic;
    expect(await bookedNet(t.code)).toEqual([{ network_fee_atomic: null }]);
    expect(await withClient((c) => bookSettlementNetworkFee(c, t.code, 30_720_001n))).toBe(true);
    expect(await bookedNet(t.code)).toEqual([{ network_fee_atomic: '20480000' }]);
    expect(await netDay('2026-05-02')).toEqual([{ kind: 'fee', fee_atomic: fee.toString(), network_fee_atomic: '20480000' }]);
    // Again (a replayed report, or another fee): nothing more.
    expect(await withClient((c) => bookSettlementNetworkFee(c, t.code, 30_720_001n))).toBe(false);
    expect(await withClient((c) => bookSettlementNetworkFee(c, t.code, 99_000_000n))).toBe(false);
    expect(await netDay('2026-05-02')).toEqual([{ kind: 'fee', fee_atomic: fee.toString(), network_fee_atomic: '20480000' }]);
    // A second trade the same day adds to the same row.
    const t2 = await trade({ to: 'released', poster: 'buyer' });
    expect(await withClient((c) => bookSettlementNetworkFee(c, t2.code, 20_000_000n))).toBe(true);
    expect(await netDay('2026-05-02')).toEqual([{ kind: 'fee', fee_atomic: (2n * fee).toString(), network_fee_atomic: '33813333' }]);
  });

  it('a refunded trade, an open trade and a bad fee book nothing', async () => {
    setNow(new Date('2026-05-03T10:00:00Z'));
    const refunded = await trade();
    await applyEvent(deps, refunded.code, { type: 'settled', kind: 'auto-refund', txHash: tx() }, 'system');
    expect(await withClient((c) => bookSettlementNetworkFee(c, refunded.code, 30_720_000n))).toBe(false);
    const open = await trade();
    expect(await withClient((c) => bookSettlementNetworkFee(c, open.code, 30_720_000n))).toBe(false);
    const released = await trade({ to: 'released' });
    await expect(withClient((c) => bookSettlementNetworkFee(c, released.code, -1n))).rejects.toThrow(RangeError);
    expect(await withClient((c) => bookSettlementNetworkFee(c, released.code, 0n))).toBe(false);
    expect(await bookedNet(released.code)).toEqual([{ network_fee_atomic: null }]);
    expect(await netDay('2026-05-03')).toEqual([{ kind: 'fee', fee_atomic: escrowPlan({ amountAtomic: XMR, poster: 'seller' }).feeAtomic.toString(), network_fee_atomic: '0' }]);
  });

  it('a reported fee over the co-signer bound (0.01 XMR) is booked as the share of the bound, never more (review M2, 16 Nov)', async () => {
    setNow(new Date('2026-05-04T10:00:00Z'));
    const t = await trade({ to: 'released' });
    const fee = escrowPlan({ amountAtomic: XMR, poster: 'seller' }).feeAtomic;
    // 0.5 XMR reported: X2F's two fee outputs lost at most their shares of 0.01 XMR (two thirds), so that is booked.
    expect(await withClient((c) => bookSettlementNetworkFee(c, t.code, 500_000_000_000n))).toBe(true);
    expect(await bookedNet(t.code)).toEqual([{ network_fee_atomic: '6666666666' }]);
    expect(await netDay('2026-05-04')).toEqual([{ kind: 'fee', fee_atomic: fee.toString(), network_fee_atomic: '6666666666' }]);
    // Exactly the bound books its share; one unit over books the same.
    const atBound = await trade({ to: 'released' });
    expect(await withClient((c) => bookSettlementNetworkFee(c, atBound.code, 10_000_000_001n))).toBe(true);
    expect(await bookedNet(atBound.code)).toEqual([{ network_fee_atomic: '6666666666' }]);
  });

  it('the ledger\'s network fees are add-only too', async () => {
    await expect(deps.db.query("update revenue_ledger set network_fee_atomic = 0 where day = '2026-05-02'")).rejects.toMatchObject({ code: '42501' });
  });

  it('GET /staff/v1/revenue: per period and per market, gross, network fees paid and net; and the totals to date', async () => {
    const owner = await asOwner();
    const res = await owner.get('/staff/v1/revenue?by=day&from=2026-05-02&to=2026-05-03');
    expect(res.statusCode, res.body).toBe(200);
    const fee = escrowPlan({ amountAtomic: XMR, poster: 'seller' }).feeAtomic;
    const body = res.json() as {
      buckets: Array<{ period: string; totalAtomic: string; networkFeeAtomic: string; netAtomic: string }>;
      total: { totalAtomic: string; networkFeeAtomic: string; netAtomic: string };
      byCurrency: Array<{ period: string; networkFeeAtomic: string; netAtomic: string }>;
      toDate: { period: string; totalAtomic: string; networkFeeAtomic: string; netAtomic: string };
      treasuryNetworkFeesRecorded: boolean;
    };
    expect(body.buckets).toMatchObject([
      { period: '2026-05-02', totalAtomic: (2n * fee).toString(), networkFeeAtomic: '33813333', netAtomic: (2n * fee - 33_813_333n).toString() },
      { period: '2026-05-03', totalAtomic: fee.toString(), networkFeeAtomic: '0', netAtomic: fee.toString() },
    ]);
    expect(body.total).toMatchObject({ totalAtomic: (3n * fee).toString(), networkFeeAtomic: '33813333', netAtomic: (3n * fee - 33_813_333n).toString() });
    expect(body.byCurrency).toMatchObject([{ period: 'USD', networkFeeAtomic: '33813333' }]);
    // To date: every day ever booked, whatever the range asked.
    expect(body.toDate.period).toBe('to-date');
    expect(BigInt(body.toDate.networkFeeAtomic)).toBeGreaterThanOrEqual(33_813_333n);
    expect(BigInt(body.toDate.netAtomic)).toBe(BigInt(body.toDate.totalAtomic) - BigInt(body.toDate.networkFeeAtomic));
    expect(BigInt(body.toDate.totalAtomic)).toBeGreaterThan(BigInt(body.total.totalAtomic));
    // The treasury's own sends (fee sweep, payroll) record no network fee yet (Plan 6 wires them).
    expect(body.treasuryNetworkFeesRecorded).toBe(false);
  });
});
