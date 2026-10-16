import { describe, expect, it } from 'vitest';
import { ReplayGuard } from '../src/index.js';

const T = 'K7M2-9QXA-4FTR-8WPN';

describe('ReplayGuard', () => {
  it('accepts strictly increasing seq per sender, independently', () => {
    const g = new ReplayGuard();
    expect(g.accept('buyer', 1, T)).toBe(true);
    expect(g.accept('buyer', 1, T)).toBe(false);
    expect(g.accept('buyer', 0, T)).toBe(false);
    expect(g.accept('seller', 1, T)).toBe(true);
    expect(g.accept('buyer', 7, T)).toBe(true);
    expect(g.accept('buyer', 6, T)).toBe(false);
  });

  it('binds to the first trade and rejects others', () => {
    const g = new ReplayGuard();
    expect(g.trade).toBeNull();
    expect(g.acceptsTrade('anything')).toBe(true);
    expect(g.accept('buyer', 1, T)).toBe(true);
    expect(g.trade).toBe(T);
    expect(g.acceptsTrade('OTHER')).toBe(false);
    expect(g.accept('buyer', 2, 'OTHER')).toBe(false);
    expect(new ReplayGuard(T).acceptsTrade('OTHER')).toBe(false);
  });

  it('rejects invalid seq and roles without recording them', () => {
    const g = new ReplayGuard();
    for (const s of [Number.NaN, -1, 1.5, 2 ** 53, Number.POSITIVE_INFINITY]) expect(g.accept('buyer', s, T)).toBe(false);
    expect(g.accept('admin' as 'buyer', 1, T)).toBe(false);
    expect(g.toJSON()).toEqual({ trade: null, seen: {} });
    expect(g.accept('buyer', 0, T)).toBe(true);
  });

  it('round-trips through JSON and still rejects an old seq', () => {
    const g = new ReplayGuard();
    g.accept('buyer', 5, T);
    g.accept('mod', 2, T);
    const json = JSON.parse(JSON.stringify(g)) as unknown;
    expect(json).toEqual({ trade: T, seen: { buyer: 5, mod: 2 } });
    const h = ReplayGuard.from(json);
    expect(h.trade).toBe(T);
    expect(h.accept('buyer', 5, T)).toBe(false);
    expect(h.accept('buyer', 6, T)).toBe(true);
    expect(h.accept('seller', 1, 'OTHER')).toBe(false);
    expect(ReplayGuard.from(new ReplayGuard().toJSON()).trade).toBeNull();
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['array', []],
    ['string', 'x'],
    ['missing seen', { trade: null }],
    ['missing trade', { seen: {} }],
    ['extra key', { trade: null, seen: {}, x: 1 }],
    ['trade number', { trade: 1, seen: {} }],
    ['trade too long', { trade: 'x'.repeat(257), seen: {} }],
    ['seen null', { trade: null, seen: null }],
    ['seen array', { trade: null, seen: [] }],
    ['unknown role', { trade: null, seen: { admin: 1 } }],
    ['NaN seq', { trade: null, seen: { buyer: Number.NaN } }],
    ['negative seq', { trade: null, seen: { buyer: -1 } }],
    ['fraction seq', { trade: null, seen: { buyer: 1.5 } }],
    ['string seq', { trade: null, seen: { buyer: '1' } }],
    ['inherited', Object.create({ trade: null, seen: {} }) as unknown],
  ])('from() rejects %s', (_n, v) => {
    expect(() => ReplayGuard.from(v)).toThrow(TypeError);
  });
});
