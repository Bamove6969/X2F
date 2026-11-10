/**
 * XEdDSA (Signal's signature scheme over Curve25519 keys; libsignal's `xed25519_sign` and
 * `curve25519_verify`). Verifying is node:crypto's Ed25519 behind the Montgomery-to-Edwards map.
 *
 * Signing, two ways:
 * - **X2F's own identity** (`identityFromSeed`; lead decision after review L1, 2026-11-09): an
 *   Ed25519 key pair from a 32-byte seed. Its Ed25519 scalar a = clamp(SHA-512(seed)[0..32]) is the
 *   X25519 identity private key, and the Montgomery u = (1 + y)/(1 − y) of its Ed25519 public key A
 *   is the identity key the bundle publishes (= X25519(a), what a libsignal client expects). OpenSSL
 *   signs (deterministic Ed25519: R = rB, S = r + H(R ‖ A ‖ M)·a over the same a and A) and A's sign
 *   bit is ORed into S[63]: exactly what `curve25519_verify` undoes, so the result is a XEdDSA
 *   signature. No secret touches the bigint arithmetic below.
 * - **The hand-written path** (`xeddsaSign`, libsignal `curve25519_sign` / `crypto_sign_modified`)
 *   for a plain Curve25519 private key, kept for the known-answer tests and the test devices (what a
 *   libsignal client does): a = clamp(k); A = a·B (its sign bit kept); r = SHA-512(0xFE ‖ 0xFF×31 ‖
 *   a ‖ M ‖ Z) mod L; R = r·B; h = SHA-512(R ‖ A ‖ M) mod L; S = r + h·a mod L; signature = R ‖ S
 *   with A's sign bit in the (otherwise zero) top bit of S. BigInt arithmetic is not constant-time,
 *   which is why production does not sign with it.
 *
 * Verifying (`curve25519_verify`): Montgomery u → Edwards y = (u − 1)/(u + 1), the sign bit taken
 * from the signature (and cleared there), then plain Ed25519 verification.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';
import { x25519PublicKey, type KeyPair } from './x25519.js';

const P = 2n ** 255n - 19n;
const L = 2n ** 252n + 27742317777372353535851937790883648493n;
const D = mod(-121665n * modInverse(121666n));
const D2 = (2n * D) % P;
const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex');
const ED25519_PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex');

function mod(a: bigint, m = P): bigint {
  const r = a % m;
  return r < 0n ? r + m : r;
}

function modpow(b: bigint, e: bigint): bigint {
  let r = 1n;
  for (b = mod(b); e > 0n; e >>= 1n, b = (b * b) % P) if (e & 1n) r = (r * b) % P;
  return r;
}

function modInverse(a: bigint): bigint {
  return modpow(a, P - 2n);
}

const fromLe = (b: Uint8Array): bigint => b.reduceRight((acc, x) => (acc << 8n) | BigInt(x), 0n);
function toLe(n: bigint, len = 32): Buffer {
  const out = Buffer.alloc(len);
  for (let i = 0; i < len; i++, n >>= 8n) out[i] = Number(n & 0xffn);
  return out;
}

/** A point in extended coordinates (X, Y, Z, T) with x = X/Z, y = Y/Z, xy = T/Z. */
type Point = readonly [bigint, bigint, bigint, bigint];
const IDENTITY: Point = [0n, 1n, 1n, 0n];
const BASE: Point = (() => {
  const y = (4n * modInverse(5n)) % P;
  const x = recoverX(y, 0);
  return [x, y, 1n, (x * y) % P];
})();

/** The x with the given sign (its low bit) for this y (RFC 8032, 5.1.3), or throws when y is not on the curve. */
function recoverX(y: bigint, sign: number): bigint {
  const y2 = (y * y) % P;
  const u = mod(y2 - 1n);
  const v = mod(D * y2 + 1n);
  let x = (((u * modpow(v, 3n)) % P) * modpow((u * modpow(v, 7n)) % P, (P - 5n) / 8n)) % P;
  const vx2 = (v * x * x) % P;
  if (vx2 === mod(-u)) x = (x * modpow(2n, (P - 1n) / 4n)) % P;
  else if (vx2 !== u) throw new RangeError('edwards: not on the curve');
  if (x === 0n && sign === 1) throw new RangeError('edwards: not on the curve');
  if (Number(x & 1n) !== sign) x = P - x;
  return x;
}

/** Unified addition (RFC 8032, 5.1.4), so doubling needs no separate formula. */
function add(p: Point, q: Point): Point {
  const [x1, y1, z1, t1] = p;
  const [x2, y2, z2, t2] = q;
  const a = (mod(y1 - x1) * mod(y2 - x2)) % P;
  const b = ((y1 + x1) * (y2 + x2)) % P;
  const c = (((t1 * D2) % P) * t2) % P;
  const d = (2n * z1 * z2) % P;
  const e = mod(b - a);
  const f = mod(d - c);
  const g = (d + c) % P;
  const h = (b + a) % P;
  return [(e * f) % P, (g * h) % P, (f * g) % P, (e * h) % P];
}

function scalarMultBase(k: bigint): Point {
  let r = IDENTITY;
  let q = BASE;
  for (let n = k; n > 0n; n >>= 1n) {
    if (n & 1n) r = add(r, q);
    q = add(q, q);
  }
  return r;
}

function compress(p: Point): Buffer {
  const zi = modInverse(p[2]);
  const x = mod(p[0] * zi);
  const y = mod(p[1] * zi);
  const out = toLe(y);
  out[31] = out[31]! | (Number(x & 1n) << 7);
  return out;
}

