// @vitest-environment happy-dom
// Owner, 8 Nov 2026 ("Offer amounts in XMR or fiat"): the ad card's two rows (the range in XMR and in
// fiat, the poster's own row exact and the other converted, "≈"), the list's "Display amounts
// including vendor markup" box (off by default, remembered on the device), the parser, and the
// PostOffer switch and body.
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { boardSellOffers } from '../src/fixtures/boards.js';
import { ApiShapeError, parseOffers, type Offer } from '../src/screens/browse/api.js';
import { OfferCard } from '../src/screens/browse/OfferCard.js';
import {
  WITH_MARKUP_KEY,
  cardRows,
  loadWithMarkup,
  marketUpdated,
  otherUnit,
  saveWithMarkup,
  withMarkupHint,
  xmrBound,
  xmrRangeText,
} from '../src/screens/browse/offerAmounts.js';
import { SELL_COPY } from '../src/screens/browse/SellCopy.js';
import { wireBody } from '../src/screens/post/api.js';
import { fiatCents } from '@x2f/trade';
import { DEFAULT_FORM, XMR_AMOUNT_ERROR, loadDraft, parseXmrAmount, saveDraft, switchUnit, validate, type FormState } from '../src/screens/post/offerForm.js';
import { UnitSwitch } from '../src/screens/post/UnitSwitch.js';
import { fire, render } from './render.js';

const NOW = new Date('2026-10-24T12:00:00Z');
const XMR = 1_000_000_000_000n;
const base = boardSellOffers(NOW)[0]!;

/** An offer as the API sends it: +2.5% on a $330.00 market is $338.25. */
function offer(over: Record<string, unknown>): Offer {
  return parseOffers([{ ...base, rate: '33825', pricing: { mode: 'market', marginBps: 250 }, ...over }])[0]!;
}
const XMR_SET = { amountUnit: 'xmr', minAtomic: (1n * XMR).toString(), maxAtomic: (5n * XMR).toString(), minFiatCents: '33825', maxFiatCents: '169125' };
const FIAT_SET = { amountUnit: 'fiat', minAtomic: '1478196600147', maxAtomic: '8869179600886', minFiatCents: '50000', maxFiatCents: '300000' };

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

describe('parsing both units', () => {
  it('reads an XMR-set and a fiat-set offer, and an older answer with no unit as fiat', () => {
    expect(offer(XMR_SET)).toMatchObject({ amountUnit: 'xmr', minAtomic: XMR, maxAtomic: 5n * XMR, minFiatCents: 33825n });
    expect(offer(FIAT_SET)).toMatchObject({ amountUnit: 'fiat', minFiatCents: 50000n, minAtomic: 1478196600147n });
    expect(parseOffers([base])[0]).toMatchObject({ amountUnit: 'fiat', minAtomic: null, minFiatCents: 5000n });
  });

  it('the converted pair may be null (no rate); the own pair may not, nor be out of order', () => {
    expect(offer({ ...XMR_SET, minFiatCents: null, maxFiatCents: null }).minFiatCents).toBeNull();
    expect(() => offer({ ...XMR_SET, minAtomic: null })).toThrow(ApiShapeError);
    expect(() => offer({ ...FIAT_SET, minFiatCents: '400000' })).toThrow(ApiShapeError);
    expect(() => offer({ ...XMR_SET, amountUnit: 'btc' })).toThrow(ApiShapeError);
    const { maxAtomic: _m, ...missing } = XMR_SET;
    expect(() => offer(missing)).toThrow(ApiShapeError);
  });
});

