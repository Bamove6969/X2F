/**
 * Envelope protocol tests: signed, encrypted, padded envelopes.
 *
 * Check order in open() (enforced and tested):
 *   0. shape          plain object, exact key set, bounded strings  -> bad-signature
 *   1. wrong-trade    trade differs, or guard bound to another trade
 *   2. not-participant from is not a role present in participants
 *   3. structure      field encodings and lengths                  -> bad-signature
 *   4. signature      domain-separated Ed25519 over canonical JSON  -> bad-signature
 *   5. unwrap         my slot does not open                         -> not-for-me
 *   6. kh             generichash(K) != kh                          -> bad-signature
 *   7. decrypt        secretbox, unpad, UTF-8, JSON, payload tags   -> bad-signature
 *   8. replay         checked and committed last
 */
import { beforeAll, describe, expect, it } from 'vitest';
import sodium from 'libsodium-wrappers';
import type { Role } from '@x2f/core';
import {
  type Envelope,
  type Identity,
  type Participants,
  ProtocolError,
  ReplayGuard,
  generateIdentity,
  open,
  seal,
} from '../src/index.js';
import { b64, canon, craft, pad, patchAndSign, resign } from './craft.js';

const trade = 'K7M2-9QXA-4FTR-8WPN';
let buyer: Identity;
let seller: Identity;
let mod: Identity;
let stranger: Identity;
let participants: Participants;
const ids = (): Record<Role, Identity> => ({ buyer, seller, mod });

beforeAll(async () => {
  await sodium.ready;
  [buyer, seller, mod, stranger] = await Promise.all([
    generateIdentity(),
    generateIdentity(),
    generateIdentity(),
    generateIdentity(),
  ]);
  const pk = (i: Identity) => ({ signPublic: i.signPublic, boxPublic: i.boxPublic });
  participants = { buyer: pk(buyer), seller: pk(seller), mod: pk(mod) };
});

type SealOver = Partial<Parameters<typeof seal>[0]>;
const sealB = (payload: unknown = { hello: 'world' }, over: SealOver = {}) =>
  seal({ trade, from: 'buyer', seq: 1, type: 'test', payload, to: ['seller'], me: buyer, participants, ...over });

const openAs = (e: unknown, role: Role, over: Partial<Parameters<typeof open>[1]> = {}) =>
  open(e as Envelope, { me: ids()[role], myRole: role, participants, trade, guard: new ReplayGuard(trade), ...over });

const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (err) {
    if (err instanceof ProtocolError) return err.code;
    throw err;
  }
  return 'ok';
};

const innerBytes = (type: string, payload: unknown) => sodium.from_string(canon({ type, payload }));

