// libsignal's SignalMessage and PreKeySignalMessage framing, byte by byte.
import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MAC_LENGTH, VERSION_BYTE, encodePreKeyMessage, encodeSignalMessage, parsePreKeyMessage, parseSignalMessage, rawKey, verifySignalMessageMac, wireKey,
} from '../src/message.js';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('SignalMessage', () => {
  const ratchetKey = Buffer.alloc(32, 0xaa);
  const ciphertext = Buffer.from('0102030405060708090a0b0c0d0e0f10', 'hex');
  const macKey = Buffer.alloc(32, 1);
  const sender = Buffer.alloc(32, 2);
  const receiver = Buffer.alloc(32, 3);

  it('is 0x33, the protobuf {1: 0x05‖ratchetKey, 2: counter, 3: previousCounter, 4: ciphertext}, then 8 MAC bytes', () => {
    const m = encodeSignalMessage({ ratchetKey, counter: 5, previousCounter: 2, ciphertext }, macKey, sender, receiver);
    expect(VERSION_BYTE).toBe(0x33);
    const proto = `0a21${'05'}${'aa'.repeat(32)}` + '1005' + '1802' + `2210${hex(ciphertext)}`;
    expect(hex(m.subarray(0, m.length - MAC_LENGTH))).toBe(`33${proto}`);
    const mac = createHmac('sha256', macKey).update(wireKey(sender)).update(wireKey(receiver)).update(Buffer.from(`33${proto}`, 'hex')).digest();
    expect(hex(m.subarray(m.length - MAC_LENGTH))).toBe(hex(mac.subarray(0, 8)));
  });

  it('parses back and verifies its MAC only with the right key and identities', () => {
    const m = encodeSignalMessage({ ratchetKey, counter: 5, previousCounter: 2, ciphertext }, macKey, sender, receiver);
    const p = parseSignalMessage(m);
    expect(p).toMatchObject({ ratchetKey, counter: 5, previousCounter: 2, ciphertext });
    expect(verifySignalMessageMac(p, macKey, sender, receiver)).toBe(true);
    expect(verifySignalMessageMac(p, Buffer.alloc(32, 9), sender, receiver)).toBe(false);
    expect(verifySignalMessageMac(p, macKey, receiver, sender)).toBe(false);
    for (let i = 0; i < m.length; i++) {
      const bad = Buffer.from(m);
      bad[i] = bad[i]! ^ 0x01;
      let ok = false;
      try {
        ok = verifySignalMessageMac(parseSignalMessage(bad), macKey, sender, receiver);
      } catch {
        ok = false;
      }
      expect(ok, `byte ${i}`).toBe(false);
    }
  });

  it('refuses another version, a missing field, a key of another type, and short input', () => {
    const m = encodeSignalMessage({ ratchetKey, counter: 0, previousCounter: 0, ciphertext }, macKey, sender, receiver);
    const v2 = Buffer.from(m);
    v2[0] = 0x22;
    expect(() => parseSignalMessage(v2)).toThrow(/version/);
    expect(() => parseSignalMessage(Buffer.from([0x33, 0, 0, 0, 0, 0, 0, 0]))).toThrow(/short/);
    expect(() => parseSignalMessage(Buffer.concat([Buffer.from('331005', 'hex'), Buffer.alloc(8)]))).toThrow(/ratchet key/);
    expect(() => rawKey(Buffer.concat([Buffer.from([0x06]), ratchetKey]))).toThrow();
    expect(() => wireKey(Buffer.alloc(31))).toThrow();
    expect(rawKey(wireKey(ratchetKey))).toEqual(ratchetKey);
  });
});

describe('PreKeySignalMessage', () => {
  it('is 0x33 then {5: registrationId, 1: preKeyId, 6: signedPreKeyId, 2: baseKey, 3: identityKey, 4: message}; preKeyId is optional', () => {
    const baseKey = randomBytes(32);
    const identityKey = randomBytes(32);
    const message = Buffer.from('deadbeef', 'hex');
    const m = encodePreKeyMessage({ registrationId: 1234, preKeyId: 77, signedPreKeyId: 300, baseKey, identityKey, message });
    expect(hex(m)).toBe(`33${'28d209'}${'084d'}${'30ac02'}${'1221'}05${hex(baseKey)}${'1a21'}05${hex(identityKey)}${'2204'}deadbeef`);
    expect(parsePreKeyMessage(m)).toEqual({ registrationId: 1234, preKeyId: 77, signedPreKeyId: 300, baseKey, identityKey, message });
    // Without a preKeyId, field 1 is absent: the exact bytes, not a search for '084d', which random
    // keys hold about once in 530 runs (the flake of 18 Nov).
    const without = encodePreKeyMessage({ registrationId: 1, signedPreKeyId: 2, baseKey, identityKey, message });
    expect(hex(without)).toBe(`33${'2801'}${'3002'}${'1221'}05${hex(baseKey)}${'1a21'}05${hex(identityKey)}${'2204'}deadbeef`);
    expect(parsePreKeyMessage(without)).toEqual({ registrationId: 1, signedPreKeyId: 2, baseKey, identityKey, message });
    expect(parsePreKeyMessage(without).preKeyId).toBeUndefined();
  });

  it('keys that hold the bytes of a preKeyId field (08 4d) do not make one appear', () => {
    const baseKey = Buffer.alloc(32, 0x08);
    baseKey[1] = 0x4d;
    const identityKey = Buffer.from('084d'.repeat(16), 'hex');
    const message = Buffer.from('deadbeef', 'hex');
    const without = encodePreKeyMessage({ registrationId: 1, signedPreKeyId: 2, baseKey, identityKey, message });
    expect(hex(without)).toBe(`33${'2801'}${'3002'}${'1221'}05${hex(baseKey)}${'1a21'}05${hex(identityKey)}${'2204'}deadbeef`);
    expect(parsePreKeyMessage(without)).toEqual({ registrationId: 1, signedPreKeyId: 2, baseKey, identityKey, message });
    expect(parsePreKeyMessage(without).preKeyId).toBeUndefined();
  });

  it('refuses another version and a missing key', () => {
    expect(() => parsePreKeyMessage(Buffer.from('22', 'hex'))).toThrow(/short/);
    expect(() => parsePreKeyMessage(Buffer.from('2200', 'hex'))).toThrow(/version/);
    expect(() => parsePreKeyMessage(Buffer.from('332801', 'hex'))).toThrow(/signed prekey id/);
  });
});
