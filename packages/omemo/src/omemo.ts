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
/**
 * Picks the one-time prekey of a bundle to use; null when every one is used up in this pass, and
 * then the notice is not sent (`PreKeysExhausted`): never without a one-time prekey.
 */
export type PickPreKey = (bundle: RecipientBundle) => PreKey | null;
/** Gives back a prekey picked for a message that was then not sent (so no client ever saw it used). */
export type ReleasePreKey = (bundle: RecipientBundle, preKey: PreKey) => void;

export interface EncryptOptions {
  /** Which prekey of a bundle to use (default: one at random; a `PreKeyLedger` for an outbox pass). */
  pickPreKey?: PickPreKey;
  /** Told of each picked prekey that went unused after all (a skipped device, a deferred notice). */
  releasePreKey?: ReleasePreKey;
  /** The base key per device (default: fresh); tests only. */
  baseKey?: () => KeyPair;
  /** Told the id of each device that was skipped (review L2); the id is the only thing worth logging. */
  onSkip?: (deviceId: number) => void;
}

const randomPreKey: PickPreKey = (b) => b.preKeys[randomInt(b.preKeys.length)]!;

/**
 * Thrown by `encryptMessage` when a recipient device has no prekey left in this pass: the notice is
 * not sent now and waits for the next pass (lead decision after the interop run of 2026-11-10, step
 * 4b). Its message is fixed.
 */
export class PreKeysExhausted extends Error {
  constructor() {
    super('omemo: prekeys used up in this pass');
    this.name = 'PreKeysExhausted';
  }
}

/**
 * The prekeys picked during one outbox pass (review M2). A client deletes a one-time prekey after
 * its first use and republishes without it; while it is offline the sender sees the same bundle for
 * every notice, so two notices picking the same prekey would leave the second unreadable. Within one
 * pass no prekey of a device (by recipient, device id and identity key) is picked twice. Once all
 * are used the picker answers null and the notice is deferred to the next pass, which fetches the
 * bundle again (lead decision after interop step 4b: python-omemo, which Gajim and other clients
 * use, refuses a PreKeySignalMessage without a one-time prekey, so there is no such fallback).
 */
export class PreKeyLedger {
  private readonly used = new Map<string, Set<number>>();
  /** The ids picked in this pass (and not given back), apart from those seeded from a record. */
  private readonly picked = new Map<string, Set<number>>();
  private readonly exhausted = new Set<string>();

  private static device(recipient: string, b: RecipientBundle): string {
    return `${recipient}\n${b.deviceId}\n${b.identityKey.toString('hex')}`;
  }

  private setOf(map: Map<string, Set<number>>, recipient: string, b: RecipientBundle): Set<number> {
    const device = PreKeyLedger.device(recipient, b);
    let s = map.get(device);
    if (s === undefined) map.set(device, (s = new Set()));
    return s;
  }

  private usedBy(recipient: string, b: RecipientBundle): Set<number> {
    return this.setOf(this.used, recipient, b);
  }

  /** The picker for notices to `recipient` (a bare JID) in this pass. */
  picker(recipient: string): PickPreKey {
    return (b) => {
      const used = this.usedBy(recipient, b);
      const left = b.preKeys.filter((p) => !used.has(p.id));
      if (left.length === 0) {
        this.exhausted.add(recipient);
        return null;
      }
      const pick = left[randomInt(left.length)]!;
      used.add(pick.id);
      this.setOf(this.picked, recipient, b).add(pick.id);
      return pick;
    };
  }

  /**
   * Whether a device of `recipient` had no prekey left in this pass: the outbox defers the rest of
   * the pass's notices to that recipient without connecting (its bundle could have been refreshed
   * meanwhile, but only a connection would tell; the next pass looks).
   */
  usedUp(recipient: string): boolean {
    return this.exhausted.has(recipient);
  }

  /** Marks `ids` as used for `recipient`'s device `b` (ids the API recorded in earlier passes). */
  seed(recipient: string, b: RecipientBundle, ids: Iterable<number>): void {
    const used = this.usedBy(recipient, b);
    for (const id of ids) used.add(id);
  }

  /** The ids used for `recipient`'s device `b` (by device id and identity key), in no order. */
  usedIds(recipient: string, b: RecipientBundle): number[] {
    return [...(this.used.get(PreKeyLedger.device(recipient, b)) ?? [])];
  }

