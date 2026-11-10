// J-23 (S-075) groundwork: sealed boxes for the chat-key handover between a person's own devices
// (docs/security/multi-device-2026-11-09.md, section 4). REVIEW-PROTOCOL: a Task 3 protocol change.
import sodium from 'libsodium-wrappers';
import { describe, expect, it } from 'vitest';
import { SEALED_OVERHEAD, generateBoxKeyPair, generateIdentity, openSealed, sealTo } from '../src/index.js';

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('generateBoxKeyPair', () => {
  it('is a fresh X25519 pair: a 64-hex public key and a 32-byte secret that derives it', async () => {
    const kp = await generateBoxKeyPair();
    await sodium.ready;
    expect(kp.boxPublic).toMatch(/^[0-9a-f]{64}$/);
    expect(kp.boxSecret).toBeInstanceOf(Uint8Array);
    expect(kp.boxSecret).toHaveLength(32);
    expect(sodium.to_hex(sodium.crypto_scalarmult_base(kp.boxSecret))).toBe(kp.boxPublic);
    const other = await generateBoxKeyPair();
    expect(other.boxPublic).not.toBe(kp.boxPublic);
  });
});

describe('sealTo / openSealed', () => {
  it('round-trips: only the holder of the recipient secret opens it; the sealed bytes are the plaintext plus SEALED_OVERHEAD', async () => {
    const device = await generateBoxKeyPair();
    const ack = sodium.randombytes_buf(32);
    const sealed = await sealTo(device.boxPublic, ack);
    expect(sealed).toBeInstanceOf(Uint8Array);
    expect(sealed).toHaveLength(32 + SEALED_OVERHEAD);
    expect(SEALED_OVERHEAD).toBe(48);
    expect(await openSealed(device, sealed)).toEqual(ack);
    // The sealed bytes never carry the plaintext in the clear.
    expect(sodium.to_hex(sealed)).not.toContain(sodium.to_hex(ack));
  });

  it('is a libsodium crypto_box_seal: libsodium itself opens what sealTo made, and sealTo-less boxes open with openSealed', async () => {
    await sodium.ready;
    const kp = sodium.crypto_box_keypair();
    const device = { boxPublic: sodium.to_hex(kp.publicKey), boxSecret: kp.privateKey };
    const sealed = await sealTo(device.boxPublic, bytes('hello'));
    expect(sodium.crypto_box_seal_open(sealed, kp.publicKey, kp.privateKey)).toEqual(bytes('hello'));
    const theirs = sodium.crypto_box_seal(bytes('from libsodium'), kp.publicKey);
    expect(await openSealed(device, theirs)).toEqual(bytes('from libsodium'));
  });

  it('a chat identity (its X25519 box keys) is a recipient too', async () => {
    const me = await generateIdentity();
    const sealed = await sealTo(me.boxPublic, bytes('to an identity'));
    expect(await openSealed(me, sealed)).toEqual(bytes('to an identity'));
  });

  it('each seal uses a fresh ephemeral key: two seals of the same bytes differ', async () => {
    const device = await generateBoxKeyPair();
    const a = await sealTo(device.boxPublic, bytes('same'));
    const b = await sealTo(device.boxPublic, bytes('same'));
    expect(sodium.to_hex(a)).not.toBe(sodium.to_hex(b));
  });

  it('the wrong key, a tampered byte, a truncated box and a box too short to be one all fail with ProtocolError not-for-me', async () => {
    const device = await generateBoxKeyPair();
    const other = await generateBoxKeyPair();
    const sealed = await sealTo(device.boxPublic, bytes('secret'));
    await expect(openSealed(other, sealed)).rejects.toMatchObject({ name: 'ProtocolError', code: 'not-for-me' });
    const tampered = new Uint8Array(sealed);
    tampered[tampered.length - 1]! ^= 1;
    await expect(openSealed(device, tampered)).rejects.toMatchObject({ name: 'ProtocolError', code: 'not-for-me' });
    await expect(openSealed(device, sealed.subarray(0, sealed.length - 1))).rejects.toMatchObject({ name: 'ProtocolError', code: 'not-for-me' });
    await expect(openSealed(device, new Uint8Array(SEALED_OVERHEAD - 1))).rejects.toMatchObject({ name: 'ProtocolError', code: 'not-for-me' });
    // The right key still opens the untouched box.
    expect(await openSealed(device, sealed)).toEqual(bytes('secret'));
  });

  it('refuses a mixed-up recipient (secret not matching the public key), bad hex and non-byte input with TypeError, before any cryptography', async () => {
    const device = await generateBoxKeyPair();
    const other = await generateBoxKeyPair();
    const sealed = await sealTo(device.boxPublic, bytes('x'));
    await expect(openSealed({ boxPublic: device.boxPublic, boxSecret: other.boxSecret }, sealed)).rejects.toThrow(TypeError);
    await expect(openSealed({ boxPublic: device.boxPublic.toUpperCase(), boxSecret: device.boxSecret }, sealed)).rejects.toThrow(TypeError);
    await expect(openSealed({ boxPublic: device.boxPublic, boxSecret: device.boxSecret.subarray(0, 31) }, sealed)).rejects.toThrow(TypeError);
    await expect(openSealed(device, 'not bytes' as unknown as Uint8Array)).rejects.toThrow(TypeError);
    await expect(sealTo('zz'.repeat(32), bytes('x'))).rejects.toThrow(TypeError);
    await expect(sealTo(device.boxPublic.slice(1), bytes('x'))).rejects.toThrow(TypeError);
    await expect(sealTo(device.boxPublic.toUpperCase(), bytes('x'))).rejects.toThrow(TypeError);
    await expect(sealTo(device.boxPublic, 'x' as unknown as Uint8Array)).rejects.toThrow(TypeError);
  });

  it('seals an empty message and a large one', async () => {
    const device = await generateBoxKeyPair();
    expect(await openSealed(device, await sealTo(device.boxPublic, new Uint8Array(0)))).toEqual(new Uint8Array(0));
    const big = sodium.randombytes_buf(16_384);
    expect(await openSealed(device, await sealTo(device.boxPublic, big))).toEqual(big);
  });
});
