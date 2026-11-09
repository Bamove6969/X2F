// Pure parts of PostOffer (Task 21): amounts, the margin (above or below the market, typed; owner F1), prices with their US-dollar value
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
  MARGIN_ERROR,
  MARGIN_MAX_BPS,
  MARGIN_SIDES,
  MIN_TRADES,
  MIN_TRADES_OPTIONS,
  POST_CURRENCIES,
  afterPostPath,
  formatAmount,
  formatMoney,
  formatPrice,
  loadDraft,
  marginBpsOf,
  marginText,
  marginWord,
  parseAmount,
  previewLine,
  priceWithMargin,
  refusalText,
  saveDraft,
  usdValue,
  validate,
  type FormErrors,
  type FormState,
  type MinTrades,
} from '../src/screens/post/offerForm.js';

/** The single-offer form's fields (before J-16): one method, one currency, one band. */
interface Flat {
  side: FormState['side'];
  methodId: string;
  currency: string;
  marginSide: 'above' | 'below';
  marginPct: string;
  unit: FormState['unit'];
  min: string;
  max: string;
  terms: string;
  minTrades: MinTrades;
  country: string;
}

const FLAT: Flat = {
  side: 'sell',
  methodId: 'ZELLE',
  currency: 'USD',
  marginSide: 'above',
  marginPct: '0.5',
  // These tests type fiat; offerAmounts.test.tsx covers the XMR default.
  unit: 'fiat',
  min: '$50',
  max: '$2,000',
  terms: '',
  minTrades: null,
  country: '',
};

/** J-16: the flat fields as the form keeps them, one currency with one band (key 1) and one method (or none). */
function one(f: Flat): FormState {
  return {
    side: f.side,
    unit: f.unit,
    currencies: [f.currency],
    bands: { [f.currency]: [{ key: 1, min: f.min, max: f.max, marginSide: f.marginSide, marginPct: f.marginPct, minTrades: f.minTrades }] },
    methods: f.methodId === '' ? [] : [{ methodId: f.methodId, adjustBps: 0, same: true, instructions: '', byCurrency: {} }],
    terms: f.terms,
    country: f.country,
  };
}

const form = (over: Partial<Flat> = {}): FormState => one({ ...FLAT, ...over });

/** The posted margin of the one band. */
const marginOf = (f: FormState) => validate(f).body?.currencies[0]?.bands[0]?.marginBps;

/** The one band's own errors. */
const bandErrors = (r: { errors: FormErrors }) => r.errors.bands?.['USD']?.rows[1];

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

