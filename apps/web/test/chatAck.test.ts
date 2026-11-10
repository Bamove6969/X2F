// J-23 (S-075) phase 1 groundwork: the account chat key keeper in the worker (chat/ack.ts). Two
// devices, two stores: one makes the key, seals it to the other's device key; the other opens it.
// No key ever appears in a result.
import { generateBoxKeyPair, openSealed, sealTo } from '@x2f/protocol';
import sodium from 'libsodium-wrappers';
import { beforeAll, describe, expect, it } from 'vitest';
import { ACK_BYTES, createAckKeeper, fromBase64Url, toBase64Url, type AckKeeper } from '../src/chat/ack.js';
import { memoryChatStore } from '../src/chat/store.js';

beforeAll(async () => {
  await sodium.ready;
});

/** A device: its own store and keeper. */
function device(random?: (n: number) => Uint8Array) {
  const store = memoryChatStore();
  const keeper = createAckKeeper({ store, newBoxKeyPair: generateBoxKeyPair, ...(random ? { random } : {}) });
  /** The stored key (hex) and epoch, read straight from the store: tests only. */
  const held = () => (store.account === null ? null : (JSON.parse(store.account) as { ack: { key: string; epoch: number } | null }).ack);
  return { store, keeper, held };
}

describe('the device key', () => {
  it('is made on first use, saved, and the same afterwards, for a new keeper on the same store too', async () => {
    const a = device();
    expect(a.store.account).toBeNull();
    const pub = await a.keeper.devicePublic();
    expect(pub).toMatch(/^[0-9a-f]{64}$/);
    expect(await a.keeper.devicePublic()).toBe(pub);
    const again = createAckKeeper({ store: a.store, newBoxKeyPair: generateBoxKeyPair });
    expect(await again.devicePublic()).toBe(pub);
    const rec = JSON.parse(a.store.account!) as { v: number; deviceKey: { boxPublic: string; boxSecret: string }; ack: unknown };
    expect(rec.v).toBe(1);
    expect(rec.deviceKey.boxPublic).toBe(pub);
    expect(sodium.to_hex(sodium.crypto_scalarmult_base(sodium.from_hex(rec.deviceKey.boxSecret)))).toBe(pub);
    expect(rec.ack).toBeNull();
    expect(await a.keeper.status()).toEqual({ hasKey: false, epoch: null });
    // Another device has another key.
    expect(await device().keeper.devicePublic()).not.toBe(pub);
  });
});

describe('making and sealing the key', () => {
  it('without a key there is nothing to seal; makeKey draws 32 random bytes once and never replaces a key held', async () => {
    const draws: number[] = [];
    const a = device((n) => {
      draws.push(n);
      return sodium.randombytes_buf(n);
    });
    expect(await a.keeper.sealFor('ab'.repeat(32))).toBeNull();
    expect(await a.keeper.makeKey(0)).toEqual({ epoch: 0 });
    expect(draws).toEqual([ACK_BYTES]);
    const first = a.held();
    expect(first!.key).toMatch(/^[0-9a-f]{64}$/);
    expect(first!.epoch).toBe(0);
    expect(await a.keeper.makeKey(5)).toEqual({ epoch: 0 });
    expect(a.held()).toEqual(first);
    expect(draws).toEqual([ACK_BYTES]);
    expect(await a.keeper.status()).toEqual({ hasKey: true, epoch: 0 });
    await expect(a.keeper.makeKey(-1)).rejects.toThrow(TypeError);
    await expect(a.keeper.makeKey(1.5)).rejects.toThrow(TypeError);
  });

  it('sealFor is a crypto_box_seal of the key to the recipient, base64url, with the epoch', async () => {
    const a = device();
    await a.keeper.makeKey(2);
    const recipient = await generateBoxKeyPair();
    const out = (await a.keeper.sealFor(recipient.boxPublic))!;
    expect(out.epoch).toBe(2);
    expect(out.sealed).toMatch(/^[A-Za-z0-9_-]+$/);
    const bytes = fromBase64Url(out.sealed)!;
    expect(bytes).toHaveLength(ACK_BYTES + 48);
    expect(sodium.to_hex(await openSealed(recipient, bytes))).toBe(a.held()!.key);
    // Never to a malformed key.
    await expect(a.keeper.sealFor('AB'.repeat(32))).rejects.toThrow(TypeError);
    await expect(a.keeper.sealFor('ab'.repeat(31))).rejects.toThrow(TypeError);
  });
});

