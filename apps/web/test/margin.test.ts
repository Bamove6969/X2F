// Design (final call, 10 Nov 2026): one form for an offer's price against the market, everywhere a
// margin is shown. "0.4% above market", "0.5% below market", "at market" at exactly 0; up to two
// decimals, trailing zeros trimmed (0.4%, never 0.40%). Every screen that shows a margin routes
// through ui/margin.ts (the offer card, the quote's bands card, Post an offer, My offers).
import { describe, expect, it } from 'vitest';
import { marginParts, marginWords } from '../src/ui/margin.js';

describe('marginWords: the one price wording', () => {
  it('above and below the market, the figure first, no sign', () => {
    expect(marginWords(40)).toBe('0.4% above market');
    expect(marginWords(50)).toBe('0.5% above market');
    expect(marginWords(-50)).toBe('0.5% below market');
    expect(marginWords(5000)).toBe('50% above market');
    expect(marginWords(-5000)).toBe('50% below market');
  });

  it('"at market" at exactly 0, and only there', () => {
    expect(marginWords(0)).toBe('at market');
    expect(marginWords(-0)).toBe('at market');
    expect(marginWords(1)).toBe('0.01% above market');
    expect(marginWords(-1)).toBe('0.01% below market');
  });

  it('up to two decimals, trailing zeros trimmed: 0.4%, not 0.40%', () => {
    expect(marginWords(40)).not.toContain('0.40');
    expect(marginWords(3)).toBe('0.03% above market');
    expect(marginWords(-20)).toBe('0.2% below market');
    expect(marginWords(250)).toBe('2.5% above market');
    expect(marginWords(-125)).toBe('1.25% below market');
    expect(marginWords(-1225)).toBe('12.25% below market');
    expect(marginWords(100)).toBe('1% above market');
    expect(marginWords(1000)).toBe('10% above market');
  });

  it('never a "+", a "−" or a "-" (the words carry the direction)', () => {
    for (const bps of [40, -40, 0, 3, -3, 5000, -5000]) expect(marginWords(bps)).not.toMatch(/[+−-]/);
  });
});

describe('marginParts: the figure and the words, for a screen that styles the figure', () => {
  it('splits "0.4% above market" into its figure and its words', () => {
    expect(marginParts(40)).toEqual({ figure: '0.4%', words: 'above market' });
    expect(marginParts(-125)).toEqual({ figure: '1.25%', words: 'below market' });
  });

  it('at market has no figure', () => {
    expect(marginParts(0)).toEqual({ figure: null, words: 'at market' });
  });

  it('joined, the parts read as marginWords', () => {
    for (const bps of [40, -40, 0, 3, -1225, 5000]) {
      const p = marginParts(bps);
      expect([p.figure, p.words].filter((s) => s !== null).join(' ')).toBe(marginWords(bps));
    }
  });
});
