// End to end inside the package: our bundle, a recipient's devices, one message to all of them, each
// device decrypts it with its own keys (the receiving half a client has).
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEVICELIST_NODE, bundleNode, bundleXml, deviceListXml, generateBundleSecrets, newDeviceId, parseBundleSecrets, serializeBundleSecrets,
} from '../src/bundle.js';
import { OmemoDevice } from '../src/device.js';
import { xeddsaSign, xeddsaVerify } from '../src/edwards.js';
import { OMEMO_NS, parseEncryptedElement } from '../src/envelope.js';
import { parsePreKeyMessage, wireKey } from '../src/message.js';
import { PreKeyLedger, encryptMessage, registrationIdFor, type RecipientBundle, type SenderIdentity } from '../src/omemo.js';
import { x25519KeyPair } from '../src/x25519.js';

const TEXT = 'An account change was made on your X2F account.';

function sender(): SenderIdentity {
  const kp = x25519KeyPair();
  return { deviceId: newDeviceId(), publicKey: kp.publicKey, privateKey: kp.privateKey };
}

/** What the API's bundle parser hands over: the device's published bundle in wire form. */
function recipientBundle(d: OmemoDevice): RecipientBundle {
  return {
    deviceId: d.deviceId,
    identityKey: wireKey(d.identity.publicKey),
    signedPreKeyId: d.bundle.signedPreKeyId,
    signedPreKey: wireKey(d.bundle.signedPreKey.publicKey),
    signedPreKeySignature: d.bundle.signedPreKeySignature,
    preKeys: d.bundle.preKeys.map((p) => ({ id: p.id, key: wireKey(p.key.publicKey) })),
  };
}

