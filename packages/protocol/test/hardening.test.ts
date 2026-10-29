/** Fixes from the adversarial review of 32a2c13 (M1-M7, D1, D4). */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import sodium from 'libsodium-wrappers';
import type { Role } from '@x2f/core';
import {
  type Identity,
  type Participants,
  ProtocolError,
  ReplayGuard,
  generateIdentity,
  joinMessage,
  open,
  seal,
} from '../src/index.js';
import { canon, craft, pad, patchAndSign } from './craft.js';

const trade = 'K7M2-9QXA-4FTR-8WPN';
let buyer: Identity;
let seller: Identity;
let mod: Identity;
let participants: Participants;
const ids = (): Record<Role, Identity> => ({ buyer, seller, mod });

beforeAll(async () => {
  await sodium.ready;
  [buyer, seller, mod] = await Promise.all([generateIdentity(), generateIdentity(), generateIdentity()]);
  const pk = (i: Identity) => ({ signPublic: i.signPublic, boxPublic: i.boxPublic });
  participants = { buyer: pk(buyer), seller: pk(seller), mod: pk(mod) };
});

afterEach(() => {
  vi.restoreAllMocks();
});

const sealB = (payload: unknown = 1, over: Partial<Parameters<typeof seal>[0]> = {}) =>
  seal({ trade, from: 'buyer', seq: 1, type: 't', payload, to: ['seller'], me: buyer, participants, ...over });
const openAs = (e: unknown, role: Role, over: Partial<Parameters<typeof open>[1]> = {}) =>
  open(e, { me: ids()[role], myRole: role, participants, trade, guard: new ReplayGuard(trade), ...over });
const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (err) {
    if (err instanceof ProtocolError) return err.code;
    throw err;
  }
  return 'ok';
};
const crafted = (padded: Uint8Array, seq = 1) =>
  craft({ sender: buyer, from: 'buyer', trade, seq, participants, padded, wrapTo: ['seller'] });
const text = (s: string) => pad(sodium.from_string(s));

describe('M1 canonical inner plaintext', () => {
  it('control: canonical text opens', async () => {
    expect((await openAs(crafted(text(canon({ type: 't', payload: { a: 1 } }))), 'seller')).payload).toEqual({ a: 1 });
  });

  it.each<[string, () => Uint8Array]>([
    ['duplicate keys (last wins)', () => text('{"type":"release","payload":{"a":1,"a":2},"type":"refund"}')],
    ['duplicate keys sorted', () => text('{"payload":1,"type":"release","type":"refund"}')],
    ['unsorted keys', () => text('{"type":"t","payload":1}')],
    ['extra whitespace', () => text('{"payload": 1,"type":"t"}')],
    ['trailing newline', () => text('{"payload":1,"type":"t"}\n')],
    ['non-canonical escape', () => text('{"payload":"\\u0061","type":"t"}')],
    ['non-canonical number', () => text('{"payload":1.0,"type":"t"}')],
    ['exponent number', () => text('{"payload":1e2,"type":"t"}')],
    ['leading BOM', () => pad(new Uint8Array([0xef, 0xbb, 0xbf, ...sodium.from_string('{"payload":1,"type":"t"}')]))],
    ['tiny message in the 65536 bucket', () => {
      const raw = sodium.from_string('{"payload":1,"type":"t"}');
      const p = new Uint8Array(65536);
      p.set(raw);
      p[raw.length] = 0x80;
      return p;
    }],
    ['255-byte message in the 1024 bucket', () => {
      const raw = sodium.from_string(canon({ type: 't', payload: 'a'.repeat(255 - 25) }));
      const p = new Uint8Array(1024);
      p.set(raw);
      p[raw.length] = 0x80;
      return p;
    }],
  ])('%s -> bad-signature', async (_n, mk) => {
    expect(await code(openAs(crafted(mk()), 'seller'))).toBe('bad-signature');
  });
});

