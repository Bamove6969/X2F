/**
 * Just enough DER to build the soft authenticator's test X.509 certificates (a self-signed test CA
 * and packed-attestation leaves). Tests only.
 */
import { sign, type KeyObject } from 'node:crypto';

function len(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let m = n; m > 0; m >>= 8) bytes.unshift(m & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

const tlv = (tag: number, content: Buffer): Buffer => Buffer.concat([Buffer.from([tag]), len(content.length), content]);

export const seq = (...items: Buffer[]): Buffer => tlv(0x30, Buffer.concat(items));
export const set = (...items: Buffer[]): Buffer => tlv(0x31, Buffer.concat(items));
export const octet = (b: Uint8Array): Buffer => tlv(0x04, Buffer.from(b));
export const bool = (v: boolean): Buffer => tlv(0x01, Buffer.from([v ? 0xff : 0]));
export const bitString = (b: Uint8Array, unused = 0): Buffer => tlv(0x03, Buffer.concat([Buffer.from([unused]), Buffer.from(b)]));
/** `[n] EXPLICIT`. */
export const explicit = (n: number, inner: Buffer): Buffer => tlv(0xa0 | n, inner);

export function int(v: number | Uint8Array): Buffer {
  let b = typeof v === 'number' ? Buffer.from([v]) : Buffer.from(v);
  while (b.length > 1 && b[0] === 0 && (b[1]! & 0x80) === 0) b = b.subarray(1);
  if ((b[0]! & 0x80) !== 0) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}

export function oid(dotted: string): Buffer {
  const parts = dotted.split('.').map(Number);
  const out: number[] = [40 * parts[0]! + parts[1]!];
  for (const p of parts.slice(2)) {
    const chunk: number[] = [p & 0x7f];
    for (let m = p >>> 7; m > 0; m >>>= 7) chunk.unshift(0x80 | (m & 0x7f));
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}

function time(d: Date): Buffer {
  const iso = d.toISOString();
  const digits = iso.slice(0, 19).replace(/[-:T]/g, '');
  // UTCTime before 2050, GeneralizedTime from 2050 (RFC 5280 4.1.2.5).
  return d.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(`${digits.slice(2)}Z`)) : tlv(0x18, Buffer.from(`${digits}Z`));
}

export interface Name {
  C: string;
  O: string;
  OU?: string;
  CN: string;
}

function name(n: Name): Buffer {
  const rdn = (type: string, value: Buffer) => set(seq(oid(type), value));
  const utf8 = (s: string) => tlv(0x0c, Buffer.from(s, 'utf8'));
  return seq(
    rdn('2.5.4.6', tlv(0x13, Buffer.from(n.C))),
    rdn('2.5.4.10', utf8(n.O)),
    ...(n.OU ? [rdn('2.5.4.11', utf8(n.OU))] : []),
    rdn('2.5.4.3', utf8(n.CN)),
  );
}

const ECDSA_SHA256 = seq(oid('1.2.840.10045.4.3.2'));

export interface CertSpec {
  serial: number;
  issuer: Name;
  subject: Name;
  notBefore: Date;
  notAfter: Date;
  /** The certified public key. */
  publicKey: KeyObject;
  /** The issuer's private key (P-256). */
  signingKey: KeyObject;
  ca: boolean;
  /** id-fido-gen-ce-aaguid, 16 bytes. */
  aaguid?: Uint8Array;
  /** subjectAltName dNSName entries (a TLS server certificate for jabber/xmpp.ts tests). */
  dnsNames?: string[];
}

/** A DER X.509 v3 certificate signed with ECDSA-SHA256. */
export function certificate(c: CertSpec): Buffer {
  const ext = (id: string, critical: boolean, value: Buffer) => seq(oid(id), ...(critical ? [bool(true)] : []), octet(value));
  const extensions = [ext('2.5.29.19', true, c.ca ? seq(bool(true)) : seq())];
  if (c.ca) extensions.push(ext('2.5.29.15', true, bitString(Buffer.from([0x06]), 1))); // keyCertSign, cRLSign
  if (c.aaguid) extensions.push(ext('1.3.6.1.4.1.45724.1.1.4', false, octet(c.aaguid)));
  if (c.dnsNames) extensions.push(ext('2.5.29.17', false, seq(...c.dnsNames.map((d) => tlv(0x82, Buffer.from(d, 'ascii'))))));
  const tbs = seq(
    explicit(0, int(2)),
    int(c.serial),
    ECDSA_SHA256,
    name(c.issuer),
    seq(time(c.notBefore), time(c.notAfter)),
    name(c.subject),
    c.publicKey.export({ type: 'spki', format: 'der' }),
    explicit(3, seq(...extensions)),
  );
  const sig = sign('sha256', tbs, { key: c.signingKey, dsaEncoding: 'der' });
  return seq(tbs, ECDSA_SHA256, bitString(sig));
}
