/**
 * A receiving OMEMO 0.3 device, as a client would be: its own identity and bundle, and the
 * decryption of an `<encrypted>` element addressed to it (a PreKeySignalMessage builds a session;
 * a SignalMessage uses the session). X2F never receives; this is for the tests and the fake XMPP
 * peer, and the only place both halves of the protocol meet.
 */
import { decryptPayload, parseEncryptedElement, PAYLOAD_KEY_LENGTH, PAYLOAD_TAG_LENGTH } from './envelope.js';
import { bundleXml, generateBundleSecrets, newDeviceId, type BundleSecrets } from './bundle.js';
import { parsePreKeyMessage, parseSignalMessage, VERSION_BYTE } from './message.js';
import { decrypt, initBob, type SessionState } from './ratchet.js';
import { registrationIdFor } from './omemo.js';
import { x25519KeyPair, type KeyPair } from './x25519.js';

export class OmemoDevice {
  readonly deviceId: number;
  readonly identity: KeyPair;
  readonly bundle: BundleSecrets;
  /** Sessions by the sender's identity key and device id. */
  readonly sessions = new Map<string, SessionState>();
  /** One-time prekeys a session consumed (a client deletes them). */
  readonly usedPreKeys = new Set<number>();

  constructor(deviceId = newDeviceId(), preKeyCount?: number) {
    this.deviceId = deviceId;
    this.identity = x25519KeyPair();
    this.bundle = generateBundleSecrets(this.identity.privateKey, preKeyCount);
  }

  bundleXml(): string {
    return bundleXml(this.identity.publicKey, this.bundle);
  }

  /** The text of an element addressed to this device, or null when no `<key>` names it. */
  decrypt(elementXml: string): string | null {
    const e = parseEncryptedElement(elementXml);
    const key = e.keys.find((k) => k.rid === this.deviceId);
    if (key === undefined) return null;
    if (e.payload === null) throw new Error('device: key transport element');
    const secret = key.prekey ? this.decryptPreKey(e.sid, key.data) : this.decryptSession(e.sid, key.data);
    if (secret.length !== PAYLOAD_KEY_LENGTH + PAYLOAD_TAG_LENGTH) throw new Error('device: expected key and tag');
    return decryptPayload({ key: secret.subarray(0, PAYLOAD_KEY_LENGTH), tag: secret.subarray(PAYLOAD_KEY_LENGTH), iv: e.iv, ciphertext: e.payload });
  }

  private decryptPreKey(sid: number, data: Buffer): Buffer {
    const m = parsePreKeyMessage(data);
    if (m.signedPreKeyId !== this.bundle.signedPreKeyId) throw new Error('device: unknown signed prekey');
    let ourOneTimePreKey: KeyPair | undefined;
    if (m.preKeyId !== undefined) {
      if (this.usedPreKeys.has(m.preKeyId)) throw new Error('device: prekey already used');
      const pre = this.bundle.preKeys.find((p) => p.id === m.preKeyId);
      if (pre === undefined) throw new Error('device: unknown prekey');
      ourOneTimePreKey = pre.key;
    }
    const session = initBob({
      ourIdentity: this.identity,
      ourSignedPreKey: this.bundle.signedPreKey,
      ...(ourOneTimePreKey ? { ourOneTimePreKey } : {}),
      theirIdentity: m.identityKey,
      theirBaseKey: m.baseKey,
      registrationId: registrationIdFor(this.deviceId),
    });
    const plaintext = decrypt(session, m.message);
    if (m.preKeyId !== undefined) this.usedPreKeys.add(m.preKeyId);
    this.sessions.set(`${m.identityKey.toString('hex')}/${sid}`, session);
    return plaintext;
  }

  private decryptSession(sid: number, data: Buffer): Buffer {
    if (data[0] !== VERSION_BYTE) throw new Error('device: unsupported version');
    const parsed = parseSignalMessage(data);
    for (const [name, session] of this.sessions) {
      if (!name.endsWith(`/${sid}`)) continue;
      return decrypt(session, parsed);
    }
    throw new Error('device: no session');
  }
}