/** The Curve25519 private scalar as X25519 uses it (RFC 7748 clamping). */
export function clampScalar(k: Uint8Array): Buffer {
  if (k.length !== 32) throw new RangeError('edwards: a private key is 32 bytes');
  const a = Buffer.from(k);
  a[0] = a[0]! & 248;
  a[31] = (a[31]! & 127) | 64;
  return a;
}

/** The compressed Ed25519 public key a·B for a (clamped) scalar. */
export function edwardsPublicKey(a: Uint8Array): Buffer {
  return compress(scalarMultBase(fromLe(a)));
}

/** The Montgomery u = (1 + y)/(1 − y) of a compressed Edwards point (its sign bit ignored). */
export function montgomeryFromEdwards(ed: Uint8Array): Buffer {
  const y = fromLe(Buffer.concat([Buffer.from(ed.subarray(0, 31)), Buffer.from([ed[31]! & 0x7f])]));
  return toLe(((1n + y) * modInverse(mod(1n - y))) % P);
}

/** The compressed Edwards point (sign bit `sign`) of a Montgomery u, or null for u = p − 1 or u ≥ p. */
function edwardsFromMontgomery(mont: Uint8Array, sign: number): Buffer | null {
  let u = 0n;
  for (let i = 31; i >= 0; i--) u = (u << 8n) | BigInt(i === 31 ? mont[i]! & 0x7f : mont[i]!);
  if (u >= P || u === P - 1n) return null;
  const y = (mod(u - 1n) * modInverse(u + 1n)) % P;
  const a = toLe(y);
  a[31] = (a[31]! & 0x7f) | (sign << 7);
  return a;
}

const sha512 = (...parts: Uint8Array[]) => {
  const h = createHash('sha512');
  for (const p of parts) h.update(p);
  return h.digest();
};

/**
 * Signs `msg` under the Curve25519 private key `priv` (32 bytes) with the 64 random bytes `random`
 * (fresh for every signature). The result verifies with `xeddsaVerify` and with libsignal.
 */
export function xeddsaSign(priv: Uint8Array, msg: Uint8Array, random: Uint8Array): Buffer {
  if (random.length !== 64) throw new RangeError('edwards: the nonce is 64 random bytes');
  const aBytes = clampScalar(priv);
  const a = fromLe(aBytes);
  const A = compress(scalarMultBase(a));
  const prefix = Buffer.alloc(32, 0xff);
  prefix[0] = 0xfe;
  const r = mod(fromLe(sha512(prefix, aBytes, msg, random)), L);
  const R = compress(scalarMultBase(r));
  const h = mod(fromLe(sha512(R, A, msg)), L);
  const S = toLe(mod(r + h * a, L));
  S[31] = S[31]! | (A[31]! & 0x80);
  return Buffer.concat([R, S]);
}

/** Anything that signs as XEdDSA does under a Curve25519 identity. */
export interface XedSigner {
  sign(msg: Uint8Array): Buffer;
}

/** The hand-written XEdDSA signer for a plain Curve25519 private key (a fresh 64-byte nonce per signature): test devices, never X2F's identity. */
export const xeddsaSigner = (priv: Uint8Array): XedSigner => ({ sign: (msg) => xeddsaSign(priv, msg, randomBytes(64)) });

/**
 * X2F's identity (see the header): `publicKey` is the Montgomery identity key the bundle publishes,
 * `privateKey` the X25519 scalar X3DH uses, `edwardsPublicKey` the Ed25519 key behind both, `sign`
 * OpenSSL's Ed25519 signer made XEdDSA.
 */
export interface SeedIdentity extends KeyPair, XedSigner {
  edwardsPublicKey: Buffer;
}

/** A fresh 32-byte seed for `identityFromSeed` (OpenSSL generates it). */
export function newIdentitySeed(): Buffer {
  return Buffer.from(generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' }).d!, 'base64url');
}

/** The identity a 32-byte Ed25519 seed defines; throws on any other length or when the two derivations of the Montgomery key disagree. */
export function identityFromSeed(seed: Uint8Array): SeedIdentity {
  if (seed.length !== 32) throw new RangeError('edwards: an identity seed is 32 bytes');
  const key = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8, seed]), format: 'der', type: 'pkcs8' });
  const edwardsPublicKey = Buffer.from(createPublicKey(key).export({ format: 'jwk' }).x!, 'base64url');
  const privateKey = clampScalar(sha512(seed).subarray(0, 32));
  const publicKey = montgomeryFromEdwards(edwardsPublicKey);
  // Both OpenSSL: the Ed25519 public key mapped to Montgomery form must be the X25519 public key of the scalar.
  if (!x25519PublicKey(privateKey).equals(publicKey)) throw new Error('edwards: identity derivation mismatch');
  const signBit = edwardsPublicKey[31]! & 0x80;
  return {
    publicKey,
    privateKey,
    edwardsPublicKey,
    sign: (msg) => {
      const s = sign(null, msg, key);
      s[63] = s[63]! | signBit;
      return s;
    },
  };
}

/** True when `sig` (64 bytes) is a valid XEdDSA signature of `msg` under the Curve25519 public key `mont` (32 bytes). */
export function xeddsaVerify(mont: Uint8Array, msg: Uint8Array, sig: Uint8Array): boolean {
  if (mont.length !== 32 || sig.length !== 64) return false;
  const a = edwardsFromMontgomery(mont, sig[63]! >> 7);
  if (a === null) return false;
  const s = Buffer.from(sig);
  s[63] = s[63]! & 0x7f;
  try {
    return verify(null, msg, createPublicKey({ key: Buffer.concat([ED25519_SPKI, a]), format: 'der', type: 'spki' }), s);
  } catch {
    return false;
  }
}
