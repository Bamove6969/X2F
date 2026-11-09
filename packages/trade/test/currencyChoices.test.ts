import { describe, expect, test } from 'vitest';
import { TOP_CURRENCIES, currencyChoices, currencyFlag } from '../src/index.js';

// Owner Q28 (6 Nov, O-019): the currency list starts with the most common ones, then A-Z, every one
// with its flag. Owner Q24 (O-020): a currency with no market rate now is kept but marked
// unavailable, and is available again as soon as its rate is back (design picks how it looks).

describe('currencyChoices', () => {
  const codes = ['NZD', 'JPY', 'EUR', 'BRL', 'USD', 'AUD', 'GBP', 'CAD', 'CHF', 'AED'];

  test('USD, EUR, GBP, CAD, AUD, JPY first, then A-Z', () => {
    expect(TOP_CURRENCIES).toEqual(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY']);
    expect(currencyChoices(codes, () => true).map((c) => c.code)).toEqual(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'AED', 'BRL', 'CHF', 'NZD']);
    // A top currency the list does not have is left out.
    expect(currencyChoices(['ZAR', 'EUR', 'ARS'], () => true).map((c) => c.code)).toEqual(['EUR', 'ARS', 'ZAR']);
  });

  test('each with its flag', () => {
    const flags = Object.fromEntries(currencyChoices(['USD', 'EUR', 'JPY', 'GBP'], () => true).map((c) => [c.code, c.flag]));
    expect(flags).toEqual({ USD: '\u{1F1FA}\u{1F1F8}', EUR: '\u{1F1EA}\u{1F1FA}', JPY: '\u{1F1EF}\u{1F1F5}', GBP: '\u{1F1EC}\u{1F1E7}' });
    expect(currencyFlag('CAD')).toBe('\u{1F1E8}\u{1F1E6}');
    expect(() => currencyFlag('usd')).toThrow(RangeError);
  });

  test('a currency with no rate stays in its place, marked unavailable, and comes back with its rate', () => {
    let priced = new Set(['USD', 'GBP']);
    const now = () => currencyChoices(['GBP', 'EUR', 'USD'], (c) => priced.has(c));
    expect(now()).toEqual([
      { code: 'USD', flag: currencyFlag('USD'), available: true },
      { code: 'EUR', flag: currencyFlag('EUR'), available: false },
      { code: 'GBP', flag: currencyFlag('GBP'), available: true },
    ]);
    priced = new Set(['USD', 'GBP', 'EUR']);
    expect(now().map((c) => c.available)).toEqual([true, true, true]);
  });
});
