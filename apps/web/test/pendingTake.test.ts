// @vitest-environment happy-dom
// The single-use pending-take marker: a `resume=` link alone never takes an offer.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PENDING_TAKE_KEY, PENDING_TAKE_MS, claimTake, rememberTake } from '../src/screens/quote/pendingTake.js';

const P = { offerId: 'offer-ghost', unit: 'fiat' as const, text: '412.50' };

beforeEach(() => sessionStorage.clear());

describe('pending take marker', () => {
  it('matches once, for the same offer, amount and nonce, then is gone', () => {
    const n = rememberTake(P, 1_000)!;
    expect(n).toMatch(/^[0-9a-f]{32}$/);
    expect(claimTake(P, n, 1_001)).toBe(true);
    expect(sessionStorage.getItem(PENDING_TAKE_KEY)).toBeNull();
    expect(claimTake(P, n, 1_002)).toBe(false);
  });

  it('no marker, another offer, amount, unit or nonce, or an expired marker: false, and the marker is cleared', () => {
    expect(claimTake(P, 'a'.repeat(32))).toBe(false);
    const bad: [Partial<typeof P>, string | null, number][] = [
      [{ offerId: 'offer-other' }, null, 1],
      [{ text: '412.51' }, null, 1],
      [{ unit: 'xmr' }, null, 1],
      [{}, 'b'.repeat(32), 1],
      [{}, null, PENDING_TAKE_MS],
    ];
    for (const [change, nonce, later] of bad) {
      const n = rememberTake(P, 0)!;
      expect(claimTake({ ...P, ...change }, nonce ?? n, later)).toBe(false);
      expect(sessionStorage.getItem(PENDING_TAKE_KEY)).toBeNull();
    }
  });

  it('each marker gets a fresh nonce, and a new one replaces the old', () => {
    const a = rememberTake(P)!;
    const b = rememberTake(P)!;
    expect(a).not.toBe(b);
    expect(claimTake(P, a)).toBe(false);
  });

  it('a garbled marker is refused', () => {
    sessionStorage.setItem(PENDING_TAKE_KEY, '{not json');
    expect(claimTake(P, 'a'.repeat(32))).toBe(false);
    sessionStorage.setItem(PENDING_TAKE_KEY, JSON.stringify({ ...P, nonce: '', expiresAt: Date.now() + 1000 }));
    expect(claimTake(P, '')).toBe(false);
  });

  it('without storage nothing is remembered and nothing resumes', () => {
    const spy = vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(rememberTake(P)).toBeNull();
    expect(claimTake(P, 'a'.repeat(32))).toBe(false);
    spy.mockRestore();
  });
});
