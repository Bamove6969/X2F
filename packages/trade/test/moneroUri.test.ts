import { describe, expect, test } from 'vitest';
import { moneroUri } from '../src/index.js';

describe('moneroUri', () => {
  test('trims trailing zeros', () => {
    expect(moneroUri('4Abc', 1_250_000_000_000n)).toBe('monero:4Abc?tx_amount=1.25');
  });

  test('one atomic unit', () => {
    expect(moneroUri('4Abc', 1n).endsWith('tx_amount=0.000000000001')).toBe(true);
  });

  test('whole XMR has no decimal point', () => {
    expect(moneroUri('4Abc', 3_000_000_000_000n)).toBe('monero:4Abc?tx_amount=3');
  });

  test('a seller-poster funding amount', () => {
    expect(moneroUri('4Abc', 1_262_500_000_000n)).toBe('monero:4Abc?tx_amount=1.2625');
  });

  test('refuses a non-positive amount', () => {
    expect(() => moneroUri('4Abc', 0n)).toThrow(RangeError);
  });

  test('refuses an address that is not base58 (no URI injection)', () => {
    expect(() => moneroUri('4Abc?tx_amount=9', 1n)).toThrow(RangeError);
    expect(() => moneroUri('4Abc&x=1', 1n)).toThrow(RangeError);
    expect(() => moneroUri('', 1n)).toThrow(RangeError);
    expect(() => moneroUri('40Il', 1n)).toThrow(RangeError);
  });
});