describe('round trip', () => {
  it('buyer -> seller', async () => {
    const e = await sealB({ amount: 42n, note: 'hi', list: [1, 'two', null, true] });
    expect(await openAs(e, 'seller')).toEqual({ type: 'test', payload: { amount: 42n, note: 'hi', list: [1, 'two', null, true] }, from: 'buyer' });
  });

  it('buyer -> {seller, mod}: both open the same envelope', async () => {
    const e = await sealB('x', { to: ['seller', 'mod'] });
    expect(await openAs(e, 'seller')).toEqual({ type: 'test', payload: 'x', from: 'buyer' });
    expect(await openAs(e, 'mod')).toEqual({ type: 'test', payload: 'x', from: 'buyer' });
  });

  it('returns the signed sender, even when the frame reads differently afterwards', async () => {
    const e = await sealB('x');
    // A proxy that shows the signed fields to the checks but another sender to a later read.
    const sly = new Proxy({ ...e }, { get: (t, k) => (k === 'from' ? 'mod' : Reflect.get(t, k)) });
    expect((sly as { from: string }).from).toBe('mod');
    expect((await openAs(sly, 'seller')).from).toBe('buyer');
  });

  it('a sender must include itself in `to` to re-read its own message', async () => {
    expect(await code(openAs(await sealB(1), 'buyer', { allowSelf: true }))).toBe('not-for-me');
    expect((await openAs(await sealB(1, { to: ['seller', 'buyer'] }), 'buyer', { allowSelf: true })).payload).toBe(1);
  });

  it('envelope has exactly the final key set and no outer type (R9)', async () => {
    const e = await sealB({ secret: 'MARKER-123' }, { type: 'TYPE-MARKER' });
    expect(Object.keys(e).sort()).toEqual(['ct', 'ctNonce', 'from', 'kh', 'nonce', 'seq', 'sig', 'slots', 'trade', 'v']);
    expect(Object.keys(e.slots).sort()).toEqual(['buyer', 'mod', 'seller']);
    const json = JSON.stringify(e);
    expect(json).not.toContain('MARKER-123');
    expect(json).not.toContain('TYPE-MARKER');
    expect(e.v).toBe(1);
    expect(e.sig).toMatch(/^[0-9a-f]{128}$/);
    expect(e.kh).toMatch(/^[0-9a-f]{64}$/);
  });

  it('base64 fields are standard padded base64 that round-trips', async () => {
    const e = await sealB({ a: 1 });
    for (const f of [e.nonce, e.ctNonce, e.ct, ...Object.values(e.slots)]) {
      expect(b64(sodium.from_base64(f, sodium.base64_variants.ORIGINAL))).toBe(f);
    }
  });

  it('src never uses Node Buffer (browser-safe)', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const dir = new URL('../src/', import.meta.url);
    for (const f of readdirSync(dir)) expect(readFileSync(new URL(f, dir), 'utf8')).not.toMatch(/\bBuffer\b/);
  });
});

