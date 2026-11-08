// Pure parts of PostOffer (Task 21): amounts, margin steps, prices with their US-dollar value
// (spec 11.6), validation into the POST /v1/offers body, the preview line, the saved draft and the
// refusal copy. The screen itself is covered by apps/web/e2e/post.spec.ts.
import { describe, expect, it } from 'vitest';
import { CURRENCIES } from '../src/screens/browse/api.js';
import { parseMethods, parsePrice } from '../src/screens/post/api.js';
import { COUNTRIES } from '../src/screens/post/countries.js';
import {
  COUNTRY_REQUIRED,
  TERMS_BAD_TEXT,
  TERMS_LONG_TEXT,
  DEFAULT_FORM,
  FIXED_STALE_WARNING,
  MIN_TRADES,
  MIN_TRADES_OPTIONS,
  POST_CURRENCIES,
  afterPostPath,
  fixedPriceCheck,
  formatAmount,
  formatMoney,
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
  // These tests type fiat; offerAmounts.test.tsx covers the XMR default.
  unit: 'fiat',
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
    // The US-dollar value beside a market price: "(about $329.90)".
    expect(formatMoney(32990n, 'USD')).toBe('$329.90');
    expect(formatMoney(200000n, 'USD')).toBe('$2,000.00');
  });

  it("gives a local price's US-dollar value at the feed's rate (spec 11.6)", () => {
    const quote = { currency: 'EUR', centsPerXmr: 30510n, usdCentsPerXmr: 32990n, exponent: 2, at: '2026-10-24T12:00:00.000Z' };
    expect(usdValue(30510n, quote)).toBe(32990n);
    expect(usdValue(30663n, quote)).toBe(33155n);
  });

  it('offers the one currency list the browse screens use, USD, EUR and GBP first (lead, Task 21 review 2026-10-27)', () => {
    // One shared list, so a poster never lands on a list that cannot show the offer's currency.
    expect(POST_CURRENCIES).toBe(CURRENCIES);
    expect(POST_CURRENCIES.slice(0, 3)).toEqual(['USD', 'EUR', 'GBP']);
    for (const zeroOrThree of ['JPY', 'KRW', 'CLP', 'VND', 'KWD', 'BHD']) expect(POST_CURRENCIES).not.toContain(zeroOrThree);
    expect(new Set(POST_CURRENCIES).size).toBe(POST_CURRENCIES.length);
  });
});

describe('fixedPriceCheck (a fixed price against the market, Task 21 review 2026-10-27)', () => {
  const market = 32990n; // $329.90
  const at = (pct: number) => BigInt(Math.round(32990 * (1 - pct / 100)));

  it('says nothing within 10% of the market, either way', () => {
    expect(fixedPriceCheck(market, market, 'USD')).toEqual({ kind: 'ok' });
    expect(fixedPriceCheck(29724n, market, 'USD')).toEqual({ kind: 'ok' }); // 9.9% below
    expect(fixedPriceCheck(36256n, market, 'USD')).toEqual({ kind: 'ok' }); // 9.9% above
  });

  it('cautions from 10% to under 50% off the market, with the percentage and the direction', () => {
    expect(fixedPriceCheck(29691n, market, 'USD')).toEqual({ kind: 'caution', text: 'Caution: that is 10% below the market price' });
    expect(fixedPriceCheck(36289n, market, 'USD')).toEqual({ kind: 'caution', text: 'Caution: that is 10% above the market price' });
    expect(fixedPriceCheck(at(49.9), market, 'USD')).toEqual({ kind: 'caution', text: 'Caution: that is 49.9% below the market price' });
    expect(fixedPriceCheck(29000n, market, 'USD')).toEqual({ kind: 'caution', text: 'Caution: that is 12.1% below the market price' });
  });

  it('refuses from 50% off the market, naming the market price', () => {
    expect(fixedPriceCheck(16495n, market, 'USD')).toEqual({ kind: 'refuse', text: 'Check your price: the market is $329.90 / XMR' });
    expect(fixedPriceCheck(49485n, market, 'USD')).toEqual({ kind: 'refuse', text: 'Check your price: the market is $329.90 / XMR' });
    expect(fixedPriceCheck(330n, market, 'USD').kind).toBe('refuse'); // 99% below: a missed decimal point
    expect(fixedPriceCheck(26530n, 26530n, 'GBP')).toEqual({ kind: 'ok' });
    expect(fixedPriceCheck(100n, 26530n, 'GBP')).toEqual({ kind: 'refuse', text: 'Check your price: the market is £265.30 / XMR' });
  });

  it('uses no exclamation marks', () => {
    for (const fixed of [29691n, 16495n, 29000n]) {
      const r = fixedPriceCheck(fixed, market, 'USD');
      expect(r.kind).not.toBe('ok');
      if (r.kind !== 'ok') expect(r.text).not.toContain('!');
    }
  });
});

