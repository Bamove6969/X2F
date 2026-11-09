/**
 * Attack tests for open(): every hostile input must end in a ProtocolError (or TypeError for a
 * bad call), never an unhandled error, and must never move the replay guard. A seeded generator
 * (fast-check is not a dependency of this repo) so a failure reproduces exactly.
 */
import sodium from 'libsodium-wrappers';
import { ROLES, type Role } from '@x2f/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { ProtocolError, ReplayGuard, generateIdentity, open, seal, type Envelope, type Identity, type Participants } from '../src/index.js';

const SEED = 0x58324621; // "X2F!"
const trade = 'K7M2-9QXA-4FTR-8WPN';
const otherTrade = 'A1B2-C3D4-E5F6-G7H8';

/** mulberry32: a small seeded PRNG, so each run is the same. */
function rng(seed: number): (n: number) => number {
  let a = seed;
  return (n) => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) % n) | 0;
  };
}

let buyer: Identity;
let seller: Identity;
let mod: Identity;
let mallory: Identity;
let participants: Participants;
const pk = (i: Identity) => ({ signPublic: i.signPublic, boxPublic: i.boxPublic });
const idOf = (r: Role): Identity => ({ buyer, seller, mod })[r];

beforeAll(async () => {
  await sodium.ready;
  [buyer, seller, mod, mallory] = await Promise.all([generateIdentity(), generateIdentity(), generateIdentity(), generateIdentity()]);
  participants = { buyer: pk(buyer), seller: pk(seller), mod: pk(mod) };
});

const sealIt = (over: Partial<Parameters<typeof seal>[0]> = {}): Promise<Envelope> =>
  seal({ trade, from: 'buyer', seq: 1, type: 'test', payload: { hello: 'world' }, to: ['buyer', 'seller', 'mod'], me: buyer, participants, ...over });

/** The rejection code, or 'ok'; anything other than a ProtocolError fails the test. */
async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    if (e instanceof ProtocolError) return e.code;
    throw e;
  }
}

const openAs = (e: unknown, role: Role = 'seller', guard = new ReplayGuard(trade)) => open(e as Envelope, { me: idOf(role), myRole: role, participants, trade, guard });

const REJECTED = ['bad-signature', 'wrong-trade', 'not-participant', 'not-for-me', 'replay'];

/** A hostile copy of `e`: type confusion, truncation or corruption of one field. */
function mutate(e: Envelope, r: (n: number) => number): unknown {
  const field = (['v', 'trade', 'from', 'seq', 'slots', 'nonce', 'kh', 'ct', 'ctNonce', 'sig'] as const)[r(10)]!;
  const junk: unknown[] = [null, undefined, 0, -1, 1.5, NaN, '', 'x', true, [], {}, 2 ** 53, '0', [1, 2], { nested: 1 }, Object.create(null)];
  const s = e[field] as unknown;
  switch (r(6)) {
    case 0:
      return { ...e, [field]: junk[r(junk.length)] };
    case 1: {
      const copy: Record<string, unknown> = { ...e };
      delete copy[field];
      return copy;
    }
    case 2:
      return { ...e, extra: junk[r(junk.length)] };
    case 3:
      return typeof s === 'string' ? { ...e, [field]: s.slice(0, r(s.length)) } : { ...e, [field]: junk[r(junk.length)] };
    case 4: {
      if (typeof s !== 'string' || s.length === 0) return { ...e, [field]: junk[r(junk.length)] };
      const at = r(s.length);
      const alphabet = 'AZaz09+/=-"{}:,0f ÿ ';
      return { ...e, [field]: s.slice(0, at) + alphabet[r(alphabet.length)]! + s.slice(at + 1) };
    }
    default: {
      // Corrupt one of the slots, or swap two of them.
      const slots = { ...e.slots };
      const a = ROLES[r(3)]!;
      const b = ROLES[r(3)]!;
      if (r(2) === 0) [slots[a], slots[b]] = [slots[b], slots[a]];
      else slots[a] = 'A'.repeat(r(80));
      return { ...e, slots };
    }
  }
}