describe('the handover between two devices', () => {
  async function handover(): Promise<{ a: ReturnType<typeof device>; b: ReturnType<typeof device>; sealed: string }> {
    const a = device();
    const b = device();
    await a.keeper.makeKey(0);
    const sealed = (await a.keeper.sealFor(await b.keeper.devicePublic()))!;
    return { a, b, sealed: sealed.sealed };
  }

  it('the receiving device opens the box with its device secret and then holds the same key at the same epoch; it can hand it on', async () => {
    const { a, b, sealed } = await handover();
    expect(b.held()).toBeNull();
    expect(await b.keeper.open({ sealed, epoch: 0 })).toBe('opened');
    expect(b.held()).toEqual(a.held());
    expect(await b.keeper.status()).toEqual({ hasKey: true, epoch: 0 });
    // The same box again changes nothing.
    expect(await b.keeper.open({ sealed, epoch: 0 })).toBe('already');
    // b hands it to a third device.
    const c = device();
    const onward = (await b.keeper.sealFor(await c.keeper.devicePublic()))!;
    expect(await c.keeper.open(onward)).toBe('opened');
    expect(c.held()).toEqual(a.held());
  });

  it('a box sealed to another device, tampered or truncated is not-for-me; a box whose content is not a 32-byte key is bad-envelope; nothing is stored', async () => {
    const { b, sealed } = await handover();
    const other = device();
    expect(await other.keeper.open({ sealed, epoch: 0 })).toBe('not-for-me');
    expect(other.held()).toBeNull();
    const bytes = fromBase64Url(sealed)!;
    const tampered = new Uint8Array(bytes);
    tampered[5]! ^= 0x40;
    expect(await b.keeper.open({ sealed: toBase64Url(tampered), epoch: 0 })).toBe('not-for-me');
    expect(await b.keeper.open({ sealed: toBase64Url(bytes.subarray(0, bytes.length - 1)), epoch: 0 })).toBe('not-for-me');
    const short = await sealTo(await b.keeper.devicePublic(), new Uint8Array(31));
    expect(await b.keeper.open({ sealed: toBase64Url(short), epoch: 0 })).toBe('bad-envelope');
    for (const bad of ['', 'not base64url!', `${sealed}=`, 42 as unknown as string]) expect(await b.keeper.open({ sealed: bad, epoch: 0 })).toBe('bad-envelope');
    expect(await b.keeper.open({ sealed, epoch: -1 })).toBe('bad-envelope');
    expect(await b.keeper.open({ sealed, epoch: 1.5 })).toBe('bad-envelope');
    expect(await b.keeper.open(null as unknown as { sealed: string; epoch: number })).toBe('bad-envelope');
    expect(b.held()).toBeNull();
    // The good box still opens after all that.
    expect(await b.keeper.open({ sealed, epoch: 0 })).toBe('opened');
  });

  it('an older epoch than the key held is stale-epoch and keeps the key; a newer one replaces it', async () => {
    const a = device();
    const b = device();
    await a.keeper.makeKey(1);
    await b.keeper.makeKey(2);
    const old = (await a.keeper.sealFor(await b.keeper.devicePublic()))!;
    const before = b.held();
    expect(await b.keeper.open(old)).toBe('stale-epoch');
    expect(b.held()).toEqual(before);
    const newer = (await b.keeper.sealFor(await a.keeper.devicePublic()))!;
    expect(await a.keeper.open(newer)).toBe('opened');
    expect(a.held()).toEqual(b.held());
    expect(await a.keeper.status()).toEqual({ hasKey: true, epoch: 2 });
  });

  it('forget erases the device key and the chat key; the next use makes a new device key', async () => {
    const { b, sealed } = await handover();
    const pub = await b.keeper.devicePublic();
    expect(await b.keeper.open({ sealed, epoch: 0 })).toBe('opened');
    await b.keeper.forget();
    expect(b.store.account).toBeNull();
    expect(await b.keeper.status()).toEqual({ hasKey: false, epoch: null });
    expect(await b.keeper.devicePublic()).not.toBe(pub);
    // The old box was for the old device key.
    expect(await b.keeper.open({ sealed, epoch: 0 })).toBe('not-for-me');
  });

  it('no result ever carries the key or the device secret', async () => {
    const { a, b, sealed } = await handover();
    const results: unknown[] = [
      await a.keeper.devicePublic(), await a.keeper.status(), await a.keeper.makeKey(0), await a.keeper.sealFor(await b.keeper.devicePublic()),
      await b.keeper.open({ sealed, epoch: 0 }), await b.keeper.status(),
    ];
    const text = JSON.stringify(results);
    for (const d of [a, b]) {
      const rec = JSON.parse(d.store.account!) as { deviceKey: { boxSecret: string }; ack: { key: string } };
      expect(text).not.toContain(rec.ack.key);
      expect(text).not.toContain(rec.deviceKey.boxSecret);
      expect(text).not.toContain(toBase64Url(sodium.from_hex(rec.ack.key)));
    }
  });

  it('serialises: two opens racing on one device end with one stored key, and sealFor after them sees it', async () => {
    const a = device();
    const b = device();
    await a.keeper.makeKey(0);
    const pubB = await b.keeper.devicePublic();
    const x = (await a.keeper.sealFor(pubB))!;
    const y = (await a.keeper.sealFor(pubB))!;
    const [r1, r2, after] = await Promise.all([b.keeper.open(x), b.keeper.open(y), b.keeper.status()]);
    expect([r1, r2].sort()).toEqual(['already', 'opened']);
    expect(after).toEqual({ hasKey: true, epoch: 0 });
    expect(b.held()).toEqual(a.held());
  });
});

describe('base64url helpers', () => {
  it('round-trip and refuse what is not canonical base64url', () => {
    for (const n of [0, 1, 2, 3, 31, 32, 80, 1024]) {
      const bytes = sodium.randombytes_buf(n);
      const s = toBase64Url(bytes);
      expect(s).not.toMatch(/[+/=]/);
      if (n > 0) expect(fromBase64Url(s)).toEqual(bytes);
    }
    expect(fromBase64Url('')).toBeNull();
    expect(fromBase64Url('AAA=')).toBeNull();
    expect(fromBase64Url('A+')).toBeNull();
    // 'AQ' is 000000 010000: the byte 0x01 and four zero bits.
    expect(fromBase64Url('AQ')).toEqual(new Uint8Array([0x01]));
    // Non-canonical trailing bits are refused: 'AC' decodes to one byte that re-encodes as 'AA'.
    expect(fromBase64Url('AC')).toBeNull();
  });
});
