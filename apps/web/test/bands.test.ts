// The offer's size bands (owner 2026-11-08, quote screen): one model the offers card and the quote
// both read, so the range and price words on the two screens never disagree.
import { describe, expect, it } from 'vitest';
import { bandAt, bandClip, marginText, offerBands, offerRange, rangeText, type Band } from '../src/screens/browse/bands.js';

const buyerLikes = (bps: number) => bps < 0;

/** One offer's bands as FlexOffer-Post draws them: whole units, in order, no gaps. */
const THREE: Band[] = [
  { fromFiatCents: 5_000n, toFiatCents: 50_000n, pricing: { mode: 'market', marginBps: 80 }, minTrades: 0 },
  { fromFiatCents: 50_001n, toFiatCents: 150_000n, pricing: { mode: 'market', marginBps: 40 }, minTrades: 10 },
  { fromFiatCents: 150_001n, toFiatCents: 300_000n, pricing: { mode: 'market', marginBps: -20 }, minTrades: 25 },
];

describe('offerBands', () => {
  it("is the offer's one range at its own price while the API sends one band per offer", () => {
    const offer = { minFiatCents: 5_000n, maxFiatCents: 150_000n, pricing: { mode: 'market', marginBps: 20 } as const, minTrades: 5 };
    expect(offerBands(offer)).toEqual([{ fromFiatCents: 5_000n, toFiatCents: 150_000n, pricing: { mode: 'market', marginBps: 20 }, minTrades: 5 }]);
  });
});

describe('bandAt: which band an amount falls in', () => {
  it('finds the band inside each range', () => {
    expect(bandAt(THREE, 20_000n)).toEqual({ kind: 'in', index: 0 });
    expect(bandAt(THREE, 100_000n)).toEqual({ kind: 'in', index: 1 });
    expect(bandAt(THREE, 200_000n)).toEqual({ kind: 'in', index: 2 });
  });

  it('counts both edges of a band as inside it, and the next minor unit as the next band', () => {
    expect(bandAt(THREE, 5_000n)).toEqual({ kind: 'in', index: 0 });
    expect(bandAt(THREE, 50_000n)).toEqual({ kind: 'in', index: 0 });
    expect(bandAt(THREE, 50_001n)).toEqual({ kind: 'in', index: 1 });
    expect(bandAt(THREE, 150_000n)).toEqual({ kind: 'in', index: 1 });
    expect(bandAt(THREE, 150_001n)).toEqual({ kind: 'in', index: 2 });
    expect(bandAt(THREE, 300_000n)).toEqual({ kind: 'in', index: 2 });
  });

  it("clips one minor unit outside the offer's smallest and largest trade", () => {
    expect(bandAt(THREE, 4_999n)).toEqual({ kind: 'below' });
    expect(bandAt(THREE, 0n)).toEqual({ kind: 'below' });
    expect(bandAt(THREE, 300_001n)).toEqual({ kind: 'above' });
  });

  it('a gap between bands (never posted: bands are contiguous) is in no band', () => {
    const gappy: Band[] = [THREE[0]!, { ...THREE[1]!, fromFiatCents: 60_000n }];
    expect(bandAt(gappy, 55_000n)).toEqual({ kind: 'between' });
  });

  it('a single band clips at the offer min and max', () => {
    const one = offerBands({ minFiatCents: 5_000n, maxFiatCents: 150_000n, pricing: { mode: 'market', marginBps: 0 }, minTrades: 0 });
    expect(bandAt(one, 4_999n)).toEqual({ kind: 'below' });
    expect(bandAt(one, 5_000n)).toEqual({ kind: 'in', index: 0 });
    expect(bandAt(one, 150_000n)).toEqual({ kind: 'in', index: 0 });
    expect(bandAt(one, 150_001n)).toEqual({ kind: 'above' });
  });
});

describe('the words the offers card and the quote share', () => {
  it("the range is the card's: whole amounts without cents, cents kept when there are any", () => {
    expect(rangeText(5_000n, 150_000n, 'USD')).toBe('$50 – $1,500');
    expect(rangeText(50_001n, 150_000n, 'USD')).toBe('$500.01 – $1,500');
    expect(rangeText(5_000n, 150_000n, 'CAD')).toBe('CA$50 – CA$1,500');
    expect(offerRange({ minFiatCents: 5_000n, maxFiatCents: 150_000n }, 'USD')).toBe('$50 – $1,500');
  });

  it("the price is the card's margin line", () => {
    expect(marginText({ mode: 'market', marginBps: 20 }, 'CAD', null, buyerLikes)).toEqual({ text: '0.2% above market', favourable: false });
    expect(marginText({ mode: 'market', marginBps: -125 }, 'USD', null, buyerLikes)).toEqual({ text: '1.25% below market', favourable: true });
    expect(marginText({ mode: 'market', marginBps: 0 }, 'USD', null, buyerLikes)).toEqual({ text: 'At market', favourable: false });
    expect(marginText({ mode: 'fixed', centsPerXmr: 34_000n }, 'USD', null, buyerLikes)).toEqual({ text: 'Fixed price', favourable: false });
    expect(marginText({ mode: 'fixed', centsPerXmr: 34_000n }, 'USD', 33_000n, buyerLikes)).toEqual({ text: '$10.00 above market', favourable: false });
  });
});

describe('bandClip: where the price clips, for the amount typed', () => {
  const words = (at: Parameters<typeof bandClip>[1]) => bandClip(THREE, at, 'USD', null, buyerLikes);

  it('with no amount, the whole range per trade', () => {
    expect(words(null)).toBe('$50 – $3,000 per trade.');
  });

  it('inside a band with one above it, where this price ends and what comes next', () => {
    expect(words({ kind: 'in', index: 0 })).toBe('Up to $500 at this price. Above it: 0.4% above market.');
    expect(words({ kind: 'in', index: 1 })).toBe('Up to $1,500 at this price. Above it: 0.2% below market.');
  });

  it('in the top band, the largest trade', () => {
    expect(words({ kind: 'in', index: 2 })).toBe('Up to $3,000 at this price, the largest trade.');
  });

  it('outside the offer, the edge it is past', () => {
    expect(words({ kind: 'below' })).toBe('Your amount is below $50, the smallest trade.');
    expect(words({ kind: 'above' })).toBe('Your amount is above $3,000, the largest trade.');
    expect(words({ kind: 'between' })).toBe('No band covers your amount.');
  });
});
