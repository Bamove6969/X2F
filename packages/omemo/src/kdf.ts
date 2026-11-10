/**
 * HKDF-SHA-256 (RFC 5869) as libsignal's HKDFv3 uses it (the expand counter starts at 1; a missing
 * salt is 32 zero bytes, which HMAC treats as the empty key), and HMAC-SHA-256.
 */
import { createHmac, hkdfSync } from 'node:crypto';

export const ZERO_SALT: Buffer = Buffer.alloc(32);

export function hkdf(ikm: Uint8Array, info: string | Uint8Array, length: number, salt: Uint8Array = ZERO_SALT): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, salt, typeof info === 'string' ? Buffer.from(info, 'utf8') : info, length));
}

export function hmac(key: Uint8Array, ...data: Uint8Array[]): Buffer {
  const h = createHmac('sha256', key);
  for (const d of data) h.update(d);
  return h.digest();
}
