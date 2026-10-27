// Task 18: the quote maths as the screens use it. Every money figure comes from @x2f/trade (Task 1);
// these tests pin what the quote shows against those functions, so the UI never grows its own maths.
import { describe, expect, it } from 'vitest';
import { atomicForFiat, escrowPlan, fiatCents, formatXmr, offerRate } from '@x2f/trade';
import { amountText, fiatWhole, parseAmount, quote, type QuoteOffer } from '../src/screens/quote/quoteModel.js';
import { takeRefusal } from '../src/screens/quote/takeErrors.js';
import { ApiCallError } from '../src/api/client.js';

const MARKET_USD = { centsPerXmr: 33_000n, usdCentsPerXmr: 33_000n };

/** satoshi_ghost's sell ad on the BuyQuote board: Zelle, USD, $330.00 / XMR, $50 to $1,500. */
const SELL_AD: QuoteOffer = {
  id: 'offer-ghost',
  side: 'sell',
  currency: 'USD',
  poster: { username: 'satoshi_ghost', stage: 'graduated' },
  pricing: { mode: 'market', marginBps: 0 },
  minFiatCents: 5_000n,
  maxFiatCents: 150_000n,
  minTrades: 0,
};

const BUY_AD: QuoteOffer = { ...SELL_AD, id: 'offer-mira', side: 'buy', poster: { username: 'mira.k', stage: 'graduated' } };

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
        const q = quote({ offer: SELL_AD, market: { centsPerXmr, usdCentsPerXmr: centsPerXmr }, text, unit: 'fiat' });
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

  it('a fixed-price offer quotes with the feed down; a market offer does not', () => {
    const fixed = { ...SELL_AD, pricing: { mode: 'fixed' as const, centsPerXmr: 34_000n } };
    const q = quote({ offer: fixed, market: null, text: '340', unit: 'fiat' });
    expect(q.kind).toBe('ok');
    if (q.kind === 'ok') {
      expect(q.rate.centsPerXmr).toBe(34_000n);
      expect(q.usdCents).toBeNull();
    }
    expect(quote({ offer: SELL_AD, market: null, text: '340', unit: 'fiat' }).kind).toBe('price-unavailable');
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
    const q = quote({ offer: eur, market: { centsPerXmr: 30_000n, usdCentsPerXmr: 33_000n }, text: '300', unit: 'fiat' });
    if (q.kind !== 'ok') throw new Error('expected a quote');
    expect(q.rate).toEqual({ currency: 'EUR', centsPerXmr: 30_000n });
    expect(q.usdCents).toBe(fiatCents(q.amountAtomic, { currency: 'USD', centsPerXmr: 33_000n }));
    expect(q.usdCents).toBe(33_000n);
    // A USD trade needs no second figure.
    const usd = quote({ offer: SELL_AD, market: MARKET_USD, text: '300', unit: 'fiat' });
    expect(usd.kind === 'ok' && usd.usdCents).toBeNull();
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

  it('every known refusal has its own words, and none carries "!"', () => {
    const codes = ['own-offer', 'out-of-range', 'not-enough-trades', 'trading-hold', 'trading-paused', 'price-unavailable', 'price-changed', 'method-unavailable', 'wallet-not-ready', 'already-waiting', 'ad-busy', 'starter-limit'];
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
