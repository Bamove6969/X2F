// XEdDSA (Signal's signature scheme over Curve25519 keys): our own Ed25519 point arithmetic, checked
// against libsignal's known-answer vectors (Curve25519Test), against OpenSSL's Ed25519 for random
// keys (the differential test), and against the verifier.
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { clampScalar, edwardsPublicKey, identityFromSeed, montgomeryFromEdwards, newIdentitySeed, xeddsaSign, xeddsaSigner, xeddsaVerify } from '../src/edwards.js';
import { x25519, x25519KeyPair, x25519PublicKey } from '../src/x25519.js';

// libsignal-protocol-java, tests/.../ecc/Curve25519Test.java testSignature (keys in libsignal's 0x05-prefixed form).
const ALICE_IDENTITY_PRIVATE = Buffer.from('c097248412e58bf05df487968205132794178e367637f5818f81e0e6ce73e865', 'hex');
const ALICE_IDENTITY_PUBLIC = Buffer.from('05ab7e717d4a163b7d9a1d8071dfe9dcf8cdcd1cea3339b6356be84d887e322c64', 'hex');
const ALICE_EPHEMERAL_PUBLIC = Buffer.from('05edce9d9c415ca78cb7252e72c2c4a554d3eb29485a0e1d503118d1a82d99fb4a', 'hex');
const ALICE_SIGNATURE = Buffer.from(
  '5de88ca9a89b4a115da79109c67c9c7464a3e4180274f1cb8c63c2984e286dfbede82deb9dcd9fae0bfbb821569b3d9001bd8130cd11d486cef047bd60b86e88', 'hex',
);

describe('XEdDSA: libsignal known-answer vectors', () => {
  it('verifies the signature libsignal made, and refuses every one-bit change to it', () => {
    expect(ALICE_IDENTITY_PRIVATE).toHaveLength(32);
    expect(xeddsaVerify(ALICE_IDENTITY_PUBLIC.subarray(1), ALICE_EPHEMERAL_PUBLIC, ALICE_SIGNATURE)).toBe(true);
    for (let i = 0; i < 64; i++) {
      const bad = Buffer.from(ALICE_SIGNATURE);
      bad[i] = bad[i]! ^ 0x01;
      expect(xeddsaVerify(ALICE_IDENTITY_PUBLIC.subarray(1), ALICE_EPHEMERAL_PUBLIC, bad), `byte ${i}`).toBe(false);
    }
  });

  it("derives Alice's public key from her private key (Montgomery, through our Edwards arithmetic and through X25519)", () => {
    const a = clampScalar(ALICE_IDENTITY_PRIVATE);
    expect(montgomeryFromEdwards(edwardsPublicKey(a))).toEqual(ALICE_IDENTITY_PUBLIC.subarray(1));
    expect(x25519PublicKey(ALICE_IDENTITY_PRIVATE)).toEqual(ALICE_IDENTITY_PUBLIC.subarray(1));
  });

  it("signs with Alice's private key so that libsignal's verifier (ours, which matches it on the vector) accepts it", () => {
    for (let i = 0; i < 8; i++) {
      const sig = xeddsaSign(ALICE_IDENTITY_PRIVATE, ALICE_EPHEMERAL_PUBLIC, randomBytes(64));
      expect(sig).toHaveLength(64);
      expect(xeddsaVerify(ALICE_IDENTITY_PUBLIC.subarray(1), ALICE_EPHEMERAL_PUBLIC, sig)).toBe(true);
      // The nonce is random: two signatures of one message differ (so a leaked signature says nothing about the key).
      expect(sig.equals(ALICE_SIGNATURE)).toBe(false);
    }
  });
});