  /**
   * The ids picked for `recipient`'s device `b` in this pass, in no order (review R1: the API tells a
   * device used up within the pass, which defers, from one that was used up before it, which it skips).
   */
  pickedIds(recipient: string, b: RecipientBundle): number[] {
    return [...(this.picked.get(PreKeyLedger.device(recipient, b)) ?? [])];
  }

  /** Picker and releaser for notices to `recipient`, as `encryptMessage` options. */
  forRecipient(recipient: string): Required<Pick<EncryptOptions, 'pickPreKey' | 'releasePreKey'>> {
    return {
      pickPreKey: this.picker(recipient),
      releasePreKey: (b, p) => {
        this.usedBy(recipient, b).delete(p.id);
        this.setOf(this.picked, recipient, b).delete(p.id);
      },
    };
  }
}

/**
 * Encrypts `text` to every device in `bundles` and returns the `<encrypted>` element. A device
 * whose bundle does not verify, has no prekeys, or has a key the agreement refuses (small-order or
 * not on the curve: OpenSSL returns an error for an all-zero shared secret) is skipped, so one
 * broken client never silences a user's other devices (review L2); the prekey picked for it is given
 * back, since nothing was sent to it. Throws when no device is left or `bundles` is empty, naming
 * only the fixed reasons, never a key.
 *
 * Throws `PreKeysExhausted` when the picker has no prekey left for a device (one outbox pass sent it
 * every one), giving back the prekeys already picked for the others: the whole notice is deferred.
 * One notice is one message carrying a key per device, and the outbox keeps one row per notice, not
 * per device, so it cannot send to some devices now and to the rest later (a per-device outbox
 * would; until then a used-up device holds back the notice for the user's other devices too).
 */
export function encryptMessage(identity: SenderIdentity, text: string, bundles: RecipientBundle[], o: EncryptOptions = {}): string {
  if (bundles.length === 0) throw new RangeError('omemo: no recipient device');
  const payload = encryptPayload(text);
  const secret = keyAndTag(payload);
  const ourIdentity: KeyPair = { publicKey: identity.publicKey, privateKey: identity.privateKey };
  const keys: Array<{ rid: number; prekey: boolean; data: Buffer }> = [];
  const reasons = new Set<string>();
  const pick = o.pickPreKey ?? randomPreKey;
  const picked: Array<[RecipientBundle, PreKey]> = [];
  const giveBack = (b: RecipientBundle, pre: PreKey) => o.releasePreKey?.(b, pre);
  for (const b of bundles) {
    let pre: PreKey | null = null;
    try {
      const theirIdentity = rawKey(b.identityKey);
      if (!xeddsaVerify(theirIdentity, b.signedPreKey, b.signedPreKeySignature)) throw new RangeError('omemo: bundle signature does not verify');
      if (b.preKeys.length === 0) throw new RangeError('omemo: bundle without prekeys');
      pre = pick(b);
      if (pre === null) {
        for (const [pb, pp] of picked) giveBack(pb, pp);
        throw new PreKeysExhausted();
      }
      const session = initAlice({
        ourIdentity,
        ourBaseKey: (o.baseKey ?? x25519KeyPair)(),
        theirIdentity,
        theirSignedPreKey: rawKey(b.signedPreKey),
        theirOneTimePreKey: rawKey(pre.key),
        preKeyId: pre.id,
        signedPreKeyId: b.signedPreKeyId,
        registrationId: registrationIdFor(identity.deviceId),
      });
      keys.push({ rid: b.deviceId, prekey: true, data: encrypt(session, secret) });
      picked.push([b, pre]);
    } catch (e) {
      if (e instanceof PreKeysExhausted) throw e;
      if (pre !== null) giveBack(b, pre);
      // Our own checks have fixed texts; anything else (OpenSSL refusing a key) becomes one.
      reasons.add(e instanceof RangeError && e.message.startsWith('omemo: ') ? e.message.slice('omemo: '.length) : 'key rejected');
      o.onSkip?.(b.deviceId);
    }
  }
  if (keys.length === 0) throw new RangeError(`omemo: no usable device (${[...reasons].join('; ')})`);
  return encryptedElement({ sid: identity.deviceId, keys, iv: payload.iv, payload: payload.ciphertext });
}
