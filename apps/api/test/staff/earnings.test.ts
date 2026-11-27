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
import { isoWeek, startEarnings, summarizeEarnings, summarizeTallies, tallyStart, tallyStarts, utcMonth, walletEndOf, type EarningsSnapshot, type EarningsWatch, type IncomingTransfer } from '../../src/staff/earnings.js';
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

describe('tallies by the day, the week and the month (owner 26 Nov 2026; UTC, weeks from Monday)', () => {
  const NOW = new Date('2026-11-26T23:30:00Z'); // a Thursday; already Friday east of UTC
  const tallies = { fee: [], payroll: [], sweptTxHashes: new Set<string>(), ledgerByDay: new Map(), usdCentsPerXmr: null, now: NOW };

  it('weeks start on Monday and carry their ISO number (the year of their Thursday)', () => {
    expect(tallyStart('week', '2026-11-26')).toBe('2026-11-23');
    expect(tallyStart('week', '2026-11-23')).toBe('2026-11-23');
    expect(tallyStart('week', '2026-11-29')).toBe('2026-11-23'); // Sunday ends the week
    expect(isoWeek('2026-11-23')).toBe('2026-W48');
    expect(isoWeek('2025-12-29')).toBe('2026-W01'); // its Thursday is 1 Jan 2026
    expect(isoWeek('2020-12-28')).toBe('2020-W53');
    expect(tallyStart('month', '2026-11-26')).toBe('2026-11-01');
  });

  it('the window is bounded: 31 days, 12 weeks, 12 months, the current one last', () => {
    const d = tallyStarts('day', NOW);
    expect([d.length, d[0], d[30]]).toEqual([31, '2026-10-27', '2026-11-26']);
    const w = tallyStarts('week', NOW);
    expect([w.length, w[0], w[11]]).toEqual([12, '2026-09-07', '2026-11-23']);
    const m = tallyStarts('month', NOW);
    expect([m.length, m[0], m[11]]).toEqual([12, '2025-12-01', '2026-11-01']);
  });

  it('by the day: each UTC day, empty ones too, the sweep apart; anything older is left out of the window', () => {
    const SW = tx();
    const { tallies: days, total } = summarizeTallies({
      ...tallies,
      period: 'day',
      fee: [at('2026-11-26T23:59:59Z', 2n * XMR), at('2026-11-25T00:00:00Z', 9n, SW), at('2026-10-26T23:59:59Z', 100n)],
      payroll: [at('2026-11-25T10:00:00Z', 3n)],
      sweptTxHashes: new Set([SW]),
      ledgerByDay: new Map([['2026-11-25', { trades: 2, netAtomic: 40n }], ['2026-10-01', { trades: 9, netAtomic: 1n }]]),
    });
    expect(days).toHaveLength(31);
    expect(days.at(-1)).toMatchObject({ period: '2026-11-26', from: '2026-11-26', to: '2026-11-26', feeWalletAtomic: (2n * XMR).toString(), earnedAtomic: (2n * XMR).toString() });
    expect(days.at(-2)).toMatchObject({ period: '2026-11-25', feeWalletAtomic: '0', sweptInAtomic: '9', payrollWalletAtomic: '3', earnedAtomic: '3', trades: 2, bookedNetAtomic: '40' });
    expect(days[0]).toMatchObject({ period: '2026-10-27', earnedAtomic: '0', trades: 0 });
    expect(total).toMatchObject({ period: 'last-31-days', from: '2026-10-27', to: '2026-11-26', earnedAtomic: (2n * XMR + 3n).toString(), sweptInAtomic: '9', trades: 2, bookedNetAtomic: '40' });
  });

  it('by the week: Monday 00:00 UTC opens a week, Sunday 23:59:59 closes it', () => {
    const { tallies: weeks } = summarizeTallies({
      ...tallies,
      period: 'week',
      fee: [at('2026-11-23T00:00:00Z', 5n), at('2026-11-22T23:59:59Z', 7n)],
      ledgerByDay: new Map([['2026-11-29', { trades: 1, netAtomic: 2n }]]),
    });
    expect(weeks.slice(-2).map((w) => [w.period, w.from, w.to, w.feeWalletAtomic, w.trades])).toEqual([
      ['2026-W47', '2026-11-16', '2026-11-22', '7', 0],
      ['2026-W48', '2026-11-23', '2026-11-29', '5', 1],
    ]);
  });

  it('by the month: the same months the monthly report gives, last 12 only, with a USD estimate', () => {
    const fee = [at('2026-11-01T00:00:00Z', XMR), at('2026-10-31T23:59:59Z', 2n * XMR), at('2025-11-30T23:59:59Z', 4n * XMR)];
    const { tallies: months, total } = summarizeTallies({ ...tallies, period: 'month', fee, usdCentsPerXmr: 15_000n });
    expect(months.map((m) => m.period)).toEqual(['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    expect(months.slice(-2).map((m) => [m.from, m.to, m.feeWalletAtomic, m.usdEstimateCents])).toEqual([
      ['2026-10-01', '2026-10-31', (2n * XMR).toString(), '30000'],
      ['2026-11-01', '2026-11-30', XMR.toString(), '15000'],
    ]);
    expect(months.find((m) => m.period === '2026-02')?.to).toBe('2026-02-28');
    expect(total).toMatchObject({ period: 'last-12-months', earnedAtomic: (3n * XMR).toString() });
    const monthly = summarizeEarnings({ ...none, fee }).months.filter((m) => m.month >= '2025-12');
    expect(monthly.map((m) => [m.month, m.earnedAtomic])).toEqual(months.filter((m) => m.earnedAtomic !== '0').map((m) => [m.period, m.earnedAtomic]));
  });

  it('refuses an unknown period, a malformed ledger day and a negative price', () => {
    expect(() => summarizeTallies({ ...tallies, period: 'year' as never })).toThrow(RangeError);
    expect(() => summarizeTallies({ ...tallies, period: 'day', ledgerByDay: new Map([['2026-11', { trades: 1, netAtomic: 1n }]]) })).toThrow(RangeError);
    expect(() => summarizeTallies({ ...tallies, period: 'day', usdCentsPerXmr: -1n })).toThrow(RangeError);
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
let setNow: (d: Date) => void;
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
  ({ app, deps, close, setNow } = await staffApps({ earnings: watch, prices }, {}, { config: { feeWallet: FEE_WALLET, payrollWallet: PAYROLL_WALLET } }));
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

  it('?period=day|week|month: the bounded tallies in UTC, the same wallet lines and all-time row; nothing that identifies a tx or address', async () => {
    usd = 16_501n;
    setNow(new Date('2026-11-20T12:00:00Z')); // a Friday
    const syncedAt = new Date('2026-11-20T11:50:00Z');
    snapshot = {
      fee: { state: 'ready', syncedAt, transfers: [at('2026-11-03T05:00:00Z', XMR + 1n, FEE_TX), at('2026-11-10T00:00:00Z', 9n, SWEEP)] },
      payroll: { state: 'ready', syncedAt, transfers: [at('2026-11-03T05:00:00Z', XMR), at('2026-10-31T23:59:59Z', 2n * XMR)] },
    };
    const owner = await asOwner();
    const monthly = (await owner.get('/staff/v1/earnings')).json() as { allTime: unknown };

    const day = await owner.get('/staff/v1/earnings?period=day');
    expect(day.statusCode, day.body).toBe(200);
    const d = day.json() as { timeZone: string; period: string; feeWallet: { walletEnd: string }; tallies: Array<Record<string, unknown>>; total: Record<string, unknown>; allTime: unknown; months?: unknown };
    expect([d.timeZone, d.period, d.feeWallet.walletEnd, d.tallies.length]).toEqual(['UTC', 'day', FEE_WALLET.slice(-4), 31]);
    expect(d.months).toBeUndefined();
    expect(d.allTime).toEqual(monthly.allTime);
    expect(d.tallies[0]).toMatchObject({ period: '2026-10-21' });
    expect(d.tallies.at(-1)).toMatchObject({ period: '2026-11-20', earnedAtomic: '0' });
    expect(d.tallies.find((t) => t.period === '2026-11-03')).toMatchObject({ feeWalletAtomic: (XMR + 1n).toString(), payrollWalletAtomic: XMR.toString(), trades: 3, bookedNetAtomic: (3n * XMR - 90n).toString() });
    expect(d.tallies.find((t) => t.period === '2026-11-04')).toMatchObject({ trades: 1, bookedNetAtomic: (XMR + 7n - 30n).toString() });
    expect(d.tallies.find((t) => t.period === '2026-11-10')).toMatchObject({ sweptInAtomic: '9', earnedAtomic: '0' });
    expect(d.tallies.find((t) => t.period === '2026-10-31')).toMatchObject({ payrollWalletAtomic: (2n * XMR).toString() });
    // 10 Oct is before the 31-day window: in all time, not in the window.
    expect(d.total).toMatchObject({ period: 'last-31-days', from: '2026-10-21', to: '2026-11-20', trades: 4, earnedAtomic: (4n * XMR + 1n).toString() });

    const week = (await owner.get('/staff/v1/earnings?period=week')).json() as { tallies: Array<Record<string, unknown>> };
    expect(week.tallies).toHaveLength(12);
    expect(week.tallies.at(-1)).toMatchObject({ period: '2026-W47', from: '2026-11-16', to: '2026-11-22' });
    expect(week.tallies.find((t) => t.period === '2026-W45')).toMatchObject({ from: '2026-11-02', trades: 4, earnedAtomic: (2n * XMR + 1n).toString() });
    expect(week.tallies.find((t) => t.period === '2026-W44')).toMatchObject({ from: '2026-10-26', payrollWalletAtomic: (2n * XMR).toString() });

    const month = await owner.get('/staff/v1/earnings?period=month');
    const m = month.json() as { tallies: Array<Record<string, unknown>>; total: Record<string, unknown> };
    expect(m.tallies.map((t) => t.period).slice(-2)).toEqual(['2026-10', '2026-11']);
    expect(m.tallies.at(-2)).toMatchObject({ trades: 2, payrollWalletAtomic: (2n * XMR).toString(), usdEstimateCents: '33002' });
    expect(m.total).toMatchObject({ period: 'last-12-months', trades: 6 });

    for (const res of [day, month]) {
      expect(res.body).not.toContain(FEE_TX);
      expect(res.body).not.toContain(SWEEP);
      expect(res.body).not.toContain(FEE_WALLET);
      expect(res.body).not.toContain(PAYROLL_WALLET);
    }
  });

  it('refuses another period, and any other query beside it', async () => {
    const owner = await asOwner();
    expect((await owner.get('/staff/v1/earnings?period=year')).statusCode).toBe(400);
    expect((await owner.get('/staff/v1/earnings?period=day&from=2026-11-01')).statusCode).toBe(400);
  });
});
