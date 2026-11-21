// Chat membership design tasks 8 and 10, re-review B1: staff-web's device key is a pair of
// NON-EXTRACTABLE WebCrypto keys (Ed25519 to sign, X25519 to open re-wraps), stored as CryptoKey
// objects: no secret byte is stored anywhere, so nothing on this origin can read one. The id is
// SHA-256 of the signing key, first 32 hex.
import { createHash } from 'node:crypto';
import { chatKeyHash, encryptChat, makeModCountersign, newChatKey, unwrapChatKey, verifyModCountersign, wrapChatKey } from '@x2f/protocol';
import { describe, expect, it } from 'vitest';
import { DeviceKeyError, staffDeviceKey, type StoredDeviceKey } from '../src/keys/deviceKey.js';
import { memory } from './chatWorld.js';

const subtle = globalThis.crypto.subtle;

describe('the staff device key (B1: non-extractable WebCrypto keys)', () => {
  it('is made once and kept: the same key on the next load, its id the SHA-256 of the signing key, first 32 hex', async () => {
    const b = memory();
    const k = await staffDeviceKey(b);
    expect(k.deviceKeyId).toBe(createHash('sha256').update(Buffer.from(k.signPublic, 'hex')).digest('hex').slice(0, 32));
    const again = await staffDeviceKey(b);
    expect([again.signPublic, again.boxPublic, again.deviceKeyId]).toEqual([k.signPublic, k.boxPublic, k.deviceKeyId]);
  });

  it('stores only the public halves and two non-extractable private CryptoKeys: nothing exports, no secret bytes anywhere', async () => {
    const b = memory();
    await staffDeviceKey(b);
    const r = b.rec as StoredDeviceKey;
    expect(Object.keys(r).sort()).toEqual(['box', 'boxPublic', 'sign', 'signPublic', 'v']);
    expect(r.v).toBe(3);
    for (const [key, alg] of [[r.sign, 'Ed25519'], [r.box, 'X25519']] as const) {
      expect(key).toBeInstanceOf(CryptoKey);
      expect({ name: key.algorithm.name, type: key.type, extractable: key.extractable }).toEqual({ name: alg, type: 'private', extractable: false });
      for (const f of ['raw', 'pkcs8', 'jwk'] as const) await expect(subtle.exportKey(f, key), `${alg} ${f}`).rejects.toBeDefined();
    }
    // Nothing in the record is bytes.
    expect(Object.values(r).some((v) => v instanceof Uint8Array || v instanceof ArrayBuffer)).toBe(false);
  });

  it('signs a countersign by signPublic and opens a re-wrap to boxPublic, all inside WebCrypto', async () => {
    const k = await staffDeviceKey(memory());
    const body = await encryptChat({ trade: 'chan-1', from: 'mod', seq: 0, type: 'chat.msg', payload: { text: 'hi' }, tk: await newChatKey() });
    const c = await makeModCountersign({ body, requestId: 'a'.repeat(32), issuedAt: '2026-11-18T12:00:00.000Z', me: k.signer });
    await expect(verifyModCountersign(c, { body, signPublic: k.signPublic })).resolves.toBeDefined();
    const tk = await newChatKey();
    expect(Buffer.from(await unwrapChatKey(k.opener, await wrapChatKey(k.boxPublic, tk), await chatKeyHash(tk))).toString('hex')).toBe(Buffer.from(tk).toString('hex'));
  });

  it('an older record (v2: secret bytes under an AES key) is replaced by a new key, to certify again; a v3 record that does not check out is bad-record, never another key', async () => {
    const b = memory();
    b.rec = { v: 2, signPublic: 'a'.repeat(64), boxPublic: 'b'.repeat(64), iv: new Uint8Array(12), ct: new ArrayBuffer(112) };
    const k = await staffDeviceKey(b);
    expect(k.signPublic).not.toBe('a'.repeat(64));
    expect((b.rec as StoredDeviceKey).v).toBe(3);
    // Review N11 (d): a stored public key that is not the stored private key's.
    const other = await staffDeviceKey(memory());
    for (const bad of [{ ...(b.rec as StoredDeviceKey), boxPublic: other.boxPublic }, { ...(b.rec as StoredDeviceKey), signPublic: other.signPublic }, { ...(b.rec as StoredDeviceKey), sign: (b.rec as StoredDeviceKey).box }, { v: 3 }]) {
      const m = memory();
      m.rec = bad;
      await expect(staffDeviceKey(m)).rejects.toEqual(new DeviceKeyError('bad-record'));
      expect(m.rec).toBe(bad);
    }
  });

  it('a WebCrypto without Ed25519 or X25519 is crypto-unavailable: never a fallback to raw keys', async () => {
    const real = globalThis.crypto;
    const noEd = { getRandomValues: real.getRandomValues.bind(real), subtle: new Proxy(real.subtle, { get: (t, p) => (p === 'generateKey' ? async (alg: { name: string }, ...a: unknown[]) => { if (alg.name === 'Ed25519') throw new DOMException('no', 'NotSupportedError'); return (t.generateKey as (...x: unknown[]) => unknown)(alg, ...a); } : (t as unknown as Record<string | symbol, unknown>)[p] instanceof Function ? ((t as unknown as Record<string | symbol, (...x: unknown[]) => unknown>)[p]!).bind(t) : (t as unknown as Record<string | symbol, unknown>)[p]) }) } as unknown as Crypto;
    const b = memory();
    await expect(staffDeviceKey(b, noEd)).rejects.toEqual(new DeviceKeyError('crypto-unavailable'));
    expect(b.rec).toBeNull();
  });
});
