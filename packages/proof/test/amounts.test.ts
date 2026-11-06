import { describe, expect, it } from 'vitest';
import { parseAmounts } from '../src/index.js';
import { ocr } from './ocr.js';

describe('parseAmounts', () => {
  it('finds 41250n in each format for USD (exponent 2)', () => {
    for (const line of ['$412.50', '412,50 €', 'USD 412.50', '412.50 USD', 'Amount: $412.50', '-$412.50', 'US$412.50']) {
      expect(parseAmounts(ocr(line), line.includes('€') ? 'EUR' : 'USD', 2), line).toEqual([41250n]);
    }
  });

  it('reads thousands separators in each style', () => {
    expect(parseAmounts(ocr('1,234.56'), 'USD', 2)).toEqual([123456n]);
    expect(parseAmounts(ocr('1.234,56'), 'EUR', 2)).toEqual([123456n]);
    expect(parseAmounts(ocr('1 234,56'), 'EUR', 2)).toEqual([123456n]);
    expect(parseAmounts(ocr('1 234,56 €'), 'EUR', 2)).toEqual([123456n]);
    expect(parseAmounts(ocr("CHF 1'234.56"), 'CHF', 2)).toEqual([123456n]);
    expect(parseAmounts(ocr('$1,234,567.89'), 'USD', 2)).toEqual([123456789n]);
  });

  it('does not confuse 1234n cents with 123456n', () => {
    expect(parseAmounts(ocr('$12.34'), 'USD', 2)).toEqual([1234n]);
    expect(parseAmounts(ocr('1,234.56'), 'USD', 2)).not.toContain(1234n);
    expect(parseAmounts(ocr('$12.34'), 'USD', 2)).not.toContain(123456n);
  });

  it('reads whole amounts with a currency marker', () => {
    expect(parseAmounts(ocr('$412'), 'USD', 2)).toEqual([41200n]);
    expect(parseAmounts(ocr('$1,234'), 'USD', 2)).toEqual([123400n]);
    expect(parseAmounts(ocr('¥41,250'), 'JPY', 0)).toEqual([41250n]);
    expect(parseAmounts(ocr('41.250 JPY'), 'JPY', 0)).toEqual([41250n]);
  });

  it('pads short decimals', () => {
    expect(parseAmounts(ocr('$412.5'), 'USD', 2)).toEqual([41250n]);
  });

  it('ignores bare whole numbers (years, times, references)', () => {
    expect(parseAmounts(ocr('Oct 16, 2026 at 14:32 ref 8392'), 'USD', 2)).toEqual([]);
  });

  it('ignores an amount in another currency', () => {
    expect(parseAmounts(ocr('€412.50'), 'USD', 2)).toEqual([]);
    expect(parseAmounts(ocr('412.50 EUR'), 'USD', 2)).toEqual([]);
  });

  it('ignores numbers with more decimals than the currency has', () => {
    expect(parseAmounts(ocr('Rate 1.08325'), 'USD', 2)).toEqual([]);
  });

  it('does not join a quantity to an amount across a space', () => {
    expect(parseAmounts(ocr('Qty 3 412.50'), 'USD', 2)).toEqual([41250n]);
  });

  it('finds several amounts in reading order', () => {
    expect(parseAmounts(ocr('Sent $412.50', 'Fee $0.00', 'Balance $1,020.13'), 'USD', 2)).toEqual([41250n, 0n, 102013n]);
  });

  it('refuses a bad exponent', () => {
    expect(() => parseAmounts(ocr('$1'), 'USD', -1)).toThrow(RangeError);
    expect(() => parseAmounts(ocr('$1'), 'USD', 1.5)).toThrow(RangeError);
  });
});
