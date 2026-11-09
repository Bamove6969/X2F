// Offer amounts in XMR or fiat (owner, 8 Nov 2026): conversion both ways, with and without the
// vendor's markup, the take's size check and the limits a trade records, rounding at the edges.
import { describe, expect, it } from 'vitest';
import {
  ATOMIC_PER_XMR,
  displayRate,
  fiatCents,
  rangeAllows,
  rangeInBoth,
  tradeFiatLimits,
  type OfferRange,
  type Price,
  type Pricing,
} from '../src/index.js';

const XMR = ATOMIC_PER_XMR;
const usd = (centsPerXmr: bigint): Price => ({ currency: 'USD', centsPerXmr });
const MARKET = usd(33_000n); // $330.00 / XMR
const PLUS_2_5: Pricing = { mode: 'market', marginBps: 250 };
// 33000 × 1.025 = 33825: what a taker trades at.
const WITH = usd(33_825n);

describe('displayRate: the rate amounts are shown at', () => {
  it('with the markup: the offer rate (market moved by the margin, as the take locks it)', () => {
    expect(displayRate(PLUS_2_5, 'USD', MARKET, true)).toEqual(WITH);
    expect(displayRate({ mode: 'market', marginBps: -100 }, 'USD', MARKET, true)).toEqual(usd(32_670n));
  });

  it('without the markup: the market price, for a fixed-price offer too', () => {
    expect(displayRate(PLUS_2_5, 'USD', MARKET, false)).toEqual(MARKET);
    const fixed: Pricing = { mode: 'fixed', centsPerXmr: 35_000n };
    expect(displayRate(fixed, 'USD', MARKET, true)).toEqual(usd(35_000n));
    expect(displayRate(fixed, 'USD', MARKET, false)).toEqual(MARKET);
  });

  it('null with no market price, except a fixed price with the markup; a market in another currency is none', () => {
    expect(displayRate(PLUS_2_5, 'USD', null, true)).toBeNull();
    expect(displayRate(PLUS_2_5, 'USD', null, false)).toBeNull();
    expect(displayRate({ mode: 'fixed', centsPerXmr: 35_000n }, 'USD', null, true)).toEqual(usd(35_000n));
    expect(displayRate({ mode: 'fixed', centsPerXmr: 35_000n }, 'USD', null, false)).toBeNull();
    expect(displayRate(PLUS_2_5, 'USD', { currency: 'EUR', centsPerXmr: 30_000n }, false)).toBeNull();
  });
});

describe('rangeInBoth', () => {
  it('an XMR range keeps its XMR and converts to fiat half up, with and without the markup', () => {
    const r: OfferRange = { unit: 'xmr', min: 1n * XMR, max: 5n * XMR };
    expect(rangeInBoth(r, MARKET)).toEqual({ minAtomic: XMR, maxAtomic: 5n * XMR, minFiat: 33_000n, maxFiat: 165_000n });
    expect(rangeInBoth(r, WITH)).toEqual({ minAtomic: XMR, maxAtomic: 5n * XMR, minFiat: 33_825n, maxFiat: 169_125n });
  });

  it('a fiat range keeps its fiat and converts to XMR floored, with and without the markup', () => {
    // $500 - $3,000: at $330 → 1.515151515151 - 9.090909090909 XMR; at $338.25 fewer XMR.
    const r: OfferRange = { unit: 'fiat', min: 50_000n, max: 300_000n };
    expect(rangeInBoth(r, MARKET)).toEqual({ minAtomic: 1_515_151_515_151n, maxAtomic: 9_090_909_090_909n, minFiat: 50_000n, maxFiat: 300_000n });
    expect(rangeInBoth(r, WITH)).toEqual({ minAtomic: 1_478_196_600_147n, maxAtomic: 8_869_179_600_886n, minFiat: 50_000n, maxFiat: 300_000n });
  });

  it('rounds at the edges: half a cent rounds up, just under rounds down; fiat → XMR never rounds up', () => {
    const at200 = usd(20_000n); // $200 / XMR: 0.5 cent = 25,000,000 atomic
    expect(rangeInBoth({ unit: 'xmr', min: 25_000_000n, max: 25_000_000n }, at200).minFiat).toBe(1n);
    expect(rangeInBoth({ unit: 'xmr', min: 24_999_999n, max: 24_999_999n }, at200).minFiat).toBe(0n);
    // 1 cent at $300 is 33,333,333.33… atomic: floored.
    expect(rangeInBoth({ unit: 'fiat', min: 1n, max: 1n }, usd(30_000n)).minAtomic).toBe(33_333_333n);
    // Exact at a whole number of atomic units.
    expect(rangeInBoth({ unit: 'fiat', min: 1n, max: 1n }, usd(25_000n)).minAtomic).toBe(40_000_000n);
  });

  it('is exact far above Number.MAX_SAFE_INTEGER', () => {
    const big = 10n ** 20n; // 100,000,000 XMR
    expect(rangeInBoth({ unit: 'xmr', min: big, max: big }, usd(123_456_789n)).minFiat).toBe(12_345_678_900_000_000n);
  });

  it('refuses a range that is empty, upside down or in an unknown unit', () => {
    expect(() => rangeInBoth({ unit: 'xmr', min: 0n, max: 1n }, MARKET)).toThrow(RangeError);
    expect(() => rangeInBoth({ unit: 'fiat', min: 5n, max: 4n }, MARKET)).toThrow(RangeError);
    expect(() => rangeInBoth({ unit: 'btc' as 'xmr', min: 1n, max: 1n }, MARKET)).toThrow(RangeError);
  });
});