describe('malformed and truncated envelopes', () => {
  it.each([[null], [undefined], [0], ['envelope'], [[]], [true], [new Date(0)], [new Map()]])('%s is refused', async (e) => {
    expect(await code(openAs(e))).toBe('bad-signature');
  });

  it('a JSON __proto__ key, an accessor and a throwing Proxy are refused, not executed', async () => {
    const e = await sealIt();
    let ran = false;
    const accessor = Object.defineProperty({ ...e }, 'ct', {
      enumerable: true,
      get() {
        ran = true;
        return e.ct;
      },
    });
    const proxy = new Proxy({ ...e }, {
      ownKeys() {
        throw new Error('trap');
      },
    });
    expect(await code(openAs(JSON.parse(`{"__proto__":{"v":1},${JSON.stringify(e).slice(1)}`)))).toBe('bad-signature');
    expect(await code(openAs(accessor))).toBe('bad-signature');
    expect(await code(openAs(proxy))).toBe('bad-signature');
    expect(ran).toBe(false);
  });

  it('every prefix of the wire form is refused', async () => {
    const e = await sealIt();
    const json = JSON.stringify(e);
    for (const cut of [1, 10, json.length >> 1, json.length - 2, json.length - 1]) {
      let body: unknown;
      try {
        body = JSON.parse(json.slice(0, cut));
      } catch {
        continue; // Not even JSON: the API layer never gets this far.
      }
      expect(await code(openAs(body))).toBe('bad-signature');
    }
    for (const field of ['ct', 'sig', 'kh', 'nonce', 'ctNonce'] as const) {
      expect(await code(openAs({ ...e, [field]: e[field].slice(0, -2) }))).toBe('bad-signature');
    }
  });

  it(`a seeded ${500}-case generator only ever yields ProtocolError and never moves the guard`, async () => {
    const e = await sealIt();
    const r = rng(SEED);
    const guard = new ReplayGuard(trade);
    for (let i = 0; i < 500; i++) {
      const m = mutate(e, r);
      if (JSON.stringify(m) === JSON.stringify(e)) continue; // A swap of a slot with itself, or an unchanged character.
      expect(REJECTED, JSON.stringify(m)).toContain(await code(open(m as Envelope, { me: seller, myRole: 'seller', participants, trade, guard })));
    }
    expect(guard.toJSON().seen).toEqual({});
    // Control: the untouched envelope still opens after all of that.
    expect(await code(open(e, { me: seller, myRole: 'seller', participants, trade, guard }))).toBe('ok');
  });
});

describe('wrong channel and cross-trade replay', () => {
  it('an envelope for one trade is refused under another, and the guard does not move', async () => {
    const e = await sealIt();
    const guard = new ReplayGuard(otherTrade);
    expect(await code(open(e, { me: seller, myRole: 'seller', participants, trade: otherTrade, guard }))).toBe('wrong-trade');
    expect(guard.toJSON().seen).toEqual({});
  });

  it('relabelling `trade` breaks the signature, so the other trade cannot accept it', async () => {
    const e = await sealIt();
    expect(await code(open({ ...e, trade: otherTrade }, { me: seller, myRole: 'seller', participants, trade: otherTrade, guard: new ReplayGuard(otherTrade) }))).toBe('bad-signature');
  });

  it('a guard bound to another trade refuses it even if the args name this trade', async () => {
    const e = await sealIt();
    expect(await code(open(e, { me: seller, myRole: 'seller', participants, trade, guard: new ReplayGuard(otherTrade) }))).toBe('wrong-trade');
  });
});

describe('wrong recipient set', () => {
  it('a reader left out of `to` gets not-for-me and the guard does not move', async () => {
    const e = await sealIt({ to: ['buyer', 'mod'] });
    const guard = new ReplayGuard(trade);
    expect(await code(open(e, { me: seller, myRole: 'seller', participants, trade, guard }))).toBe('not-for-me');
    expect(guard.toJSON().seen).toEqual({});
  });

  it('a sender can leave the moderator out: the mod gets not-for-me, so nothing proves the mod could read it', async () => {
    // R16 hides the recipient set, so a counterparty cannot detect this. Called out for the lead.
    const e = await sealIt({ to: ['seller'] });
    expect(await code(openAs(e, 'mod'))).toBe('not-for-me');
    expect(await code(openAs(e, 'seller'))).toBe('ok');
  });

  it('a reader under the wrong role, or a stranger, opens nothing', async () => {
    const e = await sealIt();
    expect(await code(open(e, { me: seller, myRole: 'mod', participants, trade, guard: new ReplayGuard(trade) }))).toBe('not-for-me');
    expect(await code(open(e, { me: mallory, myRole: 'seller', participants, trade, guard: new ReplayGuard(trade) }))).toBe('not-for-me');
  });
});

describe('signature and ciphertext tampering', () => {
  const flip = (s: string, at = 5): string => s.slice(0, at) + (s[at] === 'A' ? 'B' : 'A') + s.slice(at + 1);

  it('every signed field changed by one character is refused', async () => {
    const e = await sealIt();
    const tampered: unknown[] = [
      { ...e, ct: flip(e.ct) },
      { ...e, nonce: flip(e.nonce) },
      { ...e, ctNonce: flip(e.ctNonce) },
      { ...e, kh: `${e.kh.slice(0, -1)}${e.kh.endsWith('0') ? '1' : '0'}` },
      { ...e, sig: `${e.sig.slice(0, -1)}${e.sig.endsWith('0') ? '1' : '0'}` },
      { ...e, seq: 2 },
      { ...e, from: 'seller' },
      { ...e, slots: { ...e.slots, seller: flip(e.slots.seller) } },
    ];
    for (const t of tampered) expect(await code(openAs(t))).toBe('bad-signature');
  });

  it('a signature from a key outside the participant list, claiming each role in turn, is refused', async () => {
    for (const from of ROLES) {
      const forged = await seal({
        trade,
        from,
        seq: 1,
        type: 'test',
        payload: { hello: 'mallory' },
        to: [...ROLES],
        me: mallory,
        participants: { ...participants, [from]: pk(mallory) },
      });
      expect(await code(openAs(forged, from === 'seller' ? 'buyer' : 'seller')), from).toBe('bad-signature');
    }
  });
});

