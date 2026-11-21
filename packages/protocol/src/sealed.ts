/**
 * Sealed boxes between a person's own devices (J-23, S-075: full abilities on every strongly
 * logged-in device; docs/security/multi-device-2026-11-09.md section 4). REVIEW-PROTOCOL: a Task 3
 * protocol change, reviewed on its own.
 *
 * The chat-key handover seals the account chat key to the new device's X25519 public key with
 * libsodium's `crypto_box_seal`: an ephemeral sender key, so the box carries nothing that names
 * the sender and only the holder of the recipient's secret opens it. The API stores and serves the
 * sealed bytes as a courier and can never open them. The same primitive family as the envelope
 * (`crypto_box`), nothing new in cryptography.
 *
 * - `generateBoxKeyPair`: a fresh device key (X25519), the public half as 64 lower-case hex.
 * - `sealTo(recipientPublicHex, bytes)`: `crypto_box_seal`; the result is `bytes.length +
 *   SEALED_OVERHEAD` (48: a 32-byte ephemeral public key and a 16-byte MAC).
 * - `openSealed(recipient, sealed)`: `crypto_box_seal_open` with the recipient's own pair (a device
 *   key or a chat identity's box keys). A box not sealed to this key, a tampered or truncated one,
 *   or bytes too short to be a box: `ProtocolError('not-for-me')`.
 * - Input that is not even a candidate (bad hex, a low-order recipient key that libsodium refuses,
 *   a secret that does not derive the public key, a non-Uint8Array) is a `TypeError`, as `signProof` and `seal` do, so a mixed-up pair never opens
 *   or seals anything.
 *
 * Browser-safe: libsodium hex only, no Node-only APIs.
 */
import sodium from 'libsodium-wrappers';
import { ProtocolError } from './errors.js';

/** A recipient's X25519 box keys: a device key pair, or a chat identity (whose box keys are these fields). */
export interface BoxKeyPair {
  /** 64 lower-case hex characters. */
  boxPublic: string;
  boxSecret: Uint8Array;
}

/** Bytes a sealed box adds to its plaintext: the ephemeral public key (32) and the MAC (16). */
export const SEALED_OVERHEAD = 48;

const KEY_HEX = /^[0-9a-f]{64}$/;

export async function generateBoxKeyPair(): Promise<BoxKeyPair> {
  await sodium.ready;
  const kp = sodium.crypto_box_keypair();
  return { boxPublic: sodium.to_hex(kp.publicKey), boxSecret: kp.privateKey };
}

/** The recipient's public key bytes, or TypeError for anything but 64 lower-case hex characters. */
function publicKeyOf(hex: unknown, where: string): Uint8Array {
  if (typeof hex !== 'string' || !KEY_HEX.test(hex)) throw new TypeError(`${where}: invalid boxPublic`);
  return sodium.from_hex(hex);
}

/** Seals `bytes` to the holder of `recipientPublicHex` (`crypto_box_seal`). */
export async function sealTo(recipientPublicHex: string, bytes: Uint8Array): Promise<Uint8Array> {
  await sodium.ready;
  if (!(bytes instanceof Uint8Array)) throw new TypeError('sealTo: bytes must be a Uint8Array');
  const pub = publicKeyOf(recipientPublicHex, 'sealTo');
  try {
    return sodium.crypto_box_seal(bytes, pub);
  } catch {
    // libsodium refuses a small-order (low-order) public key, whose shared secret would be all
    // zeros, with a plain Error('invalid usage'): it is bad input, so TypeError as documented
    // (J-23 review F7).
    throw new TypeError('sealTo: boxPublic is a low-order point');
  }
}

/** Opens a box sealed to `recipient` (`crypto_box_seal_open`); `ProtocolError('not-for-me')` for any box this pair does not open. */
export async function openSealed(recipient: BoxKeyPair, sealed: Uint8Array): Promise<Uint8Array> {
  await sodium.ready;
  if (!(sealed instanceof Uint8Array)) throw new TypeError('openSealed: sealed must be a Uint8Array');
  const pub = publicKeyOf(recipient?.boxPublic, 'openSealed');
  const secret = recipient.boxSecret;
  if (!(secret instanceof Uint8Array) || secret.length !== sodium.crypto_box_SECRETKEYBYTES || !sodium.memcmp(sodium.crypto_scalarmult_base(secret), pub)) {
    throw new TypeError('openSealed: boxSecret does not match boxPublic');
  }
  if (sealed.length < sodium.crypto_box_SEALBYTES) throw new ProtocolError('not-for-me', 'sealed box too short');
  try {
    return sodium.crypto_box_seal_open(sealed, pub, secret);
  } catch {
    throw new ProtocolError('not-for-me', 'sealed box does not open with this key');
  }
}

/**
 * A recipient whose X25519 secret never leaves it (review lead-mod-chat B1: a staff device's
 * non-extractable WebCrypto key): it gives only the shared secret X25519(its secret, `ephemeral`),
 * as `subtle.deriveBits({ name: 'X25519', public }, key, 256)` does.
 */