describe('the card rows', () => {
  it('formats XMR with six places, the minimum rounded up and the maximum down', () => {
    expect(xmrBound(1_478_196_600_147n, 'up')).toBe('1.478197');
    expect(xmrBound(8_869_179_600_886n, 'down')).toBe('8.869179');
    expect(xmrBound(XMR, 'up')).toBe('1.000000');
    expect(xmrBound(XMR, 'down')).toBe('1.000000');
    // One atomic unit over a whole XMR rounds the minimum up a full place, the maximum down to 1.
    expect(xmrBound(1_000_000_000_001n, 'up')).toBe('1.000001');
    expect(xmrBound(1_000_000_000_001n, 'down')).toBe('1.000000');
    expect(xmrBound(1n, 'up')).toBe('0.000001');
    expect(xmrBound(1n, 'down')).toBe('0.000000');
    expect(xmrBound(1_234_567n * XMR, 'down')).toBe('1,234,567.000000');
    expect(xmrBound(1_478_196_600_147n, 'up', 0)).toBe('2');
    expect(xmrRangeText(XMR, 5n * XMR)).toBe('1.000000 – 5.000000');
  });

  it('an XMR-set range: XMR exact; fiat at the market without the markup, at the offer price with it', () => {
    const o = offer(XMR_SET);
    expect(cardRows(o, 'USD', 33_000n, false)).toEqual({ xmr: '1.000000 – 5.000000', fiat: '≈ $330 – $1,650' });
    expect(cardRows(o, 'USD', 33_000n, true)).toEqual({ xmr: '1.000000 – 5.000000', fiat: '≈ $338.25 – $1,691.25' });
  });

  it('a fiat-set range: fiat exact; XMR at the market without the markup, at the offer price with it', () => {
    const o = offer(FIAT_SET);
    expect(cardRows(o, 'USD', 33_000n, false)).toEqual({ xmr: '≈ 1.515152 – 9.090909', fiat: '$500 – $3,000' });
    expect(cardRows(o, 'USD', 33_000n, true)).toEqual({ xmr: '≈ 1.478197 – 8.869179', fiat: '$500 – $3,000' });
  });

  it('with no rate only the poster\'s own row shows', () => {
    expect(cardRows(offer({ ...XMR_SET, rate: null }), 'USD', null, true)).toEqual({ xmr: '1.000000 – 5.000000', fiat: null });
    expect(cardRows(offer(FIAT_SET), 'USD', null, false)).toEqual({ xmr: null, fiat: '$500 – $3,000' });
  });

  it('the card draws both rows with their units, the markup bottom-left', () => {
    const { host } = render(
      <MemoryRouter>
        <OfferCard offer={offer(XMR_SET)} currency="USD" copy={SELL_COPY} primary now={NOW} market={33_000n} withMarkup={false} />
      </MemoryRouter>,
    );
    expect(host.querySelector('[data-part="range-xmr"]')?.textContent).toBe('1.000000 – 5.000000 XMR');
    expect(host.querySelector('[data-part="range-xmr"] [data-unit="xmr"]')?.textContent).toBe('XMR');
    expect(host.querySelector('[data-part="range-fiat"]')?.textContent).toBe('≈ $330 – $1,650 USD');
    expect(host.querySelector('[data-part="markup"]')?.textContent).toBe('+2.5%Vendor markup');
    // The markup and the rows share the bottom row; the price row sits above it.
    const bottom = host.querySelector('.x2f-offer__amounts')!;
    expect(bottom.firstElementChild?.getAttribute('data-part')).toBe('markup');
    expect(bottom.querySelector('[data-part="range-fiat"]')).not.toBeNull();
  });
});

describe('Display amounts including vendor markup', () => {
  it('is off by default and remembered on this device', () => {
    const s = memoryStorage();
    expect(loadWithMarkup(s)).toBe(false);
    saveWithMarkup(s, true);
    expect(s.getItem(WITH_MARKUP_KEY)).toBe('1');
    expect(loadWithMarkup(s)).toBe(true);
    saveWithMarkup(s, false);
    expect(loadWithMarkup(s)).toBe(false);
    expect(loadWithMarkup(null)).toBe(false);
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } } as unknown as Storage;
    expect(loadWithMarkup(throwing)).toBe(false);
    expect(() => saveWithMarkup(throwing, true)).not.toThrow();
  });

  it('says which rate the converted rows use', () => {
    expect(withMarkupHint(false)).toBe('Converted at the market rate, before markup.');
    expect(withMarkupHint(true)).toBe("Converted at each offer's price, markup included.");
  });

  it('the market line says when the rate is from', () => {
    expect(marketUpdated('2026-11-08T14:05:59.000Z')).toBe('Market rate · updated 14:05 UTC');
    expect(marketUpdated('not a time')).toBeNull();
  });
});

/** J-16: one currency with one band (key 1), at market +0% unless given, and Zelle. */
function one(over: { unit?: FormState['unit']; currency?: string; min?: string; max?: string; marginPct?: string } = {}): FormState {
  const currency = over.currency ?? 'USD';
  return {
    ...DEFAULT_FORM,
    unit: over.unit ?? DEFAULT_FORM.unit,
    currencies: [currency],
    bands: { [currency]: [{ key: 1, min: over.min ?? '', max: over.max ?? '', marginSide: 'above', marginPct: over.marginPct ?? '0', minTrades: null }] },
    methods: [{ methodId: 'ZELLE', adjustBps: 0, same: true, instructions: '', byCurrency: {} }],
  };
}
const boxes = (f: FormState): [string, string] => {
  const b = f.bands[f.currencies[0]!]![0]!;
  return [b.min, b.max];
};

