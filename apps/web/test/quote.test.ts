// Task 18: the quote maths as the screens use it. Every money figure comes from @x2f/trade (Task 1);
// these tests pin what the quote shows against those functions, so the UI never grows its own maths.
import { describe, expect, it } from 'vitest';
import { atomicForFiat, escrowPlan, fiatCents, formatXmr, offerRate, rangeAllows, rateFor } from '@x2f/trade';
import { boardSellOffers } from '../src/fixtures/boards.js';
import { parseOffers } from '../src/screens/browse/api.js';
import { quoteOffer } from '../src/screens/quote/api.js';
import { amountText, currencyExponent, dealMaxFiat, fiatWhole, formatMinor, maxText, parseAmount, quote, quoteExponent, rangeText, xmrText, type QuoteOffer } from '../src/screens/quote/quoteModel.js';
import { takeRefusal } from '../src/screens/quote/takeErrors.js';
import { ApiCallError } from '../src/api/client.js';

const MARKET_USD = { centsPerXmr: 33_000n, usdCentsPerXmr: 33_000n, exponent: 2 };

/** satoshi_ghost's sell ad on the BuyQuote board: Zelle, USD, $330.00 / XMR, $50 to $1,500. */
const SELL_AD: QuoteOffer = {
  id: 'offer-ghost',
  side: 'sell',
  currency: 'USD',
  poster: { displayName: 'satoshi_ghost', stage: 'graduated' },
  pricing: { mode: 'market', marginBps: 0 },
  amountUnit: 'fiat',
  minAtomic: null,
  maxAtomic: null,
  minFiatCents: 5_000n,
  maxFiatCents: 150_000n,
  minTrades: 0,
  methodId: 'ZELLE',
  adjustBps: 0,
  // An answer from before J-16: no bands, priced from `pricing` and the range.
  tiers: [],
  viewerTrades: null,
};

const BUY_AD: QuoteOffer = { ...SELL_AD, id: 'offer-mira', side: 'buy', poster: { displayName: 'mira.k', stage: 'graduated' } };

describe('parseAmount', () => {
  it('reads fiat to cents and XMR to atomic units', () => {
    expect(parseAmount('412.50', 'fiat')).toBe(41_250n);
    expect(parseAmount('1,500', 'fiat')).toBe(150_000n);
    expect(parseAmount('.5', 'fiat')).toBe(50n);
    expect(parseAmount('1.25', 'xmr')).toBe(1_250_000_000_000n);
    expect(parseAmount('0.000000000001', 'xmr')).toBe(1n);
  });

  it('refuses what is not a plain amount', () => {
    for (const bad of ['', ' ', 'abc', '1.234', '1e3', '-5', '1.2.3', '$5', '0x10']) expect(parseAmount(bad, 'fiat')).toBeNull();
    expect(parseAmount('1.0000000000001', 'xmr')).toBeNull();
  });

  it("honours the currency's exponent (Revision 2026-10-20): yen have no minor unit, dinars have three", () => {
    expect(parseAmount('41250', 'fiat', 0)).toBe(41_250n);
    expect(parseAmount('412.5', 'fiat', 0)).toBeNull();
    expect(parseAmount('1.234', 'fiat', 3)).toBe(1_234n);
    expect(parseAmount('1.2345', 'fiat', 3)).toBeNull();
    // The exponent never touches XMR.
    expect(parseAmount('1.25', 'xmr', 0)).toBe(1_250_000_000_000n);
  });
});

