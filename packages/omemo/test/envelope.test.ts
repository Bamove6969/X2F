// The OMEMO 0.3 envelope: AES-128-GCM payload, key ‖ tag, and the <encrypted> element from typed parts.
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { OMEMO_NS, decryptPayload, encryptPayload, encryptedElement, keyAndTag, parseEncryptedElement } from '../src/envelope.js';

describe('payload', () => {
  it('encrypts with AES-128-GCM under a 16-byte key and 12-byte IV, a 16-byte tag; key ‖ tag is 32 bytes', () => {
    const p = encryptPayload('An account change was made on your X2F account.');
    expect(p.key).toHaveLength(16);
    expect(p.iv).toHaveLength(12);
    expect(p.tag).toHaveLength(16);
    expect(p.ciphertext).toHaveLength(Buffer.byteLength('An account change was made on your X2F account.'));
    expect(keyAndTag(p)).toEqual(Buffer.concat([p.key, p.tag]));
    expect(decryptPayload(p)).toBe('An account change was made on your X2F account.');
    const tampered = { ...p, ciphertext: Buffer.from(p.ciphertext) };
    tampered.ciphertext[0] = tampered.ciphertext[0]! ^ 1;
    expect(() => decryptPayload(tampered)).toThrow();
    expect(() => encryptPayload('x', randomBytes(32), p.iv)).toThrow();
    expect(() => encryptPayload('x', p.key, randomBytes(16))).toThrow();
  });

  it('uses a fresh key and IV each time', () => {
    const a = encryptPayload('same');
    const b = encryptPayload('same');
    expect(a.key.equals(b.key)).toBe(false);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });
});

describe('<encrypted> element', () => {
  it('is one element with header sid, one key per device (prekey flag), iv and payload, all base64; parses back', () => {
    const iv = randomBytes(12);
    const data = randomBytes(40);
    const payload = randomBytes(30);
    const xml = encryptedElement({ sid: 12345, keys: [{ rid: 1, prekey: true, data }, { rid: 2 ** 31 - 1, prekey: false, data }], iv, payload });
    expect(xml).toBe(
      `<encrypted xmlns='${OMEMO_NS}'><header sid='12345'><key rid='1' prekey='true'>${data.toString('base64')}</key>` +
        `<key rid='2147483647'>${data.toString('base64')}</key><iv>${iv.toString('base64')}</iv></header><payload>${payload.toString('base64')}</payload></encrypted>`,
    );
    expect(parseEncryptedElement(xml)).toEqual({ sid: 12345, keys: [{ rid: 1, prekey: true, data }, { rid: 2147483647, prekey: false, data }], iv, payload });
    expect(xml).not.toContain('<body');
    expect((xml.match(/<encrypted[\s>]/g) ?? []).length).toBe(1);
  });

  it('a KeyTransportElement has no payload', () => {
    const xml = encryptedElement({ sid: 1, keys: [{ rid: 2, prekey: false, data: Buffer.alloc(3) }], iv: randomBytes(12), payload: null });
    expect(xml).not.toContain('<payload');
    expect(parseEncryptedElement(xml).payload).toBeNull();
  });

  it('refuses device ids outside 1..2^31-1, no keys, and a wrong IV length; the parser refuses other elements and bad base64', () => {
    const ok = { sid: 1, keys: [{ rid: 2, prekey: true, data: Buffer.alloc(1) }], iv: randomBytes(12), payload: Buffer.alloc(1) };
    expect(() => encryptedElement({ ...ok, sid: 0 })).toThrow();
    expect(() => encryptedElement({ ...ok, sid: 2 ** 31 })).toThrow();
    expect(() => encryptedElement({ ...ok, keys: [{ rid: 1.5, prekey: true, data: Buffer.alloc(1) }] })).toThrow();
    expect(() => encryptedElement({ ...ok, keys: [] })).toThrow();
    expect(() => encryptedElement({ ...ok, iv: randomBytes(16) })).toThrow();
    expect(() => parseEncryptedElement('<body>hi</body>')).toThrow();
    expect(() => parseEncryptedElement(`<encrypted xmlns='${OMEMO_NS}'><header sid='1'><key rid='2'>!!!</key><iv>AAAA</iv></header></encrypted>`)).toThrow();
  });
});
