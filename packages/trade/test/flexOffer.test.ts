import { describe, expect, test } from 'vitest';
import {
  ADJUST_MAX_BPS,
  ADJUST_MIN_BPS,
  ADJUST_STEP_BPS,
  ATOMIC_PER_XMR,
  BAND_DIFFER_DEFAULT,
  BAND_MIN_TRADES,
  MAX_BANDS,
  MAX_CURRENCIES,
  MAX_METHODS,
  adjustAllowed,
  bandsDiffer,
  bandsToTiers,
  checkBands,
  headlineTier,
  pickTier,
  rateFor,
  tierHolds,
  tierRange,
  tierRate,
  type Band,
  type Tier,
} from '../src/index.js';

// Plan 3 Tasks 34/35 rebuilt (J-16, 9 Nov 2026) with the owner's numbers: at most 3 bands per
// currency (Q23, O-009), at most 5 payment types per offer (Q23, O-010), at most 5 currencies
// (2 Nov, Q8). Bands are typed in whole units of their currency, the next starting one unit on
// (2 Nov, O-018). A band may share amounts with another only when they differ by a condition
// (7 Nov, Q20/F3, O-015): the lead's default list, pending the owner (p11-60).

const band = (min: string, max: string, marginBps = 0, minTrades: Band['minTrades'] = null, methodIds?: string[]): Band =>
  methodIds === undefined ? { min, max, marginBps, minTrades } : { min, max, marginBps, minTrades, methodIds };

describe('the owner numbers', () => {
  test("3 bands, 5 payment types, 5 currencies; a method's price change -5% to +10% in 0.5% steps", () => {
    expect(MAX_BANDS).toBe(3);
    expect(MAX_METHODS).toBe(5);
    expect(MAX_CURRENCIES).toBe(5);
    // The owner's price-change rule (the web form's; review I4 put it on the API and the database too).
    expect([ADJUST_MIN_BPS, ADJUST_MAX_BPS, ADJUST_STEP_BPS]).toEqual([-500, 1000, 50]);
    for (const ok of [-500, -50, 0, 50, 1000]) expect(adjustAllowed(ok), String(ok)).toBe(true);
    for (const no of [-550, 1050, 25, 37, 2000, -2000, 0.5, NaN, '50', null]) expect(adjustAllowed(no), String(no)).toBe(false);
    // The minimum completed trades are the fixed choice of 8 Nov (null: no minimum).
    expect(BAND_MIN_TRADES).toEqual([5, 10, 25, 50]);
  });
});

describe('checkBands (fiat, whole units)', () => {
  test('one band, or bands that follow on one unit later (200-500 then 501-800)', () => {
    expect(checkBands([band('200', '500')], 'fiat')).toBeNull();
    expect(checkBands([band('200', '500', 100), band('501', '800', 50)], 'fiat')).toBeNull();
    // Any order.
    expect(checkBands([band('801', '900'), band('200', '500'), band('501', '800')], 'fiat')).toBeNull();
    expect(checkBands([band('7', '7')], 'fiat')).toBeNull();
  });

  test('at most 3 bands per currency', () => {
    const four = [band('1', '10'), band('11', '20'), band('21', '30'), band('31', '40')];
    expect(checkBands(four.slice(0, 3), 'fiat')).toBeNull();
    expect(checkBands(four, 'fiat')).toBe('too-many-bands');
    expect(checkBands([], 'fiat')).toBe('no-bands');
  });

  test('a gap between bands is refused', () => {
    expect(checkBands([band('200', '500'), band('502', '800', 10)], 'fiat')).toBe('gap');
    expect(checkBands([band('200', '500'), band('900', '1000', 10)], 'fiat')).toBe('gap');
  });

  test('malformed bands are refused', () => {
    for (const b of [
      band('0', '5'), band('5', '1'), band('-1', '5'), band('01', '5'), band('1.5', '5'), band('1', '1e3'), band('1', '1234567890123'),
      band('1', '5', 5001), band('1', '5', -5001), band('1', '5', 1.5),
      { ...band('1', '5'), minTrades: 3 as unknown as Band['minTrades'] },
      { ...band('1', '5'), minTrades: 0 as unknown as Band['minTrades'] },
      { ...band('1', '5'), extra: 1 } as unknown as Band,
      band('1', '5', 0, null, []),
      band('1', '5', 0, null, ['ZELLE', 'ZELLE']),
    ]) {
      expect(checkBands([b], 'fiat'), JSON.stringify(b)).toBe('bad-band');
    }
    expect(checkBands('x', 'fiat')).toBe('bad-band');
  });

  test('a second band on the same amounts needs another condition (the lead default, pending the owner)', () => {
    // Same amounts and nothing else different: refused, also when only partly overlapping.
    expect(checkBands([band('200', '500'), band('200', '500')], 'fiat')).toBe('bands-same');
    expect(checkBands([band('200', '500', 100), band('400', '800', 100)], 'fiat')).toBe('bands-same');
    // Each condition on the default list is enough by itself.
    expect(checkBands([band('200', '500'), band('200', '500', 0, 25)], 'fiat')).toBeNull();
    expect(checkBands([band('200', '500', 100), band('200', '500', 50)], 'fiat')).toBeNull();
    expect(checkBands([band('200', '500', 0, null, ['ZELLE']), band('200', '500', 0, null, ['REVOLUT'])], 'fiat')).toBeNull();
    // A band with every method (no list) and one with a list are different sets.
    expect(checkBands([band('200', '500'), band('200', '500', 0, null, ['ZELLE'])], 'fiat')).toBeNull();
    // The same set in another order is the same set.
    expect(checkBands([band('1', '5', 0, null, ['A', 'B']), band('1', '5', 0, null, ['B', 'A'])], 'fiat')).toBe('bands-same');
    expect(BAND_DIFFER_DEFAULT).toEqual(['range', 'minTrades', 'margin', 'methods']);
  });

  test('the rule is configurable: which differences count', () => {
    const a = band('200', '500', 100);
    const b = band('200', '500', 50);
    expect(bandsDiffer(a, b)).toBe(true);
    expect(bandsDiffer(a, b, ['range', 'minTrades'])).toBe(false);
    expect(checkBands([a, b], 'fiat', ['range', 'minTrades'])).toBe('bands-same');
    // Without 'range', even bands on different amounts must differ by a condition.
    expect(checkBands([band('200', '500'), band('501', '800')], 'fiat', ['minTrades'])).toBe('bands-same');
    expect(checkBands([band('200', '500'), band('501', '800', 0, 5)], 'fiat', ['minTrades'])).toBeNull();
  });
});