describe('exponent-aware fiat text', () => {
  it('formatMinor writes minor units with the exponent, exactly, and fiatWhole drops a zero fraction', () => {
    expect(formatMinor(41_250n, 'USD', 2)).toBe('$412.50');
    expect(formatMinor(41_250n, 'JPY', 0)).toBe('¥41,250');
    // Intl writes a no-break space after a code it has no sign for.
    expect(formatMinor(1_234n, 'KWD', 3)).toBe('KWD\u00a01.234');
    expect(formatMinor(5n, 'KWD', 3)).toBe('KWD\u00a00.005');
    expect(fiatWhole(5_000n, 'JPY', 0)).toBe('¥5,000');
    expect(fiatWhole(150_000n, 'USD', 2)).toBe('$1,500');
    expect(fiatWhole(1_500n, 'KWD', 3)).toBe('KWD\u00a01.500');
  });

  it('amountText fills the box with the exponent the quote uses', () => {
    const rate = { currency: 'JPY', centsPerXmr: 33_000n };
    expect(amountText(150_000n, 'fiat', rate, 0)).toBe('150000');
    expect(amountText(1_500n, 'fiat', { currency: 'KWD', centsPerXmr: 100_000n }, 3)).toBe('1.500');
    expect(amountText(150_000n, 'fiat', { currency: 'USD', centsPerXmr: 33_000n }, 2)).toBe('1500.00');
  });

  it("the exponent comes from /v1/price when the feed is up, else from the currency itself (the offer's own range with the feed down)", () => {
    const jpy = { ...SELL_AD, currency: 'JPY' };
    expect(quoteExponent(jpy, { centsPerXmr: 33_000n, usdCentsPerXmr: 33_000n, exponent: 0 })).toBe(0);
    expect(quoteExponent(jpy, null)).toBe(0);
    expect(currencyExponent('JPY')).toBe(0);
    expect(currencyExponent('KWD')).toBe(3);
    expect(currencyExponent('USD')).toBe(2);
    expect(currencyExponent('XXX')).toBe(2);
  });

  it('a JPY market offer quotes whole yen: typing 41250 at ¥33,000 / XMR is 1.25 XMR, never ¥4,125,000', () => {
    const jpy = { ...SELL_AD, currency: 'JPY', minFiatCents: 5_000n, maxFiatCents: 150_000n };
    const market = { centsPerXmr: 33_000n, usdCentsPerXmr: 33_000n, exponent: 0 };
    const q = quote({ offer: jpy, market, text: '41250', unit: 'fiat' });
    if (q.kind !== 'ok') throw new Error('expected a quote');
    expect(q.amountAtomic).toBe(1_250_000_000_000n);
    expect(q.fiatCents).toBe(41_250n);
    // Yen have no fraction: a decimal is not an amount here.
    expect(quote({ offer: jpy, market, text: '412.50', unit: 'fiat' }).kind).toBe('enter');
  });
});