export interface BoxOpener {
  /** 64 lower-case hex characters. */
  boxPublic: string;
  sharedWith(ephemeralPublic: Uint8Array): Promise<Uint8Array>;
}

const SIGMA = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];
const rotl = (v: number, c: number): number => ((v << c) | (v >>> (32 - c))) >>> 0;
const le32 = (b: Uint8Array, i: number): number => (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;

/**
 * HSalsa20 (the core of `crypto_box_beforenm` and XSalsa20's key step): 32-byte key, 16-byte input
 * (zeros for crypto_box), 32-byte output. Not in the standard libsodium-wrappers build, so here;
 * checked against `crypto_box_beforenm` (test/sealedWebCrypto.test.ts).
 */
export function hsalsa20(key: Uint8Array, input: Uint8Array = new Uint8Array(16)): Uint8Array {
  if (!(key instanceof Uint8Array) || key.length !== 32 || !(input instanceof Uint8Array) || input.length !== 16) throw new TypeError('hsalsa20: a 32-byte key and a 16-byte input');
  const x = new Uint32Array(16);
  x[0] = SIGMA[0]!; x[5] = SIGMA[1]!; x[10] = SIGMA[2]!; x[15] = SIGMA[3]!;
  for (let i = 0; i < 4; i++) {
    x[1 + i] = le32(key, 4 * i);
    x[11 + i] = le32(key, 16 + 4 * i);
    x[6 + i] = le32(input, 4 * i);
  }
  const qr = (a: number, b: number, c: number, d: number): void => {
    x[b] = x[b]! ^ rotl((x[a]! + x[d]!) >>> 0, 7);
    x[c] = x[c]! ^ rotl((x[b]! + x[a]!) >>> 0, 9);
    x[d] = x[d]! ^ rotl((x[c]! + x[b]!) >>> 0, 13);
    x[a] = x[a]! ^ rotl((x[d]! + x[c]!) >>> 0, 18);
  };
  for (let r = 0; r < 20; r += 2) {
    qr(0, 4, 8, 12); qr(5, 9, 13, 1); qr(10, 14, 2, 6); qr(15, 3, 7, 11);
    qr(0, 1, 2, 3); qr(5, 6, 7, 4); qr(10, 11, 8, 9); qr(15, 12, 13, 14);
  }
  const out = new Uint8Array(32);
  [0, 5, 10, 15, 6, 7, 8, 9].forEach((w, i) => {
    const v = x[w]!;
    out[4 * i] = v & 0xff; out[4 * i + 1] = (v >>> 8) & 0xff; out[4 * i + 2] = (v >>> 16) & 0xff; out[4 * i + 3] = v >>> 24;
  });
  x.fill(0);
  return out;
}

/**
 * Opens a box sealed to `recipient` (`crypto_box_seal`) the way `crypto_box_seal_open` does, from the
 * X25519 shared secret only: epk = the box's first 32 bytes; nonce = blake2b-24(epk || pk);
 * k = HSalsa20(X25519(sk, epk), 0^16); then XSalsa20-Poly1305 (`crypto_secretbox_open_easy`). The
 * shared secret and k are zeroed. `ProtocolError('not-for-me')` for any box this key does not open.
 */
export async function openSealedWith(recipient: BoxOpener, sealed: Uint8Array): Promise<Uint8Array> {
  await sodium.ready;
  if (!(sealed instanceof Uint8Array)) throw new TypeError('openSealedWith: sealed must be a Uint8Array');
  const pub = publicKeyOf(recipient?.boxPublic, 'openSealedWith');
  if (typeof recipient.sharedWith !== 'function') throw new TypeError('openSealedWith: no sharedWith');
  if (sealed.length < sodium.crypto_box_SEALBYTES) throw new ProtocolError('not-for-me', 'sealed box too short');
  const epk = sealed.slice(0, sodium.crypto_box_PUBLICKEYBYTES);
  let shared: Uint8Array;
  try {
    shared = await recipient.sharedWith(epk);
  } catch {
    throw new ProtocolError('not-for-me', 'sealed box does not open with this key');
  }
  let k: Uint8Array | null = null;
  try {
    // An all-zero shared secret (a low-order ephemeral key) opens nothing, as libsodium refuses it.
    // Re-review 2 m4: checked in constant time (an OR over every byte, as sodium_is_zero), never by
    // an early exit that would time where the first non-zero byte of a secret is.
    if (!(shared instanceof Uint8Array) || shared.length !== 32) throw new ProtocolError('not-for-me', 'sealed box does not open with this key');
    let z = 0;
    for (const b of shared) z |= b;
    if (z === 0) throw new ProtocolError('not-for-me', 'sealed box does not open with this key');
    k = hsalsa20(shared);
    const nonce = sodium.crypto_generichash(sodium.crypto_box_NONCEBYTES, new Uint8Array([...epk, ...pub]), null);
    try {
      return sodium.crypto_secretbox_open_easy(sealed.subarray(sodium.crypto_box_PUBLICKEYBYTES), nonce, k);
    } catch {
      throw new ProtocolError('not-for-me', 'sealed box does not open with this key');
    }
  } finally {
    if (shared instanceof Uint8Array) shared.fill(0);
    k?.fill(0);
  }
}
