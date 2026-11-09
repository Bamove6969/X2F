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

export type PreKey = RecipientBundle['preKeys'][number];
/** Picks the one-time prekey of a bundle to use; null when there is none left, so the session is set up without one. */
export type PickPreKey = (bundle: RecipientBundle) => PreKey | null;

export interface EncryptOptions {
  /** Which prekey of a bundle to use (default: one at random; a `PreKeyLedger` for an outbox pass). */
  pickPreKey?: PickPreKey;
  /** The base key per device (default: fresh); tests only. */
  baseKey?: () => KeyPair;
}

const randomPreKey: PickPreKey = (b) => b.preKeys[randomInt(b.preKeys.length)]!;

/**
 * The prekeys picked during one outbox pass (review M2). A client deletes a one-time prekey after
 * its first use and republishes without it; while it is offline the sender sees the same bundle for
 * every notice, so two notices picking the same prekey would leave the second unreadable. Within one
 * pass no prekey of a device (by recipient, device id and identity key) is picked twice; once all
 * are used, the session is set up without a one-time prekey, which X3DH allows and libsignal reads.
 */
export class PreKeyLedger {
  private readonly used = new Map<string, Set<number>>();

  /** The picker for notices to `recipient` (a bare JID) in this pass. */
  picker(recipient: string): PickPreKey {
    return (b) => {
      const device = `${recipient}\n${b.deviceId}\n${b.identityKey.toString('hex')}`;
      let used = this.used.get(device);
      if (used === undefined) this.used.set(device, (used = new Set()));
      const left = b.preKeys.filter((p) => !used.has(p.id));
      if (left.length === 0) return null;
      const pick = left[randomInt(left.length)]!;
      used.add(pick.id);
      return pick;
    };
  }
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
    const pre = (o.pickPreKey ?? randomPreKey)(b);
    const session = initAlice({
      ourIdentity,
      ourBaseKey: (o.baseKey ?? x25519KeyPair)(),
      theirIdentity,
      theirSignedPreKey: rawKey(b.signedPreKey),
      ...(pre === null ? {} : { theirOneTimePreKey: rawKey(pre.key), preKeyId: pre.id }),
      signedPreKeyId: b.signedPreKeyId,
      registrationId: registrationIdFor(identity.deviceId),
    });
    return { rid: b.deviceId, prekey: true, data: encrypt(session, secret) };
  });
  return encryptedElement({ sid: identity.deviceId, keys, iv: payload.iv, payload: payload.ciphertext });
}
