// End to end inside the package: our bundle, a recipient's devices, one message to all of them, each
// device decrypts it with its own keys (the receiving half a client has).
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEVICELIST_NODE, bundleNode, bundleXml, deviceListXml, generateBundleSecrets, newDeviceId, parseBundleSecrets, serializeBundleSecrets,
} from '../src/bundle.js';
import { OmemoDevice } from '../src/device.js';
import { identityFromSeed, newIdentitySeed, xeddsaSign, xeddsaVerify } from '../src/edwards.js';
import { OMEMO_NS, parseEncryptedElement } from '../src/envelope.js';
import { parsePreKeyMessage, wireKey } from '../src/message.js';
import { PreKeyLedger, PreKeysExhausted, encryptMessage, registrationIdFor, type RecipientBundle, type SenderIdentity } from '../src/omemo.js';
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
    const id = identityFromSeed(newIdentitySeed());
    const s = generateBundleSecrets(id);
    // Signed by OpenSSL's Ed25519 signer (lead decision after review L1), checked by the XEdDSA verifier a libsignal client runs.
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
    const id = identityFromSeed(newIdentitySeed());
    const s = generateBundleSecrets(id, 20);
    const back = parseBundleSecrets(serializeBundleSecrets(s), id.privateKey);
    expect(back).toEqual(s);
    expect(() => parseBundleSecrets(serializeBundleSecrets(s), x25519KeyPair().privateKey)).toThrow(/verify/);
    expect(serializeBundleSecrets(s).toString()).not.toContain(s.signedPreKey.publicKey.toString('hex'));
  });

  it('review L4: a malformed stored bundle fails with a fixed text that quotes nothing of the (decrypted) input or of any key', () => {
    const id = identityFromSeed(newIdentitySeed());
    const s = generateBundleSecrets(id, 3);
    const good = serializeBundleSecrets(s).toString('utf8');
    const MARK = 'c0ffee00deadbeef';
    const bad: string[] = [
      `${good.slice(0, -1)}${MARK}`, // cut JSON, with a marker where V8 would quote the source
      good.replace('"v":1', `"v":1,"x":"${MARK}`), // unterminated string
      good.replace('"v":1', '"v":2'),
      'null',
      '[]',
      `{"v":1,"signedPreKeyId":1,"signedPreKey":"${MARK}","signedPreKeySignature":"00","preKeys":[]}`,
      good.replace('"preKeys":[', '"preKeys":{"a":['),
      JSON.stringify({ ...JSON.parse(good), preKeys: [{ id: 'one', key: MARK }] }),
      JSON.stringify({ ...JSON.parse(good), signedPreKeySignature: MARK }),
    ];
    const secrets = [id.privateKey, s.signedPreKey.privateKey, ...s.preKeys.map((p) => p.key.privateKey)].map((b) => b.toString('hex'));
    for (const b of bad) {
      let e: Error | null = null;
      try {
        parseBundleSecrets(Buffer.from(b, 'utf8'), id.privateKey);
      } catch (x) {
        e = x as Error;
      }
      expect(e, b.slice(0, 60)).not.toBeNull();
      expect(e!.message, b.slice(0, 60)).toMatch(/^omemo: (stored bundle|unknown bundle format)/);
      expect(e!.message).not.toContain(MARK);
      for (const hex of secrets) expect(e!.message).not.toContain(hex.slice(0, 8));
      expect(e!.message.length).toBeLessThan(80);
    }
    // A bundle moved to another identity: the fixed text as well, with no key in it.
    let moved: Error | null = null;
    try {
      parseBundleSecrets(Buffer.from(good, 'utf8'), x25519KeyPair().privateKey);
    } catch (x) {
      moved = x as Error;
    }
    expect(moved!.message).toBe('omemo: stored bundle does not verify');
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

    it('tracks each recipient and device apart, and once every prekey of a device is used the notice is deferred, never sent without a one-time prekey', () => {
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
      // A fourth notice to Mira's exhausted device is neither sent on a reused prekey (which the client could not read) nor
      // without one (python-omemo refuses that: interop run 2026-11-10, step 4b): it is deferred to the next pass.
      expect(() => encryptMessage(me, 'n3', [recipientBundle(phone)], { pickPreKey: mira })).toThrow(PreKeysExhausted);
    });

    it('lead decision after interop 4b: 101 notices to a 100-prekey device in one pass are 100 sent, each on its own prekey, and 1 deferred; none goes without a prekey', () => {
      const me = sender();
      const phone = new OmemoDevice(53);
      const offline = recipientBundle(phone);
      expect(offline.preKeys).toHaveLength(100);
      const pass = new PreKeyLedger().forRecipient('mira@xmpp.example.org');
      const sent: string[] = [];
      let deferred = 0;
      for (let i = 0; i < 101; i++) {
        try {
          sent.push(encryptMessage(me, `notice ${i}`, [offline], pass));
        } catch (e) {
          expect(e).toBeInstanceOf(PreKeysExhausted);
          expect((e as Error).message).toBe('omemo: prekeys used up in this pass');
          deferred++;
        }
      }
      expect(sent).toHaveLength(100);
      expect(deferred).toBe(1);
      const ids = sent.map(preKeyIdOf);
      expect(ids.every((id) => id !== undefined)).toBe(true);
      expect(new Set(ids).size).toBe(100);
      sent.forEach((xml, i) => expect(phone.decrypt(xml), `notice ${i}`).toBe(`notice ${i}`));
      // The client republishes after reading them: the same pass can use the fresh prekeys, and only those.
      phone.replenish();
      const refreshed = recipientBundle(phone);
      expect(refreshed.preKeys.some((p) => ids.includes(p.id))).toBe(false);
      const late = encryptMessage(me, 'notice 100', [refreshed], pass);
      expect(refreshed.preKeys.map((p) => p.id)).toContain(preKeyIdOf(late));
      expect(phone.decrypt(late)).toBe('notice 100');
    });

    it('seed: prekey ids recorded outside this pass (the API keeps them across passes) are never picked; usedIds lists what the ledger holds for a device', () => {
      const me = sender();
      const phone = new OmemoDevice(58, 3);
      const ledger = new PreKeyLedger();
      ledger.seed('mira@xmpp.example.org', recipientBundle(phone), [1, 3]);
      const xml = encryptMessage(me, 'n0', [recipientBundle(phone)], ledger.forRecipient('mira@xmpp.example.org'));
      expect(preKeyIdOf(xml)).toBe(2);
      expect(ledger.usedIds('mira@xmpp.example.org', recipientBundle(phone)).sort()).toEqual([1, 2, 3]);
      expect(ledger.usedIds('noor@xmpp.example.org', recipientBundle(phone))).toEqual([]);
      expect(() => encryptMessage(me, 'n1', [recipientBundle(phone)], ledger.forRecipient('mira@xmpp.example.org'))).toThrow(PreKeysExhausted);
    });

    it('usedUp: once a device of a recipient had no prekey left, the ledger says so for that recipient alone, so the outbox can skip the rest of the pass', () => {
      const me = sender();
      const phone = new OmemoDevice(59, 1);
      const ledger = new PreKeyLedger();
      encryptMessage(me, 'n0', [recipientBundle(phone)], ledger.forRecipient('mira@xmpp.example.org'));
      expect(ledger.usedUp('mira@xmpp.example.org')).toBe(false);
      expect(() => encryptMessage(me, 'n1', [recipientBundle(phone)], ledger.forRecipient('mira@xmpp.example.org'))).toThrow(PreKeysExhausted);
      expect(ledger.usedUp('mira@xmpp.example.org')).toBe(true);
      expect(ledger.usedUp('noor@xmpp.example.org')).toBe(false);
    });

    it('a notice to several devices, one of them used up, is deferred whole (one message per notice), and the other devices keep the prekeys it had picked', () => {
      const me = sender();
      const phone = new OmemoDevice(54, 1);
      const laptop = new OmemoDevice(55, 2);
      const pass = new PreKeyLedger().forRecipient('mira@xmpp.example.org');
      const first = encryptMessage(me, 'n0', [recipientBundle(laptop), recipientBundle(phone)], pass);
      expect(phone.decrypt(first)).toBe('n0');
      expect(laptop.decrypt(first)).toBe('n0');
      // The laptop is picked first and has one prekey left; the phone has none: nothing is sent and the laptop's prekey stays free.
      expect(() => encryptMessage(me, 'n1', [recipientBundle(laptop), recipientBundle(phone)], pass)).toThrow(PreKeysExhausted);
      const alone = encryptMessage(me, 'n2', [recipientBundle(laptop)], pass);
      expect(laptop.decrypt(alone)).toBe('n2');
    });

    it('a device skipped for a key the agreement refuses (review L2) gives its prekey back, so it never uses up and defers the notices to the good devices', () => {
      const me = sender();
      const good = new OmemoDevice(56, 20);
      const zero: RecipientBundle = { ...recipientBundle(new OmemoDevice(57, 1)), preKeys: [{ id: 1, key: wireKey(Buffer.alloc(32)) }] };
      const pass = new PreKeyLedger().forRecipient('mira@xmpp.example.org');
      for (let i = 0; i < 3; i++) {
        const skipped: number[] = [];
        const xml = encryptMessage(me, `n${i}`, [zero, recipientBundle(good)], { ...pass, onSkip: (id) => skipped.push(id) });
        expect(skipped).toEqual([57]);
        expect(good.decrypt(xml)).toBe(`n${i}`);
      }
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
