import { expect, test } from 'vitest';
import { feeFor, X2F_FEE_BPS } from '../src/index.ts';

test('the fee is 1%', () => {
  expect(X2F_FEE_BPS).toBe(100n);
  expect(feeFor(1_250_000_000_000n)).toBe(12_500_000_000n);
});

test('tiny amounts round down to no fee', () => {
  expect(feeFor(99n)).toBe(0n);
  expect(feeFor(100n)).toBe(1n);
  expect(feeFor(0n)).toBe(0n);
});

test('negative amounts are refused', () => {
  expect(() => feeFor(-1n)).toThrow(RangeError);
});
