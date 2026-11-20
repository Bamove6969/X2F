// Plan 4 Task 9, the read-only part: the owner's earnings from the fee wallet's incoming transfers,
// summed by UTC month. Pure; no wallet and no key here. The view-only wallet itself
// (loadFeeWalletConfig, startEarnings, GET /staff/v1/earnings and the regtest test) is held back
// for a security review (tripwire NEEDS_REVIEW_FEE_VIEW_KEY below).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { summarizeFeeIncome, walletEndOf, type FeeTransfer } from '../../src/staff/earnings.js';

const XMR = 1_000_000_000_000n;
const NOW = new Date('2026-11-20T18:00:00Z');
const at = (iso: string, atomic: bigint): FeeTransfer => ({ at: new Date(iso), atomic });

describe('summarizeFeeIncome', () => {
  const transfers = [
    at('2026-11-01T00:00:00Z', 3n * XMR), // first instant of this UTC month
    at('2026-11-20T17:59:59Z', 1n * XMR),
    at('2026-10-31T23:59:59Z', 2n * XMR), // last instant of last month (BC time it is still the 31st, UTC decides)
    at('2026-10-01T00:00:00Z', 5n),
    at('2026-09-30T23:59:59Z', 7n * XMR), // older: all time only
  ];
  const trades = { thisMonth: 4, lastMonth: 2, allTime: 9 };

  it('sums incoming transfers into this month, last month and all time by UTC month', () => {
    const e = summarizeFeeIncome({ transfers, now: NOW, usdCentsPerXmr: null, trades, address: '4'.repeat(91) + '9Fq2' });
    expect(e.thisMonth).toEqual({ atomic: (4n * XMR).toString(), usdEstimate: null, trades: 4 });
    expect(e.lastMonth).toEqual({ atomic: (2n * XMR + 5n).toString(), usdEstimate: null, trades: 2 });
    expect(e.allTime).toEqual({ atomic: (13n * XMR + 5n).toString(), usdEstimate: null, trades: 9 });
    expect(e.walletEnd).toBe('9Fq2');
  });

  it('gives a USD estimate in cents at the current price, rounded down', () => {
    const e = summarizeFeeIncome({ transfers, now: NOW, usdCentsPerXmr: 16_501n, trades, address: '4'.repeat(95) });
    expect(e.thisMonth.usdEstimate).toBe((4n * 16_501n).toString());
    // 2 XMR + 5 atomic units at 165.01 USD: the 5 units are far below a cent.
    expect(e.lastMonth.usdEstimate).toBe((2n * 16_501n).toString());
  });

  it('January: last month is December of the year before', () => {
    const e = summarizeFeeIncome({
      transfers: [at('2026-12-31T23:00:00Z', 1n), at('2027-01-02T00:00:00Z', 2n)],
      now: new Date('2027-01-15T00:00:00Z'),
      usdCentsPerXmr: null,
      trades: { thisMonth: 0, lastMonth: 0, allTime: 0 },
      address: '4'.repeat(95),
    });
    expect([e.thisMonth.atomic, e.lastMonth.atomic, e.allTime.atomic]).toEqual(['2', '1', '3']);
  });

  it('no income is zero, not missing', () => {
    const e = summarizeFeeIncome({ transfers: [], now: NOW, usdCentsPerXmr: 16_501n, trades: { thisMonth: 0, lastMonth: 0, allTime: 0 }, address: '4'.repeat(95) });
    expect(e.allTime).toEqual({ atomic: '0', usdEstimate: '0', trades: 0 });
  });

  it('refuses a transfer that is not positive, a negative price and a malformed trade count', () => {
    const base = { now: NOW, usdCentsPerXmr: null, trades, address: '4'.repeat(95) };
    expect(() => summarizeFeeIncome({ ...base, transfers: [at('2026-11-02T00:00:00Z', 0n)] })).toThrow(RangeError);
    expect(() => summarizeFeeIncome({ ...base, transfers: [at('2026-11-02T00:00:00Z', -1n)] })).toThrow(RangeError);
    expect(() => summarizeFeeIncome({ ...base, transfers: [{ at: new Date(NaN), atomic: 1n }] })).toThrow(RangeError);
    expect(() => summarizeFeeIncome({ ...base, transfers: [], usdCentsPerXmr: -1n })).toThrow(RangeError);
    expect(() => summarizeFeeIncome({ ...base, transfers: [], trades: { ...trades, thisMonth: -1 } })).toThrow(RangeError);
    expect(() => summarizeFeeIncome({ ...base, transfers: [], trades: { ...trades, lastMonth: 1.5 } })).toThrow(RangeError);
  });
});

describe('walletEndOf', () => {
  it('is the last four characters of the address, and nothing else of it', () => {
    expect(walletEndOf('48abc9Fq2')).toBe('9Fq2');
    expect(() => walletEndOf('abc')).toThrow(RangeError);
  });
});

describe('TRIPWIRE NEEDS_REVIEW_FEE_VIEW_KEY', () => {
  it('earnings.ts reads no key, opens no wallet, and nothing serves or starts it yet', () => {
    // When the security review clears the view-only fee wallet (Plan 4 Task 9's loadFeeWalletConfig
    // and startEarnings): build them, wire GET /staff/v1/earnings, and change this test.
    const src = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
    const earnings = src('../../src/staff/earnings.ts');
    expect(earnings).not.toMatch(/monero-ts|MoneroWallet|process\.env|privateViewKey|viewKey|spendKey|seed/i);
    expect(src('../../src/main.ts')).not.toMatch(/earnings/i);
    expect(src('../../src/staff/main.ts')).not.toMatch(/earnings/i);
    expect(src('../../src/staff/app.ts')).not.toMatch(/staff\/earnings|\/staff\/v1\/earnings/);
  });
});
