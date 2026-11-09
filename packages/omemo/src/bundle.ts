/**
 * A device's own OMEMO 0.3 bundle: a signed prekey (XEdDSA-signed under the identity key over its
 * 33-byte wire form) and one-time prekeys (the XEP says 100, at least 20), its PEP XML, and the
 * device-list XML. X2F's bundle is generated once and stored sealed (the API's job); it is
 * published on every connection so that recipients' clients can read and check our keys.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { xeddsaSign, xeddsaVerify } from './edwards.js';
import { OMEMO_NS } from './envelope.js';
import { wireKey } from './message.js';
import { x25519KeyPair, x25519PublicKey, type KeyPair } from './x25519.js';

export const DEVICELIST_NODE = `${OMEMO_NS}.devicelist`;
export const bundleNode = (deviceId: number): string => `${OMEMO_NS}.bundles:${deviceId}`;
export const PREKEY_COUNT = 100;

export interface BundleSecrets {
  signedPreKeyId: number;
  signedPreKey: KeyPair;
  signedPreKeySignature: Buffer;
  preKeys: Array<{ id: number; key: KeyPair }>;
}

/** A fresh device id, 1..2^31-1 (XEP-0384 0.3.0, 4.1). */
export const newDeviceId = (): number => randomInt(1, 0x7fffffff);

export function generateBundleSecrets(identityPrivate: Uint8Array, preKeyCount = PREKEY_COUNT): BundleSecrets {
  const signedPreKey = x25519KeyPair();
  return {
    signedPreKeyId: randomInt(1, 0xffffff),
    signedPreKey,
    signedPreKeySignature: xeddsaSign(identityPrivate, wireKey(signedPreKey.publicKey), randomBytes(64)),
    preKeys: Array.from({ length: preKeyCount }, (_, i) => ({ id: i + 1, key: x25519KeyPair() })),
  };
}

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

/** The `<bundle>` item for `bundleNode(deviceId)`. */
export function bundleXml(identityPublic: Uint8Array, s: BundleSecrets): string {
  const prekeys = s.preKeys.map((p) => `<preKeyPublic preKeyId='${p.id}'>${b64(wireKey(p.key.publicKey))}</preKeyPublic>`).join('');
  return `<bundle xmlns='${OMEMO_NS}'><signedPreKeyPublic signedPreKeyId='${s.signedPreKeyId}'>${b64(wireKey(s.signedPreKey.publicKey))}</signedPreKeyPublic>` +
    `<signedPreKeySignature>${b64(s.signedPreKeySignature)}</signedPreKeySignature><identityKey>${b64(wireKey(identityPublic))}</identityKey><prekeys>${prekeys}</prekeys></bundle>`;
}

/** The `<list>` item for `DEVICELIST_NODE`. */
export function deviceListXml(deviceIds: number[]): string {
  return `<list xmlns='${OMEMO_NS}'>${deviceIds.map((id) => `<device id='${id}'/>`).join('')}</list>`;
}

/** JSON for sealing at rest; `parseBundleSecrets` reads it back and checks every key and the signature. */
export function serializeBundleSecrets(s: BundleSecrets): Buffer {
  const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
  return Buffer.from(JSON.stringify({
    v: 1,
    signedPreKeyId: s.signedPreKeyId,
    signedPreKey: hex(s.signedPreKey.privateKey),
    signedPreKeySignature: hex(s.signedPreKeySignature),
    preKeys: s.preKeys.map((p) => ({ id: p.id, key: hex(p.key.privateKey) })),
  }), 'utf8');
}

/**
 * Reads a bundle back from its sealed form. The input is the decrypted secret itself, so every
 * failure is a fixed text (review L4): V8's `JSON.parse` error would quote a piece of the source,
 * which here holds private keys in hex.
 */
export function parseBundleSecrets(buf: Uint8Array, identityPrivate: Uint8Array): BundleSecrets {
  const malformed = () => new RangeError('omemo: stored bundle is malformed');
  let j: unknown;
  try {
    j = JSON.parse(Buffer.from(buf).toString('utf8'));
  } catch {
    throw malformed();
  }
  if (typeof j !== 'object' || j === null || Array.isArray(j)) throw malformed();
  const o = j as Record<string, unknown>;
  if (o.v !== 1) throw new RangeError('omemo: unknown bundle format');
  const id = (v: unknown): number => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw malformed();
    return v;
  };
  const hex = (v: unknown, bytes: number): Buffer => {
    if (typeof v !== 'string' || v.length !== 2 * bytes || !/^[0-9a-f]*$/.test(v)) throw malformed();
    return Buffer.from(v, 'hex');
  };
  const pair = (v: unknown): KeyPair => {
    const privateKey = hex(v, 32);
    return { privateKey, publicKey: x25519PublicKey(privateKey) };
  };
  if (!Array.isArray(o.preKeys)) throw malformed();
  const preKeys = o.preKeys.map((p: unknown) => {
    if (typeof p !== 'object' || p === null) throw malformed();
    const q = p as Record<string, unknown>;
    return { id: id(q.id), key: pair(q.key) };
  });
  const signedPreKey = pair(o.signedPreKey);
  const signedPreKeySignature = hex(o.signedPreKeySignature, 64);
  if (!xeddsaVerify(x25519PublicKey(identityPrivate), wireKey(signedPreKey.publicKey), signedPreKeySignature)) throw new RangeError('omemo: stored bundle does not verify');
  return { signedPreKeyId: id(o.signedPreKeyId), signedPreKey, signedPreKeySignature, preKeys };
}