describe('quote', () => {
  it('BuyQuote board: $412.50 at $330.00 is 1.250000 XMR, and the fiat total is what the trade stores', () => {
    const q = quote({ offer: SELL_AD, market: MARKET_USD, text: '412.50', unit: 'fiat' });
    expect(q.kind).toBe('ok');
    if (q.kind !== 'ok') return;
    const rate = offerRate(SELL_AD.pricing, 'USD', { currency: 'USD', centsPerXmr: 33_000n })!;
    expect(q.rate).toEqual(rate);
    expect(q.amountAtomic).toBe(atomicForFiat(41_250n, rate));
    expect(formatXmr(q.amountAtomic)).toBe('1.250000');
    // OD-5: the total shown is fiatCents(amount, rate), the same figure Task 5 locks at take.
    expect(q.fiatCents).toBe(fiatCents(q.amountAtomic, rate));
    expect(q.fiatCents).toBe(41_250n);
  });

  it('the shown total always equals fiatCents of the amount sent to take, across many inputs', () => {
    const markets = [32_990n, 33_000n, 33_123n, 1_234_567n];
    for (const centsPerXmr of markets) {
      for (const text of ['50', '50.01', '99.99', '412.50', '777.77', '1499.99', '1500']) {
        const q = quote({ offer: SELL_AD, market: { centsPerXmr, usdCentsPerXmr: centsPerXmr, exponent: 2 }, text, unit: 'fiat' });
        if (q.kind !== 'ok') continue;
        expect(q.fiatCents).toBe(fiatCents(q.amountAtomic, q.rate));
        expect(q.fiatCents).toBe(parseAmount(text, 'fiat'));
      }
    }
  });

  it('the taker never pays a fee: the buyer receives the whole amount; the seller locks only the amount', () => {
    const buy = quote({ offer: SELL_AD, market: MARKET_USD, text: '412.50', unit: 'fiat' });
    const sell = quote({ offer: BUY_AD, market: MARKET_USD, text: '1.25', unit: 'xmr' });
    if (buy.kind !== 'ok' || sell.kind !== 'ok') throw new Error('expected quotes');
    expect(buy.receiveAtomic).toBe(buy.amountAtomic);
    // On a buy ad the poster (the buyer) pays the 1% out of their payout; the taking seller funds the amount.
    expect(sell.amountAtomic).toBe(1_250_000_000_000n);
    expect(sell.sellerFundsAtomic).toBe(escrowPlan({ amountAtomic: sell.amountAtomic, poster: 'buyer' }).sellerFundsAtomic);
    expect(sell.sellerFundsAtomic).toBe(sell.amountAtomic);
  });

  it('with the feed down no offer quotes, at any margin: there is no fixed price (owner Q1)', () => {
    for (const marginBps of [-5000, 0, 5000]) {
      expect(quote({ offer: { ...SELL_AD, pricing: { mode: 'market', marginBps } }, market: null, text: '340', unit: 'fiat' }).kind, String(marginBps)).toBe('price-unavailable');
    }
    expect(quote({ offer: SELL_AD, market: null, text: '340', unit: 'fiat' }).kind).toBe('price-unavailable');
    // A fixed pricing is never priced from its own number, with or without the feed.
    const fixed = { ...SELL_AD, pricing: { mode: 'fixed', centsPerXmr: 34_000n } as unknown as QuoteOffer['pricing'] };
    expect(() => quote({ offer: fixed, market: null, text: '340', unit: 'fiat' })).toThrow(RangeError);
    expect(() => quote({ offer: fixed, market: MARKET_USD, text: '340', unit: 'fiat' })).toThrow(RangeError);
  });

  it('checks the offer range on the fiat total, for either unit', () => {
    expect(quote({ offer: SELL_AD, market: MARKET_USD, text: '49.99', unit: 'fiat' }).kind).toBe('too-low');
    expect(quote({ offer: SELL_AD, market: MARKET_USD, text: '1500.01', unit: 'fiat' }).kind).toBe('too-high');
    expect(quote({ offer: SELL_AD, market: MARKET_USD, text: '1500', unit: 'fiat' }).kind).toBe('ok');
    expect(quote({ offer: SELL_AD, market: MARKET_USD, text: '5', unit: 'xmr' }).kind).toBe('too-high');
    expect(quote({ offer: SELL_AD, market: MARKET_USD, text: '0.1', unit: 'xmr' }).kind).toBe('too-low');
    expect(quote({ offer: SELL_AD, market: MARKET_USD, text: '', unit: 'fiat' }).kind).toBe('enter');
    expect(quote({ offer: SELL_AD, market: MARKET_USD, text: 'x', unit: 'fiat' }).kind).toBe('enter');
  });

  it('an offer the API marks opensAt is not takeable whatever the amount (starter limits, spec 2.3)', () => {
    const q = quote({ offer: { ...SELL_AD, opensAt: 'building' }, market: MARKET_USD, text: '412.50', unit: 'fiat' });
    expect(q).toEqual({ kind: 'opens-at', stage: 'building' });
  });

  it('shows the US-dollar value beside a non-USD trade (spec 11.6), from the feed', () => {
    const eur = { ...SELL_AD, currency: 'EUR' };
    const q = quote({ offer: eur, market: { centsPerXmr: 30_000n, usdCentsPerXmr: 33_000n, exponent: 2 }, text: '300', unit: 'fiat' });
    if (q.kind !== 'ok') throw new Error('expected a quote');
    expect(q.rate).toEqual({ currency: 'EUR', centsPerXmr: 30_000n });
    expect(q.usdCents).toBe(fiatCents(q.amountAtomic, { currency: 'USD', centsPerXmr: 33_000n }));
    expect(q.usdCents).toBe(33_000n);
    // A USD trade needs no second figure.
    const usd = quote({ offer: SELL_AD, market: MARKET_USD, text: '300', unit: 'fiat' });
    expect(usd.kind === 'ok' && usd.usdCents).toBeNull();
  });

  it("the US-dollar figures are the trade's own figures at the exchange rate: the offer's margin applies to them too", () => {
    // A EUR market offer at +5%: €300.00 / XMR market, €315.00 / XMR offered; $330.00 / XMR market.
    const margin = quote({ offer: { ...SELL_AD, currency: 'EUR', pricing: { mode: 'market', marginBps: 500 } }, market: { centsPerXmr: 30_000n, usdCentsPerXmr: 33_000n, exponent: 2 }, text: '315', unit: 'fiat' });
    if (margin.kind !== 'ok') throw new Error('expected a quote');
    expect(margin.rate.centsPerXmr).toBe(31_500n);
    expect(margin.amountAtomic).toBe(1_000_000_000_000n);
    // 1 XMR at the offer's €315.00 is $346.50 / XMR in dollars, and the €315.00 total is about $346.50.
    expect(margin.usdPerXmrCents).toBe(34_650n);
    expect(margin.usdCents).toBe(34_650n);
    // 50% below, the furthest an offer goes (owner F1): €150.00 / XMR is $165.00 / XMR in dollars.
    const half = quote({ offer: { ...SELL_AD, currency: 'EUR', pricing: { mode: 'market', marginBps: -5000 } }, market: { centsPerXmr: 30_000n, usdCentsPerXmr: 33_000n, exponent: 2 }, text: '150', unit: 'fiat' });
    if (half.kind !== 'ok') throw new Error('expected a quote');
    expect(half.rate.centsPerXmr).toBe(15_000n);
    expect(half.usdPerXmrCents).toBe(16_500n);
    expect(half.usdCents).toBe(16_500n);
    // Half up, as every other figure: €1.00 at €300.00 and $330.00 is $1.10; €0.01 at €3.00 / $1.00 is $0.00 (0.33 cents).
    const tiny = quote({ offer: { ...SELL_AD, currency: 'EUR', minFiatCents: 1n }, market: { centsPerXmr: 30_000n, usdCentsPerXmr: 33_000n, exponent: 2 }, text: '1', unit: 'fiat' });
    expect(tiny.kind === 'ok' && tiny.usdCents).toBe(110n);
  });
});