describe('checkBands (XMR)', () => {
  const XMR = ATOMIC_PER_XMR.toString();
  test('one band per currency in atomic units', () => {
    expect(checkBands([band((ATOMIC_PER_XMR / 2n).toString(), (ATOMIC_PER_XMR * 3n).toString(), 100, 10)], 'xmr')).toBeNull();
    expect(checkBands([band('1', '1')], 'xmr')).toBeNull();
    // Lead default until the owner rules on bands in XMR: one band only.
    expect(checkBands([band('1', XMR), band((ATOMIC_PER_XMR + 1n).toString(), (ATOMIC_PER_XMR * 2n).toString())], 'xmr')).toBe('xmr-one-band');
    expect(checkBands([band('0', XMR)], 'xmr')).toBe('bad-band');
    expect(checkBands([band('1', '1'.repeat(21))], 'xmr')).toBe('bad-band');
  });
});

describe('bandsToTiers', () => {
  test('a band covers totals up to just below the next band (200-500, 501-800 → 20000-50099, 50100-80000)', () => {
    expect(bandsToTiers([band('501', '800', 50), band('200', '500', 100)], 'fiat', 2)).toEqual([
      { min: '20000', max: '50099', marginBps: 100, minTrades: null, methodIds: null },
      { min: '50100', max: '80000', marginBps: 50, minTrades: null, methodIds: null },
    ]);
    // JPY has no minor unit; KWD has 3.
    expect(bandsToTiers([band('1', '9'), band('10', '20')], 'fiat', 0).map((t) => [t.min, t.max])).toEqual([['1', '9'], ['10', '20']]);
    expect(bandsToTiers([band('1', '9')], 'fiat', 3).map((t) => [t.min, t.max])).toEqual([['1000', '9000']]);
  });

  test('bands on the same amounts each cover them; a band reaching into another covers up to its next unit', () => {
    const tiers = bandsToTiers([band('200', '500'), band('200', '500', 0, 25, ['ZELLE']), band('501', '900')], 'fiat', 2);
    expect(tiers.map((t) => [t.min, t.max, t.minTrades, t.methodIds])).toEqual([
      ['20000', '50099', null, null],
      ['20000', '50099', 25, ['ZELLE']],
      ['50100', '90000', null, null],
    ]);
  });

  test('XMR bands are kept as typed, in atomic units', () => {
    expect(bandsToTiers([band('5', '9', 10)], 'xmr', 2)).toEqual([{ min: '5', max: '9', marginBps: 10, minTrades: null, methodIds: null }]);
    const [t] = bandsToTiers([band('5', '9')], 'xmr', 2);
    expect(tierRange('xmr', t!)).toEqual({ unit: 'xmr', min: 5n, max: 9n });
  });
});

const tier = (min: string, max: string, marginBps = 0, minTrades: Tier['minTrades'] = null, methodIds: string[] | null = null): Tier => ({
  min, max, marginBps, minTrades, methodIds,
});

