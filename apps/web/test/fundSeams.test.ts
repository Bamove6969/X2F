// Pure checks behind TradeFund (Task 22): the integrity guard, the amount to send, the view parser.
import { describe, expect, it } from 'vitest';
import { parseTradeView, TradeShapeError } from '../src/api/trade.js';
import { amountToSend, integrityFailed } from '../src/screens/trade/seams.js';

const ADDRESS = '4' + 'A'.repeat(94);

describe('integrityFailed', () => {
  it('runs the amount guard even before this device has its deal (review 2026-10-27, Minor 5)', () => {
    const e = { error: null, escrowAddress: ADDRESS, deal: null } as const;
    expect(integrityFailed(e, { poster: 'buyer', funding: { escrowAddress: ADDRESS, sellerFundsAtomic: '1.25' } })).toBe(true);
    expect(integrityFailed(e, { poster: 'buyer', funding: { escrowAddress: ADDRESS, sellerFundsAtomic: '' } })).toBe(true);
    expect(integrityFailed(e, { poster: 'buyer', funding: { escrowAddress: ADDRESS, sellerFundsAtomic: '1'.repeat(31) } })).toBe(true);
    expect(integrityFailed(e, { poster: 'buyer', funding: { escrowAddress: ADDRESS, sellerFundsAtomic: '1250000000000' } })).toBe(false);
  });
});

describe('amountToSend', () => {
  const funds = 1_250_000_000_000n;
  it('is the whole funding while nothing has arrived anywhere', () => {
    expect(amountToSend({ fundsAtomic: funds, receivedAtomic: null }, 0n)).toBe(funds);
    expect(amountToSend({ fundsAtomic: funds, receivedAtomic: 0n }, 0n)).toBe(funds);
  });
  it("is the remainder of this device's own reading", () => {
    expect(amountToSend({ fundsAtomic: funds, receivedAtomic: 1_000_000_000_000n }, 0n)).toBe(250_000_000_000n);
    expect(amountToSend({ fundsAtomic: funds, receivedAtomic: 1_000_000_000_000n }, 1_000_000_000_000n)).toBe(250_000_000_000n);
  });
  it('is nothing while only the API says part arrived, or once the device reading covers the funding', () => {
    expect(amountToSend({ fundsAtomic: funds, receivedAtomic: null }, 1_000_000_000_000n)).toBeNull();
    expect(amountToSend({ fundsAtomic: funds, receivedAtomic: 0n }, 1_000_000_000_000n)).toBeNull();
    expect(amountToSend({ fundsAtomic: funds, receivedAtomic: funds }, 0n)).toBeNull();
  });
});

describe('parseTradeView (review 2026-10-27, Minor 5)', () => {
  const view = {
    amountAtomic: '1250000000000',
    fiatCents: '41250',
    lockedRate: { currency: 'USD', centsPerXmr: '33000' },
    maxFiatCents: '50000',
    grown: null,
    receivedAtomic: '0',
    funding: { sellerFundsAtomic: '1250000000000', escrowAddress: ADDRESS, uri: null, walletApp: null },
  };
  it('accepts plain digit strings and returns the view', () => {
    expect(parseTradeView(view)).toBe(view);
    expect(parseTradeView({ ...view, fee: { atomic: '0' }, grown: { at: 'x', fromAtomic: '1', fromFiatCents: '2' }, funding: null })).toBeDefined();
  });
  for (const [name, bad] of [
    ['non-digits', { receivedAtomic: '1_000' }],
    ['a sign', { fiatCents: '+1' }],
    ['a decimal point', { amountAtomic: '1.0' }],
    ['empty', { maxFiatCents: '' }],
    ['31 digits', { amountAtomic: '1'.repeat(31) }],
    ['a number instead of a string', { receivedAtomic: 0 }],
    ['a bad fee', { fee: { atomic: 'free' } }],
    ['a bad grown', { grown: { at: 'x', fromAtomic: 'a', fromFiatCents: '2' } }],
    ['a bad funding amount', { funding: { ...view.funding, sellerFundsAtomic: '0x10' } }],
    ['a bad rate', { lockedRate: { currency: 'USD', centsPerXmr: 'NaN' } }],
    ['no body', null],
  ] as [string, unknown][]) {
    it(`refuses ${name} with TradeShapeError`, () => {
      const v = bad !== null && typeof bad === 'object' ? { ...view, ...bad } : bad;
      expect(() => parseTradeView(v)).toThrow(TradeShapeError);
    });
  }
});
