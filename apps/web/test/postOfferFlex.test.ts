// J-16 (Plan 3 Tasks 34/35, rebuilt from claude2's Task 34 web with the owner's numbers): PostOffer's
// currencies, bands and payment methods. Owner Q23 (O-009: 3 bands per currency; O-010: 5 payment
// types), Q8 (5 currencies), O-018 (whole units, the next band at +1), Q20/F3 (O-015: a band on the
// same amounts needs another condition; the lead's list pending p11-60), Q27 (O-017: No minimum, 5,
// 10, 25, 50), Q28/Q24 (O-019/O-020: the currency picker's order, flags and no-rate tag).
import { describe, expect, it } from 'vitest';
import { parseCurrencies } from '../src/screens/post/api.js';
import {
  DEFAULT_FORM,
  MAX_BANDS,
  MAX_CURRENCIES,
  MAX_METHODS,
  MIN_TRADES_OPTIONS,
  POST_COPY,
  addBand,
  addCurrency,
  addMethod,
  adjustText,
  canSwitchUnit,
  currencyLabel,
  currencyOptions,
  removeBand,
  removeCurrency,
  setBand,
  setMethod,
  stepAdjust,
  switchUnit,
  validate,
  type FormState,
} from '../src/screens/post/offerForm.js';

/** USD in fiat with one band 200-500 at +1%, and Zelle. */
function base(): FormState {
  let f: FormState = { ...DEFAULT_FORM, unit: 'fiat' };
  f = setBand(f, 'USD', 1, { min: '200', max: '500', marginPct: '1' });
  return addMethod(f, 'ZELLE');
}

const usdBands = (f: FormState) => f.bands['USD']!;

describe('the owner numbers', () => {
  it('3 bands per currency, 5 payment methods, 5 currencies', () => {
    expect([MAX_BANDS, MAX_METHODS, MAX_CURRENCIES]).toEqual([3, 5, 5]);
    let f = base();
    for (let i = 0; i < 5; i++) f = addBand(f, 'USD');
    expect(usdBands(f)).toHaveLength(3);
    for (const m of ['A', 'B', 'C', 'D', 'E', 'F']) f = addMethod(f, m);
    expect(f.methods.map((m) => m.methodId)).toEqual(['ZELLE', 'A', 'B', 'C', 'D']);
    for (const c of ['EUR', 'GBP', 'CAD', 'BRL', 'INR']) f = addCurrency(f, c);
    expect(f.currencies).toEqual(['USD', 'EUR', 'GBP', 'CAD', 'BRL']);
    expect(f.bands['INR']).toBeUndefined();
  });

  it('minimum completed trades per band: No minimum (the default), 5, 10, 25, 50 (O-017)', () => {
    expect(MIN_TRADES_OPTIONS.map((o) => o.value)).toEqual([null, 5, 10, 25, 50]);
    expect(usdBands(DEFAULT_FORM)[0]!.minTrades).toBeNull();
  });
});

describe('bands', () => {
  it('Add a band starts one unit after the highest end, with the last band\'s price and rule (O-018)', () => {
    let f = setBand(base(), 'USD', 1, { minTrades: 10 });
    f = addBand(f, 'USD');
    expect(usdBands(f)[1]).toMatchObject({ min: '501', max: '', marginSide: 'above', marginPct: '1', minTrades: 10 });
    expect(usdBands(f)[1]!.key).not.toBe(usdBands(f)[0]!.key);
  });

  it('posts bands that follow on, each with its own margin and rule', () => {
    let f = addBand(base(), 'USD');
    const k = usdBands(f)[1]!.key;
    f = setBand(f, 'USD', k, { max: '800', marginSide: 'below', marginPct: '0.5', minTrades: 5 });
    const r = validate(f);
    expect(r.errors).toEqual({});
    expect(r.body?.currencies).toEqual([
      { currency: 'USD', bands: [{ min: '200', max: '500', marginBps: 100, minTrades: null }, { min: '501', max: '800', marginBps: -50, minTrades: 5 }] },
    ]);
  });

  it('bands are whole units: an amount with cents is refused on its box', () => {
    const r = validate(setBand(base(), 'USD', 1, { max: '500.50' }));
    expect(r.errors.bands?.['USD']?.rows[1]?.max).toBe('Whole units only, no cents.');
  });

  it('a gap between bands is refused, naming where the next band starts', () => {
    let f = addBand(base(), 'USD');
    const k = usdBands(f)[1]!.key;
    f = setBand(f, 'USD', k, { min: '600', max: '800' });
    expect(validate(f).errors.bands?.['USD']?.all).toBe(POST_COPY.bandsGap('$501'));
  });

  it('a second band on the same amounts needs another price or another minimum (lead default, p11-60)', () => {
    let f = addBand(base(), 'USD');
    const k = usdBands(f)[1]!.key;
    f = setBand(f, 'USD', k, { min: '200', max: '500' });
    expect(validate(f).errors.bands?.['USD']?.all).toBe(POST_COPY.bandsSame);
    expect(validate(setBand(f, 'USD', k, { minTrades: 25 })).errors).toEqual({});
    expect(validate(setBand(f, 'USD', k, { marginPct: '0.5' })).errors).toEqual({});
  });

  it('a currency keeps at least one band', () => {
    const f = base();
    expect(removeBand(f, 'USD', 1)).toBe(f);
    const two = addBand(f, 'USD');
    expect(usdBands(removeBand(two, 'USD', 1)).map((b) => b.min)).toEqual(['501']);
  });

  it('in XMR a currency has one band: no Add a band, and the switch to XMR waits for one band each (lead default)', () => {
    const x = setBand({ ...DEFAULT_FORM }, 'USD', 1, { min: '1', max: '2' });
    expect(addBand(x, 'USD')).toBe(x);
    const two = addBand(base(), 'USD');
    expect(canSwitchUnit(two, 'xmr')).toBe(false);
    expect(switchUnit(two, 'xmr', { USD: 33_000n })).toBe(two);
    expect(canSwitchUnit(two, 'fiat')).toBe(true);
    expect(canSwitchUnit(base(), 'xmr')).toBe(true);
  });
});

