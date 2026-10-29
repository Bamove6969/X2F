import { describe, expect, test } from 'vitest';
import { X2F_FEE_BPS, feeFor } from '@x2f/core';

describe('feeFor', () => {
  test('X2F_FEE_BPS is 100n', () => {
    expect(X2F_FEE_BPS).toBe(100n);
  });

  test('1% of 1.25 XMR', () => {
    expect(feeFor(1_250_000_000_000n)).toBe(12_500_000_000n);
  });

  test('floors sub-piconero amounts', () => {
    expect(feeFor(99n)).toBe(0n);
  });

  test('zero input gives zero fee', () => {
    expect(feeFor(0n)).toBe(0n);
  });

  test('throws RangeError on negative input', () => {
    expect(() => feeFor(-1n)).toThrow(RangeError);
  });

  test('boundary: 100n gives 1n, 199n floors to 1n, 200n gives 2n', () => {
    expect(feeFor(100n)).toBe(1n);
    expect(feeFor(199n)).toBe(1n);
    expect(feeFor(200n)).toBe(2n);
  });

  test('exact above Number.MAX_SAFE_INTEGER', () => {
    const big = BigInt(Number.MAX_SAFE_INTEGER) * 1_000n + 99n;
    expect(feeFor(big)).toBe(big / 100n);
    expect(feeFor(9_007_199_254_740_993n)).toBe(90_071_992_547_409n);
  });

  test('exact for a huge value (2^100)', () => {
    const v = 2n ** 100n;
    expect(feeFor(v)).toBe(v / 100n);
  });
});
