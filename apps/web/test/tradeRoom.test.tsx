// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import type { TradeView } from '../src/api/trade.js';
import { publicName } from '../src/api/trade.js';
import { registerTradeScreen, screenFor, type TradeScreen } from '../src/screens/trade/TradeRoom.js';

const A: TradeScreen = () => null;
const B: TradeScreen = () => null;
const C: TradeScreen = () => null;

const view = (over: Partial<TradeView> = {}): TradeView =>
  ({ role: 'seller', state: 'secured', payBy: '2026-10-25T12:00:00.000Z', ...over }) as TradeView;

const undo: (() => void)[] = [];
const reg = (...a: Parameters<typeof registerTradeScreen>) => undo.push(registerTradeScreen(...a));
afterEach(() => {
  for (const u of undo.splice(0)) u();
});

describe('trade-room slots', () => {
  it('picks the screen by role and state', () => {
    reg({ owner: 'x', role: 'seller', states: ['secured'], screen: A });
    reg({ owner: 'y', role: 'buyer', states: ['secured', 'securing'], screen: B });
    expect(screenFor(view(), 0)).toBe(A);
    expect(screenFor(view({ role: 'buyer', state: 'securing' }), 0)).toBe(B);
    expect(screenFor(view({ state: 'paid' }), 0)).toBeNull();
  });

  it('a guarded slot wins while its guard holds (e.g. past payBy by the server clock)', () => {
    reg({ owner: 'x', role: 'seller', states: ['secured'], screen: A });
    reg({ owner: 'y', role: 'seller', states: ['secured'], when: (v, now) => now >= Date.parse(v.payBy!), screen: B });
    const payBy = Date.parse('2026-10-25T12:00:00.000Z');
    expect(screenFor(view(), payBy - 1)).toBe(A);
    expect(screenFor(view(), payBy)).toBe(B);
  });

  it("'any' matches both roles", () => {
    reg({ owner: 'x', role: 'any', states: ['disputed'], screen: C });
    expect(screenFor(view({ state: 'disputed' }), 0)).toBe(C);
    expect(screenFor(view({ role: 'buyer', state: 'disputed' }), 0)).toBe(C);
  });

  it('two unguarded slots for the same role and state are refused, naming the owner', () => {
    reg({ owner: 'Task 23', role: 'seller', states: ['secured'], screen: A });
    expect(() => registerTradeScreen({ owner: 'Task 25', role: 'seller', states: ['secured'], screen: B })).toThrow(/Task 23/);
    expect(() => registerTradeScreen({ owner: 'Task 27', role: 'any', states: ['secured'], screen: B })).toThrow(/Task 23/);
  });

  it('refuses unknown or missing states', () => {
    expect(() => registerTradeScreen({ owner: 'x', role: 'buyer', states: [], screen: A })).toThrow();
    expect(() => registerTradeScreen({ owner: 'x', role: 'buyer', states: ['nope' as 'paid'], screen: A })).toThrow(/unknown/);
  });

  it('unregistering frees the slot', () => {
    const off = registerTradeScreen({ owner: 'x', role: 'buyer', states: ['paid'], screen: A });
    off();
    reg({ owner: 'y', role: 'buyer', states: ['paid'], screen: B });
    expect(screenFor(view({ role: 'buyer', state: 'paid' }), 0)).toBe(B);
  });
});

describe('publicName', () => {
  it('reads the display name only (FU-A)', () => {
    expect(publicName({ displayName: 'Mira.K_' })).toBe('Mira.K_');
  });
});
