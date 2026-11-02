import { describe, expect, it } from 'vitest';
import { TRADED_MIN_USD, tradedBucketLabel, tradedBucketUsd } from '../src/index.js';

// The owner's opt-in "Completed over $X in trades to date" line (2026-11-01/02, via the lead):
// rounded DOWN to $10,000 steps up to "$90,000+", then "$100,000+", then $50,000 steps.
const dollars = (d: number): bigint => BigInt(d) * 100n;
const label = (usdCents: bigint): string | null => {
  const b = tradedBucketUsd(usdCents);
  return b === null ? null : tradedBucketLabel(b);
};

describe('tradedBucketUsd', () => {
  it('reaching a step exactly earns it (owner 2026-11-02: "at least $10,000")', () => {
    for (const d of [10_000, 20_000, 90_000, 100_000, 150_000, 200_000]) expect(label(dollars(d)), String(d)).toBe(`$${d.toLocaleString('en-US')}+`);
    for (const d of [10_000, 20_000, 90_000, 100_000, 150_000]) expect(label(dollars(d) - 1n), String(d)).not.toBe(`$${d.toLocaleString('en-US')}+`);
  });
  it('shows nothing below $10,000', () => {
    expect(TRADED_MIN_USD).toBe(10_000);
    expect(label(0n)).toBeNull();
    expect(label(dollars(9_999))).toBeNull();
    expect(label(dollars(10_000) - 1n)).toBeNull();
  });
  it('the boundaries the lead listed', () => {
    expect(label(dollars(10_000))).toBe('$10,000+');
    expect(label(dollars(19_999))).toBe('$10,000+');
    expect(label(dollars(20_000))).toBe('$20,000+');
    expect(label(dollars(99_999))).toBe('$90,000+');
    expect(label(dollars(100_000) - 1n)).toBe('$90,000+');
    expect(label(dollars(100_000))).toBe('$100,000+');
    expect(label(dollars(149_999))).toBe('$100,000+');
    expect(label(dollars(150_000))).toBe('$150,000+');
    expect(label(dollars(199_999))).toBe('$150,000+');
    expect(label(dollars(200_000))).toBe('$200,000+');
    expect(label(dollars(1_234_567))).toBe('$1,200,000+');
  });
  it('a bucket is never above the total (rounded down), and never the exact total unless it is a step', () => {
    for (const d of [10_000, 12_345, 54_321, 99_999, 100_001, 123_456, 987_654, 5_000_001]) {
      const b = tradedBucketUsd(dollars(d))!;
      expect(b).toBeLessThanOrEqual(d);
      expect(b % 10_000).toBe(0);
    }
  });
  it('refuses a negative total', () => {
    expect(() => tradedBucketUsd(-1n)).toThrow(RangeError);
  });
});