describe('xmrText', () => {
  it('shows exactly what is sent: the board\'s 6 places, and more only when the amount has them, trailing zeros trimmed', () => {
    expect(xmrText(1_250_000_000_000n)).toBe('1.250000');
    expect(xmrText(1_000_000_900_000n)).toBe('1.0000009');
    expect(xmrText(1_000_000_000_001n)).toBe('1.000000000001');
    expect(xmrText(4_545_454_545_454n)).toBe('4.545454545454');
    expect(xmrText(0n)).toBe('0.000000');
    expect(xmrText(1_000_000_100_000n)).toBe('1.0000001');
    // Never rounds: formatXmr(…, 6) would hide the 9 below.
    expect(xmrText(999_999_900_000n)).toBe('0.9999999');
  });
});

describe('an offer set in XMR (review M1): the quote checks what the take checks, the XMR range at the rate now', () => {
  const XMR = 1_000_000_000_000n;
  // 0.1 - 0.5 XMR at CA$15,000.33: the card shows ≈ CA$1,500.03 - CA$7,500.17.
  const CAD = { centsPerXmr: 1_500_033n, usdCentsPerXmr: 1_100_000n, exponent: 2 };
  const rate = { currency: 'CAD', centsPerXmr: CAD.centsPerXmr };
  const XMR_AD: QuoteOffer = { ...SELL_AD, currency: 'CAD', amountUnit: 'xmr', minAtomic: XMR / 10n, maxAtomic: XMR / 2n, minFiatCents: null, maxFiatCents: null };
  const q = (text: string, unit: 'fiat' | 'xmr') => quote({ offer: XMR_AD, market: CAD, text, unit });

  it('typed in XMR: the bounds themselves pass, one atomic unit past either is refused', () => {
    expect(q('0.1', 'xmr').kind).toBe('ok');
    expect(q('0.5', 'xmr').kind).toBe('ok');
    expect(q('0.099999999999', 'xmr').kind).toBe('too-low');
    expect(q('0.500000000001', 'xmr').kind).toBe('too-high');
  });

  it('typed in fiat: the card\'s shown edges quote the exact XMR bounds; a cent beyond is refused', () => {
    const lo = q('1500.03', 'fiat');
    expect(lo.kind).toBe('ok');
    if (lo.kind === 'ok') expect(lo.amountAtomic).toBe(XMR / 10n);
    const hi = q('7500.17', 'fiat');
    expect(hi.kind).toBe('ok');
    if (hi.kind === 'ok') expect(hi.amountAtomic).toBe(XMR / 2n);
    expect(q('1500.02', 'fiat').kind).toBe('too-low');
    expect(q('7500.18', 'fiat').kind).toBe('too-high');
    // Inside the range nothing is moved.
    const mid = q('3000', 'fiat');
    if (mid.kind === 'ok') expect(mid.amountAtomic).toBe(atomicForFiat(300_000n, rate));
  });

  it('every amount the quote passes, the take would pass (rangeAllows at the same rate)', () => {
    for (const t of ['1500.03', '1500.04', '2222.22', '7500.16', '7500.17']) {
      const r = q(t, 'fiat');
      expect(r.kind, t).toBe('ok');
      if (r.kind === 'ok') expect(rangeAllows({ unit: 'xmr', min: XMR / 10n, max: XMR / 2n }, r.amountAtomic, rate), t).toBe('ok');
    }
  });

  it('shows the range in the unit the poster set; Max fills the exact maximum in either unit', () => {
    expect(rangeText(XMR_AD, 2)).toEqual({ min: '0.100000 XMR', max: '0.500000 XMR' });
    expect(rangeText(SELL_AD, 2)).toEqual({ min: '$50', max: '$1,500' });
    for (const unit of ['xmr', 'fiat'] as const) {
      const r = q(maxText(XMR_AD, unit, rate, 2), unit);
      expect(r.kind, unit).toBe('ok');
      if (r.kind === 'ok') expect(r.amountAtomic, unit).toBe(XMR / 2n);
    }
    expect(maxText(SELL_AD, 'fiat', { currency: 'USD', centsPerXmr: 33_000n }, 2)).toBe('1500.00');
  });

  it('the trade room is handed the limit the take records: the XMR maximum at the rate', () => {
    expect(dealMaxFiat(XMR_AD, rate)).toBe(750_017n);
    expect(dealMaxFiat(SELL_AD, rate)).toBe(150_000n);
  });

  it('with the feed down, a market offer set in XMR is price-unavailable (review L2), not gone', () => {
    expect(quote({ offer: XMR_AD, market: null, text: '0.2', unit: 'xmr' }).kind).toBe('price-unavailable');
    const parsed = parseOffers([{ ...boardSellOffers(new Date('2026-10-24T12:00:00Z'))[0]!, rate: null, amountUnit: 'xmr', minAtomic: '100000000000', maxAtomic: '500000000000', minFiatCents: null, maxFiatCents: null }])[0]!;
    expect(quoteOffer(parsed, 'sell', 'USD', 'ZELLE')).toMatchObject({ amountUnit: 'xmr', minAtomic: XMR / 10n, maxAtomic: XMR / 2n, minFiatCents: null, maxFiatCents: null });
  });
});

