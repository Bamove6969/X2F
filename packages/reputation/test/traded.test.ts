import { describe, expect, it } from 'vitest';
import { TRADED_MIN_USD, TRADED_MIN_XMR, tradedBucketLabel, tradedBucketUsd, tradedBucketXmr, tradedBucketXmrLabel } from '../src/index.js';

// The owner's opt-in "$X+ in trades to date" line (2026-11-01/02/03, via the lead):
// rounded DOWN to $10,000 steps up to "$90,000+", then "$100,000+", then $50,000 steps.
const dollars = (d: number): bigint => BigInt(d) * 100n;
const label = (usdCents: bigint): string | null => {
  const b = tradedBucketUsd(usdCents);
  return b === null ? null : tradedBucketLabel(b);
};

describe('tradedBucketUsd', () => {
  it('a plus needs MORE than the step (owner 2026-11-03: "$30,001 earns $30,000+")', () => {
    const cents: [bigint, string | null][] = [
      [dollars(10_000), null], [dollars(10_000) + 1n, '$10,000+'], [dollars(10_001), '$10,000+'],
      [dollars(20_000), '$10,000+'], [dollars(20_000) + 1n, '$20,000+'], [dollars(20_001), '$20,000+'],
      [dollars(30_000), '$20,000+'], [dollars(30_001), '$30,000+'],
      [dollars(90_000), '$80,000+'], [dollars(90_000) + 1n, '$90,000+'],
      [dollars(100_000), '$90,000+'], [dollars(100_000) + 1n, '$100,000+'],
      [dollars(150_000), '$100,000+'], [dollars(150_000) + 1n, '$150,000+'],
      [dollars(200_000), '$150,000+'], [dollars(200_001), '$200,000+'],
    ];
    for (const [c, want] of cents) expect(label(c), String(c)).toBe(want);
  });
  it('up to and including exactly $10,000 nothing shows', () => {
    expect(TRADED_MIN_USD).toBe(10_000);
    expect(label(0n)).toBeNull();
    expect(label(1n)).toBeNull();
    expect(label(dollars(9_999))).toBeNull();
    expect(label(dollars(10_000))).toBeNull();
  });
  it('between the boundaries', () => {
    expect(label(dollars(19_999))).toBe('$10,000+');
    expect(label(dollars(99_999))).toBe('$90,000+');
    expect(label(dollars(149_999))).toBe('$100,000+');
    expect(label(dollars(199_999))).toBe('$150,000+');
    expect(label(dollars(1_234_567))).toBe('$1,200,000+');
  });
  it('a bucket is never above the total (rounded down), and never the exact total unless it is a step', () => {
    for (const d of [10_001, 12_345, 54_321, 99_999, 100_001, 123_456, 987_654, 5_000_001]) {
      const b = tradedBucketUsd(dollars(d))!;
      expect(b).toBeLessThanOrEqual(d);
      expect(b % 10_000).toBe(0);
    }
  });
  it('refuses a negative total', () => {
    expect(() => tradedBucketUsd(-1n)).toThrow(RangeError);
  });
});

// Owner Q63 (6 Nov): the card's line is the XMR traded to date, on the same "more than" rule.
describe('tradedBucketXmr', () => {
  const xmr = (n: number): bigint => BigInt(n) * 1_000_000_000_000n;
  const label = (atomic: bigint): string | null => {
    const b = tradedBucketXmr(atomic);
    return b === null ? null : tradedBucketXmrLabel(b);
  };
  it('a plus needs MORE than the step', () => {
    const rows: [bigint, string | null][] = [
      [xmr(10), null], [xmr(10) + 1n, '10+ XMR'], [xmr(20), '10+ XMR'], [xmr(20) + 1n, '20+ XMR'],
      [xmr(90) + 1n, '90+ XMR'], [xmr(100), '90+ XMR'], [xmr(100) + 1n, '100+ XMR'],
      [xmr(150), '100+ XMR'], [xmr(150) + 1n, '150+ XMR'], [xmr(1_234), '1,200+ XMR'],
    ];
    for (const [a, want] of rows) expect(label(a), String(a)).toBe(want);
  });
  it('up to and including exactly 10 XMR nothing shows; never negative', () => {
    expect(TRADED_MIN_XMR).toBe(10);
    expect(label(0n)).toBeNull();
    expect(label(xmr(9) + 999_999_999_999n)).toBeNull();
    expect(() => tradedBucketXmr(-1n)).toThrow(RangeError);
  });
});