describe('replayed and out-of-order seq', () => {
  it('the same envelope twice, and an older one after a newer one, are replays; the guard keeps the newest', async () => {
    const a = await sealIt({ seq: 3 });
    const b = await sealIt({ seq: 5 });
    const guard = new ReplayGuard(trade);
    const read = (e: Envelope) => code(open(e, { me: seller, myRole: 'seller', participants, trade, guard }));
    expect(await read(b)).toBe('ok');
    expect(await read(b)).toBe('replay');
    expect(await read(a)).toBe('replay');
    expect(guard.toJSON().seen).toEqual({ buyer: 5 });
  });

  it('a seeded mixed order accepts exactly the strictly newer seq, per sender', async () => {
    const r = rng(SEED + 1);
    const guard = new ReplayGuard(trade);
    const last: Partial<Record<Role, number>> = {};
    for (let i = 0; i < 60; i++) {
      const from: Role = r(2) === 0 ? 'buyer' : 'seller';
      const seq = r(20);
      const e = await seal({ trade, from, seq, type: 't', payload: 1, to: [...ROLES], me: idOf(from), participants });
      const want = last[from] === undefined || seq > last[from]! ? 'ok' : 'replay';
      expect(await code(open(e, { me: mod, myRole: 'mod', participants, trade, guard }))).toBe(want);
      if (want === 'ok') last[from] = seq;
    }
    expect(guard.toJSON().seen).toEqual(last);
  });

  it('a seq beyond the safe range is refused; the top safe seq is the last one', async () => {
    const e = await sealIt();
    for (const seq of [-1, 1.5, 2 ** 53, Number.MAX_VALUE, NaN]) expect(await code(openAs({ ...e, seq }))).toBe('bad-signature');
    const top = await sealIt({ seq: Number.MAX_SAFE_INTEGER });
    const guard = new ReplayGuard(trade);
    expect(await code(open(top, { me: seller, myRole: 'seller', participants, trade, guard }))).toBe('ok');
    expect(await code(open(await sealIt({ seq: Number.MAX_SAFE_INTEGER }), { me: seller, myRole: 'seller', participants, trade, guard }))).toBe('replay');
  });

  it('a corrupt saved guard is refused with a TypeError, never accepted', () => {
    for (const bad of [null, {}, { trade, seen: { nobody: 1 } }, { trade, seen: { buyer: -1 } }, { trade: 'x\0y', seen: {} }, JSON.parse(`{"trade":"${trade}","seen":{"__proto__":1}}`)]) {
      expect(() => ReplayGuard.from(bad)).toThrow(TypeError);
    }
  });
});

describe('forged sender role', () => {
  it('a real participant signing as another role is refused, whichever role it claims', async () => {
    for (const claim of ['seller', 'mod'] as const) {
      const env = await seal({
        trade,
        from: claim,
        seq: 1,
        type: 'test',
        payload: {},
        to: [...ROLES],
        me: buyer,
        participants: { ...participants, [claim]: pk(buyer), buyer: pk(idOf(claim)) },
      });
      expect(await code(openAs(env, claim === 'seller' ? 'mod' : 'seller')), claim).toBe('bad-signature');
    }
  });

  it('an unknown role, or one with no participant, is not-participant', async () => {
    const e = await sealIt();
    expect(await code(openAs({ ...e, from: 'admin' }))).toBe('not-participant');
    expect(await code(openAs({ ...e, from: '__proto__' }))).toBe('not-participant');
    expect(await code(open(e, { me: seller, myRole: 'seller', participants: { seller: pk(seller) }, trade, guard: new ReplayGuard(trade) }))).toBe('not-participant');
  });
});

describe('oversized bodies', () => {
  it('open refuses anything over the length caps before decoding', async () => {
    const e = await sealIt();
    expect(await code(openAs({ ...e, ct: 'A'.repeat(200_000) }))).toBe('bad-signature');
    expect(await code(openAs({ ...e, trade: 'A'.repeat(257) }))).toBe('bad-signature');
    expect(await code(openAs({ ...e, slots: { ...e.slots, seller: 'A'.repeat(65) } }))).toBe('bad-signature');
  });

  it('seal refuses a plaintext over the top bucket with too-large, naming no length', async () => {
    try {
      await sealIt({ payload: { s: 'x'.repeat(70_000) } });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ProtocolError);
      expect((e as ProtocolError).code).toBe('too-large');
      expect((e as ProtocolError).message).not.toMatch(/\d{3,}/);
    }
  });
});