describe('payment methods', () => {
  it('a price change in steps of 0.5%, −5% to +10%, shown as the board', () => {
    expect([stepAdjust(0, 1), stepAdjust(0, -1), stepAdjust(1000, 1), stepAdjust(-500, -1)]).toEqual([50, -50, 1000, -500]);
    expect([adjustText(0), adjustText(200), adjustText(-50)]).toEqual(['No change', '+2.0%', '−0.5%']);
  });

  it('instructions shared, or per currency where they differ (owner Q3)', () => {
    let f = addCurrency(base(), 'EUR');
    f = setBand(f, 'EUR', f.bands['EUR']![0]!.key, { min: '100', max: '900' });
    f = setMethod(f, 'ZELLE', { instructions: ' pay to z@example.test ' });
    expect(validate(f).body?.methods).toEqual([{ methodId: 'ZELLE', adjustBps: 0, instructions: 'pay to z@example.test' }]);
    f = setMethod(f, 'ZELLE', { same: false, byCurrency: { USD: 'routing 1', EUR: 'IBAN 2' } });
    expect(validate(f).body?.methods).toEqual([{ methodId: 'ZELLE', adjustBps: 0, instructions: '', instructionsByCurrency: { USD: 'routing 1', EUR: 'IBAN 2' } }]);
    // Removing a currency drops its own text; one currency left makes its text the shared one (Task 34 review I1/I2).
    const back = removeCurrency(f, 'EUR');
    expect(back.methods[0]).toMatchObject({ same: true, instructions: 'routing 1', byCurrency: {} });
    expect(back.bands['EUR']).toBeUndefined();
  });

  it('needs one method; a band margin plus a method change past 50% is refused', () => {
    const none = { ...base(), methods: [] };
    expect(validate(none).errors.methods).toBe(POST_COPY.pickMethod);
    const over = setMethod(setBand(base(), 'USD', 1, { marginPct: '45' }), 'ZELLE', { adjustBps: 1000 });
    expect(validate(over).errors.methods).toBe(POST_COPY.overLimit);
    expect(validate(setMethod(over, 'ZELLE', { adjustBps: 500 })).errors).toEqual({});
  });

  it('needs one currency', () => {
    expect(validate(removeCurrency(base(), 'USD')).errors.currencies).toBe(POST_COPY.pickCurrency);
  });
});

describe('the currency picker (owner Q28, Q24)', () => {
  it('the lists\' currencies in the owner\'s order (top six first, then A-Z), each with its flag', () => {
    const all = currencyOptions(null);
    expect(all.map((c) => c.code)).toEqual(['USD', 'EUR', 'GBP', 'CAD', 'BRL', 'INR']);
    expect(all.every((c) => c.available)).toBe(true);
    expect(currencyLabel(all[0]!)).toBe('\u{1F1FA}\u{1F1F8} USD');
  });

  it('a currency with no rate stays, marked, and is back the moment its rate is', () => {
    const loaded = parseCurrencies({ currencies: [{ code: 'USD', flag: 'x', available: true }, { code: 'CAD', flag: 'y', available: false }] });
    const cad = currencyOptions(loaded).find((c) => c.code === 'CAD')!;
    expect(cad.available).toBe(false);
    expect(currencyLabel(cad)).toBe(`\u{1F1E8}\u{1F1E6} CAD · ${POST_COPY.noRate}`);
    expect(currencyOptions(loaded, (c) => c === 'CAD').find((c) => c.code === 'CAD')!.available).toBe(true);
    expect(() => parseCurrencies({ currencies: [{ code: 'usd', flag: 'x', available: true }] })).toThrow();
    expect(() => parseCurrencies([])).toThrow();
  });
});