describe('XEdDSA: differential test against OpenSSL', () => {
  it('our scalar multiplication of the base point matches Ed25519 public keys from node:crypto for 200 random seeds', () => {
    for (let i = 0; i < 200; i++) {
      const { publicKey, privateKey } = generateKeyPairSync('ed25519');
      const seed = Buffer.from(privateKey.export({ format: 'jwk' }).d!, 'base64url');
      const expected = Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url');
      const a = clampScalar(createHash('sha512').update(seed).digest().subarray(0, 32));
      expect(edwardsPublicKey(a).equals(expected), `seed ${i}`).toBe(true);
    }
  });

  it('for 100 random Curve25519 keys: the Edwards key maps to the X25519 public key, and a signature verifies only for its key and message', () => {
    for (let i = 0; i < 100; i++) {
      const priv = randomBytes(32);
      const mont = x25519PublicKey(priv);
      expect(montgomeryFromEdwards(edwardsPublicKey(clampScalar(priv)))).toEqual(mont);
      const msg = randomBytes(1 + (i % 70));
      const sig = xeddsaSign(priv, msg, randomBytes(64));
      expect(xeddsaVerify(mont, msg, sig)).toBe(true);
      expect(xeddsaVerify(x25519PublicKey(randomBytes(32)), msg, sig)).toBe(false);
      const other = Buffer.from(msg);
      other[0] = other[0]! ^ 0x80;
      expect(xeddsaVerify(mont, other, sig)).toBe(false);
    }
  });

  it("review L1 (lead decision): X2F's identity is an Ed25519 key pair from a seed; OpenSSL signs, and the result is a XEdDSA signature under the derived Curve25519 key", () => {
    for (let i = 0; i < 100; i++) {
      const seed = newIdentitySeed();
      expect(seed).toHaveLength(32);
      const id = identityFromSeed(seed);
      // The X25519 identity scalar is a = clamp(SHA-512(seed)[0..32]); its Montgomery key is the Ed25519 public key's u = (1 + y)/(1 - y).
      const a = clampScalar(createHash('sha512').update(seed).digest().subarray(0, 32));
      expect(id.privateKey).toEqual(a);
      expect(id.publicKey).toEqual(x25519PublicKey(a));
      expect(id.publicKey).toEqual(montgomeryFromEdwards(id.edwardsPublicKey));
      expect(id.edwardsPublicKey).toEqual(edwardsPublicKey(a));
      // The same seed gives the same identity (what the sealed row holds).
      expect(identityFromSeed(seed)).toMatchObject({ publicKey: id.publicKey, privateKey: a });
      const msg = randomBytes(1 + (i % 70));
      const sig = id.sign(msg);
      expect(sig).toHaveLength(64);
      expect(sig[63]! >> 7, 'sign bit of A carried in S[63]').toBe(id.edwardsPublicKey[31]! >> 7);
      expect(xeddsaVerify(id.publicKey, msg, sig)).toBe(true);
      // Deterministic (Ed25519): no nonce, so nothing about the key depends on randomness at signing time.
      expect(id.sign(msg).equals(sig)).toBe(true);
      // The hand-written signer over the same scalar is interchangeable with it (both are XEdDSA under a, A).
      expect(xeddsaVerify(id.publicKey, msg, xeddsaSign(a, msg, randomBytes(64)))).toBe(true);
      expect(xeddsaVerify(id.publicKey, msg, xeddsaSigner(a).sign(msg))).toBe(true);
      // Not under another key, not of another message, not with the sign bit flipped.
      expect(xeddsaVerify(identityFromSeed(newIdentitySeed()).publicKey, msg, sig)).toBe(false);
      const other = Buffer.from(msg);
      other[0] = other[0]! ^ 0x01;
      expect(xeddsaVerify(id.publicKey, other, sig)).toBe(false);
      const flipped = Buffer.from(sig);
      flipped[63] = flipped[63]! ^ 0x80;
      expect(xeddsaVerify(id.publicKey, msg, flipped)).toBe(false);
      // And the scalar does X25519 as a libsignal peer expects of the published identity key.
      const peer = x25519KeyPair();
      expect(x25519(id.privateKey, peer.publicKey)).toEqual(x25519(peer.privateKey, id.publicKey));
    }
    expect(() => identityFromSeed(Buffer.alloc(31))).toThrow(/32 bytes/);
    expect(() => identityFromSeed(Buffer.alloc(33))).toThrow(/32 bytes/);
  });

  it('refuses malformed input: wrong lengths, u = p - 1 (the Edwards map has no inverse there), and a private key that is not 32 bytes', () => {
    expect(xeddsaVerify(Buffer.alloc(31), Buffer.alloc(1), Buffer.alloc(64))).toBe(false);
    expect(xeddsaVerify(Buffer.alloc(32), Buffer.alloc(1), Buffer.alloc(63))).toBe(false);
    const pMinus1 = Buffer.alloc(32, 0xff);
    pMinus1[0] = 0xec;
    pMinus1[31] = 0x7f;
    expect(xeddsaVerify(pMinus1, Buffer.alloc(1), Buffer.alloc(64))).toBe(false);
    expect(() => xeddsaSign(Buffer.alloc(31), Buffer.alloc(1), randomBytes(64))).toThrow();
    expect(() => xeddsaSign(Buffer.alloc(32), Buffer.alloc(1), randomBytes(63))).toThrow();
  });
});
