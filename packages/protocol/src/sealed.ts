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
