// Chat membership design task 8: staff-web makes and keeps its device key. The secrets are stored
// only sealed under a non-extractable AES-GCM key; the id is SHA-256 of the signing key, first 32 hex.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DeviceKeyError, staffDeviceKey, wipeIdentity, type DeviceKeyBackend, type StoredDeviceKey } from '../src/device/deviceKey.js';

function memory(): DeviceKeyBackend & { wrap: CryptoKey | null; rec: StoredDeviceKey | null } {
  const m = {
    wrap: null as CryptoKey | null,
    rec: null as StoredDeviceKey | null,
    async load() {
      return { wrap: m.wrap, rec: m.rec };
    },
    async save(wrap: CryptoKey, rec: StoredDeviceKey) {
      m.wrap = wrap;
      m.rec = rec;
    },
  };
  return m;
}

describe('the staff device key', () => {
  it('is made once and kept: the same key on the next load, its id the SHA-256 of the signing key, first 32 hex', async () => {
    const b = memory();
    const k = await staffDeviceKey(b);
    expect(k.deviceKeyId).toBe(createHash('sha256').update(Buffer.from(k.signPublic, 'hex')).digest('hex').slice(0, 32));
    const again = await staffDeviceKey(b);
    expect([again.signPublic, again.boxPublic, again.deviceKeyId]).toEqual([k.signPublic, k.boxPublic, k.deviceKeyId]);
  });

  it('keeps the secrets only sealed under a non-extractable key, and opens them to the stored public key', async () => {
    const b = memory();
    const k = await staffDeviceKey(b);
    expect(b.wrap!.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', b.wrap!)).rejects.toBeDefined();
    const id = await k.identity();
    const secretHex = Buffer.from(id.signSecret).toString('hex');
    expect(Buffer.from(id.signSecret.subarray(32)).toString('hex')).toBe(k.signPublic);
    const stored = JSON.stringify({ ...b.rec, ct: Buffer.from(b.rec!.ct).toString('hex') });
    expect(stored).not.toContain(secretHex);
    expect(stored).not.toContain(secretHex.slice(0, 64));
    wipeIdentity(id);
    expect(id.signSecret.every((x) => x === 0)).toBe(true);
  });

  it('a record that does not open (another wrap key, a flipped byte) is bad-record, never another key', async () => {
    const b = memory();
    const k = await staffDeviceKey(b);
    b.wrap = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const swapped = await staffDeviceKey(b);
    expect(swapped.signPublic).toBe(k.signPublic);
    await expect(swapped.identity()).rejects.toEqual(new DeviceKeyError('bad-record'));
  });

  it('review N11 (d): a stored box key that is not the stored secret\'s is bad-record', async () => {
    const b = memory();
    await staffDeviceKey(b);
    const other = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
    b.rec = { ...b.rec!, boxPublic: other };
    await expect((await staffDeviceKey(b)).identity()).rejects.toEqual(new DeviceKeyError('bad-record'));
  });
});
