import { describe, expect, it } from 'vitest';
import {
  PAY_DETAILS_V,
  PAY_FIELD_MAX_CHARS,
  PAY_FIELDS,
  PayDetailsError,
  checkPayDetails,
  parsePayDetails,
  payFieldsFor,
  renderPayDetailsText,
  type PayDetailsPayload,
} from '../src/index.js';

/** The research pack's Part 2 rows (research/research-pack-2026-11-09.md), by catalog id, plus ACH from the profiles file. */
const RESEARCHED = [
  'ZELLE',
  'INTERAC_E_TRANSFER',
  'SEPA',
  'SEPA_INSTANT',
  'TRANSFERWISE',
  'REVOLUT',
  'CASH_APP',
  'PAYPAL',
  'VENMO',
  'FASTER_PAYMENTS',
  'PIX',
  'UPI',
  'PAY_BY_MAIL',
  'ACH_TRANSFER',
];

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return e instanceof PayDetailsError ? `${e.code}:${e.key ?? ''}` : String(e);
  }
};

describe('the payee fields table', () => {
  it('has a row for every researched method, each with unique keys, labels and a source', () => {
    for (const id of RESEARCHED) {
      const spec = PAY_FIELDS[id];
      expect(spec, id).toBeDefined();
      expect(spec!.source.length, id).toBeGreaterThan(0);
      expect(spec!.fields.length, id).toBeGreaterThan(0);
      const keys = spec!.fields.map((f) => f.key);
      expect(new Set(keys).size, id).toBe(keys.length);
      for (const f of spec!.fields) {
        expect(/^[a-z][a-zA-Z0-9]*$/.test(f.key), `${id}.${f.key}`).toBe(true);
        expect(f.label.trim().length, `${id}.${f.key}`).toBeGreaterThan(0);
      }
      // Something must be filled for every method: a required field or a one-of group.
      expect(spec!.fields.some((f) => f.need !== 'no'), id).toBe(true);
    }
  });

  it("Interac (the owner's example, p7-3): full name, plus email or phone, one or the other", () => {
    const f = payFieldsFor('INTERAC_E_TRANSFER');
    expect(f.map((x) => [x.key, x.need])).toEqual([
      ['name', 'yes'],
      ['email', { oneOf: 'contact' }],
      ['phone', { oneOf: 'contact' }],
    ]);
    expect(f.find((x) => x.key === 'email')?.kind).toBe('email');
    expect(f.find((x) => x.key === 'phone')?.kind).toBe('phone');
  });

  it('a method not in the table gets the one free-text box (CUSTOM and the rest of the catalog)', () => {
    for (const id of ['CUSTOM', 'SWISH', 'NOT_A_METHOD']) {
      expect(payFieldsFor(id)).toEqual([{ key: 'details', label: 'Payment details', kind: 'text', need: 'yes' }]);
    }
  });

  it('cash by mail takes a multi-line mailing address', () => {
    expect(payFieldsFor('PAY_BY_MAIL').find((f) => f.key === 'address')?.kind).toBe('postal');
  });
});

