import { describe, expect, test } from 'vitest';
import { amountForFunds, atomicForFiat, escrowPlan, fiatCents, formatFiat, formatXmr, formatXmrExact, offerRate, posterRole, rateFor } from '../src/index.js';

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

  test('rejects a non-integer margin or one beyond ±50%', () => {
    expect(() => rateFor({ currency: 'USD', centsPerXmr: 1n }, 1.5)).toThrow(RangeError);
    expect(() => rateFor({ currency: 'USD', centsPerXmr: 1n }, -10_000)).toThrow(RangeError);
    expect(() => rateFor({ currency: 'USD', centsPerXmr: 1n }, -5_001)).toThrow(RangeError);
    expect(() => rateFor({ currency: 'USD', centsPerXmr: 1n }, 5_001)).toThrow(RangeError);
    expect(rateFor({ currency: 'USD', centsPerXmr: 10_000n }, 5_000).centsPerXmr).toBe(15_000n);
    expect(rateFor({ currency: 'USD', centsPerXmr: 10_000n }, -5_000).centsPerXmr).toBe(5_000n);
    expect(() => rateFor({ currency: 'USD', centsPerXmr: 1n }, Number.NaN)).toThrow(RangeError);
  });

  test('the rate is always positive', () => {
    expect(rateFor({ currency: 'USD', centsPerXmr: 1n }, -5_000).centsPerXmr).toBe(1n);
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

  // Design kit handoff 1.5: every XMR string is /^\d+\.\d{6}$/, money is never rounded up.
  test('kit: always exactly 6 places, trailing zeros kept', () => {
    for (const a of [0n, 1n, 999_999n, 1_000_000n, 1_250_000_000_000n, 275_400_000_000_000n, 10n ** 18n]) {
      expect(formatXmr(a)).toMatch(/^\d+\.\d{6}$/);
    }
    expect(formatXmr(1_250_000_000_000n)).toBe('1.250000');
    expect(formatXmr(1_000_000_000_000n)).toBe('1.000000');
  });

  test('kit: digits past the sixth are cut, never rounded (half, nine and just-under cases)', () => {
    expect(formatXmr(1_250_000_500_000n)).toBe('1.250000'); // exactly half of the 6th place
    expect(formatXmr(1_250_000_999_999n)).toBe('1.250000'); // would round up to 1.250001
    expect(formatXmr(999_999_999_999n)).toBe('0.999999'); // would round up to 1.000000
    expect(formatXmr(1_262_500_000_000n)).toBe('1.262500');
  });

  test('kit: very small amounts', () => {
    expect(formatXmr(1n)).toBe('0.000000'); // one atomic unit is below the 6th place
    expect(formatXmr(999_999n)).toBe('0.000000');
    expect(formatXmr(1_000_000n)).toBe('0.000001'); // the smallest amount 6 places can show
  });

  test('kit: very large amounts stay exact past Number precision', () => {
    expect(formatXmr(18_446_744_073_709_551_615n)).toBe('18446744.073709'); // 2^64 - 1 atomic
    expect(formatXmr(9_007_199_254_740_993_000_000n)).toBe('9007199254.740993');
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

describe('formatXmrExact (figures the user must send: exact to the atomic unit)', () => {
  test('at least 6 places: an aligned amount reads like formatXmr', () => {
    expect(formatXmrExact(1_250_000_000_000n)).toBe('1.250000');
    expect(formatXmrExact(0n)).toBe('0.000000');
    expect(formatXmrExact(5n * XMR)).toBe('5.000000');
  });

  test('more places when the digits past the 6th are non-zero, trailing zeros trimmed', () => {
    expect(formatXmrExact(610_529_733_574n)).toBe('0.610529733574');
    expect(formatXmrExact(1_000_000_900_000n)).toBe('1.0000009');
    expect(formatXmrExact(1_000_000_000_001n)).toBe('1.000000000001');
    expect(formatXmrExact(999_999_900_000n)).toBe('0.9999999');
  });

  test('a remainder under 0.000001 is never shown as zero', () => {
    expect(formatXmrExact(733_574n)).toBe('0.000000733574');
    expect(formatXmrExact(1n)).toBe('0.000000000001');
    expect(formatXmr(733_574n)).toBe('0.000000');
  });

  test('round-trips: the shown figure is the atomic amount', () => {
    for (const a of [1n, 733_574n, 610_529_733_574n, 1_262_500_000_000n, 18_446_744_073_709_551_615n]) {
      const [whole, frac] = formatXmrExact(a).split('.');
      expect(BigInt(whole!) * XMR + BigInt(frac!.padEnd(12, '0'))).toBe(a);
    }
  });

  test('negative amounts keep the sign', () => {
    expect(formatXmrExact(-733_574n)).toBe('-0.000000733574');
    expect(formatXmrExact(-12_500_000_000n)).toBe('-0.012500');
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

describe('amountForFunds', () => {
  test('a buyer-poster trade grows to exactly what was funded', () => {
    expect(amountForFunds(1_300_000_000_000n, 'buyer')).toBe(1_300_000_000_000n);
  });

  test('a seller-poster trade grows to the largest A with A + feeFor(A) <= funds', () => {
    for (const funds of [1n, 100n, 101n, 102n, 1_262_500_000_000n, 1_262_600_000_000n, 1_313_131_313_131n, 7_777_777_777_777n]) {
      const a = amountForFunds(funds, 'seller');
      expect(escrowPlan({ amountAtomic: a, poster: 'seller' }).sellerFundsAtomic <= funds).toBe(true);
      expect(escrowPlan({ amountAtomic: a + 1n, poster: 'seller' }).sellerFundsAtomic > funds).toBe(true);
    }
    expect(amountForFunds(1_262_500_000_000n, 'seller')).toBe(1_250_000_000_000n);
  });

  test('refuses non-positive funds', () => {
    expect(() => amountForFunds(0n, 'seller')).toThrow(RangeError);
  });
});
