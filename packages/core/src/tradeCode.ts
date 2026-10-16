/**
 * Crockford base32 trade-code generation and normalization.
 *
 * Alphabet: 0123456789ABCDEFGHJKMNPQRSTVWXYZ  (32 symbols, no I, L, O, U)
 *
 * Each random byte is masked with `& 0x1f` (31), which is bias-free because
 * 256 is an exact multiple of 32 (256 / 32 = 8).
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Set of valid characters for fast lookup. */
const VALID = new Set(ALPHABET);

function group(raw: string): string {
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

/**
 * Generate a new trade code: 16 Crockford base32 chars grouped XXXX-XXXX-XXXX-XXXX.
 * Uses `globalThis.crypto.getRandomValues` for cryptographic randomness.
 */
export function newTradeCode(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);

  let raw = '';
  for (let i = 0; i < 16; i++) {
    // bytes[i] is always defined for i < 16, but noUncheckedIndexedAccess
    // requires the guard.
    const b = bytes[i];
    if (b === undefined) throw new Error('unreachable');
    raw += ALPHABET[b & 0x1f];
  }

  return group(raw);
}

/**
 * Normalize a user-entered trade code.
 *
 * - Rejects any non-ASCII input up front (toUpperCase() would turn 'ß' into
 *   'SS' and the Kelvin sign into 'K').
 * - Uppercases the input.
 * - Strips whitespace and dashes.
 * - Maps commonly-confused letters: O -> 0, I -> 1, L -> 1.
 * - Rejects any character outside the Crockford base32 alphabet (U is invalid).
 * - Requires exactly 16 valid characters.
 *
 * @returns The grouped code (XXXX-XXXX-XXXX-XXXX) or `null` on invalid input.
 */
export function normalizeTradeCode(input: string): string | null {
  if (/[^\x00-\x7f]/.test(input)) return null;
  const upper = input.toUpperCase().replace(/[\s-]/g, '');

  let cleaned = '';
  for (const ch of upper) {
    let mapped = ch;
    if (ch === 'O') mapped = '0';
    else if (ch === 'I' || ch === 'L') mapped = '1';

    if (!VALID.has(mapped)) return null;
    cleaned += mapped;
  }

  if (cleaned.length !== 16) return null;

  return group(cleaned);
}
