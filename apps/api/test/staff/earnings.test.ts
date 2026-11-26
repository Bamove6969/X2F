// Plan 4 Task 9: the owner's earnings by UTC month, as X2F's own wallets saw them arrive: the fee
// wallet through its view-only key (sweeps from the payroll wallet shown apart, never counted twice)
// and the payroll wallet, beside the books (the revenue ledger). Pure sums, the 10-minute watch over
// fake wallets, and GET /staff/v1/earnings on real Postgres. No Monero network: the wallets are
// stand-ins (IncomeSource).
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/app.js';
import type { MarketPrices } from '../../src/price/market.js';
import { startEarnings, summarizeEarnings, utcMonth, walletEndOf, type EarningsSnapshot, type EarningsWatch, type IncomingTransfer } from '../../src/staff/earnings.js';
import { StaffBrowser, insertSession, seedStaff, staffApps } from '../helpers/staffApp.js';
import { fakeAddress } from '../helpers/trades.js';

const XMR = 1_000_000_000_000n;
const tx = () => randomBytes(32).toString('hex');
const at = (iso: string, atomic: bigint, txHash = tx()): IncomingTransfer => ({ txHash, at: new Date(iso), atomic });
const none = { fee: [], payroll: [], sweptTxHashes: new Set<string>(), ledger: new Map(), usdCentsPerXmr: null };

describe('summarizeEarnings', () => {
  it('sums each wallet by UTC month; the month boundary is UTC whatever the local time', () => {
    const { months, allTime } = summarizeEarnings({
      ...none,
      fee: [
        at('2026-11-01T00:00:00Z', 3n * XMR), // first instant of November
        at('2026-11-20T17:59:59Z', 1n * XMR),
        at('2026-10-31T23:59:59Z', 2n * XMR), // last instant of October (already November east of UTC)
        at('2026-09-30T23:59:59Z', 7n),
      ],
      payroll: [at('2026-11-05T00:00:00Z', 4n * XMR), at('2026-10-01T00:00:00Z', 5n)],
    });
    expect(months.map((m) => [m.month, m.feeWalletAtomic, m.payrollWalletAtomic, m.earnedAtomic])).toEqual([
      ['2026-09', '7', '0', '7'],
      ['2026-10', (2n * XMR).toString(), '5', (2n * XMR + 5n).toString()],
      ['2026-11', (4n * XMR).toString(), (4n * XMR).toString(), (8n * XMR).toString()],
    ]);
    expect(allTime).toMatchObject({ month: 'all-time', feeWalletAtomic: (6n * XMR + 7n).toString(), payrollWalletAtomic: (4n * XMR + 5n).toString(), earnedAtomic: (10n * XMR + 12n).toString() });
  });

  it('a sweep from the payroll wallet arrives in the fee wallet, is shown apart and is not earned twice', () => {
    const sweep = tx();
    const { months, allTime } = summarizeEarnings({
      ...none,
      fee: [at('2026-11-02T00:00:00Z', XMR), at('2026-11-03T00:00:00Z', 9n * XMR, sweep)],
      payroll: [at('2026-11-01T00:00:00Z', 10n * XMR)],
      sweptTxHashes: new Set([sweep]),
    });
    expect(months).toEqual([expect.objectContaining({ month: '2026-11', feeWalletAtomic: XMR.toString(), sweptInAtomic: (9n * XMR).toString(), payrollWalletAtomic: (10n * XMR).toString(), earnedAtomic: (11n * XMR).toString() })]);
    expect(allTime.sweptInAtomic).toBe((9n * XMR).toString());
  });

  it('carries the books for each month (trades and the booked net), months with only the books too', () => {
    const { months, allTime } = summarizeEarnings({
      ...none,
      fee: [at('2026-11-02T00:00:00Z', XMR)],
      ledger: new Map([
        ['2026-11', { trades: 4, netAtomic: 2n * XMR }],
        ['2026-08', { trades: 1, netAtomic: 5n }],
      ]),
    });
    expect(months.map((m) => [m.month, m.trades, m.bookedNetAtomic, m.earnedAtomic])).toEqual([
      ['2026-08', 1, '5', '0'],
      ['2026-11', 4, (2n * XMR).toString(), XMR.toString()],
    ]);
    expect(allTime).toMatchObject({ trades: 5, bookedNetAtomic: (2n * XMR + 5n).toString() });
  });

  it('gives a USD estimate in cents at the current price, rounded down; none without a price', () => {
    const fee = [at('2026-11-02T00:00:00Z', 2n * XMR + 5n)];
    expect(summarizeEarnings({ ...none, fee, usdCentsPerXmr: 16_501n }).allTime.usdEstimateCents).toBe((2n * 16_501n).toString());
    expect(summarizeEarnings({ ...none, fee }).allTime.usdEstimateCents).toBeNull();
  });

  it('no income is zero, not missing', () => {
    const r = summarizeEarnings({ ...none, usdCentsPerXmr: 16_501n });
    expect(r.months).toEqual([]);
    expect(r.allTime).toEqual({ month: 'all-time', feeWalletAtomic: '0', sweptInAtomic: '0', payrollWalletAtomic: '0', earnedAtomic: '0', usdEstimateCents: '0', trades: 0, bookedNetAtomic: '0' });
  });

  it('refuses a transfer that is not one, a negative price and a malformed ledger month', () => {
    expect(() => summarizeEarnings({ ...none, fee: [at('2026-11-02T00:00:00Z', 0n)] })).toThrow(RangeError);
    expect(() => summarizeEarnings({ ...none, payroll: [at('2026-11-02T00:00:00Z', -1n)] })).toThrow(RangeError);
    expect(() => summarizeEarnings({ ...none, fee: [{ txHash: tx(), at: new Date(NaN), atomic: 1n }] })).toThrow(RangeError);
    expect(() => summarizeEarnings({ ...none, fee: [{ txHash: 'nope', at: new Date(), atomic: 1n }] })).toThrow(RangeError);
    expect(() => summarizeEarnings({ ...none, usdCentsPerXmr: -1n })).toThrow(RangeError);
    expect(() => summarizeEarnings({ ...none, ledger: new Map([['2026-1', { trades: 1, netAtomic: 1n }]]) })).toThrow(RangeError);
    expect(() => summarizeEarnings({ ...none, ledger: new Map([['2026-11', { trades: 1.5, netAtomic: 1n }]]) })).toThrow(RangeError);
  });

  it('January: December of the year before is its own month', () => {
    const { months } = summarizeEarnings({ ...none, fee: [at('2026-12-31T23:00:00Z', 1n), at('2027-01-02T00:00:00Z', 2n)] });
    expect(months.map((m) => [m.month, m.feeWalletAtomic])).toEqual([['2026-12', '1'], ['2027-01', '2']]);
    expect(utcMonth(new Date('2027-01-01T00:00:00Z'))).toBe('2027-01');
  });
});

