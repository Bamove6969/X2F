// @vitest-environment happy-dom
// The device's own record of what the person confirmed on the quote (Task 12's ConfirmedTrade),
// kept in this tab until the trade room has started the escrow with it: a reload of the room before
// then must still find it (history state does not survive a reload).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmedKey, readConfirmed, storeConfirmed, type ConfirmedTrade } from '../src/screens/quote/confirmed.js';

const C: ConfirmedTrade = {
  role: 'buyer',
  ownAddress: '4AAAAk3Fz0',
  deal: { poster: 'seller', takeAmountAtomic: 1_250_000_000_000n, currency: 'USD', centsPerXmr: 33_000n, maxFiatCents: 150_000n },
};

beforeEach(() => sessionStorage.clear());

describe('the confirmed record', () => {
  it('reads back exactly what was stored, bigints included, keyed by trade code', () => {
    expect(storeConfirmed('K7M2-9QXA-4FTR-8WPN', C)).toBe(true);
    expect(sessionStorage.getItem(confirmedKey('K7M2-9QXA-4FTR-8WPN'))).not.toBeNull();
    expect(readConfirmed('K7M2-9QXA-4FTR-8WPN')).toEqual(C);
    expect(readConfirmed('OTHER-CODE')).toBeNull();
  });

  it('refuses a garbled or incomplete record', () => {
    sessionStorage.setItem(confirmedKey('X'), '{not json');
    expect(readConfirmed('X')).toBeNull();
    sessionStorage.setItem(confirmedKey('X'), JSON.stringify({ role: 'buyer', ownAddress: '', deal: {} }));
    expect(readConfirmed('X')).toBeNull();
    sessionStorage.setItem(confirmedKey('X'), JSON.stringify({ role: 'buyer', ownAddress: '4A', deal: { poster: 'seller', takeAmountAtomic: '12x', currency: 'USD', centsPerXmr: '1', maxFiatCents: '1' } }));
    expect(readConfirmed('X')).toBeNull();
  });

  it('without storage nothing is kept and nothing is read', () => {
    const spy = vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(storeConfirmed('X', C)).toBe(false);
    expect(readConfirmed('X')).toBeNull();
    spy.mockRestore();
  });
});
