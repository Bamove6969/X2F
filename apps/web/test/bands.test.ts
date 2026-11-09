// The offer's size bands (owner 2026-11-08, quote screen): one model the offers card and the quote
// both read, so the range and price words on the two screens never disagree.
import { describe, expect, it } from 'vitest';
import { atomicForFiat, formatXmr, offerRate } from '@x2f/trade';
import { formatMinor } from '../src/screens/browse/api.js';
import { bandAt, bandRate, bandXmr, clipLines, marginText, markupText, money, offerBands, offerRange, rangeText, type Band } from '../src/screens/browse/bands.js';

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

  it("the quote passes the price route's exponent: whole yen, 3-place dinars", () => {
    expect(rangeText(5_000n, 150_000n, 'JPY', 0)).toBe('¥5,000 – ¥150,000');
    expect(rangeText(50_000n, 150_001n, 'KWD', 3).replace(/\u00a0/g, ' ')).toBe('KWD 50 – KWD 150.001');
    expect(money(33_000n, 'JPY', 0)).toBe('¥33,000');
    expect(money(330_005n, 'KWD', 3).replace(/\u00a0/g, ' ')).toBe('KWD 330.005');
  });

  it("the price is the card's margin line", () => {
    expect(marginText({ mode: 'market', marginBps: 20 }, 'CAD', null, buyerLikes)).toEqual({ text: '0.2% above market', favourable: false });
    expect(marginText({ mode: 'market', marginBps: -125 }, 'USD', null, buyerLikes)).toEqual({ text: '1.25% below market', favourable: true });
    expect(marginText({ mode: 'market', marginBps: 0 }, 'USD', null, buyerLikes)).toEqual({ text: 'At market', favourable: false });
    expect(marginText({ mode: 'fixed', centsPerXmr: 34_000n }, 'USD', null, buyerLikes)).toEqual({ text: 'Fixed price', favourable: false });
    expect(marginText({ mode: 'fixed', centsPerXmr: 34_000n }, 'USD', 33_000n, buyerLikes)).toEqual({ text: '$10.00 above market', favourable: false });
  });
});

const MARKET = 33_000n;
const usd = (rate: bigint) => ({ currency: 'USD', centsPerXmr: rate });

describe('bandRate and bandXmr: each band in XMR, with or without the markup (owner 2026-11-08)', () => {
  const up: Band = { fromFiatCents: 5_000n, toFiatCents: 150_000n, pricing: { mode: 'market', marginBps: 250 }, minTrades: 0 };

  it("with the markup: the band's own price (offerRate), the fiat edges converted exactly (atomicForFiat, 6 places)", () => {
    const rate = bandRate(up, 'USD', MARKET, true)!;
    expect(rate).toEqual(offerRate(up.pricing, 'USD', usd(MARKET)));
    expect(rate.centsPerXmr).toBe(33_825n);
    expect(bandXmr(up, rate)).toBe(`${formatXmr(atomicForFiat(5_000n, rate), 6)} – ${formatXmr(atomicForFiat(150_000n, rate), 6)}`);
    expect(bandXmr(up, rate)).toBe('0.147819 – 4.434589');
  });

  it('without it: the market price', () => {
    const rate = bandRate(up, 'USD', MARKET, false)!;
    expect(rate.centsPerXmr).toBe(MARKET);
    expect(bandXmr(up, rate)).toBe('0.151515 – 4.545454');
  });

  it('no market price: a market band has no rate either way; a fixed band only with its markup', () => {
    expect(bandRate(up, 'USD', null, true)).toBeNull();
    expect(bandRate(up, 'USD', null, false)).toBeNull();
    const fixed: Band = { ...up, pricing: { mode: 'fixed', centsPerXmr: 30_000n } };
    expect(bandXmr(fixed, bandRate(fixed, 'USD', null, true)!)).toBe('0.166666 – 5.000000');
    expect(bandRate(fixed, 'USD', null, false)).toBeNull();
  });
});

describe('markupText: the markup as the board writes it', () => {
  it("a market band's margin, exact, 2 places", () => {
    expect(markupText({ mode: 'market', marginBps: 250 }, null)).toBe('+2.50%');
    expect(markupText({ mode: 'market', marginBps: 3 }, null)).toBe('+0.03%');
    expect(markupText({ mode: 'market', marginBps: -20 }, null)).toBe('−0.20%');
    expect(markupText({ mode: 'market', marginBps: 0 }, MARKET)).toBe('0.00%');
  });

  it("a fixed band's, from the market price, to the nearest basis point; none without a market", () => {
    // The board's $330.00 on $329.90: 0.0303...% → +0.03%.
    expect(markupText({ mode: 'fixed', centsPerXmr: 33_000n }, 32_990n)).toBe('+0.03%');
    expect(markupText({ mode: 'fixed', centsPerXmr: 33_188n }, 32_990n)).toBe('+0.60%');
    expect(markupText({ mode: 'fixed', centsPerXmr: 32_000n }, 33_000n)).toBe('−3.03%');
    expect(markupText({ mode: 'fixed', centsPerXmr: 33_000n }, null)).toBeNull();
  });
});

describe('clipLines: where the rate changes around your band', () => {
  const rate = (b: Band) => formatMinor(offerRate(b.pricing, 'USD', usd(MARKET))!.centsPerXmr, 'USD');

  it("the bottom band: only up, at its top edge, to the next band's rate", () => {
    expect(clipLines(THREE, { kind: 'in', index: 0 }, 'USD', MARKET)).toEqual([{ dir: 'up', at: '$500', rate: rate(THREE[1]!) }]);
  });

  it('a middle band: up at its top, down at its bottom (cents kept: $500.01)', () => {
    expect(clipLines(THREE, { kind: 'in', index: 1 }, 'USD', MARKET)).toEqual([
      { dir: 'up', at: '$1,500', rate: rate(THREE[2]!) },
      { dir: 'down', at: '$500.01', rate: rate(THREE[0]!) },
    ]);
  });

  it('a single band, no amount, or an amount outside every band: none', () => {
    const one = offerBands({ minFiatCents: 5_000n, maxFiatCents: 150_000n, pricing: { mode: 'market', marginBps: 0 }, minTrades: 0 });
    expect(clipLines(one, { kind: 'in', index: 0 }, 'USD', MARKET)).toEqual([]);
    expect(clipLines(THREE, null, 'USD', MARKET)).toEqual([]);
    expect(clipLines(THREE, { kind: 'below' }, 'USD', MARKET)).toEqual([]);
    expect(clipLines(THREE, { kind: 'above' }, 'USD', MARKET)).toEqual([]);
  });

  it('a 0-decimal currency: the edge and the rate in whole yen', () => {
    const yen: Band[] = [
      { fromFiatCents: 5_000n, toFiatCents: 50_000n, pricing: { mode: 'fixed', centsPerXmr: 33_000n }, minTrades: 0 },
      { fromFiatCents: 50_001n, toFiatCents: 150_000n, pricing: { mode: 'fixed', centsPerXmr: 33_188n }, minTrades: 0 },
    ];
    expect(clipLines(yen, { kind: 'in', index: 0 }, 'JPY', null, 0)).toEqual([{ dir: 'up', at: '¥50,000', rate: '¥33,188' }]);
  });

  it('no market price: no rate to name, no line', () => {
    expect(clipLines(THREE, { kind: 'in', index: 1 }, 'USD', null)).toEqual([]);
  });
});