describe('rangeAllows: the take size check at the rate that locks', () => {
  it('an XMR range compares the XMR amount itself, to the atomic unit', () => {
    const r: OfferRange = { unit: 'xmr', min: 1n * XMR, max: 5n * XMR };
    expect(rangeAllows(r, XMR, WITH)).toBe('ok');
    expect(rangeAllows(r, XMR - 1n, WITH)).toBe('too-low');
    expect(rangeAllows(r, 5n * XMR, WITH)).toBe('ok');
    expect(rangeAllows(r, 5n * XMR + 1n, WITH)).toBe('too-high');
    // The price does not move an XMR range.
    expect(rangeAllows(r, 5n * XMR, usd(1_000_000n))).toBe('ok');
  });

  it('a fiat range compares the fiat total at the locked rate (the markup included)', () => {
    const r: OfferRange = { unit: 'fiat', min: 50_000n, max: 300_000n };
    // The floored XMR for $500 at the offer rate totals exactly $500 again.
    const minXmr = rangeInBoth(r, WITH).minAtomic;
    expect(fiatCents(minXmr, WITH)).toBe(50_000n);
    expect(rangeAllows(r, minXmr, WITH)).toBe('ok');
    // 1 XMR is $338.25 with the markup: too low for $500; 9 XMR ($3,044.25) too high.
    expect(rangeAllows(r, XMR, WITH)).toBe('too-low');
    expect(rangeAllows(r, 9n * XMR, WITH)).toBe('too-high');
    // At the market price without the markup 9 XMR would be $2,970 and fit: the check uses the rate it is given.
    expect(rangeAllows(r, 9n * XMR, MARKET)).toBe('ok');
  });

  it('a total that rounds to nothing is too low in either unit', () => {
    expect(rangeAllows({ unit: 'xmr', min: 1n, max: 100n }, 5n, WITH)).toBe('too-low');
    expect(rangeAllows({ unit: 'xmr', min: 1n, max: 100n }, 0n, WITH)).toBe('too-low');
  });
});

describe('tradeFiatLimits: what the trade records at the take', () => {
  it('a fiat range is its own', () => {
    expect(tradeFiatLimits({ unit: 'fiat', min: 50_000n, max: 300_000n }, WITH)).toEqual({ minFiatCents: 50_000n, maxFiatCents: 300_000n });
  });

  it('an XMR range is converted at the locked rate; every allowed amount has its total inside', () => {
    const r: OfferRange = { unit: 'xmr', min: 1n * XMR, max: 5n * XMR };
    const lim = tradeFiatLimits(r, WITH);
    expect(lim).toEqual({ minFiatCents: 33_825n, maxFiatCents: 169_125n });
    for (const a of [XMR, XMR + 1n, 3n * XMR, 5n * XMR - 1n, 5n * XMR]) {
      expect(rangeAllows(r, a, WITH)).toBe('ok');
      const t = fiatCents(a, WITH);
      expect(t >= lim.minFiatCents && t <= lim.maxFiatCents).toBe(true);
    }
  });

  it('a tiny XMR range still has a minimum of one minor unit and a maximum not below it', () => {
    expect(tradeFiatLimits({ unit: 'xmr', min: 1n, max: 2n }, WITH)).toEqual({ minFiatCents: 1n, maxFiatCents: 1n });
  });
});