describe('walletEndOf', () => {
  it('is the last four characters of the address, and nothing else of it', () => {
    expect(walletEndOf('48abc9Fq2')).toBe('9Fq2');
    expect(() => walletEndOf('abc')).toThrow(RangeError);
  });
});

describe('startEarnings (the 10-minute watch)', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  const clock = () => now;

  it('no wallet: nothing is read and both are null', async () => {
    const w = startEarnings({ fee: null, payroll: null, clock });
    expect(w.snapshot()).toEqual({ fee: null, payroll: null });
    await w.stop();
  });

  it('reads both wallets at start; a failed read keeps the last good figures (stale), never the error', async () => {
    let feeFails = false;
    let payrollFails = true;
    const list = [at('2026-11-02T00:00:00Z', XMR)];
    const errors: string[] = [];
    const w = startEarnings({
      fee: { incoming: async () => { if (feeFails) throw new Error('secret-view-key-in-message'); return list; } },
      payroll: { incoming: async () => { if (payrollFails) throw new Error('boom'); return []; } },
      clock,
      everyMs: 3_600_000,
      onError: (wallet) => errors.push(wallet),
    });
    expect(w.snapshot().fee!.state).toBe('syncing');
    await w.refresh();
    let s = w.snapshot();
    expect(s.fee).toEqual({ state: 'ready', syncedAt: now, transfers: list });
    expect(s.payroll).toEqual({ state: 'unavailable', syncedAt: null, transfers: [] });
    feeFails = true;
    payrollFails = false;
    await w.refresh();
    s = w.snapshot();
    expect(s.fee).toEqual({ state: 'stale', syncedAt: now, transfers: list });
    expect(s.payroll!.state).toBe('ready');
    expect(errors).toEqual(['payroll', 'fee']);
    await w.stop();
  });

  it('a malformed answer from a wallet is a failed read', async () => {
    const w = startEarnings({ fee: { incoming: async () => [{ txHash: tx(), at: new Date(), atomic: 0n }] }, payroll: null, clock, everyMs: 3_600_000 });
    await w.refresh();
    expect(w.snapshot().fee!.state).toBe('unavailable');
    await w.stop();
  });

  it('one read at a time: a refresh while one runs waits for it', async () => {
    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const w = startEarnings({ fee: { incoming: async () => (calls++, await gate, []) }, payroll: null, clock, everyMs: 3_600_000 });
    const a = w.refresh();
    const b = w.refresh();
    release();
    await Promise.all([a, b]);
    expect(calls).toBe(1);
    await w.stop();
  });
});

// ---------------------------------------------------------------------------------------------
// The route

