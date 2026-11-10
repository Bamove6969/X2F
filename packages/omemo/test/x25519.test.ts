// X25519 through node:crypto, in libsignal's raw 32-byte form, against libsignal's agreement vector.
import { describe, expect, it } from 'vitest';
import { x25519, x25519KeyPair, x25519PublicKey } from '../src/x25519.js';

// libsignal-protocol-java Curve25519Test.testAgreement (public keys without the 0x05 prefix).
const ALICE_PUBLIC = Buffer.from('1bb75966f2e93a3691dfff942bb2a466a1c08b8d78ca3f4d6df8b8bfa2e4ee28', 'hex');
const ALICE_PRIVATE = Buffer.from('c806439dc9d2c476ffed8f2580c0888d58ab406bf7ae3698879021b96bb4bf59', 'hex');
const BOB_PUBLIC = Buffer.from('653614993d2b15ee9e5fd3d86ce719ef4ec1daae1886a87b3f5fa9565a27a22f', 'hex');
const BOB_PRIVATE = Buffer.from('b03b34c33a1c44f225b662d2bf4859b8135411fa7b0386d45fb75dc5b91b4466', 'hex');
const SHARED = Buffer.from('325f239328941ced6e673b86ba41017448e99b649a9c3806c1dd7ca4c477e629', 'hex');

describe('x25519', () => {
  it("agrees on libsignal's shared secret both ways and derives libsignal's public keys", () => {
    expect(x25519(ALICE_PRIVATE, BOB_PUBLIC)).toEqual(SHARED);
    expect(x25519(BOB_PRIVATE, ALICE_PUBLIC)).toEqual(SHARED);
    expect(x25519PublicKey(ALICE_PRIVATE)).toEqual(ALICE_PUBLIC);
    expect(x25519PublicKey(BOB_PRIVATE)).toEqual(BOB_PUBLIC);
  });

  it('generates clamped 32-byte pairs whose public key is the private key’s own', () => {
    const kp = x25519KeyPair();
    expect(kp.privateKey).toHaveLength(32);
    expect(kp.publicKey).toHaveLength(32);
    expect(kp.privateKey[0]! & 7).toBe(0);
    expect(kp.privateKey[31]! & 0xc0).toBe(0x40);
    expect(x25519PublicKey(kp.privateKey)).toEqual(kp.publicKey);
    expect(x25519KeyPair().publicKey.equals(kp.publicKey)).toBe(false);
  });

  it('refuses keys that are not 32 bytes', () => {
    expect(() => x25519(Buffer.alloc(31), BOB_PUBLIC)).toThrow();
    expect(() => x25519(ALICE_PRIVATE, Buffer.alloc(33))).toThrow();
    expect(() => x25519PublicKey(Buffer.alloc(0))).toThrow();
  });
});