describe('checkPayDetails', () => {
  it('keeps the filled fields in table order, trimmed, and drops empty optional ones', () => {
    const got = checkPayDetails('INTERAC_E_TRANSFER', { phone: ' +1 416 555 0100 ', name: 'Jane Doe', email: '' });
    expect(got).toEqual([
      { key: 'name', value: 'Jane Doe' },
      { key: 'phone', value: '+1 416 555 0100' },
    ]);
  });

  it('refuses a missing required field, an empty one-of group, an unknown key, a newline in a one-line box and an overlong value', () => {
    expect(codeOf(() => checkPayDetails('INTERAC_E_TRANSFER', { email: 'j@x.ca' }))).toBe('missing:name');
    expect(codeOf(() => checkPayDetails('INTERAC_E_TRANSFER', { name: 'Jane', email: '  ', phone: '' }))).toBe('one-of:contact');
    expect(codeOf(() => checkPayDetails('INTERAC_E_TRANSFER', { name: 'Jane', email: 'j@x.ca', iban: 'x' }))).toBe('unknown-field:iban');
    expect(codeOf(() => checkPayDetails('INTERAC_E_TRANSFER', { name: 'Jane\nDoe', email: 'j@x.ca' }))).toBe('bad-value:name');
    expect(codeOf(() => checkPayDetails('INTERAC_E_TRANSFER', { name: 'J'.repeat(PAY_FIELD_MAX_CHARS.line + 1), email: 'j@x.ca' }))).toBe('too-long:name');
    expect(codeOf(() => checkPayDetails('PAY_BY_MAIL', { name: 'Jane', address: 'x'.repeat(PAY_FIELD_MAX_CHARS.postal + 1) }))).toBe('too-long:address');
    // Not strings at all.
    expect(codeOf(() => checkPayDetails('INTERAC_E_TRANSFER', { name: 1 as unknown as string, email: 'j@x.ca' }))).toBe('bad-value:name');
  });

  it('a mailing address may span lines, but never more than its box allows', () => {
    const ok = checkPayDetails('PAY_BY_MAIL', { name: 'Jane Doe', address: '12 Main St\nApt 4\nToronto ON  M5V 1A1' });
    expect(ok).toEqual([
      { key: 'name', value: 'Jane Doe' },
      { key: 'address', value: '12 Main St\nApt 4\nToronto ON  M5V 1A1' },
    ]);
    expect(codeOf(() => checkPayDetails('PAY_BY_MAIL', { name: 'Jane', address: Array.from({ length: 9 }, (_, i) => `line ${i}`).join('\n') }))).toBe('bad-value:address');
  });

  it('the free-text box is required for a method outside the table', () => {
    expect(codeOf(() => checkPayDetails('CUSTOM', {}))).toBe('missing:details');
    expect(checkPayDetails('CUSTOM', { details: 'Meet at the station, cash in hand' })).toEqual([{ key: 'details', value: 'Meet at the station, cash in hand' }]);
  });
});

describe('the packaged message', () => {
  const pay: PayDetailsPayload = { v: PAY_DETAILS_V, method: 'INTERAC_E_TRANSFER', fields: [{ key: 'name', value: 'Jane Doe' }, { key: 'email', value: 'jane@example.ca' }] };

  it('renders the same plain text on both sides (the old-client fallback): a title and one "Label: value" line per field', () => {
    expect(renderPayDetailsText(pay)).toBe('Payment details\nFull name: Jane Doe\nEmail: jane@example.ca');
    expect(renderPayDetailsText({ ...pay, fields: [...pay.fields] })).toBe(renderPayDetailsText(pay));
  });

  it('parsePayDetails takes exactly the sealed shape and re-checks the fields', () => {
    expect(parsePayDetails(JSON.parse(JSON.stringify(pay)))).toEqual(pay);
    const bad: unknown[] = [
      null,
      'x',
      { ...pay, v: 2 },
      { ...pay, extra: 1 },
      { v: 1, method: 'INTERAC_E_TRANSFER' },
      { ...pay, method: 7 },
      { ...pay, fields: [] },
      { ...pay, fields: [{ key: 'email', value: 'jane@example.ca' }] }, // no name
      { ...pay, fields: [{ key: 'name', value: 'Jane' }] }, // neither email nor phone
      { ...pay, fields: [{ key: 'name', value: 'Jane' }, { key: 'email', value: 'a@b', extra: 1 }] },
      { ...pay, fields: [{ key: 'email', value: 'a@b' }, { key: 'name', value: 'Jane' }] }, // out of table order
      { ...pay, fields: [{ key: 'name', value: ' Jane' }, { key: 'email', value: 'a@b' }] }, // not trimmed
      { ...pay, fields: [{ key: 'name', value: 'Jane' }, { key: 'name', value: 'Jane' }, { key: 'email', value: 'a@b' }] },
    ];
    for (const b of bad) expect(() => parsePayDetails(b), JSON.stringify(b)).toThrow(PayDetailsError);
  });

  it('a method outside the table packages its one box', () => {
    const custom: PayDetailsPayload = { v: PAY_DETAILS_V, method: 'SWISH', fields: [{ key: 'details', value: '070-123 45 67' }] };
    expect(parsePayDetails(custom)).toEqual(custom);
    expect(renderPayDetailsText(custom)).toBe('Payment details\nPayment details: 070-123 45 67');
  });
});
