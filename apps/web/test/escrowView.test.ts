// instr-hash review M1 and I1: how the escrow runtime reads the view's payment instructions, and
// that no screen can read them from the (unsigned) TradeView type at all.
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

describe('TradeView has no payment instructions (review I1)', () => {
  it('a screen cannot read them from the API view type', () => {
    const v = {} as TradeView;
    // @ts-expect-error review I1: the field is not on the screens' TradeView type (the escrow runtime parses `unknown`)
    expect(v.paymentInstructions).toBeUndefined();
  });
});
