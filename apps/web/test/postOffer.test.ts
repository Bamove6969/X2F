// Pure parts of PostOffer (Task 21): amounts, margin steps, prices with their US-dollar value
// (spec 11.6), validation into the POST /v1/offers body, the preview line, the saved draft and the
// refusal copy. The screen itself is covered by apps/web/e2e/post.spec.ts.
import { describe, expect, it } from 'vitest';
import { parseMethods, parsePrice } from '../src/screens/post/api.js';
import {
  DEFAULT_FORM,
  FIXED_STALE_WARNING,
  POST_CURRENCIES,
  afterPostPath,
  formatAmount,
  formatPrice,
  loadDraft,
  marginText,
  marginWord,
  parseAmount,
  previewLine,
  priceWithMargin,
  refusalText,
  saveDraft,
  stepMargin,
  usdValue,
  validate,
  type FormState,
} from '../src/screens/post/offerForm.js';

const form = (over: Partial<FormState> = {}): FormState => ({
  ...DEFAULT_FORM,
  methodId: 'ZELLE',
  min: '$50',
  max: '$2,000',
  ...over,
});

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

describe('parseAmount', () => {
  it('reads plain and board-style amounts into cents', () => {
    expect(parseAmount('50')).toBe(5000n);
    expect(parseAmount('$50')).toBe(5000n);
    expect(parseAmount('$2,000')).toBe(200000n);
    expect(parseAmount(' 12.5 ')).toBe(1250n);
    expect(parseAmount('€0.99')).toBe(99n);
  });

  it('refuses anything that is not one plain amount', () => {
    for (const bad of ['', '  ', 'abc', '1.2.3', '1.234', '-5', '1e3', '12$3', '$']) expect(parseAmount(bad), bad).toBeNull();
  });
});

describe('margin', () => {
  it('steps by 0.1% (10 bps) and stops at the board limits of ±10%', () => {
    expect(stepMargin(50, 1)).toBe(60);
    expect(stepMargin(50, -1)).toBe(40);
    expect(stepMargin(1000, 1)).toBe(1000);
    expect(stepMargin(-1000, -1)).toBe(-1000);
  });

  it('reads like the board', () => {
    expect(marginText(50)).toBe('+0.5%');
    expect(marginText(0)).toBe('0.0%');
    expect(marginText(-120)).toBe('-1.2%');
    expect(marginWord(50)).toBe('above market');
    expect(marginWord(0)).toBe('at market');
    expect(marginWord(-10)).toBe('below market');
  });

  it('moves the market price by the margin, rounded half up', () => {
    // The board: $329.90 at +0.5% is $331.55.
    expect(priceWithMargin(32990n, 50)).toBe(33155n);
    expect(priceWithMargin(32990n, 0)).toBe(32990n);
    expect(priceWithMargin(32990n, -100)).toBe(32660n);
  });
});

describe('formatting', () => {
  it('prices per XMR keep two decimals; trade sizes drop whole-unit zeros', () => {
    expect(formatPrice(33155n, 'USD')).toBe('$331.55 / XMR');
    expect(formatPrice(30510n, 'EUR')).toBe('€305.10 / XMR');
    expect(formatAmount(5000n, 'USD')).toBe('$50');
    expect(formatAmount(200000n, 'USD')).toBe('$2,000');
    expect(formatAmount(1250n, 'USD')).toBe('$12.50');
  });

  it("gives a local price's US-dollar value at the feed's rate (spec 11.6)", () => {
    const quote = { currency: 'EUR', centsPerXmr: 30510n, usdCentsPerXmr: 32990n, exponent: 2, at: '2026-10-24T12:00:00.000Z' };
    expect(usdValue(30510n, quote)).toBe(32990n);
    expect(usdValue(30663n, quote)).toBe(33155n);
  });

  it('offers only two-decimal currencies, USD, EUR and GBP first (Revision 2026-10-20)', () => {
    expect(POST_CURRENCIES.slice(0, 3)).toEqual(['USD', 'EUR', 'GBP']);
    for (const zeroOrThree of ['JPY', 'KRW', 'CLP', 'VND', 'KWD', 'BHD']) expect(POST_CURRENCIES).not.toContain(zeroOrThree);
    expect(new Set(POST_CURRENCIES).size).toBe(POST_CURRENCIES.length);
  });
});