describe('margin (owner F1, 7 Nov: pick above or below, type the percentage, at most 50%)', () => {
  const bps = (marginSide: 'above' | 'below', marginPct: string) => marginBpsOf({ marginSide, marginPct });

  it('starts at 0.5% above the market (the board), and offers exactly above and below', () => {
    expect(DEFAULT_FORM.bands['USD']![0]).toMatchObject({ marginSide: 'above', marginPct: '0.5' });
    expect(MARGIN_SIDES.map((o) => o.id)).toEqual(['above', 'below']);
    expect(MARGIN_MAX_BPS).toBe(5000);
  });

  it('reads the typed percentage in basis points, signed by the side', () => {
    expect(bps('above', '0.5')).toBe(50);
    expect(bps('below', '0.5')).toBe(-50);
    expect(bps('above', '2')).toBe(200);
    expect(bps('below', '12.25')).toBe(-1225);
    expect(bps('above', ' 3.1 ')).toBe(310);
    expect(bps('above', '3.10%')).toBe(310);
    expect(bps('above', '0')).toBe(0);
    expect(bps('below', '0')).toBe(0);
  });

  it('takes 50% either way and refuses 50.01% either way', () => {
    expect(bps('above', '50')).toBe(5000);
    expect(bps('below', '50')).toBe(-5000);
    expect(bps('above', '50.00')).toBe(5000);
    expect(bps('above', '50.01')).toBeNull();
    expect(bps('below', '50.01')).toBeNull();
    expect(bps('above', '51')).toBeNull();
    expect(bps('below', '100')).toBeNull();
  });

  it('refuses anything that is not a plain percentage with at most two decimals', () => {
    for (const bad of ['', ' ', 'abc', '-1', '+1', '1.234', '1.2.3', '1e1', '.', '50.001']) expect(bps('above', bad), bad).toBeNull();
  });

  it('validate sends the signed margin, and refuses a bad or too-large percentage inline, on the margin', () => {
    expect(marginOf(form({ marginSide: 'above', marginPct: '50' }))).toBe(5000);
    expect(marginOf(form({ marginSide: 'below', marginPct: '50' }))).toBe(-5000);
    for (const marginSide of ['above', 'below'] as const) {
      const r = validate(form({ marginSide, marginPct: '50.01' }));
      expect(r.body).toBeUndefined();
      expect(r.errors).toEqual({ bands: { USD: { rows: { 1: { margin: MARGIN_ERROR } } } } });
    }
    expect(validate(form({ marginPct: '' })).errors).toEqual({ bands: { USD: { rows: { 1: { margin: MARGIN_ERROR } } } } });
    expect(MARGIN_ERROR).not.toContain('!');
  });

  it('reads like the board', () => {
    expect(marginText(50)).toBe('+0.5%');
    expect(marginText(0)).toBe('0.0%');
    expect(marginText(-120)).toBe('-1.2%');
    // A typed hundredth is shown, never rounded away (owner F1: the percentage is typed).
    expect(marginText(-1225)).toBe('-12.25%');
    expect(marginText(3)).toBe('+0.03%');
    expect(marginText(5000)).toBe('+50.0%');
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
    // J-16: whole units (O-018), one band per currency here, the method with its instructions.
    expect(r.body).toEqual({
      side: 'sell',
      amountUnit: 'fiat',
      currencies: [{ currency: 'USD', bands: [{ min: '50', max: '2000', marginBps: 50, minTrades: 5 }] }],
      methods: [{ methodId: 'ZELLE', adjustBps: 0, instructions: '' }],
      terms: 'Memo: trade number',
    });
  });

  it('there is no fixed price (owner Q1): the form has no price box and always sends a market margin', () => {
    expect(DEFAULT_FORM).not.toHaveProperty('priceMode');
    expect(DEFAULT_FORM).not.toHaveProperty('fixed');
    expect(marginOf(form({ side: 'buy', marginSide: 'below', marginPct: '3' }))).toBe(-300);
    expect(validate(form()).body?.currencies[0]?.bands[0]).not.toHaveProperty('centsPerXmr');
  });

  it('refuses min > max inline, on the smallest trade', () => {
    const r = validate(form({ min: '500', max: '100' }));
    expect(r.body).toBeUndefined();
    expect(bandErrors(r)?.min).toBe("The smallest trade can't be more than the largest.");
  });

  it('refuses missing or zero amounts, a missing method and a missing margin', () => {
    const r = validate(form({ methodId: '', min: '', max: '0', marginPct: 'x' }));
    expect(r.body).toBeUndefined();
    expect(Object.keys(r.errors).sort()).toEqual(['bands', 'methods']);
    expect(Object.keys(bandErrors(r)!).sort()).toEqual(['margin', 'max', 'min']);
  });

  it('a gift-card method needs the card\'s country, sent as `country` (Revision 2026-10-21)', () => {
    const refused = validate(form({ methodId: 'AMAZON_GIFT_CARD' }), { giftCard: (id) => id === 'AMAZON_GIFT_CARD' });
    expect(refused.body).toBeUndefined();
    expect(refused.errors).toEqual({ country: COUNTRY_REQUIRED });
    const ok = validate(form({ methodId: 'AMAZON_GIFT_CARD', country: 'US' }), { giftCard: (id) => id === 'AMAZON_GIFT_CARD' });
    expect(ok.errors).toEqual({});
    expect(ok.body?.country).toBe('US');
  });

  it('never sends a country for a method that is not a gift card', () => {
    const r = validate(form({ country: 'US' }), { giftCard: () => false });
    expect(r.errors).toEqual({});
    expect(r.body).not.toHaveProperty('country');
    expect(validate(form()).body).not.toHaveProperty('country');
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
    expect(DEFAULT_FORM.bands['USD']![0]!.minTrades).toBeNull();
    expect(MIN_TRADES_OPTIONS.map((o) => o.label)).toEqual(['No minimum', '5', '10', '25', '50']);
  });

  it('posts null for no minimum and the number for a choice', () => {
    const rule = (f: FormState) => validate(f).body?.currencies[0]?.bands[0]?.minTrades;
    expect(rule(form())).toBeNull();
    for (const n of [5, 10, 25, 50] as const) expect(rule(form({ minTrades: n }))).toBe(n);
  });

  it('a no-minimum draft round-trips', () => {
    const s = memoryStorage();
    saveDraft(s, form({ minTrades: null }));
    expect(loadDraft(s)?.bands['USD']![0]!.minTrades).toBeNull();
    saveDraft(s, form({ minTrades: 25 }));
    expect(loadDraft(s)?.bands['USD']![0]!.minTrades).toBe(25);
  });
});

