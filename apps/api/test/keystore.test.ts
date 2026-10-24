import { createCipheriv, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { keyringBox } from '../src/auth/keystore.js';
import type { Keyring } from '../src/config.js';

const key = (fill: number) => new Uint8Array(Buffer.alloc(32, fill));
const ring = (current: number, ...ids: number[]): Keyring => ({ current, keys: new Map(ids.map((id) => [id, key(id)])) });
const SECRET = new Uint8Array(randomBytes(20));
const CTX = 'x2f/totp/0b6f4a52-5f1e-4f7d-9a3c-2d8f1e6b7c90';

/** A format-0 blob as Plan 2 sealed it: 0x00 ‖ nonce ‖ AES-256-GCM(secret, aad = context) ‖ tag. */
function legacySeal(k: Uint8Array, plain: Uint8Array, context: string): Buffer {
  const nonce = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', k, nonce, { authTagLength: 16 });
  c.setAAD(Buffer.from(context, 'utf8'));
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([Buffer.from([0]), nonce, body, c.getAuthTag()]);
}

describe('keyringBox (the file/env key store, FU-C)', () => {
  it('seals under the current key with a versioned header and opens it again', () => {
    const box = keyringBox(ring(2, 2, 1));
    const sealed = box.seal(SECRET, CTX);
    expect([...sealed.subarray(0, 3)]).toEqual([0x01, 0x00, 0x02]);
    expect(sealed).toHaveLength(3 + 12 + SECRET.length + 16);
    expect(sealed.indexOf(Buffer.from(SECRET))).toBe(-1);
    expect(Buffer.from(box.open(sealed, CTX))).toEqual(Buffer.from(SECRET));
    expect(box.isCurrent(sealed)).toBe(true);
    expect(box.seal(SECRET, CTX)).not.toEqual(sealed); // fresh nonce each time
  });

  it('refuses another context, a tampered body and a header switched to another key of the ring', () => {
    const box = keyringBox(ring(2, 2, 1));
    const sealed = box.seal(SECRET, CTX);
    expect(() => box.open(sealed, `${CTX}x`)).toThrow();
    const flipped = Buffer.from(sealed);
    flipped[10] ^= 1;
    expect(() => box.open(flipped, CTX)).toThrow();
    const switched = Buffer.from(sealed);
    switched[2] = 1;
    expect(() => box.open(switched, CTX)).toThrow();
  });

  it('opens a blob of an older key in the ring (not current); refuses a key id the ring no longer holds', () => {
    const old = keyringBox(ring(1, 1)).seal(SECRET, CTX);
    const rotated = keyringBox(ring(2, 2, 1));
    expect(Buffer.from(rotated.open(old, CTX))).toEqual(Buffer.from(SECRET));
    expect(rotated.isCurrent(old)).toBe(false);
    expect(rotated.isCurrent(rotated.seal(rotated.open(old, CTX), CTX))).toBe(true);
    expect(() => keyringBox(ring(2, 2)).open(old, CTX)).toThrow(/key 1/);
  });

  it('opens a format-0 blob only with the legacy key, and never counts it as current', () => {
    const legacyKey = key(99);
    const sealed = legacySeal(legacyKey, SECRET, CTX);
    const box = keyringBox(ring(1, 1), legacyKey);
    expect(Buffer.from(box.open(sealed, CTX))).toEqual(Buffer.from(SECRET));
    expect(box.isCurrent(sealed)).toBe(false);
    expect(() => box.open(sealed, `${CTX}x`)).toThrow();
    expect(() => keyringBox(ring(1, 1)).open(sealed, CTX)).toThrow(/format 0/);
  });

  it('refuses unknown formats and short blobs', () => {
    const box = keyringBox(ring(1, 1), key(99));
    const sealed = box.seal(SECRET, CTX);
    const v9 = Buffer.from(sealed);
    v9[0] = 9;
    expect(() => box.open(v9, CTX)).toThrow(/format/);
    expect(box.isCurrent(v9)).toBe(false);
    expect(() => box.open(sealed.subarray(0, 3 + 12 + 15), CTX)).toThrow(/malformed/);
    expect(() => box.open(Buffer.alloc(0), CTX)).toThrow(/malformed/);
    expect(box.isCurrent(Buffer.alloc(0))).toBe(false);
  });
});