describe('padding (R9)', () => {
  it('1-byte and 200-byte payloads give identical ciphertext length', async () => {
    const a = await sealB('x');
    const b = await sealB('y'.repeat(200));
    expect(a.ct.length).toBe(b.ct.length);
    expect(sodium.from_base64(a.ct, sodium.base64_variants.ORIGINAL).length).toBe(256 + 16);
  });

  it('snaps to the next bucket', async () => {
    // inner JSON {"payload":"...","type":"t"} has 25 bytes of overhead
    const ctLen = async (n: number) =>
      sodium.from_base64((await sealB('a'.repeat(n), { type: 't' })).ct, sodium.base64_variants.ORIGINAL).length - 16;
    expect(await ctLen(255 - 25)).toBe(256);
    expect(await ctLen(256 - 25)).toBe(1024);
    expect(await ctLen(1023 - 25)).toBe(1024);
    expect(await ctLen(1024 - 25)).toBe(4096);
    expect(await ctLen(65535 - 25)).toBe(65536);
  });

  it('65535-byte plaintext fits; 65536 is too-large without revealing the length', async () => {
    const ok = await sealB('a'.repeat(65535 - 25), { type: 't' });
    expect((await openAs(ok, 'seller')).payload).toHaveLength(65510);
    let err: unknown;
    try {
      await sealB('a'.repeat(65536 - 25), { type: 't' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ProtocolError);
    expect((err as ProtocolError).code).toBe('too-large');
    expect((err as ProtocolError).message).not.toMatch(/\d/);
    expect(await code(sealB('a'.repeat(70_000)))).toBe('too-large');
  });
});

describe('each ProtocolError code', () => {
  it('bad-signature: one byte of ct flipped', async () => {
    const e = await sealB();
    const ct = sodium.from_base64(e.ct, sodium.base64_variants.ORIGINAL);
    ct[10] = (ct[10] ?? 0) ^ 1;
    expect(await code(openAs({ ...e, ct: b64(ct) }, 'seller'))).toBe('bad-signature');
  });

  it('bad-signature: one byte of my slot flipped', async () => {
    const e = await sealB();
    const s = sodium.from_base64(e.slots.seller, sodium.base64_variants.ORIGINAL);
    s[0] = (s[0] ?? 0) ^ 1;
    expect(await code(openAs({ ...e, slots: { ...e.slots, seller: b64(s) } }, 'seller'))).toBe('bad-signature');
  });

  it('bad-signature: nonce, ctNonce, seq, kh or from changed', async () => {
    const e = await sealB();
    const other = await sealB();
    for (const m of [
      { nonce: other.nonce },
      { ctNonce: other.ctNonce },
      { seq: 2 },
      { kh: other.kh },
      { from: 'seller' as const },
      { trade: trade }, // unchanged control below
    ]) {
      const expected = 'trade' in m ? 'ok' : 'bad-signature';
      expect(await code(openAs({ ...e, ...m }, 'seller'))).toBe(expected);
    }
  });

  it('bad-signature: stranger signs claiming to be buyer (Haveno pattern)', async () => {
    const e = craft({ sender: stranger, from: 'buyer', trade, seq: 1, participants, padded: pad(innerBytes('t', 1)), wrapTo: ['seller'] });
    expect(await code(openAs(e, 'seller'))).toBe('bad-signature');
  });

  it('bad-signature: real buyer key sealing as from:mod', async () => {
    const e = craft({ sender: buyer, from: 'mod', trade, seq: 1, participants, padded: pad(innerBytes('t', 1)), wrapTo: ['seller'] });
    expect(await code(openAs(e, 'seller'))).toBe('bad-signature');
  });

  it('bad-signature: signature without the domain prefix', async () => {
    const e = craft({ sender: buyer, from: 'buyer', trade, seq: 1, participants, padded: pad(innerBytes('t', 1)), wrapTo: ['seller'], domain: '' });
    expect(await code(openAs(e, 'seller'))).toBe('bad-signature');
    const good = craft({ sender: buyer, from: 'buyer', trade, seq: 1, participants, padded: pad(innerBytes('t', 1)), wrapTo: ['seller'] });
    expect((await openAs(good, 'seller')).payload).toBe(1);
  });

  it('not-participant: from is not a role present in participants', async () => {
    const e = await sealB(1, { from: 'mod', me: mod });
    const { mod: _m, ...partial } = participants;
    void _m;
    expect(await code(openAs(e, 'seller', { participants: partial }))).toBe('not-participant');
    expect(await code(openAs({ ...(await sealB()), from: 'admin' }, 'seller'))).toBe('not-participant');
  });

  it('wrong-trade: opened for a different trade', async () => {
    expect(await code(openAs(await sealB(), 'seller', { trade: 'AAAA-BBBB-CCCC-DDDD' }))).toBe('wrong-trade');
  });

  it('wrong-trade: guard bound to another trade', async () => {
    const guard = new ReplayGuard('AAAA-BBBB-CCCC-DDDD');
    expect(await code(openAs(await sealB(), 'seller', { guard }))).toBe('wrong-trade');
  });

  it('replay: same envelope twice; lower and equal seq', async () => {
    const guard = new ReplayGuard(trade);
    const e5 = await sealB(1, { seq: 5 });
    await openAs(e5, 'seller', { guard });
    expect(await code(openAs(e5, 'seller', { guard }))).toBe('replay');
    expect(await code(openAs(await sealB(1, { seq: 4 }), 'seller', { guard }))).toBe('replay');
    expect(await code(openAs(await sealB(1, { seq: 5 }), 'seller', { guard }))).toBe('replay');
    expect(await code(openAs(await sealB(1, { seq: 6 }), 'seller', { guard }))).toBe('ok');
  });

  it('not-for-me: role not in `to`', async () => {
    expect(await code(openAs(await sealB(1, { to: ['seller'] }), 'mod'))).toBe('not-for-me');
  });

  it('too-large is only raised by seal', async () => {
    expect(await code(sealB('z'.repeat(65536)))).toBe('too-large');
  });

  it('ProtocolError carries a code and is an Error', () => {
    const e = new ProtocolError('replay', 'x');
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('replay');
    expect(e.name).toBe('ProtocolError');
  });
});

describe('check order', () => {
  it('shape before wrong-trade', async () => {
    const e = await sealB();
    expect(await code(openAs({ ...e, extra: 1 }, 'seller', { trade: 'other' }))).toBe('bad-signature');
  });

  it('wrong-trade before not-participant and bad-signature', async () => {
    const e = await sealB();
    expect(await code(openAs({ ...e, from: 'admin', sig: '00'.repeat(64) }, 'seller', { trade: 'other' }))).toBe('wrong-trade');
  });

  it('not-participant before bad-signature', async () => {
    const e = await sealB();
    expect(await code(openAs({ ...e, from: 'admin', sig: '00'.repeat(64) }, 'seller'))).toBe('not-participant');
  });

  it('bad-signature before not-for-me', async () => {
    const e = await sealB(1, { to: ['seller'] });
    expect(await code(openAs({ ...e, seq: 9 }, 'mod'))).toBe('bad-signature');
  });

  it('not-for-me before kh and decrypt failures', async () => {
    const e = craft({ sender: buyer, from: 'buyer', trade, seq: 1, participants, padded: new Uint8Array(256), wrapTo: ['seller'], khKey: new Uint8Array(32) });
    expect(await code(openAs(e, 'mod'))).toBe('not-for-me');
    expect(await code(openAs(e, 'seller'))).toBe('bad-signature');
  });

  it('replay is last: a tampered copy of a seen envelope is bad-signature, not replay', async () => {
    const guard = new ReplayGuard(trade);
    const e = await sealB(1, { to: ['seller'] });
    await openAs(e, 'seller', { guard });
    expect(await code(openAs({ ...e, ct: (await sealB()).ct }, 'seller', { guard }))).toBe('bad-signature');
    const forMe = await sealB(1, { to: ['mod'] });
    expect(await code(openAs(forMe, 'seller', { guard }))).toBe('not-for-me');
  });

  it('failures never advance the guard', async () => {
    const guard = new ReplayGuard(trade);
    const hi = await sealB(1, { seq: 100 });
    await expect(openAs({ ...hi, sig: '00'.repeat(64) }, 'seller', { guard })).rejects.toBeInstanceOf(ProtocolError);
    const badKh = craft({ sender: buyer, from: 'buyer', trade, seq: 101, participants, padded: pad(innerBytes('t', 1)), wrapTo: ['seller'], khKey: new Uint8Array(32) });
    expect(await code(openAs(badKh, 'seller', { guard }))).toBe('bad-signature');
    const badPad = craft({ sender: buyer, from: 'buyer', trade, seq: 102, participants, padded: new Uint8Array(256), wrapTo: ['seller'] });
    expect(await code(openAs(badPad, 'seller', { guard }))).toBe('bad-signature');
    expect(guard.toJSON()).toEqual({ trade, seen: {} });
    expect(await code(openAs(await sealB(1, { seq: 1 }), 'seller', { guard }))).toBe('ok');
  });

  it('a later envelope not addressed to me does not make an earlier one a replay', async () => {
    const guard = new ReplayGuard(trade);
    const first = await sealB('first', { seq: 1, to: ['seller'] });
    const later = await sealB('later', { seq: 2, to: ['mod'] });
    expect(await code(openAs(later, 'seller', { guard }))).toBe('not-for-me');
    expect((await openAs(first, 'seller', { guard })).payload).toBe('first');
  });

  it('a guard bound to one trade rejects envelopes of another trade', async () => {
    const guard = new ReplayGuard(trade);
    await openAs(await sealB(), 'seller', { guard });
    const t2 = 'ZZZZ-ZZZZ-ZZZZ-ZZZZ';
    const other = await seal({ trade: t2, from: 'buyer', seq: 9, type: 't', payload: 1, to: ['seller'], me: buyer, participants });
    expect(await code(openAs(other, 'seller', { guard, trade: t2 }))).toBe('wrong-trade');
  });
});

describe('anti-equivocation (R15)', () => {
  it('two different keys under one valid signature: rejected for at least one recipient', async () => {
    const k1 = sodium.randombytes_buf(32);
    const k2 = sodium.randombytes_buf(32);
    const e = craft({
      sender: buyer, from: 'buyer', trade, seq: 1, participants,
      padded: pad(innerBytes('t', 'for seller')), wrapTo: ['seller', 'mod'], key: k1, keyFor: { mod: k2 },
    });
    expect((await openAs(e, 'seller')).payload).toBe('for seller');
    expect(await code(openAs(e, 'mod'))).toBe('bad-signature');
  });

  it('kh not matching the wrapped key: bad-signature', async () => {
    const e = craft({ sender: buyer, from: 'buyer', trade, seq: 1, participants, padded: pad(innerBytes('t', 1)), wrapTo: ['seller'], khKey: sodium.randombytes_buf(32) });
    expect(await code(openAs(e, 'seller'))).toBe('bad-signature');
  });
});

describe('recipient hiding (R16)', () => {
  it('every recipient set yields the same structure and lengths', async () => {
    const sets: Role[][] = [['seller'], ['mod'], ['seller', 'mod'], ['buyer', 'seller', 'mod']];
    const shapes = await Promise.all(
      sets.map(async (to) => {
        const e = await sealB({ x: 1 }, { to });
        return {
          keys: Object.keys(e).sort(),
          slots: Object.fromEntries(Object.entries(e.slots).map(([r, s]) => [r, s.length])),
          lens: [e.nonce.length, e.kh.length, e.ct.length, e.ctNonce.length, e.sig.length],
        };
      }),
    );
    for (const s of shapes) expect(s).toEqual(shapes[0]);
    expect(shapes[0]?.slots).toEqual({ buyer: 64, seller: 64, mod: 64 });
  });

  it('non-recipient slots are random, not constant', async () => {
    const a = await sealB(1, { to: ['seller'] });
    const b = await sealB(1, { to: ['seller'] });
    expect(a.slots.mod).not.toBe(b.slots.mod);
    expect(a.slots.mod).not.toBe(a.slots.buyer);
  });

  it('swapping two slots breaks the signature', async () => {
    const e = await sealB(1, { to: ['seller'] });
    expect(await code(openAs({ ...e, slots: { ...e.slots, seller: e.slots.mod, mod: e.slots.seller } }, 'seller'))).toBe('bad-signature');
    expect(await code(openAs({ ...e, slots: { ...e.slots, mod: e.slots.seller } }, 'mod'))).toBe('bad-signature');
  });

  it('adding or removing a slot key is rejected', async () => {
    const e = await sealB();
    expect(await code(openAs({ ...e, slots: { ...e.slots, admin: e.slots.seller } }, 'seller'))).toBe('bad-signature');
    const { mod: _m, ...two } = e.slots;
    void _m;
    expect(await code(openAs({ ...e, slots: two }, 'seller'))).toBe('bad-signature');
  });
});

describe('participant keys', () => {
  it('open: boxPublic not derived from signPublic -> bad-signature', async () => {
    const e = await sealB();
    const p2 = { ...participants, buyer: { signPublic: buyer.signPublic, boxPublic: stranger.boxPublic } };
    expect(await code(openAs(e, 'seller', { participants: p2 }))).toBe('bad-signature');
  });

  it('open: malformed participant hex -> bad-signature', async () => {
    const e = await sealB();
    for (const signPublic of [buyer.signPublic.toUpperCase(), 'zz'.repeat(32), buyer.signPublic.slice(2)]) {
      const p2 = { ...participants, buyer: { ...participants.buyer, signPublic } };
      expect(await code(openAs(e, 'seller', { participants: p2 }))).toBe('bad-signature');
    }
  });
});

describe('shape and field encoding', () => {
  const variants = async (): Promise<Array<[string, unknown]>> => {
    const e = await sealB();
    return [
      ['null', null],
      ['string', 'x'],
      ['array', [e]],
      ['class instance', Object.assign(Object.create({ inherited: 1 }) as object, e)],
      ['unknown key', { ...e, extra: 1 }],
      ['missing key', (({ kh: _k, ...r }) => r)(e)],
      ['v 2', { ...e, v: 2 }],
      ['v "1"', { ...e, v: '1' }],
      ['seq negative', { ...e, seq: -1 }],
      ['seq fraction', { ...e, seq: 1.5 }],
      ['seq string', { ...e, seq: '1' }],
      ['seq unsafe', { ...e, seq: 2 ** 53 }],
      ['from number', { ...e, from: 1 }],
      ['trade too long', { ...e, trade: 'x'.repeat(257) }],
      ['trade number', { ...e, trade: 1 }],
      ['slots null', { ...e, slots: null }],
      ['slots array', { ...e, slots: [] }],
      ['slot number', { ...e, slots: { ...e.slots, seller: 1 } }],
      ['slot huge', { ...e, slots: { ...e.slots, seller: 'A'.repeat(100_000) } }],
      ['ct huge', { ...e, ct: 'A'.repeat(200_000) }],
      ['sig upper hex', { ...e, sig: e.sig.toUpperCase() }],
      ['sig short', { ...e, sig: e.sig.slice(2) }],
      ['sig non-hex', { ...e, sig: 'g'.repeat(128) }],
      ['kh upper hex', { ...e, kh: e.kh.toUpperCase() }],
      ['kh short', { ...e, kh: e.kh.slice(2) }],
      ['nonce short', { ...e, nonce: b64(new Uint8Array(23)) }],
      ['ctNonce long', { ...e, ctNonce: b64(new Uint8Array(25)) }],
      ['slot short', { ...e, slots: { ...e.slots, seller: b64(new Uint8Array(47)) } }],
      ['ct not a bucket', { ...e, ct: b64(new Uint8Array(300)) }],
      ['ct empty', { ...e, ct: '' }],
    ];
  };

  it('every malformed shape -> bad-signature ProtocolError', async () => {
    for (const [name, v] of await variants()) {
      expect([name, await code(openAs(v, 'seller'))]).toEqual([name, 'bad-signature']);
    }
  });

  it('error messages name the field, never the value', async () => {
    const e = await sealB();
    try {
      await openAs({ ...e, nonce: 'SECRETVALUE!' }, 'seller');
    } catch (err) {
      expect((err as Error).message).toContain('nonce');
      expect((err as Error).message).not.toContain('SECRETVALUE');
    }
  });

  // Non-canonical forms: URL-safe alphabet, missing/extra padding, whitespace, dirty trailing bits.
  const dirtyBits = (s: string): string => {
    const padN = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const idx = s.length - padN - 1;
    return s.slice(0, idx) + A[A.indexOf(s[idx] ?? 'A') | 1] + s.slice(idx + 1);
  };
  const nonCanon = (s: string): string[] => {
    const out = [`${s}=`, `${s} `, ` ${s}`, `${s.slice(0, 4)}\n${s.slice(4)}`, s.replace(/[A-Za-z0-9]/, '-'), `${s.slice(0, -1)}_`];
    if (s.endsWith('=')) out.push(s.replace(/=+$/, ''), dirtyBits(s));
    return out;
  };

  it.each(['nonce', 'ctNonce', 'ct', 'slots.buyer', 'slots.seller', 'slots.mod'])(
    'non-canonical base64 in %s -> bad-signature',
    async (field) => {
      const e = await sealB();
      const [f, sub] = field.split('.') as [keyof Envelope, Role | undefined];
      const orig = sub ? e.slots[sub] : (e[f] as string);
      for (const bad of nonCanon(orig)) {
        const m = sub ? { ...e, slots: { ...e.slots, [sub]: bad } } : { ...e, [f]: bad };
        expect([bad, await code(openAs(m, 'seller'))]).toEqual([bad, 'bad-signature']);
      }
    },
  );

  it('dirty trailing bits are rejected even with a fresh valid signature', async () => {
    // Same length and alphabet, valid signature over the dirty string: must still be bad-signature.
    const e = await sealB();
    expect(e.ct.endsWith('=')).toBe(true);
    const m = patchAndSign(e, { ct: dirtyBits(e.ct) }, buyer);
    expect(await code(openAs(m, 'seller'))).toBe('bad-signature');
    expect(await code(openAs({ ...e, nonce: 'AB==' }, 'seller'))).toBe('bad-signature');
    expect(await code(openAs({ ...e, nonce: 'AAB=' }, 'seller'))).toBe('bad-signature');
  });
});

describe('plaintext validation with a valid signature', () => {
  const withPadded = (padded: Uint8Array) =>
    craft({ sender: buyer, from: 'buyer', trade, seq: 1, participants, padded, wrapTo: ['seller'] });

  it.each<[string, () => Uint8Array]>([
    ['all zeros', () => new Uint8Array(256)],
    ['no 0x80 marker', () => { const p = pad(innerBytes('t', 1)); p[p.indexOf(0x80)] = 0x81; return p; }],
    ['non-zero after marker', () => { const p = pad(innerBytes('t', 1)); p[255] = 1; return p; }],
    ['not a bucket length', () => { const raw = innerBytes('t', 1); const p = new Uint8Array(300); p.set(raw); p[raw.length] = 0x80; return p; }],
    ['invalid JSON', () => pad(sodium.from_string('{"type":'))],
    ['invalid UTF-8', () => pad(new Uint8Array([0x22, 0xff, 0x22]))],
    ['extra inner key', () => pad(sodium.from_string('{"extra":1,"payload":1,"type":"t"}'))],
    ['missing type', () => pad(sodium.from_string('{"payload":1}'))],
    ['type not string', () => pad(sodium.from_string('{"payload":1,"type":5}'))],
    ['inner not object', () => pad(sodium.from_string('[1]'))],
    ['bad bigint tag', () => pad(sodium.from_string('{"payload":{"__t":"bigint","v":"1.5"},"type":"t"}'))],
    ['bigint -0', () => pad(sodium.from_string('{"payload":{"__t":"bigint","v":"-0"},"type":"t"}'))],
    ['bigint leading zero', () => pad(sodium.from_string('{"payload":{"__t":"bigint","v":"01"},"type":"t"}'))],
    ['unknown tag', () => pad(sodium.from_string('{"payload":{"__t":"date","v":"1"},"type":"t"}'))],
    ['tag with extra key', () => pad(sodium.from_string('{"payload":{"__t":"bigint","v":"1","x":1},"type":"t"}'))],
    ['too deep', () => pad(sodium.from_string(`{"payload":${'['.repeat(65)}1${']'.repeat(65)},"type":"t"}`))],
  ])('%s -> bad-signature', async (_name, mk) => {
    expect(await code(openAs(withPadded(mk()), 'seller'))).toBe('bad-signature');
  });

  it('a well-formed crafted plaintext opens (control)', async () => {
    expect((await openAs(withPadded(pad(innerBytes('t', { a: [1] }))), 'seller')).payload).toEqual({ a: [1] });
  });
});

describe('seal validation (TypeError)', () => {
  it.each<[string, () => SealOver]>([
    ['empty to', () => ({ to: [] })],
    ['unknown recipient', () => ({ to: ['admin' as Role] })],
    ['unknown from', () => ({ from: 'admin' as Role })],
    ['me not participants[from]', () => ({ me: seller })],
    ['signSecret of another key', () => ({ me: { ...buyer, signSecret: stranger.signSecret } })],
    ['signSecret short', () => ({ me: { ...buyer, signSecret: buyer.signSecret.subarray(0, 32) } })],
    ['boxSecret of another key', () => ({ me: { ...buyer, boxSecret: stranger.boxSecret } })],
    ['participant box key not derived', () => ({ participants: { ...participants, mod: { ...participants.mod, boxPublic: stranger.boxPublic } } })],
    ['participant hex upper-case', () => ({ participants: { ...participants, mod: { ...participants.mod, signPublic: participants.mod.signPublic.toUpperCase() } } })],
    ['participant missing', () => ({ participants: { buyer: participants.buyer, seller: participants.seller } as Participants })],
    ['seq negative', () => ({ seq: -1 })],
    ['seq fraction', () => ({ seq: 0.5 })],
    ['seq NaN', () => ({ seq: Number.NaN })],
    ['trade too long', () => ({ trade: 'x'.repeat(257) })],
    ['trade empty', () => ({ trade: '' })],
    ['type not a string', () => ({ type: 5 as unknown as string })],
  ])('%s', async (_n, over) => {
    await expect(sealB(1, over())).rejects.toThrow(TypeError);
  });
});

describe('deterministic fuzz', () => {
  it('200 mutated envelopes: open() only ever throws ProtocolError', async () => {
    const base = await sealB({ k: 1n }, { to: ['seller', 'mod'] });
    let seed = 0x5eed;
    const rnd = (n: number): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return seed % n;
    };
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=-_ \n\0é';
    const odd: unknown[] = [null, 0, -1, 1.5, '', [], {}, true, 'buyer', 'mod', 'x'.repeat(300), 2 ** 60];
    const paths = ['v', 'trade', 'from', 'seq', 'nonce', 'kh', 'ct', 'ctNonce', 'sig', 'slots', 'slots.buyer', 'slots.seller', 'slots.mod'];
    let threw = 0;
    for (let i = 0; i < 200; i++) {
      const e = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
      const p = paths[rnd(paths.length)] ?? 'ct';
      const [k1, k2] = p.split('.') as [string, string | undefined];
      const holder = (k2 ? e[k1] : e) as Record<string, unknown>;
      const key = k2 ?? k1;
      const cur = holder[key];
      const op = rnd(6);
      if (op === 5 || typeof cur !== 'string') {
        holder[key] = odd[rnd(odd.length)];
      } else {
        const pos = rnd(cur.length + 1);
        const ch = alphabet[rnd(alphabet.length)] ?? 'A';
        holder[key] =
          op === 0 ? cur.slice(0, pos) + ch + cur.slice(pos + 1)
          : op === 1 ? cur.slice(0, pos) + ch + cur.slice(pos)
          : op === 2 ? cur.slice(0, pos) + cur.slice(pos + 1)
          : op === 3 ? cur.toUpperCase()
          : cur + cur;
      }
      if (rnd(10) === 0) e[`x${rnd(3)}`] = 1;
      try {
        await openAs(e, rnd(2) === 0 ? 'seller' : 'mod');
      } catch (err) {
        threw++;
        if (!(err instanceof ProtocolError)) throw new Error(`mutation ${i} (${p}, op ${op}) threw non-ProtocolError: ${String(err)}`);
      }
    }
    expect(threw).toBeGreaterThan(190);
  });
});

describe('crafting helper sanity', () => {
  it('resign over the sealed body reproduces a verifiable signature', async () => {
    const e = await sealB();
    const { sig: _s, ...unsigned } = e;
    void _s;
    expect(await code(openAs({ ...e, sig: resign(unsigned, buyer) }, 'seller'))).toBe('ok');
  });
});
