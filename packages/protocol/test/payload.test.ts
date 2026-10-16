/** Strict payload encoding: what seal accepts, and that open returns exactly it. */
import { beforeAll, describe, expect, it } from 'vitest';
import { type Identity, type Participants, ReplayGuard, generateIdentity, open, seal } from '../src/index.js';

const trade = 'K7M2-9QXA-4FTR-8WPN';
let buyer: Identity;
let seller: Identity;
let participants: Participants;

beforeAll(async () => {
  const mod = await generateIdentity();
  [buyer, seller] = await Promise.all([generateIdentity(), generateIdentity()]);
  const pk = (i: Identity) => ({ signPublic: i.signPublic, boxPublic: i.boxPublic });
  participants = { buyer: pk(buyer), seller: pk(seller), mod: pk(mod) };
});

const sealP = (payload: unknown) =>
  seal({ trade, from: 'buyer', seq: 1, type: 't', payload, to: ['seller'], me: buyer, participants });
const roundTrip = async (payload: unknown) =>
  (await open(await sealP(payload), { me: seller, myRole: 'seller', participants, trade, guard: new ReplayGuard(trade) })).payload;

const nest = (n: number): unknown => {
  let v: unknown = 1;
  for (let i = 0; i < n; i++) v = [v];
  return v;
};

describe('payload round trips', () => {
  it.each<[string, unknown]>([
    ['string', 'héllo \u0000 ✓'],
    ['number', -12.5],
    ['zero', 0],
    ['true', true],
    ['null', null],
    ['empty object', {}],
    ['empty array', []],
    ['nested', { a: { b: [1, { c: 'd' }] } }],
    ['bigint', 42n],
    ['negative bigint', -7n],
    ['huge bigint', 2n ** 200n],
    ['bigint in arrays', [1n, [2n, { x: 3n }]]],
  ])('%s', async (_n, v) => {
    expect(await roundTrip(v)).toEqual(v);
  });

  it('lookalike tag objects stay data', async () => {
    const v = { __t: 'bigint', v: '5' };
    const out = await roundTrip(v);
    expect(out).toEqual(v);
    expect(typeof (out as { v: unknown }).v).toBe('string');
    const deep = { '~__t': 'bigint', '~~__t': 'x', __t: 'y', v: 1n, nested: { __t: 'bigint', v: '9' } };
    expect(await roundTrip(deep)).toEqual(deep);
    expect(await roundTrip(['__t', '~__t'])).toEqual(['__t', '~__t']);
  });

  it('__proto__ and constructor are kept as own data', async () => {
    const v = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":1}}') as Record<string, unknown>;
    const out = (await roundTrip(v)) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(out['__proto__']).toEqual({ polluted: true });
    expect(out['constructor']).toEqual({ prototype: 1 });
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('null-prototype objects are accepted', async () => {
    const v = Object.assign(Object.create(null) as object, { a: 1 });
    expect(await roundTrip(v)).toEqual({ a: 1 });
  });

  it('depth 64 is accepted, 65 is a TypeError', async () => {
    expect(await roundTrip(nest(64))).toEqual(nest(64));
    await expect(sealP(nest(65))).rejects.toThrow(TypeError);
    const obj = (n: number): unknown => (n === 0 ? 1n : { a: obj(n - 1) });
    expect(await roundTrip(obj(64))).toEqual(obj(64));
    await expect(sealP(obj(65))).rejects.toThrow(TypeError);
  });
});

describe('payload rejected with TypeError', () => {
  class Thing {
    a = 1;
  }
  const sparse: unknown[] = [1];
  sparse[2] = 3;
  it.each<[string, () => unknown]>([
    ['Date', () => new Date(0)],
    ['Map', () => new Map()],
    ['Set', () => new Set()],
    ['Uint8Array', () => new Uint8Array(1)],
    ['ArrayBuffer', () => new ArrayBuffer(1)],
    ['class instance', () => new Thing()],
    ['Array subclass', () => new (class extends Array {})()],
    ['NaN', () => Number.NaN],
    ['Infinity', () => Number.POSITIVE_INFINITY],
    ['-Infinity', () => Number.NEGATIVE_INFINITY],
    ['-0', () => -0],
    ['-0 nested', () => ({ a: [-0] })],
    ['undefined', () => undefined],
    ['undefined property', () => ({ a: undefined })],
    ['undefined in array', () => [undefined]],
    ['function', () => () => 1],
    ['symbol value', () => Symbol('s')],
    ['symbol key', () => ({ [Symbol('s')]: 1 })],
    ['symbol key on array', () => [Object.assign([], { [Symbol('s')]: 1 })]],
    ['sparse array', () => sparse],
    ['extra array property', () => Object.assign([1, 2], { foo: 'bar' })],
    ['boxed string', () => new String('x')],
  ])('%s', async (_n, mk) => {
    await expect(sealP(mk())).rejects.toThrow(TypeError);
  });
});