describe('pickTier: the band a take is priced from', () => {
  const tiers = [tier('20000', '50099', 200), tier('20000', '50099', 100, 25), tier('50100', '80000', 50, null, ['ZELLE'])];
  const fiat = (fiatCents: bigint) => ({ amountAtomic: 1n, fiatCents });

  test('the band holding the total, both ends included', () => {
    expect(pickTier(tiers, 'fiat', fiat(20000n), 'ZELLE', 'sell', 0)).toEqual({ tier: tiers[0] });
    expect(pickTier(tiers, 'fiat', fiat(50099n), 'ZELLE', 'sell', 0)).toEqual({ tier: tiers[0] });
    expect(pickTier(tiers, 'fiat', fiat(80000n), 'ZELLE', 'sell', 0)).toEqual({ tier: tiers[2] });
  });

  test('outside every band, or a band without this method: out-of-range', () => {
    expect(pickTier(tiers, 'fiat', fiat(19999n), 'ZELLE', 'sell', 0)).toEqual({ refused: 'out-of-range' });
    expect(pickTier(tiers, 'fiat', fiat(80001n), 'ZELLE', 'sell', 0)).toEqual({ refused: 'out-of-range' });
    expect(pickTier(tiers, 'fiat', fiat(60000n), 'REVOLUT', 'sell', 0)).toEqual({ refused: 'out-of-range' });
  });

  test('of the bands the taker qualifies for, the best price for them', () => {
    // A taker with 30 trades buying (sell ad): the lower margin.
    expect(pickTier(tiers, 'fiat', fiat(30000n), 'ZELLE', 'sell', 30)).toEqual({ tier: tiers[1] });
    // Selling to a buy ad: the higher margin.
    expect(pickTier(tiers, 'fiat', fiat(30000n), 'ZELLE', 'buy', 30)).toEqual({ tier: tiers[0] });
  });

  test('no band the taker qualifies for: not-enough-trades with the lowest rule', () => {
    const strict = [tier('100', '900', 0, 50), tier('100', '900', 10, 10)];
    expect(pickTier(strict, 'fiat', fiat(500n), 'ZELLE', 'sell', 9)).toEqual({ refused: 'not-enough-trades', minTrades: 10 });
    expect(pickTier(strict, 'fiat', fiat(500n), 'ZELLE', 'sell', 10)).toEqual({ tier: strict[1] });
  });

  test('an XMR band is found by the amount', () => {
    const x = [tier('500', '900', 10)];
    expect(pickTier(x, 'xmr', { amountAtomic: 500n, fiatCents: 1n }, 'ZELLE', 'sell', 0)).toEqual({ tier: x[0] });
    expect(pickTier(x, 'xmr', { amountAtomic: 499n, fiatCents: 700n }, 'ZELLE', 'sell', 0)).toEqual({ refused: 'out-of-range' });
    expect(tierHolds('xmr', x[0]!, { amountAtomic: 900n, fiatCents: 0n })).toBe(true);
  });
});

describe('headlineTier: a card without an amount', () => {
  const tiers = [tier('100', '500', 200), tier('100', '500', 100, 25), tier('501', '900', 300, null, ['REVOLUT'])];
  test('the best band the viewer qualifies for, among those with the method', () => {
    expect(headlineTier(tiers, 'ZELLE', 'sell', 0)).toBe(tiers[0]);
    expect(headlineTier(tiers, 'ZELLE', 'sell', 25)).toBe(tiers[1]);
    expect(headlineTier(tiers, 'REVOLUT', 'buy', 0)).toBe(tiers[2]);
    // The poster's own view (null): every band.
    expect(headlineTier(tiers, 'ZELLE', 'sell', null)).toBe(tiers[1]);
  });
  test('when no band is open to the viewer, those with the lowest rule; null without the method', () => {
    const strict = [tier('100', '500', 100, 50), tier('501', '900', 0, 10)];
    expect(headlineTier(strict, 'ZELLE', 'sell', 0)).toBe(strict[1]);
    expect(headlineTier([tier('1', '2', 0, null, ['A'])], 'B', 'sell', 0)).toBeNull();
  });
});

describe('tierRate', () => {
  const market = { currency: 'USD', centsPerXmr: 33_000n };
  test('market + band margin + method adjustment, rounded once', () => {
    expect(tierRate('USD', tier('1', '2', 150), { adjustBps: -50 }, market)).toEqual(rateFor(market, 100));
    expect(tierRate('EUR', tier('1', '2'), { adjustBps: 0 }, market)).toBeNull();
    expect(tierRate('USD', tier('1', '2'), { adjustBps: 0 }, null)).toBeNull();
    expect(() => tierRate('USD', tier('1', '2', 5000), { adjustBps: 1 }, market)).toThrow(RangeError);
  });
});
