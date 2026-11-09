// The offer's size bands (owner 2026-11-08, quote screen): one model the offers card and the quote
// both read, so the range and price words on the two screens never disagree.
import { describe, expect, it } from 'vitest';
import { atomicForFiat, formatXmr, offerRate } from '@x2f/trade';
import { formatMinor } from '../src/screens/browse/api.js';
import { bandAt, bandFiat, bandOther, bandRange, bandRate, bandXmr, clipLines, marginText, markupText, money, offerBands, rangeText, type Band } from '../src/screens/browse/bands.js';
import { markupOf } from '../src/screens/browse/OfferCard.js';
import { fiatRangeText, xmrRangeText } from '../src/screens/browse/offerAmounts.js';

/** An offer set in fiat (owner 8 Nov: the poster sets the range in XMR or in fiat). */
const FIAT_SET = { amountUnit: 'fiat', minAtomic: null, maxAtomic: null } as const;

const buyerLikes = (bps: number) => bps < 0;

/** One offer's bands as FlexOffer-Post draws them: whole units, in order, no gaps. */
const THREE: Band[] = [
  { unit: 'fiat', from: 5_000n, to: 50_000n, pricing: { mode: 'market', marginBps: 80 }, minTrades: 0 },
  { unit: 'fiat', from: 50_001n, to: 150_000n, pricing: { mode: 'market', marginBps: 40 }, minTrades: 10 },
  { unit: 'fiat', from: 150_001n, to: 300_000n, pricing: { mode: 'market', marginBps: -20 }, minTrades: 25 },
];