describe('preview and navigation', () => {
  it('says who can trade openly, never a name (the board says "you")', () => {
    expect(previewLine('sell', ['Zelle'], ['USD'], null)).toBe('Selling XMR via Zelle · USD · you');
    expect(previewLine('sell', ['Zelle'], ['USD'], 25)).toBe('Selling XMR via Zelle · USD · you · 25+ completed trades');
    expect(previewLine('buy', ['Zelle'], ['EUR'], 10)).toBe('Buying XMR via Zelle · EUR · you · 10+ completed trades');
    // J-16: several methods and currencies.
    expect(previewLine('sell', ['Zelle', 'PayPal'], ['USD', 'CAD'], null)).toBe('Selling XMR via Zelle, PayPal · USD, CAD · you');
  });

  it("returns to the list where takers see the new offer: a sell ad on Buy, a buy ad on Sell", () => {
    expect(afterPostPath('sell', 'ZELLE', 'USD')).toBe('/buy/ZELLE?currency=USD');
    expect(afterPostPath('buy', 'SEPA', 'EUR')).toBe('/sell/SEPA?currency=EUR');
  });
});

describe('draft', () => {
  it('round-trips the form through storage', () => {
    const s = memoryStorage();
    const f = form({ side: 'buy', marginSide: 'below', marginPct: '2.5', terms: 'cash only', minTrades: 50, country: 'GB' });
    saveDraft(s, f);
    expect(loadDraft(s)).toEqual(f);
  });

  it('a draft from before the typed margin keeps its market margin; a fixed-price draft is dropped (owner Q1)', () => {
    const s = memoryStorage();
    // A draft of the single-offer form (before J-16, no version) loads as one currency, one band, one method.
    const { marginSide: _s, marginPct: _p, ...rest } = FLAT;
    s.setItem('x2f.post-draft', JSON.stringify({ ...rest, priceMode: 'market', marginBps: -120, fixed: '' }));
    expect(loadDraft(s)?.bands['USD']![0]).toMatchObject({ marginSide: 'below', marginPct: '1.2' });
    expect(loadDraft(s)?.methods.map((m) => m.methodId)).toEqual(['ZELLE']);
    s.setItem('x2f.post-draft', JSON.stringify({ ...rest, priceMode: 'fixed', marginBps: 50, fixed: '340' }));
    expect(loadDraft(s)).toBeNull();
    // A typed percentage over 50 is kept as typed (the form shows the error); the side must be one of the two.
    s.setItem('x2f.post-draft', JSON.stringify({ ...FLAT, marginSide: 'sideways' }));
    expect(loadDraft(s)).toBeNull();
    const saved = memoryStorage();
    saveDraft(saved, form());
    const v2 = JSON.parse(saved.getItem('x2f.post-draft')!) as { bands: Record<string, Record<string, unknown>[]> };
    v2.bands['USD']![0]!.marginSide = 'sideways';
    saved.setItem('x2f.post-draft', JSON.stringify(v2));
    expect(loadDraft(saved)).toBeNull();
  });

  it('refuses a draft whose country is not an alpha-2 code', () => {
    const s = memoryStorage();
    s.setItem('x2f.post-draft', JSON.stringify({ ...FLAT, country: 'usa' }));
    expect(loadDraft(s)).toBeNull();
    saveDraft(s, form({ country: 'GB' }));
    s.setItem('x2f.post-draft', s.getItem('x2f.post-draft')!.replace('"country":"GB"', '"country":"usa"'));
    expect(loadDraft(s)).toBeNull();
  });

  it('ignores a missing, broken or wrongly shaped draft', () => {
    const s = memoryStorage();
    expect(loadDraft(s)).toBeNull();
    s.setItem('x2f.post-draft', '{not json');
    expect(loadDraft(s)).toBeNull();
    s.setItem('x2f.post-draft', JSON.stringify({ ...FLAT, minTrades: 7 }));
    expect(loadDraft(s)).toBeNull();
    // A draft from before the owner's choices (0 for anyone) is No minimum, never read as a minimum (review L2).
    s.setItem('x2f.post-draft', JSON.stringify({ ...FLAT, minTrades: 0 }));
    expect(loadDraft(s)?.bands['USD']![0]!.minTrades).toBeNull();
    s.setItem('x2f.post-draft', JSON.stringify({ ...FLAT, side: 'steal' }));
    expect(loadDraft(s)).toBeNull();
    s.setItem('x2f.post-draft', JSON.stringify({ v: 2, ...form(), side: 'steal' }));
    expect(loadDraft(s)).toBeNull();
    s.setItem('x2f.post-draft', JSON.stringify({ v: 3, ...form() }));
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
    expect(refusalText('method-unavailable')).toMatch(/payment methods/);
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
