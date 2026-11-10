/**
 * The OMEMO 0.3 envelope (XEP-0384 0.3.0, namespace `eu.siacs.conversations.axolotl`): the text is
 * encrypted once with AES-128-GCM under a random 16-byte key and 12-byte IV; `key ‖ tag` (32 bytes)
 * is what each recipient device's session encrypts (Conversations' `PUT_AUTH_TAG_INTO_KEY`; a key
 * without the tag is refused by current clients). The element is built from typed parts, never from
 * a caller's string (review R1), and parsed back for tests and the fake peer.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const OMEMO_NS = 'eu.siacs.conversations.axolotl';
export const PAYLOAD_KEY_LENGTH = 16;
export const PAYLOAD_IV_LENGTH = 12;
export const PAYLOAD_TAG_LENGTH = 16;

export interface Payload {
  key: Buffer;
  iv: Buffer;
  ciphertext: Buffer;
  tag: Buffer;
}

export function encryptPayload(text: string, key: Buffer = randomBytes(PAYLOAD_KEY_LENGTH), iv: Buffer = randomBytes(PAYLOAD_IV_LENGTH)): Payload {
  if (key.length !== PAYLOAD_KEY_LENGTH || iv.length !== PAYLOAD_IV_LENGTH) throw new RangeError('omemo: payload key is 16 bytes, iv 12');
  const c = createCipheriv('aes-128-gcm', key, iv, { authTagLength: PAYLOAD_TAG_LENGTH });
  const ciphertext = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return { key, iv, ciphertext, tag: c.getAuthTag() };
}

export function decryptPayload(p: Payload): string {
  const d = createDecipheriv('aes-128-gcm', p.key, p.iv, { authTagLength: PAYLOAD_TAG_LENGTH });
  d.setAuthTag(p.tag);
  return Buffer.concat([d.update(p.ciphertext), d.final()]).toString('utf8');
}

/** What one device's session encrypts: the payload key and the GCM tag. */
export const keyAndTag = (p: Payload): Buffer => Buffer.concat([p.key, p.tag]);

export interface EncryptedElement {
  /** The sender's device id. */
  sid: number;
  keys: Array<{ rid: number; prekey: boolean; data: Buffer }>;
  iv: Buffer;
  /** Absent for a KeyTransportElement. */
  payload: Buffer | null;
}

const DEVICE_ID_MAX = 0x7fffffff;
const deviceId = (n: number, what: string) => {
  if (!Number.isInteger(n) || n < 1 || n > DEVICE_ID_MAX) throw new RangeError(`omemo: ${what} is a device id in 1..2^31-1`);
  return String(n);
};
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

/** The `<encrypted>` element, built from parts (every value is a checked integer or base64). */
export function encryptedElement(e: EncryptedElement): string {
  if (e.keys.length === 0) throw new RangeError('omemo: no recipient device');
  if (e.iv.length !== PAYLOAD_IV_LENGTH) throw new RangeError('omemo: iv is 12 bytes');
  const keys = e.keys.map((k) => `<key rid='${deviceId(k.rid, 'rid')}'${k.prekey ? " prekey='true'" : ''}>${b64(k.data)}</key>`).join('');
  const payload = e.payload === null ? '' : `<payload>${b64(e.payload)}</payload>`;
  return `<encrypted xmlns='${OMEMO_NS}'><header sid='${deviceId(e.sid, 'sid')}'>${keys}<iv>${b64(e.iv)}</iv></header>${payload}</encrypted>`;
}

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const fromB64 = (s: string): Buffer => {
  const t = s.trim();
  if (!B64.test(t) || t.length % 4 !== 0) throw new RangeError('omemo: bad base64');
  return Buffer.from(t, 'base64');
};

/** Parses an `<encrypted>` element (tests and the fake peer; the API never parses one). */
export function parseEncryptedElement(xml: string): EncryptedElement {
  const m = /^<encrypted xmlns=['"]eu\.siacs\.conversations\.axolotl['"]>([\s\S]*)<\/encrypted>$/.exec(xml.trim());
  if (!m) throw new RangeError('omemo: not an encrypted element');
  const header = /<header\b[^>]*\bsid=['"]([0-9]+)['"][^>]*>([\s\S]*?)<\/header>/.exec(m[1]!);
  if (!header) throw new RangeError('omemo: no header');
  const keys = [...header[2]!.matchAll(/<key\b([^>]*)>([^<]*)<\/key>/g)].map((k) => {
    const rid = /\brid=['"]([0-9]+)['"]/.exec(k[1]!)?.[1];
    if (rid === undefined) throw new RangeError('omemo: key without rid');
    return { rid: Number(rid), prekey: /\bprekey=['"](?:true|1)['"]/.test(k[1]!), data: fromB64(k[2]!) };
  });
  const iv = /<iv>([^<]*)<\/iv>/.exec(header[2]!);
  if (!iv) throw new RangeError('omemo: no iv');
  const payload = /<payload>([^<]*)<\/payload>/.exec(m[1]!);
  return { sid: Number(header[1]), keys, iv: fromB64(iv[1]!), payload: payload ? fromB64(payload[1]!) : null };
}
