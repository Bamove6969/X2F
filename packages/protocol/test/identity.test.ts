import { describe, expect, it } from 'vitest';
import sodium from 'libsodium-wrappers';
import { generateIdentity, joinMessage } from '../src/index.js';

describe('generateIdentity', () => {
  it('Ed25519 signing keys with derived X25519 box keys', async () => {
    const id = await generateIdentity();
    await sodium.ready;
    expect(id.signPublic).toMatch(/^[0-9a-f]{64}$/);
    expect(id.boxPublic).toMatch(/^[0-9a-f]{64}$/);
    expect(id.signSecret).toHaveLength(64);
    expect(id.boxSecret).toHaveLength(32);
    expect(id.boxPublic).toBe(sodium.to_hex(sodium.crypto_sign_ed25519_pk_to_curve25519(sodium.from_hex(id.signPublic))));
    expect(sodium.to_hex(sodium.crypto_scalarmult_base(id.boxSecret))).toBe(id.boxPublic);
    expect(sodium.to_hex(id.signSecret.subarray(32))).toBe(id.signPublic);
  });

  it('fresh keys each call', async () => {
    const [a, b] = await Promise.all([generateIdentity(), generateIdentity()]);
    expect(a.signPublic).not.toBe(b.signPublic);
  });
});

describe('joinMessage', () => {
  it('is the domain-separated, NUL-joined bytes', () => {
    const m = joinMessage('K7M2-9QXA-4FTR-8WPN', 'seller', 'Y2hhbGxlbmdl');
    expect(m).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(m)).toBe('x2f/relay-join/v1\0K7M2-9QXA-4FTR-8WPN\0seller\0Y2hhbGxlbmdl');
  });

  it('differs by role, code and challenge', () => {
    const d = (m: Uint8Array) => new TextDecoder().decode(m);
    const base = d(joinMessage('A', 'buyer', 'c'));
    expect(d(joinMessage('A', 'seller', 'c'))).not.toBe(base);
    expect(d(joinMessage('B', 'buyer', 'c'))).not.toBe(base);
    expect(d(joinMessage('A', 'buyer', 'd'))).not.toBe(base);
  });

  it('rejects an unknown role or a NUL inside a part', () => {
    expect(() => joinMessage('A', 'admin' as 'buyer', 'c')).toThrow(TypeError);
    expect(() => joinMessage('A\0', 'buyer', 'c')).toThrow(TypeError);
    expect(() => joinMessage('A', 'buyer', 'c\0')).toThrow(TypeError);
  });
});