describe('validate', () => {
  it('builds the POST /v1/offers body for a market offer', () => {
    const r = validate(form({ terms: '  Memo: trade number  ', minTrades: 5 }));
    expect(r.errors).toEqual({});
    expect(r.body).toEqual({
      side: 'sell',
      methodId: 'ZELLE',
      currency: 'USD',
      pricing: { mode: 'market', marginBps: 50 },
      minFiatCents: 5000n,
      maxFiatCents: 200000n,
      minTrades: 5,
      terms: 'Memo: trade number',
    });
  });

  it('a fixed price posts pricing.mode = fixed with its cents per XMR', () => {
    const r = validate(form({ priceMode: 'fixed', fixed: '335' }));
    expect(r.body?.pricing).toEqual({ mode: 'fixed', centsPerXmr: 33500n });
  });

  it('refuses min > max inline, on the smallest trade', () => {
    const r = validate(form({ min: '500', max: '100' }));
    expect(r.body).toBeUndefined();
    expect(r.errors.min).toBe("The smallest trade can't be more than the largest.");
  });

  it('refuses missing or zero amounts, a missing method and a missing fixed price', () => {
    const r = validate(form({ methodId: '', min: '', max: '0', priceMode: 'fixed', fixed: 'x' }));
    expect(r.body).toBeUndefined();
    expect(Object.keys(r.errors).sort()).toEqual(['fixed', 'max', 'method', 'min']);
  });
});

describe('preview and navigation', () => {
  it('says who can trade openly, never a name (the board says "you")', () => {
    expect(previewLine('sell', 'Zelle', 'USD', 0)).toBe('Selling XMR via Zelle · USD · you');
    expect(previewLine('buy', 'Zelle', 'EUR', 10)).toBe('Buying XMR via Zelle · EUR · you · 10+ completed trades');
  });

  it("returns to the list where takers see the new offer: a sell ad on Buy, a buy ad on Sell", () => {
    expect(afterPostPath('sell', 'ZELLE', 'USD')).toBe('/buy/ZELLE?currency=USD');
    expect(afterPostPath('buy', 'SEPA', 'EUR')).toBe('/sell/SEPA?currency=EUR');
  });

  it('has the spec 2.2 stale-price warning', () => {
    expect(FIXED_STALE_WARNING).toBe('A fixed price goes stale when the market moves.');
  });
});

describe('draft', () => {
  it('round-trips the form through storage', () => {
    const s = memoryStorage();
    const f = form({ side: 'buy', priceMode: 'fixed', fixed: '340', terms: 'cash only', minTrades: 50 });
    saveDraft(s, f);
    expect(loadDraft(s)).toEqual(f);
  });

  it('ignores a missing, broken or wrongly shaped draft', () => {
    const s = memoryStorage();
    expect(loadDraft(s)).toBeNull();
    s.setItem('x2f.post-draft', '{not json');
    expect(loadDraft(s)).toBeNull();
    s.setItem('x2f.post-draft', JSON.stringify({ ...form(), minTrades: 7 }));
    expect(loadDraft(s)).toBeNull();
    s.setItem('x2f.post-draft', JSON.stringify({ ...form(), side: 'steal' }));
    expect(loadDraft(s)).toBeNull();
  });

  it('survives storage that throws', () => {
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } } as unknown as Storage;
    expect(() => saveDraft(throwing, form())).not.toThrow();
    expect(loadDraft(throwing)).toBeNull();
  });
});

describe('refusalText', () => {
  it('shows the API refusals as text', () => {
    expect(refusalText('trading-hold')).toMatch(/trading hold/);
    expect(refusalText('trading-paused')).toMatch(/paused/);
    expect(refusalText('method-unavailable')).toMatch(/payment method/);
    expect(refusalText('something-new')).toMatch(/wasn't posted/);
    for (const code of ['trading-hold', 'trading-paused', 'method-unavailable', 'x']) expect(refusalText(code)).not.toContain('!');
  });
});

describe('api parsers (Task 3 shapes from wip/second-p3-t3)', () => {
  it('parsePrice reads the price route', () => {
    expect(
      parsePrice({ currency: 'EUR', centsPerXmr: '30510', exponent: 2, at: '2026-10-24T12:00:00.000Z', usdCentsPerXmr: '32990' }),
    ).toEqual({ currency: 'EUR', centsPerXmr: 30510n, exponent: 2, at: '2026-10-24T12:00:00.000Z', usdCentsPerXmr: 32990n });
  });

  it('parsePrice throws on a renamed or malformed field', () => {
    expect(() => parsePrice({ currency: 'EUR', centsPerXmr: 30510, exponent: 2, at: 'x', usdCentsPerXmr: '1' })).toThrow();
    expect(() => parsePrice({ currency: 'EUR', cents: '30510', exponent: 2, at: 'x', usdCentsPerXmr: '1' })).toThrow();
  });

  it('parseMethods takes the whole catalog list (`all`)', () => {
    const row = (id: string, name: string, giftCard = false) => ({ id, name, group: 'g', giftCard, offers: 0, bestRate: null });
    expect(parseMethods({ live: [row('ZELLE', 'Zelle')], all: [row('ZELLE', 'Zelle'), row('AMAZON_GIFT_CARD', 'Amazon gift card', true)] })).toEqual([
      { id: 'ZELLE', name: 'Zelle', giftCard: false },
      { id: 'AMAZON_GIFT_CARD', name: 'Amazon gift card', giftCard: true },
    ]);
    expect(() => parseMethods({ live: [] })).toThrow();
  });
});
