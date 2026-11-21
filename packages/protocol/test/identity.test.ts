import { describe, expect, it } from 'vitest';
import sodium from 'libsodium-wrappers';
import { generateIdentity, identityKeysMatch, joinMessage, signProof } from '../src/index.js';

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

describe('signProof', () => {
  const msg = (t: string): Uint8Array => new TextEncoder().encode(`x2f/test/v1\0${t}`);

  it('is a detached Ed25519 signature by the identity over the bytes, as 128 lower-case hex characters', async () => {
    const id = await generateIdentity();
    const proof = await signProof(id, msg('hello'));
    expect(proof).toMatch(/^[0-9a-f]{128}$/);
    const pk = sodium.from_hex(id.signPublic);
    expect(sodium.crypto_sign_verify_detached(sodium.from_hex(proof), msg('hello'), pk)).toBe(true);
    expect(sodium.crypto_sign_verify_detached(sodium.from_hex(proof), msg('hellp'), pk)).toBe(false);
    const other = await generateIdentity();
    expect(sodium.crypto_sign_verify_detached(sodium.from_hex(proof), msg('hello'), sodium.from_hex(other.signPublic))).toBe(false);
  });

  it('refuses an identity whose signSecret does not match signPublic, or non-byte input (TypeError)', async () => {
    const [a, b] = await Promise.all([generateIdentity(), generateIdentity()]);
    await expect(signProof({ ...a, signPublic: b.signPublic }, msg('x'))).rejects.toThrow(TypeError);
    await expect(signProof({ ...a, signSecret: b.signSecret }, msg('x'))).rejects.toThrow(TypeError);
    await expect(signProof({ ...a, signSecret: a.signSecret.subarray(0, 63) }, msg('x'))).rejects.toThrow(TypeError);
    await expect(signProof({ ...a, signPublic: a.signPublic.toUpperCase() }, msg('x'))).rejects.toThrow(TypeError);
    await expect(signProof(a, 'x' as unknown as Uint8Array)).rejects.toThrow(TypeError);
  });
});

describe('joinMessage', () => {
  const c = 'A'.repeat(43) + '=';
  const c2 = 'B'.repeat(42) + 'A=';

  it('is the domain-separated, NUL-joined bytes', () => {
    const m = joinMessage('K7M2-9QXA-4FTR-8WPN', 'seller', c);
    expect(m).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(m)).toBe(`x2f/relay-join/v1\0K7M2-9QXA-4FTR-8WPN\0seller\0${c}`);
  });

  it('differs by role, code and challenge', () => {
    const d = (m: Uint8Array) => new TextDecoder().decode(m);
    const base = d(joinMessage('A', 'buyer', c));
    expect(d(joinMessage('A', 'seller', c))).not.toBe(base);
    expect(d(joinMessage('B', 'buyer', c))).not.toBe(base);
    expect(d(joinMessage('A', 'buyer', c2))).not.toBe(base);
  });

  it('rejects an unknown role or a NUL inside the code', () => {
    expect(() => joinMessage('A', 'admin' as 'buyer', c)).toThrow(TypeError);
    expect(() => joinMessage('A\0', 'buyer', c)).toThrow(TypeError);
    expect(() => joinMessage('A', 'buyer', `${c}\0`)).toThrow(TypeError);
  });
});

describe('identityKeysMatch (review lead-mod-chat N11 d)', () => {
  it('true only when both secrets are the public keys\' own', async () => {
    const a = await generateIdentity();
    const b = await generateIdentity();
    expect(await identityKeysMatch(a)).toBe(true);
    expect(await identityKeysMatch({ ...a, boxPublic: b.boxPublic })).toBe(false);
    expect(await identityKeysMatch({ ...a, boxSecret: b.boxSecret })).toBe(false);
    expect(await identityKeysMatch({ ...a, signPublic: b.signPublic })).toBe(false);
    // A secret key whose seed is another key's, with this public half pasted on.
    expect(await identityKeysMatch({ ...a, signSecret: new Uint8Array([...b.signSecret.subarray(0, 32), ...a.signSecret.subarray(32)]) })).toBe(false);
    expect(await identityKeysMatch({ ...a, boxSecret: new Uint8Array(31) })).toBe(false);
  });
});
