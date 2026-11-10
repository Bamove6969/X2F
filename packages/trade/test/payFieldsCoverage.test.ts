import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PAY_FIELDS, payFieldsFor, payeeGivesNothing } from '../src/index.js';

/** The catalogue (data/payment-methods.json): every method a trade can carry. */
const CATALOG = (JSON.parse(readFileSync(new URL('../../../data/payment-methods.json', import.meta.url), 'utf8')) as { methods: { id: string }[] }).methods.map((m) => m.id);

/** A key's camelCase words, lower case ("cardPin" is ["card", "pin"]). */
const words = (key: string): string[] => key.split(/(?=[A-Z])/).map((w) => w.toLowerCase());

// Owner order 10 Nov 2026 and the research brief rule 4: nothing that lets someone take money, and
// no personal tax data (lead decisions, 10 Nov 2026), ever as a box.
const BAD_LABEL = /password|passcode|passphrase|\bpin\b|\bcvv\b|\bcvc\b|\bcvv2\b|security code|expir|valid thru|\btax\b|codice fiscale|\brnokpp\b|\bnric\b|\bssn\b|social security|online banking|log ?in/i;
const BAD_WORDS = new Set(['password', 'passcode', 'pin', 'cvv', 'cvc', 'expiry', 'expiration', 'exp', 'tax', 'nric', 'ssn', 'login']);

describe('the payee fields table covers the catalogue (owner order, 10 Nov 2026)', () => {
  it('the catalogue is the 127 methods the research covered', () => {
    expect(CATALOG.length).toBe(127);
    expect(new Set(CATALOG).size).toBe(CATALOG.length);
  });

  it('every catalogue method has its own row: boxes, or explicitly nothing to send', () => {
    const missing = CATALOG.filter((id) => !Object.prototype.hasOwnProperty.call(PAY_FIELDS, id));
    expect(missing).toEqual([]);
    for (const id of CATALOG) {
      const row = PAY_FIELDS[id]!;
      expect(row.source.length, id).toBeGreaterThan(0);
      if (row.payeeGivesNothing === true) {
        expect(row.fields, id).toEqual([]);
        expect(payFieldsFor(id), id).toEqual([]);
        expect(payeeGivesNothing(id), id).toBe(true);
      } else {
        expect(row.fields.length, id).toBeGreaterThan(0);
        expect(payeeGivesNothing(id), id).toBe(false);
      }
    }
  });

  it('every row is from the catalogue (no stray ids)', () => {
    expect(Object.keys(PAY_FIELDS).filter((id) => !CATALOG.includes(id))).toEqual([]);
  });

  it('no box asks for a password, PIN, CVV, expiry date or tax ID', () => {
    for (const [id, row] of Object.entries(PAY_FIELDS)) {
      for (const f of row.fields) {
        expect(BAD_LABEL.test(f.label), `${id}.${f.key} label "${f.label}"`).toBe(false);
        expect(words(f.key).filter((w) => BAD_WORDS.has(w)), `${id}.${f.key}`).toEqual([]);
      }
    }
  });

  it('every one-of group has at least two boxes', () => {
    for (const [id, row] of Object.entries(PAY_FIELDS)) {
      const groups = new Map<string, number>();
      for (const f of row.fields) if (typeof f.need === 'object') groups.set(f.need.oneOf, (groups.get(f.need.oneOf) ?? 0) + 1);
      for (const [g, n] of groups) expect(n, `${id} group ${g}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('every row has unique camelCase keys', () => {
    for (const [id, row] of Object.entries(PAY_FIELDS)) {
      const keys = row.fields.map((f) => f.key);
      expect(new Set(keys).size, id).toBe(keys.length);
      for (const f of row.fields) expect(/^[a-z][a-zA-Z0-9]*$/.test(f.key), `${id}.${f.key}`).toBe(true);
    }
  });
});
