import { describe, expect, test } from 'vitest';
import { atomicForFiat, escrowPlan, fiatCents, formatFiat, formatXmr, offerRate, posterRole, rateFor } from '../src/index.js';

const XMR = 1_000_000_000_000n;

describe('posterRole', () => {
  test('a sell ad is posted by the seller, a buy ad by the buyer', () => {
    expect(posterRole('sell')).toBe('seller');
    expect(posterRole('buy')).toBe('buyer');
  });
});

describe('rateFor', () => {
  test('applies the margin, rounding half up', () => {
    expect(rateFor({ currency: 'USD', centsPerXmr: 32990n }, 40)).toEqual({ currency: 'USD', centsPerXmr: 33122n });
  });

  test('exact half rounds up', () => {
    // 150 * 10_100 / 10_000 = 151.5 -> 152
    expect(rateFor({ currency: 'USD', centsPerXmr: 150n }, 100).centsPerXmr).toBe(152n);
  });

  test('negative margin', () => {
    expect(rateFor({ currency: 'EUR', centsPerXmr: 30000n }, -250).centsPerXmr).toBe(29250n);
  });

  test('zero margin keeps the market rate', () => {
    expect(rateFor({ currency: 'USD', centsPerXmr: 32990n }, 0).centsPerXmr).toBe(32990n);
  });

  test('rejects a non-integer margin or one at or below -100%', () => {
    expect(() => rateFor({ currency: 'USD', centsPerXmr: 1n }, 1.5)).toThrow(RangeError);
    expect(() => rateFor({ currency: 'USD', centsPerXmr: 1n }, -10_000)).toThrow(RangeError);
    expect(() => rateFor({ currency: 'USD', centsPerXmr: 1n }, Number.NaN)).toThrow(RangeError);
  });

  test('rejects a non-positive market price', () => {
    expect(() => rateFor({ currency: 'USD', centsPerXmr: 0n }, 0)).toThrow(RangeError);
  });
});

describe('fiatCents and atomicForFiat', () => {
  test('1.25 XMR at $330.00', () => {
    expect(fiatCents(1_250_000_000_000n, { currency: 'USD', centsPerXmr: 33000n })).toBe(41250n);
  });

  test('fiatCents rounds half up', () => {
    // 0.5 cent exactly
    expect(fiatCents(XMR / 2n, { currency: 'USD', centsPerXmr: 1n })).toBe(1n);
    expect(fiatCents(XMR / 2n - 1n, { currency: 'USD', centsPerXmr: 1n })).toBe(0n);
  });

  test('atomicForFiat floors', () => {
    expect(atomicForFiat(41250n, { currency: 'USD', centsPerXmr: 33000n })).toBe(1_250_000_000_000n);
    expect(atomicForFiat(1n, { currency: 'USD', centsPerXmr: 3n })).toBe(333_333_333_333n);
  });

  test('rejects negative amounts', () => {
    expect(() => fiatCents(-1n, { currency: 'USD', centsPerXmr: 1n })).toThrow(RangeError);
    expect(() => atomicForFiat(-1n, { currency: 'USD', centsPerXmr: 1n })).toThrow(RangeError);
    expect(() => atomicForFiat(1n, { currency: 'USD', centsPerXmr: 0n })).toThrow(RangeError);
  });
});

describe('offerRate', () => {
  const market = { currency: 'USD', centsPerXmr: 32990n };

  test('fixed mode ignores the feed', () => {
    expect(offerRate({ mode: 'fixed', centsPerXmr: 34000n }, 'USD', null)).toEqual({ currency: 'USD', centsPerXmr: 34000n });
    expect(offerRate({ mode: 'fixed', centsPerXmr: 34000n }, 'USD', market)).toEqual({ currency: 'USD', centsPerXmr: 34000n });
  });

  test('market mode needs the feed', () => {
    expect(offerRate({ mode: 'market', marginBps: 40 }, 'USD', null)).toBeNull();
    expect(offerRate({ mode: 'market', marginBps: 40 }, 'USD', market)).toEqual({ currency: 'USD', centsPerXmr: 33122n });
  });

  test('market mode refuses a feed price in another currency', () => {
    expect(offerRate({ mode: 'market', marginBps: 40 }, 'EUR', market)).toBeNull();
  });

  test('fixed mode rejects a non-positive price', () => {
    expect(() => offerRate({ mode: 'fixed', centsPerXmr: 0n }, 'USD', null)).toThrow(RangeError);
  });
});

describe('formatXmr and formatFiat', () => {
  test('six decimals by default', () => {
    expect(formatXmr(1_237_500_000_000n)).toBe('1.237500');
    expect(formatXmr(0n)).toBe('0.000000');
    expect(formatXmr(12_500_000_000n)).toBe('0.012500');
  });

  test('truncates rather than rounding up past what exists', () => {
    expect(formatXmr(999_999_999n)).toBe('0.000999');
  });

  test('other decimal counts', () => {
    expect(formatXmr(1n, 12)).toBe('0.000000000001');
    expect(formatXmr(1_250_000_000_000n, 0)).toBe('1');
    expect(() => formatXmr(1n, 13)).toThrow(RangeError);
  });

  test('negative amounts keep the sign', () => {
    expect(formatXmr(-12_500_000_000n)).toBe('-0.012500');
  });

  test('fiat', () => {
    expect(formatFiat(41250n, 'USD')).toBe('$412.50');
    expect(formatFiat(5n, 'USD')).toBe('$0.05');
    expect(formatFiat(123_456_789n, 'USD')).toBe('$1,234,567.89');
    expect(formatFiat(41250n, 'EUR')).toBe('€412.50');
  });

  test('fiat beyond Number precision stays exact', () => {
    expect(formatFiat(9_007_199_254_740_993n, 'USD')).toBe('$90,071,992,547,409.93');
  });
});

describe('escrowPlan', () => {
  test('a seller-poster funds amount + 1%', () => {
    expect(escrowPlan({ amountAtomic: 1_250_000_000_000n, poster: 'seller' })).toEqual({
      sellerFundsAtomic: 1_262_500_000_000n,
      feeAtomic: 12_500_000_000n,
    });
  });

  test('a buyer-poster ad: the seller funds the amount', () => {
    expect(escrowPlan({ amountAtomic: 1_250_000_000_000n, poster: 'buyer' })).toEqual({
      sellerFundsAtomic: 1_250_000_000_000n,
      feeAtomic: 12_500_000_000n,
    });
  });

  test('rejects a non-positive amount', () => {
    expect(() => escrowPlan({ amountAtomic: 0n, poster: 'seller' })).toThrow(RangeError);
  });
});