describe('offerBands', () => {
  it("is the offer's one range at its own price while the API sends one band per offer", () => {
    const offer = { ...FIAT_SET, minFiatCents: 5_000n, maxFiatCents: 150_000n, pricing: { mode: 'market', marginBps: 20 } as const, minTrades: 5 };
    expect(offerBands(offer)).toEqual([{ unit: 'fiat', from: 5_000n, to: 150_000n, pricing: { mode: 'market', marginBps: 20 }, minTrades: 5 }]);
  });

  it('an offer set in XMR (batch 2: no fiat range) is one XMR band, in atomic units', () => {
    const offer = { amountUnit: 'xmr', minAtomic: 300_000_000_000n, maxAtomic: 9_000_000_000_000n, minFiatCents: null, maxFiatCents: null, pricing: { mode: 'market', marginBps: 0 } as const, minTrades: 0 } as const;
    expect(offerBands(offer)).toEqual([{ unit: 'xmr', from: 300_000_000_000n, to: 9_000_000_000_000n, pricing: { mode: 'market', marginBps: 0 }, minTrades: 0 }]);
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
    const gappy: Band[] = [THREE[0]!, { ...THREE[1]!, from: 60_000n }];
    expect(bandAt(gappy, 55_000n)).toEqual({ kind: 'between' });
  });

  it('a single band clips at the offer min and max', () => {
    const one = offerBands({ ...FIAT_SET, minFiatCents: 5_000n, maxFiatCents: 150_000n, pricing: { mode: 'market', marginBps: 0 }, minTrades: 0 });
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
    // The offers card's own words for the same range (offerAmounts.ts, batch 2's two-row card).
    for (const [from, to, cur] of [[5_000n, 150_000n, 'USD'], [50_001n, 150_000n, 'USD'], [5_000n, 150_000n, 'CAD']] as const) {
      expect(rangeText(from, to, cur)).toBe(fiatRangeText(from, to, cur));
      expect(bandRange({ unit: 'fiat', from, to, pricing: { mode: 'market', marginBps: 0 }, minTrades: 0 }, cur)).toBe(fiatRangeText(from, to, cur));
    }
  });

  it("an XMR band's range is the card's XMR row: 6 places, the minimum rounded up and the maximum down", () => {
    const band: Band = { unit: 'xmr', from: 300_000_000_000n, to: 9_000_000_000_000n, pricing: { mode: 'market', marginBps: 0 }, minTrades: 0 };
    expect(bandRange(band, 'USD')).toBe('0.300000 – 9.000000');
    const odd: Band = { ...band, from: 1_234_567_890n, to: 2_999_999_999_999n };
    expect(bandRange(odd, 'USD')).toBe(xmrRangeText(odd.from, odd.to));
    expect(bandRange(odd, 'USD')).toBe('0.001235 – 2.999999');
  });

  it("the quote passes the price route's exponent: whole yen, 3-place dinars", () => {
    expect(rangeText(5_000n, 150_000n, 'JPY', 0)).toBe('¥5,000 – ¥150,000');
    expect(rangeText(50_000n, 150_001n, 'KWD', 3).replace(/\u00a0/g, ' ')).toBe('KWD 50 – KWD 150.001');
    expect(money(33_000n, 'JPY', 0)).toBe('¥33,000');
    expect(money(330_005n, 'KWD', 3).replace(/\u00a0/g, ' ')).toBe('KWD 330.005');
  });

  // TODO(design): the card says "+0.4%" over "Vendor markup" (batch 2, markupOf), marginText says
  // "0.4% above market", and the quote's bands card "+0.40% markup" (markupText, the BuyQuote
  // board's 2 places). Design has not picked one wording (asked 9 Nov), so until then the screens
  // must agree on the number and its direction, not the words.
  it('the card, marginText and the quote say the same markup: the same number, the same direction', () => {
    const num = (t: string) => Number(/[\d.,]+/.exec(t)![0].replace(/,/g, ''));
    const dir = (t: string) => (/^\+|above/.test(t) ? 1 : /^\u2212|^-|below/.test(t) ? -1 : 0);
    const cases: [Parameters<typeof marginText>[0], bigint | null][] = [
      [{ mode: 'market', marginBps: 40 }, 33_000n],
      [{ mode: 'market', marginBps: 20 }, null],
      [{ mode: 'market', marginBps: -125 }, 33_000n],
      [{ mode: 'market', marginBps: 3 }, 33_000n],
      [{ mode: 'market', marginBps: 250 }, 33_000n],
    ];
    for (const [pricing, market] of cases) {
      const card = markupOf({ rate: 1n, pricing }, { favourable: buyerLikes })!;
      const words = marginText(pricing, 'USD', market, buyerLikes);
      const quote = markupText(pricing, market)!;
      const at = JSON.stringify(pricing);
      expect([at, num(card.mark!)]).toEqual([at, num(words.text)]);
      expect([at, num(card.mark!)]).toEqual([at, num(quote)]);
      expect([at, dir(card.mark!)]).toEqual([at, dir(words.text)]);
      expect([at, dir(card.mark!)]).toEqual([at, dir(quote)]);
      expect([at, card.favourable]).toEqual([at, words.favourable]);
    }
  });

  it("marginText's words (kept for the quote until design picks, see the TODO above)", () => {
    expect(marginText({ mode: 'market', marginBps: 20 }, 'CAD', null, buyerLikes)).toEqual({ text: '0.2% above market', favourable: false });
    expect(marginText({ mode: 'market', marginBps: -125 }, 'USD', null, buyerLikes)).toEqual({ text: '1.25% below market', favourable: true });
    expect(marginText({ mode: 'market', marginBps: 0 }, 'USD', null, buyerLikes)).toEqual({ text: 'At market', favourable: false });
  });
});

const MARKET = 33_000n;
const usd = (rate: bigint) => ({ currency: 'USD', centsPerXmr: rate });

describe('bandRate and bandXmr: each band in XMR, with or without the markup (owner 2026-11-08)', () => {
  const up: Band = { unit: 'fiat', from: 5_000n, to: 150_000n, pricing: { mode: 'market', marginBps: 250 }, minTrades: 0 };

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

  it('no market price: a band has no rate either way (every band is market ± %, owner Q1)', () => {
    expect(bandRate(up, 'USD', null, true)).toBeNull();
    expect(bandRate(up, 'USD', null, false)).toBeNull();
  });
});