describe('M2 snapshot untrusted input', () => {
  it('a seq getter is rejected and never reaches the guard', async () => {
    const e = await sealB();
    let n = 0;
    const evil = { ...e } as Record<string, unknown>;
    delete evil['seq'];
    Object.defineProperty(evil, 'seq', { enumerable: true, get: () => (n++ === 0 ? 1 : Number.MAX_SAFE_INTEGER) });
    const guard = new ReplayGuard(trade);
    expect(await code(openAs(evil, 'seller', { guard }))).toBe('bad-signature');
    expect(guard.toJSON().seen).toEqual({});
  });

  it('a getter inside slots is rejected', async () => {
    const e = await sealB();
    const slots = { ...e.slots } as Record<string, unknown>;
    delete slots['seller'];
    Object.defineProperty(slots, 'seller', { enumerable: true, get: () => e.slots.seller });
    expect(await code(openAs({ ...e, slots }, 'seller'))).toBe('bad-signature');
  });

  it('a Proxy whose get lies is read through descriptors only', async () => {
    const e = await sealB(1, { seq: 3 });
    const proxy = new Proxy({ ...e }, { get: (t, k) => (k === 'seq' ? Number.MAX_SAFE_INTEGER : Reflect.get(t, k)) });
    const guard = new ReplayGuard(trade);
    expect(await code(openAs(proxy, 'seller', { guard }))).toBe('ok');
    expect(guard.toJSON().seen).toEqual({ buyer: 3 });
  });

  it('a Proxy whose descriptors change between reads commits only the verified seq', async () => {
    const e = await sealB(1, { seq: 3 });
    let reads = 0;
    const proxy = new Proxy({ ...e }, {
      getOwnPropertyDescriptor: (t, k) => {
        const d = Reflect.getOwnPropertyDescriptor(t, k);
        if (k === 'seq' && d && reads++ > 0) return { ...d, value: Number.MAX_SAFE_INTEGER };
        return d;
      },
    });
    const guard = new ReplayGuard(trade);
    const c = await code(openAs(proxy, 'seller', { guard }));
    expect(['ok', 'bad-signature']).toContain(c);
    expect(guard.toJSON().seen.buyer ?? 3).toBe(3);
  });

  it('a Proxy whose traps throw gives a ProtocolError', async () => {
    const e = await sealB();
    const proxy = new Proxy({ ...e }, { ownKeys: () => { throw new Error('trap'); } });
    expect(await code(openAs(proxy, 'seller'))).toBe('bad-signature');
    const { proxy: revoked, revoke } = Proxy.revocable({ ...e }, {});
    revoke();
    expect(await code(openAs(revoked, 'seller'))).toBe('bad-signature');
  });

  it('non-enumerable and symbol-keyed extras are rejected', async () => {
    const e = await sealB();
    const hidden = { ...e };
    Object.defineProperty(hidden, 'x', { value: 1, enumerable: false });
    expect(await code(openAs(hidden, 'seller'))).toBe('bad-signature');
    expect(await code(openAs({ ...e, [Symbol('s')]: 1 }, 'seller'))).toBe('bad-signature');
  });
});

describe('M3 negative zero seq', () => {
  it('open rejects seq -0 even with a valid signature', async () => {
    const e = await sealB(1, { seq: 0 });
    expect(await code(openAs({ ...e, seq: -0 }, 'seller'))).toBe('bad-signature');
  });

  it('seal and the guard reject -0', async () => {
    await expect(sealB(1, { seq: -0 })).rejects.toThrow(TypeError);
    expect(new ReplayGuard(trade).accept('buyer', -0)).toBe(false);
  });
});

describe('M4 participants must have distinct keys', () => {
  const dup = (): Participants => ({ ...participants, seller: participants.buyer });

  it('seal throws TypeError when two roles share keys', async () => {
    await expect(sealB(1, { participants: dup() })).rejects.toThrow(TypeError);
  });

  it('open throws when two roles share keys', async () => {
    const e = await sealB();
    await expect(openAs(e, 'seller', { participants: dup() })).rejects.toThrow(TypeError);
  });

  it('a shared signPublic alone, or a shared boxPublic alone, is rejected', async () => {
    const e = await sealB();
    const sameSign = { ...participants, mod: { ...participants.mod, signPublic: participants.seller.signPublic } };
    const sameBox = { ...participants, mod: { ...participants.mod, boxPublic: participants.seller.boxPublic } };
    await expect(openAs(e, 'seller', { participants: sameSign })).rejects.toThrow(TypeError);
    await expect(openAs(e, 'seller', { participants: sameBox })).rejects.toThrow(TypeError);
    await expect(sealB(1, { participants: sameSign })).rejects.toThrow(TypeError);
  });
});

describe('M5 messages from myself need an explicit opt-in', () => {
  it('from === myRole is not-for-me by default, opens with allowSelf', async () => {
    const e = await sealB('mine', { to: ['seller', 'buyer'] });
    expect(await code(openAs(e, 'buyer'))).toBe('not-for-me');
    expect((await openAs(e, 'buyer', { allowSelf: true })).payload).toBe('mine');
  });

  it('a self-claim with a bad signature is still bad-signature', async () => {
    const e = await sealB('mine', { to: ['buyer'] });
    expect(await code(openAs({ ...e, seq: 7 }, 'buyer'))).toBe('bad-signature');
  });
});

