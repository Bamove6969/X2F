import { describe, expect, it } from 'vitest';
import { ReplayGuard } from '../src/index.js';

const T = 'K7M2-9QXA-4FTR-8WPN';

describe('ReplayGuard', () => {
  it('accepts strictly increasing seq per sender, independently', () => {
    const g = new ReplayGuard(T);
    expect(g.accept('buyer', 1)).toBe(true);
    expect(g.accept('buyer', 1)).toBe(false);
    expect(g.accept('buyer', 0)).toBe(false);
    expect(g.accept('seller', 1)).toBe(true);
    expect(g.accept('buyer', 7)).toBe(true);
    expect(g.accept('buyer', 6)).toBe(false);
  });

  it('is bound to its trade from construction', () => {
    const g = new ReplayGuard(T);
    expect(g.trade).toBe(T);
    expect(() => new ReplayGuard(undefined as unknown as string)).toThrow(TypeError);
  });

  it('rejects invalid seq and roles without recording them', () => {
    const g = new ReplayGuard(T);
    for (const s of [Number.NaN, -1, -0, 1.5, 2 ** 53, Number.POSITIVE_INFINITY]) expect(g.accept('buyer', s)).toBe(false);
    expect(g.accept('admin' as 'buyer', 1)).toBe(false);
    expect(g.toJSON()).toEqual({ trade: T, seen: {} });
    expect(g.accept('buyer', 0)).toBe(true);
  });

  it('round-trips through JSON and still rejects an old seq', () => {
    const g = new ReplayGuard(T);
    g.accept('buyer', 5);
    g.accept('mod', 2);
    const json = JSON.parse(JSON.stringify(g)) as unknown;
    expect(json).toEqual({ trade: T, seen: { buyer: 5, mod: 2 } });
    const h = ReplayGuard.from(json);
    expect(h.trade).toBe(T);
    expect(h.accept('buyer', 5)).toBe(false);
    expect(h.accept('buyer', 6)).toBe(true);
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['array', []],
    ['string', 'x'],
    ['missing seen', { trade: T }],
    ['missing trade', { seen: {} }],
    ['extra key', { trade: T, seen: {}, x: 1 }],
    ['trade null', { trade: null, seen: {} }],
    ['trade number', { trade: 1, seen: {} }],
    ['trade empty', { trade: '', seen: {} }],
    ['trade too long', { trade: 'x'.repeat(257), seen: {} }],
    ['seen null', { trade: T, seen: null }],
    ['seen array', { trade: T, seen: [] }],
    ['unknown role', { trade: T, seen: { admin: 1 } }],
    ['NaN seq', { trade: T, seen: { buyer: Number.NaN } }],
    ['negative seq', { trade: T, seen: { buyer: -1 } }],
    ['fraction seq', { trade: T, seen: { buyer: 1.5 } }],
    ['string seq', { trade: T, seen: { buyer: '1' } }],
    ['inherited', Object.create({ trade: T, seen: {} }) as unknown],
  ])('from() rejects %s', (_n, v) => {
    expect(() => ReplayGuard.from(v)).toThrow(TypeError);
  });
});