let app: FastifyInstance;
let deps: Deps;
let close: () => Promise<void>;
let ownerId: string;
let snapshot: EarningsSnapshot = { fee: null, payroll: null };
let usd: bigint | null = null;
const FEE_WALLET = fakeAddress();
const PAYROLL_WALLET = fakeAddress();
const SWEEP = tx();
const FEE_TX = tx();
const watch: EarningsWatch = { snapshot: () => snapshot, refresh: async () => undefined, stop: async () => undefined };
const prices = { quote: () => (usd === null ? null : { usdCentsPerXmr: usd }) } as unknown as MarketPrices;
const asOwner = async () => new StaffBrowser(app).withSession((await insertSession(deps, ownerId, 'staff')).token);

beforeAll(async () => {
  ({ app, deps, close } = await staffApps({ earnings: watch, prices }, {}, { config: { feeWallet: FEE_WALLET, payrollWallet: PAYROLL_WALLET } }));
  ownerId = (await seedStaff(deps, { role: 'owner' })).id;
  await deps.db.query(
    `insert into revenue_ledger (day, currency, kind, trades, fee_atomic, network_fee_atomic) values
       ('2026-11-03', 'USD', 'fee', 3, $1, 90), ('2026-11-04', 'EUR', 'fee', 1, $2, 30), ('2026-11-04', 'USD', 'owed', 1, 7, 0),
       ('2026-10-10', 'USD', 'fee', 2, $3, 60)`,
    [(3n * XMR).toString(), XMR.toString(), (2n * XMR).toString()],
  );
  await deps.db.query(`insert into fee_sweeps (at, balance_atomic, amount_atomic, keep_atomic, outcome, tx_hash, settled_at) values (now(), 10, 9, 1, 'sent', $1, now())`, [SWEEP]);
});
afterAll(async () => close());

describe('GET /staff/v1/earnings (owner only)', () => {
  it('without wallets: both null, the months from the books alone', async () => {
    snapshot = { fee: null, payroll: null };
    const res = await (await asOwner()).get('/staff/v1/earnings');
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { feeWallet: unknown; payrollWallet: unknown; usdCentsPerXmr: unknown; months: Array<{ month: string; trades: number; bookedNetAtomic: string; earnedAtomic: string }> };
    expect(body.feeWallet).toBeNull();
    expect(body.payrollWallet).toBeNull();
    expect(body.usdCentsPerXmr).toBeNull();
    expect(body.months.map((m) => [m.month, m.trades, m.bookedNetAtomic, m.earnedAtomic])).toEqual([
      ['2026-10', 2, (2n * XMR - 60n).toString(), '0'],
      ['2026-11', 4, (4n * XMR + 7n - 120n).toString(), '0'],
    ]);
  });

  it('with both wallets: arrivals by UTC month, the sweep apart, the wallet ends only; no tx hash or address in the answer', async () => {
    usd = 16_501n;
    const syncedAt = new Date('2026-11-20T11:50:00Z');
    snapshot = {
      fee: { state: 'ready', syncedAt, transfers: [at('2026-11-03T05:00:00Z', XMR + 1n, FEE_TX), at('2026-11-10T00:00:00Z', 9n, SWEEP)] },
      payroll: { state: 'stale', syncedAt, transfers: [at('2026-11-03T05:00:00Z', XMR), at('2026-10-31T23:59:59Z', 2n * XMR)] },
    };
    const res = await (await asOwner()).get('/staff/v1/earnings');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      feeWallet: { walletEnd: FEE_WALLET.slice(-4), state: 'ready', syncedAt: syncedAt.toISOString() },
      payrollWallet: { walletEnd: PAYROLL_WALLET.slice(-4), state: 'stale', syncedAt: syncedAt.toISOString() },
      usdCentsPerXmr: '16501',
      months: [
        { month: '2026-10', feeWalletAtomic: '0', sweptInAtomic: '0', payrollWalletAtomic: (2n * XMR).toString(), earnedAtomic: (2n * XMR).toString(), usdEstimateCents: '33002', trades: 2, bookedNetAtomic: (2n * XMR - 60n).toString() },
        { month: '2026-11', feeWalletAtomic: (XMR + 1n).toString(), sweptInAtomic: '9', payrollWalletAtomic: XMR.toString(), earnedAtomic: (2n * XMR + 1n).toString(), usdEstimateCents: '33002', trades: 4, bookedNetAtomic: (4n * XMR + 7n - 120n).toString() },
      ],
      allTime: { month: 'all-time', feeWalletAtomic: (XMR + 1n).toString(), sweptInAtomic: '9', payrollWalletAtomic: (3n * XMR).toString(), earnedAtomic: (4n * XMR + 1n).toString(), usdEstimateCents: '66004', trades: 6, bookedNetAtomic: (6n * XMR + 7n - 180n).toString() },
    });
    expect(res.body).not.toContain(FEE_TX);
    expect(res.body).not.toContain(SWEEP);
    expect(res.body).not.toContain(FEE_WALLET);
    expect(res.body).not.toContain(PAYROLL_WALLET);
  });

  it('refuses any query', async () => {
    const res = await (await asOwner()).get('/staff/v1/earnings?month=2026-11');
    expect(res.statusCode).toBe(400);
  });
});
