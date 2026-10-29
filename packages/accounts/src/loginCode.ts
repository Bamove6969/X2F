/**
 * PGP login codes (12 Crockford base32 characters, XXXX-XXXX-XXXX, 60 bits)
 * and recovery codes (the 16-character trade-code format from `@x2f/core`).
 *
 * Each random byte is masked with `& 0x1f`; bias-free since 256 = 8 × 32.
 */
import { newTradeCode, normalizeTradeCode } from '@x2f/core';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const VALID = new Set(ALPHABET);
const LOGIN_CODE_LENGTH = 12;
const MAX_INPUT_LENGTH = 64;

function group(raw: string): string {
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

export function newLoginCode(): string {
  const bytes = new Uint8Array(LOGIN_CODE_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  let raw = '';
  for (const b of bytes) raw += ALPHABET[b & 0x1f];
  return group(raw);
}

/**
 * Same mapping rules as `normalizeTradeCode`: ASCII only, upper-cased,
 * whitespace and dashes removed, O → 0, I/L → 1, exactly 12 symbols.
 */
export function normalizeLoginCode(input: string): string | null {
  if (typeof input !== 'string') return null;
  if (input.length > MAX_INPUT_LENGTH) return null;
  if (/[^\x00-\x7f]/.test(input)) return null;
  let cleaned = '';
  for (const ch of input.toUpperCase().replace(/[\s-]/g, '')) {
    const mapped = ch === 'O' ? '0' : ch === 'I' || ch === 'L' ? '1' : ch;
    if (!VALID.has(mapped)) return null;
    cleaned += mapped;
  }
  if (cleaned.length !== LOGIN_CODE_LENGTH) return null;
  return group(cleaned);
}

export function newRecoveryCode(): string {
  return newTradeCode();
}

export function normalizeRecoveryCode(input: string): string | null {
  return normalizeTradeCode(input);
}
