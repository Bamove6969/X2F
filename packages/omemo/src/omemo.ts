/**
 * The sender: one OMEMO 0.3 message to every device of a recipient, each device getting a fresh
 * X3DH session and a PreKeySignalMessage (docs/jabber/omemo-plan.md, section 2.8: no session state
 * is kept). Trust: every bundle whose signed prekey verifies under its identity key is used (blind
 * trust before verification; owner question 1 in the plan).
 */
import { randomInt } from 'node:crypto';
import { xeddsaVerify } from './edwards.js';
import { encryptPayload, encryptedElement, keyAndTag } from './envelope.js';
import { rawKey } from './message.js';
import { encrypt, initAlice } from './ratchet.js';
import { x25519KeyPair, type KeyPair } from './x25519.js';

/** A recipient device's published bundle. Keys are in wire form (0x05 ‖ 32 bytes). */
export interface RecipientBundle {
  deviceId: number;
  identityKey: Buffer;
  signedPreKeyId: number;
  signedPreKey: Buffer;
  signedPreKeySignature: Buffer;
  preKeys: Array<{ id: number; key: Buffer }>;
}

export interface SenderIdentity {
  deviceId: number;
  /** Raw 32-byte Curve25519 keys. */
  publicKey: Buffer;
  privateKey: Buffer;
}

/** libsignal registration ids are 1..16380; clients do not use the value. */
export const registrationIdFor = (deviceId: number): number => 1 + (deviceId % 16380);

export interface EncryptOptions {
  /** Which prekey of a bundle to use (default: one at random). */
  pickPreKey?: (count: number) => number;
  /** The base key per device (default: fresh); tests only. */
  baseKey?: () => KeyPair;
}

/** Encrypts `text` to every device in `bundles`; returns the `<encrypted>` element. Throws when a bundle does not verify or `bundles` is empty. */
export function encryptMessage(identity: SenderIdentity, text: string, bundles: RecipientBundle[], o: EncryptOptions = {}): string {
  if (bundles.length === 0) throw new RangeError('omemo: no recipient device');
  const payload = encryptPayload(text);
  const secret = keyAndTag(payload);
  const ourIdentity: KeyPair = { publicKey: identity.publicKey, privateKey: identity.privateKey };
  const keys = bundles.map((b) => {
    const theirIdentity = rawKey(b.identityKey);
    if (!xeddsaVerify(theirIdentity, b.signedPreKey, b.signedPreKeySignature)) throw new RangeError('omemo: bundle signature does not verify');
    if (b.preKeys.length === 0) throw new RangeError('omemo: bundle without prekeys');
    const pre = b.preKeys[(o.pickPreKey ?? ((n) => randomInt(n)))(b.preKeys.length)]!;
    const session = initAlice({
      ourIdentity,
      ourBaseKey: (o.baseKey ?? x25519KeyPair)(),
      theirIdentity,
      theirSignedPreKey: rawKey(b.signedPreKey),
      theirOneTimePreKey: rawKey(pre.key),
      signedPreKeyId: b.signedPreKeyId,
      preKeyId: pre.id,
      registrationId: registrationIdFor(identity.deviceId),
    });
    return { rid: b.deviceId, prekey: true, data: encrypt(session, secret) };
  });
  return encryptedElement({ sid: identity.deviceId, keys, iv: payload.iv, payload: payload.ciphertext });
}
