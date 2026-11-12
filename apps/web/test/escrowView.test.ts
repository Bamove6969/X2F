// instr-hash review M1 and I1: how the escrow runtime reads the view's payment instructions, and
// that no screen can read them from the (unsigned) TradeView type at all.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { TradeView } from '../src/api/trade.js';
import { parseTradeView } from '../src/escrow/adapters.js';

const BASE = {
  role: 'buyer', state: 'secured', poster: 'seller', amountAtomic: '1250000000000',
  lockedRate: { currency: 'USD', centsPerXmr: '33000' }, maxFiatCents: '50000', payWindowMin: 90, methodId: 'ZELLE',
};

describe('parseTradeView: payment instructions (review M1)', () => {
  it('a string is the text; null or a missing key is none; anything else is malformed, not none', () => {
    expect(parseTradeView({ ...BASE, paymentInstructions: 'Zelle to x' })).toMatchObject({ paymentInstructions: 'Zelle to x', instructionsMalformed: false });
    expect(parseTradeView({ ...BASE, paymentInstructions: '' })).toMatchObject({ paymentInstructions: '', instructionsMalformed: false });
    expect(parseTradeView({ ...BASE, paymentInstructions: null })).toMatchObject({ paymentInstructions: null, instructionsMalformed: false });
    expect(parseTradeView(BASE)).toMatchObject({ paymentInstructions: null, instructionsMalformed: false });
    for (const bad of [42, false, true, {}, ['x'], 0]) {
      expect(parseTradeView({ ...BASE, paymentInstructions: bad }), JSON.stringify(bad)).toMatchObject({ paymentInstructions: null, instructionsMalformed: true });
    }
  });
});

describe('parseTradeView: the 1000-character limit (re-verify R2)', () => {
  it('text over 1000 characters (code points, as the column counts them) is malformed; 1000 is fine', () => {
    expect(parseTradeView({ ...BASE, paymentInstructions: 'x'.repeat(1000) })).toMatchObject({ paymentInstructions: 'x'.repeat(1000), instructionsMalformed: false });
    expect(parseTradeView({ ...BASE, paymentInstructions: 'x'.repeat(1001) })).toMatchObject({ paymentInstructions: null, instructionsMalformed: true });
    expect(parseTradeView({ ...BASE, paymentInstructions: 'x'.repeat(5_000_000) })).toMatchObject({ paymentInstructions: null, instructionsMalformed: true });
    // 1000 astral characters are 2000 UTF-16 units but 1000 characters in Postgres: allowed.
    const astral = '\u{1F600}'.repeat(1000);
    expect(astral.length).toBe(2000);
    expect(parseTradeView({ ...BASE, paymentInstructions: astral })).toMatchObject({ paymentInstructions: astral, instructionsMalformed: false });
    expect(parseTradeView({ ...BASE, paymentInstructions: `${astral}x` })).toMatchObject({ paymentInstructions: null, instructionsMalformed: true });
  });
});

describe('TradeView has no payment instructions (review I1)', () => {
  it('a screen cannot read them from the API view type', () => {
    const v = {} as TradeView;
    // @ts-expect-error review I1: the field is not on the screens' TradeView type (the escrow runtime parses `unknown`)
    expect(v.paymentInstructions).toBeUndefined();
  });
});

// Re-verify R3 (instr-hash): the dispute screen (a route of its own, outside the trade room) names
// the method from the bundled catalog by id, never from the API's method list.
describe('the dispute screen asks the API for no method names (re-verify R3)', () => {
  it('DisputeScreen and the dispute api do not fetch /v1/methods', () => {
    const screen = readFileSync(new URL('../src/screens/dispute/DisputeScreen.tsx', import.meta.url), 'utf8');
    const api = readFileSync(new URL('../src/screens/dispute/api.ts', import.meta.url), 'utf8');
    expect(screen).not.toMatch(/fetchMethodName/);
    expect(api).not.toMatch(/\/v1\/methods/);
  });
});