describe('countries (the gift card\'s country, Revision 2026-10-21)', () => {
  it('lists every ISO 3166-1 alpha-2 code once, named in English and sorted by name', () => {
    expect(COUNTRIES).toHaveLength(249);
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(249);
    for (const c of COUNTRIES) {
      expect(c.code).toMatch(/^[A-Z]{2}$/);
      expect(c.name.length).toBeGreaterThan(2);
    }
    const names = COUNTRIES.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
    expect(COUNTRIES.find((c) => c.code === 'US')?.name).toBe('United States');
    expect(COUNTRIES.find((c) => c.code === 'GB')?.name).toBe('United Kingdom');
    expect(COUNTRIES.find((c) => c.code === 'DE')?.name).toBe('Germany');
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
      amounts: { amountUnit: 'fiat', minFiatCents: 5000n, maxFiatCents: 200000n },
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

  it('a gift-card method needs the card\'s country, sent as `country` (Revision 2026-10-21)', () => {
    const refused = validate(form({ methodId: 'AMAZON_GIFT_CARD' }), { giftCard: true });
    expect(refused.body).toBeUndefined();
    expect(refused.errors).toEqual({ country: COUNTRY_REQUIRED });
    const ok = validate(form({ methodId: 'AMAZON_GIFT_CARD', country: 'US' }), { giftCard: true });
    expect(ok.errors).toEqual({});
    expect(ok.body?.country).toBe('US');
  });

  it('never sends a country for a method that is not a gift card', () => {
    const r = validate(form({ country: 'US' }), { giftCard: false });
    expect(r.errors).toEqual({});
    expect(r.body).not.toHaveProperty('country');
    expect(validate(form()).body).not.toHaveProperty('country');
  });

  it('refuses a fixed price 50% or more off the market inline, on the price; cautions do not block', () => {
    const market = 32990n;
    const refused = validate(form({ priceMode: 'fixed', fixed: '160' }), { market });
    expect(refused.body).toBeUndefined();
    expect(refused.errors.fixed).toBe('Check your price: the market is $329.90 / XMR');
    expect(validate(form({ priceMode: 'fixed', fixed: '290' }), { market }).body?.pricing).toEqual({ mode: 'fixed', centsPerXmr: 29000n });
    // With no quote the stale-price line stands and any price goes through.
    expect(validate(form({ priceMode: 'fixed', fixed: '160' }), { market: null }).body?.pricing).toEqual({ mode: 'fixed', centsPerXmr: 16000n });
  });
});

describe('validate: terms (the API rule, Task 4 review M2)', () => {
  it('refuses control and bidi characters with a message the user can act on', () => {
    for (const t of ['nul \u0000', 'c1 \u0085', 'bidi \u202e', 'isolate \u2066x\u2069', 'esc \u001b']) {
      expect(validate(form({ terms: t })).errors.terms, JSON.stringify(t)).toBe(TERMS_BAD_TEXT);
    }
    expect(validate(form({ terms: 'x'.repeat(4001) })).errors.terms).toBe(TERMS_LONG_TEXT);
  });

  it('allows emoji with a zero-width joiner, soft hyphens and tabs, and sends CRLF as LF', () => {
    const r = validate(form({ terms: 'Team \u{1F469}\u200D\u{1F4BB} ok\u00ADay\r\nline two\rthree\tend' }));
    expect(r.errors).toEqual({});
    expect(r.body?.terms).toBe('Team \u{1F469}\u200D\u{1F4BB} ok\u00ADay\nline two\nthree\tend');
  });
});

describe('minimum completed trades (owner, 8 Nov: "This will be 5, 10, 25, 50")', () => {
  it('is a fixed choice: No minimum (the default), 5, 10, 25 or 50', () => {
    expect(MIN_TRADES).toEqual([null, 5, 10, 25, 50]);
    expect(DEFAULT_FORM.minTrades).toBeNull();
    expect(MIN_TRADES_OPTIONS.map((o) => o.label)).toEqual(['No minimum', '5', '10', '25', '50']);
  });

  it('posts null for no minimum and the number for a choice', () => {
    expect(validate(form()).body?.minTrades).toBeNull();
    for (const n of [5, 10, 25, 50] as const) expect(validate(form({ minTrades: n })).body?.minTrades).toBe(n);
  });

  it('a no-minimum draft round-trips', () => {
    const s = memoryStorage();
    saveDraft(s, form({ minTrades: null }));
    expect(loadDraft(s)?.minTrades).toBeNull();
    saveDraft(s, form({ minTrades: 25 }));
    expect(loadDraft(s)?.minTrades).toBe(25);
  });
});

describe('preview and navigation', () => {
  it('says who can trade openly, never a name (the board says "you")', () => {
    expect(previewLine('sell', 'Zelle', 'USD', null)).toBe('Selling XMR via Zelle · USD · you');
    expect(previewLine('sell', 'Zelle', 'USD', 25)).toBe('Selling XMR via Zelle · USD · you · 25+ completed trades');
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
    const f = form({ side: 'buy', priceMode: 'fixed', fixed: '340', terms: 'cash only', minTrades: 50, country: 'GB' });
    saveDraft(s, f);
    expect(loadDraft(s)).toEqual(f);
  });

  it('refuses a draft whose country is not an alpha-2 code', () => {
    const s = memoryStorage();
    s.setItem('x2f.post-draft', JSON.stringify({ ...form(), country: 'usa' }));
    expect(loadDraft(s)).toBeNull();
  });

  it('ignores a missing, broken or wrongly shaped draft', () => {
    const s = memoryStorage();
    expect(loadDraft(s)).toBeNull();
    s.setItem('x2f.post-draft', '{not json');
    expect(loadDraft(s)).toBeNull();
    s.setItem('x2f.post-draft', JSON.stringify({ ...form(), minTrades: 7 }));
    expect(loadDraft(s)).toBeNull();
    // A draft from before the owner's choices (0 for anyone) is dropped, never read as a minimum.
    s.setItem('x2f.post-draft', JSON.stringify({ ...form(), minTrades: 0 }));
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
    expect(refusalText('too-many-offers')).toMatch(/Remove one/);
    expect(refusalText('something-new')).toMatch(/wasn't posted/);
    for (const code of ['trading-hold', 'trading-paused', 'method-unavailable', 'too-many-offers', 'x']) expect(refusalText(code)).not.toContain('!');
  });
});

describe('api parsers (Task 3 shapes: GET /v1/price, GET /v1/methods on the main line)', () => {
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