describe('an XMR band (an offer set in XMR): its XMR range, and the fiat "≈" at the live rate (lead 9 Nov)', () => {
  const xmrBand: Band = { unit: 'xmr', from: 500_000_000_000n, to: 5_000_000_000_000n, pricing: { mode: 'market', marginBps: 250 }, minTrades: 0 };

  it('converts both edges to the currency at the band rate (with markup) or the market rate (without), half up', () => {
    const withRate = bandRate(xmrBand, 'USD', MARKET, true)!;
    expect(withRate.centsPerXmr).toBe(33_825n);
    // 0.5 XMR at $338.25 is $169.125, half up $169.13; 5 XMR is $1,691.25.
    expect(bandFiat(xmrBand, withRate, 'USD')).toBe('$169.13 – $1,691.25');
    expect(bandOther(xmrBand, withRate, 'USD')).toEqual({ text: '≈ $169.13 – $1,691.25', unit: 'USD' });
    const without = bandRate(xmrBand, 'USD', MARKET, false)!;
    expect(bandOther(xmrBand, without, 'USD')).toEqual({ text: '≈ $165 – $1,650', unit: 'USD' });
    // Whole yen at the quote's exponent.
    expect(bandFiat(xmrBand, { currency: 'JPY', centsPerXmr: 33_000n }, 'JPY', 0)).toBe('¥16,500 – ¥165,000');
  });

  it('a fiat band converts the other way, to XMR', () => {
    const rate = bandRate(THREE[0]!, 'USD', MARKET, true)!;
    expect(bandOther(THREE[0]!, rate, 'USD')).toEqual({ text: `≈ ${bandXmr(THREE[0]!, rate)}`, unit: 'XMR' });
    expect(() => bandXmr(xmrBand, rate)).toThrow(RangeError);
    expect(() => bandFiat(THREE[0]!, rate, 'USD')).toThrow(RangeError);
  });

  it('places an XMR amount by its atomic units, edges included', () => {
    const one = [xmrBand];
    expect(bandAt(one, 499_999_999_999n)).toEqual({ kind: 'below' });
    expect(bandAt(one, 500_000_000_000n)).toEqual({ kind: 'in', index: 0 });
    expect(bandAt(one, 5_000_000_000_000n)).toEqual({ kind: 'in', index: 0 });
    expect(bandAt(one, 5_000_000_000_001n)).toEqual({ kind: 'above' });
  });

  it("clip lines name an XMR band's edge in XMR, exact", () => {
    const two: Band[] = [xmrBand, { ...xmrBand, from: 5_000_000_000_001n, to: 9_000_000_000_000n, pricing: { mode: 'market', marginBps: 0 } }];
    expect(clipLines(two, { kind: 'in', index: 0 }, 'USD', MARKET)).toEqual([{ dir: 'up', at: '5.000000 XMR', rate: '$330.00' }]);
    expect(clipLines(two, { kind: 'in', index: 1 }, 'USD', MARKET)).toEqual([{ dir: 'down', at: '5.000000000001 XMR', rate: '$338.25' }]);
  });
});

describe('markupText: the markup as the board writes it', () => {
  it("a market band's margin, exact, 2 places", () => {
    expect(markupText({ mode: 'market', marginBps: 250 }, null)).toBe('+2.50%');
    expect(markupText({ mode: 'market', marginBps: 3 }, null)).toBe('+0.03%');
    expect(markupText({ mode: 'market', marginBps: -20 }, null)).toBe('−0.20%');
    expect(markupText({ mode: 'market', marginBps: 0 }, MARKET)).toBe('0.00%');
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
    const one = offerBands({ ...FIAT_SET, minFiatCents: 5_000n, maxFiatCents: 150_000n, pricing: { mode: 'market', marginBps: 0 }, minTrades: 0 });
    expect(clipLines(one, { kind: 'in', index: 0 }, 'USD', MARKET)).toEqual([]);
    expect(clipLines(THREE, null, 'USD', MARKET)).toEqual([]);
    expect(clipLines(THREE, { kind: 'below' }, 'USD', MARKET)).toEqual([]);
    expect(clipLines(THREE, { kind: 'above' }, 'USD', MARKET)).toEqual([]);
  });

  it('a 0-decimal currency: the edge and the rate in whole yen', () => {
    // Market ¥33,000; the next band is +1%, so its rate is ¥33,330 (was two fixed bands before owner Q1).
    const yen: Band[] = [
      { unit: 'fiat', from: 5_000n, to: 50_000n, pricing: { mode: 'market', marginBps: 0 }, minTrades: 0 },
      { unit: 'fiat', from: 50_001n, to: 150_000n, pricing: { mode: 'market', marginBps: 100 }, minTrades: 0 },
    ];
    expect(clipLines(yen, { kind: 'in', index: 0 }, 'JPY', 33_000n, 0)).toEqual([{ dir: 'up', at: '¥50,000', rate: '¥33,330' }]);
  });

  it('no market price: no rate to name, no line', () => {
    expect(clipLines(THREE, { kind: 'in', index: 1 }, 'USD', null)).toEqual([]);
  });
});