describe('J-16: a flexible offer is quoted from the band the take will use', () => {
  const MARKET = { centsPerXmr: 33_000n, usdCentsPerXmr: 33_000n, exponent: 2 };
  const at = (bps: number) => rateFor({ currency: 'USD', centsPerXmr: 33_000n }, bps);
  // 200-500 at +1% and 501-800 at market, as the API covers them (200.00-500.99, 501.00-800.00); PayPal +2%.
  const BANDED: QuoteOffer = {
    ...SELL_AD,
    minFiatCents: 20_000n,
    maxFiatCents: 80_000n,
    methodId: 'PAYPAL',
    adjustBps: 200,
    tiers: [
      { min: 20_000n, max: 50_099n, marginBps: 100, minTrades: null },
      { min: 50_100n, max: 80_000n, marginBps: 0, minTrades: null },
    ],
  };

  it('each amount at its own band\'s price (band margin + method change); the band is the range the trade records', () => {
    const low = quote({ offer: BANDED, market: MARKET, text: '300', unit: 'fiat' });
    expect(low.kind).toBe('ok');
    if (low.kind !== 'ok') return;
    expect(low.rate).toEqual(at(300));
    expect(low.range).toEqual({ unit: 'fiat', min: 20_000n, max: 50_099n });
    expect(dealMaxFiat(BANDED, low.rate, low.range)).toBe(50_099n);
    const high = quote({ offer: BANDED, market: MARKET, text: '600', unit: 'fiat' });
    expect(high.kind === 'ok' && [high.rate, high.range.max]).toEqual([at(200), 80_000n]);
    expect(quote({ offer: BANDED, market: MARKET, text: '150', unit: 'fiat' }).kind).toBe('too-low');
    expect(quote({ offer: BANDED, market: MARKET, text: '900', unit: 'fiat' }).kind).toBe('too-high');
  });

  it('bands on the same amounts: the best for the taker among those whose rule they meet (as the take)', () => {
    const SAME: QuoteOffer = {
      ...BANDED,
      adjustBps: 0,
      tiers: [
        { min: 20_000n, max: 80_000n, marginBps: 100, minTrades: null },
        { min: 20_000n, max: 80_000n, marginBps: -100, minTrades: 10 },
      ],
    };
    const rateWith = (viewerTrades: number | null, side: 'sell' | 'buy' = 'sell') => {
      const q = quote({ offer: { ...SAME, side, viewerTrades }, market: MARKET, text: '300', unit: 'fiat' });
      return q.kind === 'ok' ? q.rate : null;
    };
    expect(rateWith(12)).toEqual(at(-100));
    expect(rateWith(3)).toEqual(at(100));
    expect(rateWith(null)).toEqual(at(100));
    // A buy ad's best for the taker (who sells) is the higher price.
    expect(rateWith(12, 'buy')).toEqual(at(100));
  });

  it('the card keeps only the bands offered with the method it was opened under, and that method\'s change', () => {
    const card = parseOffers([
      {
        ...boardSellOffers(new Date('2026-10-24T12:00:00Z'))[0]!,
        tiers: [
          { min: '5000', max: '150000', marginBps: 0, minTrades: null, methodIds: null },
          { min: '5000', max: '150000', marginBps: -200, minTrades: null, methodIds: ['ZELLE'] },
        ],
        methods: [{ methodId: 'ZELLE', adjustBps: 0 }, { methodId: 'PAYPAL', adjustBps: 300 }],
        currencies: ['USD', 'CAD'],
        viewerTrades: 4,
      },
    ])[0]!;
    expect(card.currencies).toEqual(['USD', 'CAD']);
    const viaPaypal = quoteOffer(card, 'sell', 'USD', 'PAYPAL');
    expect(viaPaypal).toMatchObject({ methodId: 'PAYPAL', adjustBps: 300, viewerTrades: 4 });
    expect(viaPaypal.tiers.map((t) => t.marginBps)).toEqual([0]);
    expect(quoteOffer(card, 'sell', 'USD', 'ZELLE').tiers.map((t) => t.marginBps)).toEqual([0, -200]);
  });
});