describe('our bundle', () => {
  it('has a signed prekey whose signature verifies under the identity key over its 33-byte wire form, and 100 prekeys with ids 1..100', () => {
    const id = x25519KeyPair();
    const s = generateBundleSecrets(id.privateKey);
    expect(xeddsaVerify(id.publicKey, wireKey(s.signedPreKey.publicKey), s.signedPreKeySignature)).toBe(true);
    expect(s.preKeys.map((p) => p.id)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(new Set(s.preKeys.map((p) => p.key.publicKey.toString('hex'))).size).toBe(100);
    expect(s.signedPreKeyId).toBeGreaterThanOrEqual(1);
    const xml = bundleXml(id.publicKey, s);
    expect(xml.startsWith(`<bundle xmlns='${OMEMO_NS}'><signedPreKeyPublic signedPreKeyId='${s.signedPreKeyId}'>`)).toBe(true);
    expect(xml).toContain(`<identityKey>${wireKey(id.publicKey).toString('base64')}</identityKey>`);
    expect((xml.match(/<preKeyPublic /g) ?? []).length).toBe(100);
    expect(deviceListXml([5, 77])).toBe(`<list xmlns='${OMEMO_NS}'><device id='5'/><device id='77'/></list>`);
    expect(DEVICELIST_NODE).toBe('eu.siacs.conversations.axolotl.devicelist');
    expect(bundleNode(77)).toBe('eu.siacs.conversations.axolotl.bundles:77');
  });

  it('round-trips through its sealed form and refuses one made for another identity', () => {
    const id = x25519KeyPair();
    const s = generateBundleSecrets(id.privateKey, 20);
    const back = parseBundleSecrets(serializeBundleSecrets(s), id.privateKey);
    expect(back).toEqual(s);
    expect(() => parseBundleSecrets(serializeBundleSecrets(s), x25519KeyPair().privateKey)).toThrow(/verify/);
    expect(serializeBundleSecrets(s).toString()).not.toContain(s.signedPreKey.publicKey.toString('hex'));
  });
});

describe('encryptMessage', () => {
  it('reaches every device: three devices with different keys all read the same text, with a prekey message each, from our sid', () => {
    const me = sender();
    const devices = [new OmemoDevice(11, 20), new OmemoDevice(12, 20), new OmemoDevice(13, 20)];
    const xml = encryptMessage(me, TEXT, devices.map(recipientBundle));
    const e = parseEncryptedElement(xml);
    expect(e.sid).toBe(me.deviceId);
    expect(e.keys.map((k) => k.rid)).toEqual([11, 12, 13]);
    expect(e.keys.every((k) => k.prekey)).toBe(true);
    for (const d of devices) expect(d.decrypt(xml)).toBe(TEXT);
    const stranger = new OmemoDevice(14, 20);
    expect(stranger.decrypt(xml)).toBeNull();
    // Each key element is a PreKeySignalMessage naming our identity and one of the device's prekeys.
    for (const [i, k] of e.keys.entries()) {
      const p = parsePreKeyMessage(k.data);
      expect(p.identityKey).toEqual(me.publicKey);
      expect(p.signedPreKeyId).toBe(devices[i]!.bundle.signedPreKeyId);
      expect(devices[i]!.bundle.preKeys.some((pk) => pk.id === p.preKeyId)).toBe(true);
      expect(p.registrationId).toBe(registrationIdFor(me.deviceId));
    }
  });

  it('every message is a fresh session: a second message to the same device uses another base key and another prekey is allowed; the device reads both', () => {
    const me = sender();
    const d = new OmemoDevice(21, 20);
    const first = encryptMessage(me, 'one', [recipientBundle(d)], { pickPreKey: (b) => b.preKeys[0]! });
    const second = encryptMessage(me, 'two', [recipientBundle(d)], { pickPreKey: (b) => b.preKeys[1]! });
    expect(parsePreKeyMessage(parseEncryptedElement(first).keys[0]!.data).baseKey).not.toEqual(parsePreKeyMessage(parseEncryptedElement(second).keys[0]!.data).baseKey);
    expect(d.decrypt(first)).toBe('one');
    expect(d.decrypt(second)).toBe('two');
    // A client deletes a used prekey: a third message on the same prekey would not be readable there.
    const third = encryptMessage(me, 'three', [recipientBundle(d)], { pickPreKey: (b) => b.preKeys[0]! });
    expect(() => d.decrypt(third)).toThrow(/already used/);
  });

  describe('PreKeyLedger (review M2): no prekey of a device is picked twice within one outbox pass', () => {
    const preKeyIdOf = (xml: string) => parsePreKeyMessage(parseEncryptedElement(xml).keys[0]!.data).preKeyId;

    it('five notices to one offline device (the same published bundle every time) use five different prekeys, and the device reads all five', () => {
      const me = sender();
      const phone = new OmemoDevice(51, 20);
      const offline = recipientBundle(phone); // the client is offline: nothing is consumed or republished between notices
      const pick = new PreKeyLedger().picker('mira@xmpp.example.org');
      const used: number[] = [];
      for (let i = 0; i < 5; i++) {
        const xml = encryptMessage(me, `notice ${i}`, [offline], { pickPreKey: pick });
        used.push(preKeyIdOf(xml)!);
        expect(phone.decrypt(xml), `notice ${i}`).toBe(`notice ${i}`);
      }
      expect(new Set(used).size).toBe(5);
      expect(used.every((id) => offline.preKeys.some((p) => p.id === id))).toBe(true);
    });

    it('tracks each recipient and device apart, and once every prekey of a device is used the session is set up without a one-time prekey, which the device still reads', () => {
      const me = sender();
      const phone = new OmemoDevice(52, 3);
      const sameIdElsewhere = new OmemoDevice(52, 3); // another user's device with the same id: its own identity, its own prekeys
      const ledger = new PreKeyLedger();
      const mira = ledger.picker('mira@xmpp.example.org');
      const noor = ledger.picker('noor@xmpp.example.org');
      const ids = [0, 1, 2].map((i) => {
        const xml = encryptMessage(me, `n${i}`, [recipientBundle(phone)], { pickPreKey: mira });
        expect(phone.decrypt(xml)).toBe(`n${i}`);
        return preKeyIdOf(xml);
      });
      expect(new Set(ids)).toEqual(new Set([1, 2, 3]));
      // Noor's device 52 is untouched by Mira's picks.
      const other = encryptMessage(me, 'to noor', [recipientBundle(sameIdElsewhere)], { pickPreKey: noor });
      expect([1, 2, 3]).toContain(preKeyIdOf(other));
      expect(sameIdElsewhere.decrypt(other)).toBe('to noor');
      // A fourth notice to Mira's exhausted device: no one-time prekey rather than a reused one (which the client could not read).
      const fourth = encryptMessage(me, 'n3', [recipientBundle(phone)], { pickPreKey: mira });
      expect(preKeyIdOf(fourth)).toBeUndefined();
      expect(phone.decrypt(fourth)).toBe('n3');
    });
  });

  it('refuses a bundle whose signed prekey signature does not verify, one without prekeys, and no devices at all', () => {
    const me = sender();
    const d = new OmemoDevice(31, 20);
    const bad = recipientBundle(d);
    bad.signedPreKeySignature = Buffer.from(bad.signedPreKeySignature);
    bad.signedPreKeySignature[3] = bad.signedPreKeySignature[3]! ^ 1;
    expect(() => encryptMessage(me, TEXT, [bad])).toThrow(/signature/);
    expect(() => encryptMessage(me, TEXT, [{ ...recipientBundle(d), preKeys: [] }])).toThrow(/prekeys/);
    expect(() => encryptMessage(me, TEXT, [])).toThrow(/no recipient/);
    expect(() => encryptMessage(me, TEXT, [{ ...recipientBundle(d), identityKey: randomBytes(33) }])).toThrow();
  });

  it('review L2: a device with a small-order or non-canonical key is skipped (reported by id) and the notice still reaches the others; with none left it fails', () => {
    const me = sender();
    const good = new OmemoDevice(61, 20);
    const P = 2n ** 255n - 19n;
    const le = (n: bigint) => { const out = Buffer.alloc(32); for (let i = 0; i < 32; i++, n >>= 8n) out[i] = Number(n & 0xffn); return out; };
    // 62: every prekey is u = 0 (order 1); 63: the signed prekey is u = 1 (order 4), properly signed; 64: the identity key is u = p (0, written non-canonically).
    const zeroPreKeys: RecipientBundle = { ...recipientBundle(new OmemoDevice(62, 3)), preKeys: [1, 2, 3].map((id) => ({ id, key: wireKey(Buffer.alloc(32)) })) };
    const spkDevice = new OmemoDevice(63, 3);
    const one = wireKey(le(1n));
    const smallSpk: RecipientBundle = { ...recipientBundle(spkDevice), signedPreKey: one, signedPreKeySignature: xeddsaSign(spkDevice.identity.privateKey, one, randomBytes(64)) };
    const nonCanonical: RecipientBundle = { ...recipientBundle(new OmemoDevice(64, 3)), identityKey: wireKey(le(P)) };
    const skipped: number[] = [];
    const xml = encryptMessage(me, TEXT, [zeroPreKeys, recipientBundle(good), smallSpk, nonCanonical], { onSkip: (id) => skipped.push(id) });
    expect(skipped).toEqual([62, 63, 64]);
    expect(parseEncryptedElement(xml).keys.map((k) => k.rid)).toEqual([61]);
    expect(good.decrypt(xml)).toBe(TEXT);
    expect(() => encryptMessage(me, TEXT, [zeroPreKeys, smallSpk])).toThrow(/^omemo: no usable device/);
    // A skip never quotes a key: the error names the fixed reasons only.
    const e = (() => { try { encryptMessage(me, TEXT, [nonCanonical]); return null; } catch (x) { return x as Error; } })()!;
    expect(e.message).toBe('omemo: no usable device (bundle signature does not verify)');
  });

  it('a message to one device is unreadable by another device of the same user, and the text is not in the element', () => {
    const me = sender();
    const a = new OmemoDevice(41, 20);
    const b = new OmemoDevice(42, 20);
    const xml = encryptMessage(me, TEXT, [recipientBundle(a)]);
    expect(xml).not.toContain('account');
    expect(a.decrypt(xml)).toBe(TEXT);
    expect(b.decrypt(xml)).toBeNull();
    // b pretending to be a (same rid) cannot: its keys differ.
    const forged = xml.replace(`rid='41'`, `rid='42'`);
    expect(() => b.decrypt(forged)).toThrow();
  });
});
