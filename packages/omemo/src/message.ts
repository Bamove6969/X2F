/**
 * libsignal's message framing (WhisperTextProtocol.proto, session version 3), as every OMEMO 0.3
 * client parses it:
 *
 * - a public key on the wire is `0x05 ‖ 32 bytes` (Curve25519, "DJB type");
 * - SignalMessage = version byte `0x33` ((3 << 4) | 3) ‖ protobuf {1: ratchetKey, 2: counter,
 *   3: previousCounter, 4: ciphertext} ‖ MAC, where MAC = HMAC-SHA-256(macKey, senderIdentityKey ‖
 *   receiverIdentityKey ‖ version ‖ protobuf) cut to 8 bytes;
 * - PreKeySignalMessage = `0x33` ‖ protobuf {5: registrationId, 1: preKeyId (optional),
 *   6: signedPreKeyId, 2: baseKey, 3: identityKey, 4: SignalMessage}.
 */
import { timingSafeEqual } from 'node:crypto';
import { hmac } from './kdf.js';
import { decodeFields, encodeFields, one, type DecodedField } from './protobuf.js';

export const KEY_TYPE_DJB = 0x05;
export const SESSION_VERSION = 3;
export const VERSION_BYTE = (SESSION_VERSION << 4) | SESSION_VERSION;
export const MAC_LENGTH = 8;

/** A raw 32-byte public key in wire form. */
export function wireKey(raw: Uint8Array): Buffer {
  if (raw.length !== 32) throw new RangeError('message: a public key is 32 bytes');
  return Buffer.concat([Buffer.from([KEY_TYPE_DJB]), raw]);
}

/** The raw key of a 33-byte wire key; throws on another type or length. */
export function rawKey(wire: Uint8Array): Buffer {
  if (wire.length !== 33 || wire[0] !== KEY_TYPE_DJB) throw new RangeError('message: not a Curve25519 wire key');
  return Buffer.from(wire.subarray(1));
}

export interface SignalMessageFields {
  /** The sender's current ratchet public key, raw 32 bytes. */
  ratchetKey: Buffer;
  counter: number;
  previousCounter: number;
  ciphertext: Buffer;
}

export interface ParsedSignalMessage extends SignalMessageFields {
  /** Version byte and protobuf: what the MAC covers after the identity keys. */
  body: Buffer;
  mac: Buffer;
}

function mac(macKey: Uint8Array, senderIdentity: Uint8Array, receiverIdentity: Uint8Array, body: Uint8Array): Buffer {
  return hmac(macKey, wireKey(senderIdentity), wireKey(receiverIdentity), body).subarray(0, MAC_LENGTH);
}

/** `senderIdentity` and `receiverIdentity` are raw 32-byte identity public keys. */
export function encodeSignalMessage(f: SignalMessageFields, macKey: Uint8Array, senderIdentity: Uint8Array, receiverIdentity: Uint8Array): Buffer {
  const body = Buffer.concat([
    Buffer.from([VERSION_BYTE]),
    encodeFields([
      { n: 1, bytes: wireKey(f.ratchetKey) }, { n: 2, varint: f.counter }, { n: 3, varint: f.previousCounter }, { n: 4, bytes: f.ciphertext },
    ]),
  ]);
  return Buffer.concat([body, mac(macKey, senderIdentity, receiverIdentity, body)]);
}

const varintOf = (f: DecodedField | undefined, what: string): number => {
  if (f === undefined || !('varint' in f)) throw new RangeError(`message: ${what} missing`);
  return f.varint;
};
const bytesOf = (f: DecodedField | undefined, what: string): Buffer => {
  if (f === undefined || !('bytes' in f)) throw new RangeError(`message: ${what} missing`);
  return f.bytes;
};

/** Parses without checking the MAC (the keys to check it with come from the ratchet key and counter). */
export function parseSignalMessage(buf: Uint8Array): ParsedSignalMessage {
  if (buf.length < 1 + MAC_LENGTH) throw new RangeError('message: too short');
  if (buf[0] !== VERSION_BYTE) throw new RangeError('message: unsupported version');
  const body = Buffer.from(buf.subarray(0, buf.length - MAC_LENGTH));
  const fields = decodeFields(body.subarray(1));
  return {
    ratchetKey: rawKey(bytesOf(one(fields, 1), 'ratchet key')),
    counter: varintOf(one(fields, 2), 'counter'),
    previousCounter: varintOf(one(fields, 3), 'previous counter'),
    ciphertext: bytesOf(one(fields, 4), 'ciphertext'),
    body,
    mac: Buffer.from(buf.subarray(buf.length - MAC_LENGTH)),
  };
}

export function verifySignalMessageMac(m: ParsedSignalMessage, macKey: Uint8Array, senderIdentity: Uint8Array, receiverIdentity: Uint8Array): boolean {
  return timingSafeEqual(m.mac, mac(macKey, senderIdentity, receiverIdentity, m.body));
}

export interface PreKeyMessageFields {
  registrationId: number;
  preKeyId?: number;
  signedPreKeyId: number;
  /** Raw 32-byte keys. */
  baseKey: Buffer;
  identityKey: Buffer;
  /** The SignalMessage bytes. */
  message: Buffer;
}

export function encodePreKeyMessage(f: PreKeyMessageFields): Buffer {
  return Buffer.concat([
    Buffer.from([VERSION_BYTE]),
    encodeFields([
      { n: 5, varint: f.registrationId },
      ...(f.preKeyId === undefined ? [] : [{ n: 1, varint: f.preKeyId }]),
      { n: 6, varint: f.signedPreKeyId },
      { n: 2, bytes: wireKey(f.baseKey) },
      { n: 3, bytes: wireKey(f.identityKey) },
      { n: 4, bytes: f.message },
    ]),
  ]);
}

export function parsePreKeyMessage(buf: Uint8Array): PreKeyMessageFields {
  if (buf.length < 2) throw new RangeError('message: too short');
  if (buf[0] !== VERSION_BYTE) throw new RangeError('message: unsupported version');
  const fields = decodeFields(buf.subarray(1));
  const preKey = one(fields, 1);
  return {
    registrationId: varintOf(one(fields, 5), 'registration id'),
    ...(preKey === undefined ? {} : { preKeyId: varintOf(preKey, 'prekey id') }),
    signedPreKeyId: varintOf(one(fields, 6), 'signed prekey id'),
    baseKey: rawKey(bytesOf(one(fields, 2), 'base key')),
    identityKey: rawKey(bytesOf(one(fields, 3), 'identity key')),
    message: bytesOf(one(fields, 4), 'message'),
  };
}
