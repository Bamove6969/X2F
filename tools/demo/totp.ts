/**
 * DEMO ONLY: authenticator codes for the demo accounts (RFC 6238: SHA-1, 6 digits, 30 s). Each demo
 * account's authenticator app is its second kind of login method (owner, 26 Nov 2026: at least two
 * kinds; an authenticator app never logs in alone). The secrets are the throwaway ones the seeder
 * enrolled, in .demo/secrets/totp.json.
 */
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SECRETS_DIR } from './config.js';

export const TOTP_FILE = join(SECRETS_DIR, 'totp.json');

function base32(s: string): Buffer {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const i = A.indexOf(ch);
    if (i < 0) throw new Error('totp: bad base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const stepOf = (ms: number): number => Math.floor(ms / 30_000);

/** The 6-digit code of a base32 secret for 30-second step `step`. */
export function totpCode(secretB32: string, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32(secretB32)).update(msg).digest();
  const o = h[h.length - 1]! & 0x0f;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, '0');
}

/** login name → base32 secret, as the seeder wrote it. */
export function readTotpSecrets(): Record<string, string> {
  if (!existsSync(TOTP_FILE)) return {};
  return JSON.parse(readFileSync(TOTP_FILE, 'utf8')) as Record<string, string>;
}