describe('amount text', () => {
  it('fiatWhole drops ".00" only (the board\'s "$50 to $1,500")', () => {
    expect(fiatWhole(5_000n, 'USD')).toBe('$50');
    expect(fiatWhole(150_000n, 'USD')).toBe('$1,500');
    expect(fiatWhole(41_250n, 'USD')).toBe('$412.50');
  });

  it('amountText is what Max puts in the box: the offer maximum, never above it', () => {
    const rate = { currency: 'USD', centsPerXmr: 33_000n };
    expect(amountText(150_000n, 'fiat', rate)).toBe('1500.00');
    const xmr = amountText(150_000n, 'xmr', rate);
    const q = quote({ offer: SELL_AD, market: MARKET_USD, text: xmr, unit: 'xmr' });
    expect(q.kind).toBe('ok');
    if (q.kind === 'ok') expect(q.fiatCents <= 150_000n).toBe(true);
  });
});

describe('take refusals', () => {
  it('a starter-limit refusal names only the caller\'s own stage', () => {
    const err = new ApiCallError(409, 'starter-limit', { stage: 'starter', capUsdCents: '20000', otherStage: 'building', poster: 'graduated' });
    const msg = takeRefusal(err, SELL_AD);
    expect(msg).toContain('Starter');
    expect(msg).toContain('$200');
    expect(msg).not.toMatch(/building|graduated/i);
    expect(msg).not.toContain('satoshi_ghost');
  });

  it('a starter-limit refusal without a cap still names the stage, and an unknown stage names none', () => {
    expect(takeRefusal(new ApiCallError(409, 'starter-limit', { stage: 'building' }), SELL_AD)).toMatch(/Building/);
    const odd = takeRefusal(new ApiCallError(409, 'starter-limit', { stage: 'graduated' }), SELL_AD);
    expect(odd).not.toMatch(/starter|building|graduated/i);
  });

  it("a starter-limit refusal for the open-trade count says so; one about the other side names no stage (Task 5 as built)", () => {
    expect(takeRefusal(new ApiCallError(409, 'starter-limit', { stage: 'starter', maxOpen: 3 }), SELL_AD)).toBe(
      'Your account is on Starter limits: at most 3 open trades at once. Finish one first.',
    );
    const other = takeRefusal(new ApiCallError(409, 'starter-limit', {}), SELL_AD);
    expect(other).toBe('This trade is above a trading limit right now. Try a smaller amount or another offer.');
    expect(other).not.toMatch(/your account|starter|building|graduated/i);
  });

  it("Plan 4 Task 26: an account-limit refusal names the caller's own cap, never why or a stage", () => {
    const msg = takeRefusal(new ApiCallError(409, 'account-limit', { capUsdCents: '30000', reason: 'walked away' }), SELL_AD);
    expect(msg).toBe('Your account has a limit of $300 per trade. Try a smaller amount.');
    expect(takeRefusal(new ApiCallError(409, 'account-limit', {}), SELL_AD)).toBe('Your account has a limit per trade. Try a smaller amount.');
  });

  it('a not-enough-trades refusal counts in the singular for 1', () => {
    const one = takeRefusal(new ApiCallError(409, 'not-enough-trades', {}), { ...SELL_AD, minTrades: 1 });
    expect(one).toBe('This offer needs at least 1 completed trade.');
    expect(takeRefusal(new ApiCallError(409, 'not-enough-trades', {}), { ...SELL_AD, minTrades: 5 })).toBe('This offer needs at least 5 completed trades.');
  });

  it('every known refusal has its own words, and none carries "!"', () => {
    const codes = ['own-offer', 'out-of-range', 'not-enough-trades', 'trading-hold', 'trading-paused', 'price-unavailable', 'price-changed', 'method-unavailable', 'wallet-not-ready', 'already-waiting', 'ad-busy', 'offer-busy', 'starter-limit'];
    const seen = new Set<string>();
    for (const c of codes) {
      const m = takeRefusal(new ApiCallError(409, c, { stage: 'starter' }), SELL_AD);
      expect(m).not.toContain('!');
      seen.add(m);
    }
    expect(seen.size).toBe(codes.length);
    expect(takeRefusal(new Error('boom'), SELL_AD)).toBe('The trade could not start. Try again.');
  });
});
