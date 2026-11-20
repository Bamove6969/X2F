// Plan 4 Task 26 (review m10): the shared cap rule's fiat edge.
import { ATOMIC_PER_XMR, atomicForFiat } from '@x2f/trade';
import { describe, expect, it } from 'vitest';
import { largestTotalWithin } from '../../src/trades/capValue.js';

describe('largestTotalWithin', () => {
  it('is the largest total whose amount (rounded down) is within, also when (max + 1) × rate is an exact multiple of one XMR', () => {
    // 1 XMR at 100.00: (max + 1) × rate = 2 × 10^14, an exact multiple of 10^12; without the `- 1n`
    // the total 200 would buy max + 1.
    const rate = { currency: 'USD', centsPerXmr: 10_000n };
    const max = 2n * (ATOMIC_PER_XMR / 100n) - 1n;
    const total = largestTotalWithin(rate, max);
    expect(total).toBe(199n);
    expect(atomicForFiat(total, rate)).toBeLessThanOrEqual(max);
    expect(atomicForFiat(total + 1n, rate)).toBe(max + 1n);
    // Not an exact multiple: the largest total still buys at most max.
    const odd = { currency: 'USD', centsPerXmr: 33_017n };
    for (const m of [1n, 12_345_678_901n, 3n * ATOMIC_PER_XMR + 7n]) {
      const t = largestTotalWithin(odd, m);
      expect(atomicForFiat(t, odd)).toBeLessThanOrEqual(m);
      expect(atomicForFiat(t + 1n, odd)).toBeGreaterThan(m);
    }
  });
});