describe('PostOffer in XMR or fiat', () => {
  it('defaults to XMR and posts atomic units; in fiat, whole units (O-018); the unit sits at the top of the wire body', () => {
    expect(DEFAULT_FORM.unit).toBe('xmr');
    const x = validate(one({ min: '0.5', max: '25' }));
    expect(x.body?.amountUnit).toBe('xmr');
    expect(x.body?.currencies[0]?.bands[0]).toMatchObject({ min: String(500_000_000_000n), max: String(25n * XMR) });
    expect(wireBody(x.body!)).toMatchObject({ amountUnit: 'xmr', currencies: [{ currency: 'USD', bands: [{ min: '500000000000', max: '25000000000000' }] }] });
    expect(wireBody(x.body!)).not.toHaveProperty('amounts');
    // "Entering $500-$3000 in CAD still means the offer sells XMR."
    const f = validate(one({ unit: 'fiat', currency: 'CAD', min: '$500', max: '$3,000' }));
    expect(f.body).toMatchObject({ side: 'sell', amountUnit: 'fiat', currencies: [{ currency: 'CAD', bands: [{ min: '500', max: '3000' }] }] });
  });

  it('reads XMR to the atomic unit and refuses more places, fiat signs and junk', () => {
    expect(parseXmrAmount('1.000000000001')).toBe(1_000_000_000_001n);
    expect(parseXmrAmount('.5')).toBe(500_000_000_000n);
    expect(parseXmrAmount('1,000 XMR')).toBe(1000n * XMR);
    for (const bad of ['1.0000000000001', '$50', '', '1e3', '-1', '1.2.3']) expect(parseXmrAmount(bad), bad).toBeNull();
    const rows = (f: FormState) => validate(f).errors.bands?.['USD']?.rows[1];
    expect(rows(one({ min: '$50', max: '2' }))?.min).toBe(XMR_AMOUNT_ERROR);
    expect(rows(one({ min: '3', max: '2' }))?.min).toBe("The smallest trade can't be more than the largest.");
  });

  it('keeps the unit in the draft; a draft from before the switch is fiat', () => {
    const s = memoryStorage();
    saveDraft(s, one({ unit: 'xmr', min: '1', max: '2' }));
    expect(loadDraft(s)?.unit).toBe('xmr');
    // The single-offer form's draft (before J-16), without a unit.
    const old = { side: 'sell', methodId: 'ZELLE', currency: 'USD', marginSide: 'above', marginPct: '0.5', min: '$50', max: '$2,000', terms: '', minTrades: null, country: '' };
    s.setItem('x2f.post-draft', JSON.stringify(old));
    expect(loadDraft(s)?.unit).toBe('fiat');
    s.setItem('x2f.post-draft', JSON.stringify({ ...old, unit: 'btc' }));
    expect(loadDraft(s)).toBeNull();
    s.setItem('x2f.post-draft', JSON.stringify({ v: 2, ...one(), unit: 'btc' }));
    expect(loadDraft(s)).toBeNull();
  });

  it('shows one amount in the other unit at your price', () => {
    const at = { currency: 'USD', centsPerXmr: 33_155n };
    expect(otherUnit(500_000_000_000n, 'xmr', 'USD', at)).toBe('≈ $165.78');
    expect(otherUnit(50_000n, 'fiat', 'USD', at)).toBe('≈ 1.508068 XMR');
  });

  it('the switch: XMR first and chosen by default; tapping the currency swaps; the arrows move the choice', () => {
    let unit: 'xmr' | 'fiat' = 'xmr';
    const ui = () => <UnitSwitch box="Smallest trade" currency="CAD" unit={unit} onChange={(u) => (unit = u)} />;
    const r = render(ui());
    const group = r.host.querySelector('[role="radiogroup"]')!;
    expect(group.getAttribute('aria-label')).toBe('Smallest trade unit');
    const [xmr, cad] = [...group.querySelectorAll('[role="radio"]')] as HTMLButtonElement[];
    expect([xmr!.textContent, cad!.textContent]).toEqual(['XMR', 'CAD']);
    expect([xmr!.getAttribute('aria-checked'), cad!.getAttribute('aria-checked')]).toEqual(['true', 'false']);
    fire(cad!, new MouseEvent('click', { bubbles: true }));
    expect(unit).toBe('fiat');
    r.rerender(ui());
    expect(cad!.getAttribute('aria-checked')).toBe('true');
    fire(cad!, new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(unit).toBe('xmr');
  });
});

describe('switching the unit on Post an offer converts every band at its own price (review H1)', () => {
  const RATE = 1_500_033n; // CA$15,000.33 per XMR
  const at = { currency: 'CAD', centsPerXmr: RATE };
  const CAD = { CAD: RATE };
  // At market +0%, the band's price is the market.
  const fiatForm = one({ unit: 'fiat', currency: 'CAD', min: '500', max: '3000' });

  it('fiat to XMR: the boxes no longer read 500 and 3000; the min rounds up, the max down', () => {
    const x = switchUnit(fiatForm, 'xmr', CAD);
    expect(x.unit).toBe('xmr');
    const [min, max] = boxes(x);
    expect(min).not.toBe('500');
    expect(max).not.toBe('3000');
    expect(fiatCents(parseXmrAmount(min)!, at)).toBeGreaterThanOrEqual(50_000n);
    expect(fiatCents(parseXmrAmount(max)!, at)).toBeLessThanOrEqual(300_000n);
    expect([min, max]).toEqual(['0.033333', '0.199995']);
  });

  it('XMR to fiat: whole units (O-018), the min rounded up, the max down; each band at its own margin', () => {
    const f = switchUnit(one({ unit: 'xmr', currency: 'CAD', min: '0.1', max: '0.5' }), 'fiat', CAD);
    expect(f.unit).toBe('fiat');
    expect(boxes(f)).toEqual(['1501', '7500']);
    expect(boxes(switchUnit(one({ unit: 'xmr', min: '1', max: '2' }), 'fiat', { USD: 33_000n }))).toEqual(['330', '660']);
    // +10% on $330.00 is $363.00.
    expect(boxes(switchUnit(one({ unit: 'xmr', min: '1', max: '2', marginPct: '10' }), 'fiat', { USD: 33_000n }))).toEqual(['363', '726']);
  });

  it('equal boxes never come out with the smallest above the largest (review 2, M2)', () => {
    // CA$500 / CA$500 at 1,500,033: the min rounds up to 0.033333, the max down to 0.033332; the largest is set to the smallest.
    const x = switchUnit(one({ unit: 'fiat', currency: 'CAD', min: '500', max: '500' }), 'xmr', CAD);
    expect(boxes(x)).toEqual(['0.033333', '0.033333']);
    expect(validate(x).errors.bands).toBeUndefined();
    const f = switchUnit(one({ unit: 'xmr', currency: 'CAD', min: '0.1000001', max: '0.1000001' }), 'fiat', CAD);
    expect(boxes(f)).toEqual(['1501', '1501']);
  });

  it('with no price, the boxes are cleared; the same unit changes nothing', () => {
    expect(switchUnit(fiatForm, 'xmr', { CAD: null })).toMatchObject({ unit: 'xmr', bands: { CAD: [{ min: '', max: '' }] } });
    expect(switchUnit(fiatForm, 'xmr', {})).toMatchObject({ unit: 'xmr', bands: { CAD: [{ min: '', max: '' }] } });
    expect(switchUnit(fiatForm, 'fiat', CAD)).toBe(fiatForm);
  });

  it('an empty or unreadable box is left empty', () => {
    const x = switchUnit(one({ unit: 'fiat', currency: 'CAD', min: '', max: 'abc' }), 'xmr', CAD);
    expect(boxes(x)).toEqual(['', '']);
  });
});

describe('XMR amounts the API can store (review L2)', () => {
  it('allows at most 8 whole digits (the API keeps 20 digits of atomic units)', () => {
    expect(parseXmrAmount('99999999.999999999999')).toBe(99_999_999_999_999_999_999n);
    expect(parseXmrAmount('100000000')).toBeNull();
  });

  it('a draft from before the choices with minTrades 0 (the old default) loads as No minimum', () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } as unknown as Storage;
    s.setItem('x2f.post-draft', JSON.stringify({ side: 'sell', methodId: 'ZELLE', currency: 'USD', marginSide: 'above', marginPct: '0.5', unit: 'xmr', min: '50', max: '2000', terms: '', minTrades: 0, country: '' }));
    expect(loadDraft(s)).toMatchObject({ methods: [{ methodId: 'ZELLE' }], bands: { USD: [{ min: '50', minTrades: null }] } });
  });
});
