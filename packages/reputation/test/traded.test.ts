import { describe, expect, it } from 'vitest';
import { TRADED_MIN_USD, tradedBucketLabel, tradedBucketUsd } from '../src/index.js';

// The owner's opt-in "Completed over $X in trades to date" line (2026-11-01/02, via the lead):
// rounded DOWN to $10,000 steps up to "$90,000+", then "$100,000+", then $50,000 steps. The line
// says "over", so X is the largest step STRICTLY below the total (review M1): a total of exactly a
// step shows the step below it.
const dollars = (d: number): bigint => BigInt(d) * 100n;
const label = (usdCents: bigint): string | null => {
  const b = tradedBucketUsd(usdCents);
  return b === null ? null : tradedBucketLabel(b);
};

describe('tradedBucketUsd', () => {
  it('shows nothing up to and including $10,000', () => {
    expect(TRADED_MIN_USD).toBe(10_000);
    expect(label(0n)).toBeNull();
    expect(label(1n)).toBeNull();
    expect(label(dollars(9_999))).toBeNull();
    expect(label(dollars(10_000) - 1n)).toBeNull();
    expect(label(dollars(10_000))).toBeNull();
    expect(label(dollars(10_000) + 1n)).toBe('$10,000+');
  });
  it('the boundaries the lead listed, each step strictly below the total ("over $X" is true at X)', () => {
    expect(label(dollars(19_999))).toBe('$10,000+');
    expect(label(dollars(20_000))).toBe('$10,000+');
    expect(label(dollars(20_000) + 1n)).toBe('$20,000+');
    expect(label(dollars(90_000))).toBe('$80,000+');
    expect(label(dollars(90_000) + 1n)).toBe('$90,000+');
    expect(label(dollars(99_999))).toBe('$90,000+');
    expect(label(dollars(100_000) - 1n)).toBe('$90,000+');
    expect(label(dollars(100_000))).toBe('$90,000+');
    expect(label(dollars(100_000) + 1n)).toBe('$100,000+');
    expect(label(dollars(149_999))).toBe('$100,000+');
    expect(label(dollars(150_000))).toBe('$100,000+');
    expect(label(dollars(150_000) + 1n)).toBe('$150,000+');
    expect(label(dollars(199_999))).toBe('$150,000+');
    expect(label(dollars(200_000))).toBe('$150,000+');
    expect(label(dollars(200_000) + 1n)).toBe('$200,000+');
    expect(label(dollars(1_234_567))).toBe('$1,200,000+');
  });
  it('a bucket is always strictly below the total, so "over $X" is never false', () => {
    for (const cents of [dollars(10_000) + 1n, dollars(12_345), dollars(54_321), dollars(90_000), dollars(99_999), dollars(100_000), dollars(100_001), dollars(123_456), dollars(987_654), dollars(5_000_000), dollars(5_000_001)]) {
      const b = tradedBucketUsd(cents)!;
      expect(BigInt(b) * 100n < cents).toBe(true);
      expect(b % 10_000).toBe(0);
    }
  });
  it('refuses a negative total', () => {
    expect(() => tradedBucketUsd(-1n)).toThrow(RangeError);
  });
});