describe('M6 joinMessage challenge is canonical base64 of 32 bytes', () => {
  it('accepts a real 32-byte challenge', () => {
    const c = sodium.to_base64(sodium.randombytes_buf(32), sodium.base64_variants.ORIGINAL);
    expect(new TextDecoder().decode(joinMessage(trade, 'buyer', c))).toBe(`x2f/relay-join/v1\0${trade}\0buyer\0${c}`);
  });

  it.each<[string, string]>([
    // Literals: it.each arguments are built at collection time, before sodium.ready resolves.
    ['too short', `${'A'.repeat(42)}==`], // 31 zero bytes
    ['too long', 'A'.repeat(44)], // 33 zero bytes
    ['no padding', 'A'.repeat(43)],
    ['dirty trailing bits', `${'A'.repeat(42)}B=`],
    ['url-safe', `${'-'.repeat(42)}A=`],
    ['whitespace', ` ${'A'.repeat(43)}=`],
    ['empty', ''],
  ])('rejects %s', (_n, c) => {
    expect(() => joinMessage(trade, 'buyer', c)).toThrow(TypeError);
  });
});

describe('M7 key hygiene', () => {
  it('the decrypted padded buffer is zeroed on success', async () => {
    const e = await sealB();
    const zeroed: number[] = [];
    const real = sodium.memzero.bind(sodium);
    vi.spyOn(sodium, 'memzero').mockImplementation((b: Uint8Array) => {
      zeroed.push(b.length);
      real(b);
    });
    await openAs(e, 'seller');
    expect(zeroed).toContain(256);
  });

  it('the decrypted padded buffer is zeroed when unpad or parse fails', async () => {
    for (const padded of [new Uint8Array(256), text('{"payload":1,"type":"t"} ')]) {
      const zeroed: number[] = [];
      const real = sodium.memzero.bind(sodium);
      vi.spyOn(sodium, 'memzero').mockImplementation((b: Uint8Array) => {
        zeroed.push(b.length);
        real(b);
      });
      expect(await code(openAs(crafted(padded), 'seller'))).toBe('bad-signature');
      expect(zeroed).toContain(256);
      vi.restoreAllMocks();
    }
  });

  it('crypto_scalarmult_base failing in seal becomes a TypeError', async () => {
    vi.spyOn(sodium, 'crypto_scalarmult_base').mockImplementation(() => {
      throw new Error('boom');
    });
    await expect(sealB()).rejects.toThrow(TypeError);
  });
});

describe('D1 ReplayGuard is bound to a trade at construction', () => {
  it('requires a valid trade', () => {
    for (const t of [undefined, '', 'x'.repeat(257), 5, null, 'has space', 'nul\0']) {
      expect(() => new ReplayGuard(t as unknown as string)).toThrow(TypeError);
    }
    expect(new ReplayGuard(trade).trade).toBe(trade);
  });

  it('toJSON/from carry the trade; trade null is invalid', () => {
    const g = new ReplayGuard(trade);
    g.accept('buyer', 1);
    expect(JSON.parse(JSON.stringify(g))).toEqual({ trade, seen: { buyer: 1 } });
    expect(() => ReplayGuard.from({ trade: null, seen: {} })).toThrow(TypeError);
    expect(ReplayGuard.from(g.toJSON()).accept('buyer', 1)).toBe(false);
  });

  it('open: guard bound to another trade -> wrong-trade, guard untouched', async () => {
    const guard = new ReplayGuard('AAAA-BBBB-CCCC-DDDD');
    expect(await code(openAs(await sealB(), 'seller', { guard }))).toBe('wrong-trade');
    expect(guard.toJSON().seen).toEqual({});
  });
});

describe('D4 canonical base64 re-encode check is load-bearing', () => {
  it('a lenient from_base64 still cannot let dirty trailing bits through', async () => {
    const e = await sealB();
    // Lenient decoder: ignores non-zero trailing bits (like atob).
    vi.spyOn(sodium, 'from_base64').mockImplementation((s: string) => {
      const bin = atob(s);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    });
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const idx = e.ct.length - (e.ct.endsWith('==') ? 2 : 1) - 1;
    const dirty = e.ct.slice(0, idx) + A[A.indexOf(e.ct[idx] ?? 'A') | 1] + e.ct.slice(idx + 1);
    expect(dirty).not.toBe(e.ct);
    // The lenient decoder maps it to the same bytes, so only the re-encode check stops it.
    expect(sodium.to_base64(sodium.from_base64(dirty), sodium.base64_variants.ORIGINAL)).toBe(e.ct);
    const m = patchAndSign(e, { ct: dirty }, buyer);
    expect(await code(openAs(m, 'seller'))).toBe('bad-signature');
  });
});
