/**
 * PGP login codes and recovery codes, both Crockford base32 in groups of four.
 *
 * - Login codes (owner demo note, 12 Nov 2026, /setup/pgp-code: "4 times as long"): 48 symbols,
 *   XXXX-…-XXXX in 12 groups, 240 bits. They were 12 symbols (60 bits); a 12-symbol input still
 *   normalizes, so a challenge issued before the change (5 minutes) and the owner setup code
 *   (staff/ownerSetup.ts derives a 12-symbol code) keep working. Only the hash of the issued code
 *   is stored, so a 12-symbol input can never match a 48-symbol challenge.
 * - Recovery codes (owner demo note, 12 Nov 2026, /setup/backup: "much longer, like four times that
 *   length"): 64 symbols in 16 groups, 320 bits. They were the 16-character trade-code format from
 *   `@x2f/core` (80 bits); a 16-symbol input still normalizes to that old form, so a code made
 *   before the change keeps working until it is used or replaced.
 *
 * Each random byte is masked with `& 0x1f`; bias-free since 256 = 8 × 32.
 */
import { normalizeTradeCode } from '@x2f/core';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const VALID = new Set(ALPHABET);
export const LOGIN_CODE_LENGTH = 48;
/** The login code's length before 12 Nov 2026 (still accepted, see above). */
const OLD_LOGIN_CODE_LENGTH = 12;
export const RECOVERY_CODE_LENGTH = 64;
/** The recovery code's length before 12 Nov 2026 (the trade-code format, still accepted). */
const OLD_RECOVERY_CODE_LENGTH = 16;
/** Longest raw input considered: the longest code with generous separators. */
const MAX_INPUT_LENGTH = 200;

/** `raw` in groups of four joined by dashes. */
function group(raw: string): string {
  return (raw.match(/.{1,4}/g) ?? []).join('-');
}

function randomSymbols(n: number): string {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  let raw = '';
  for (const b of bytes) raw += ALPHABET[b & 0x1f];
  return raw;
}

/**
 * The symbols of `input` (ASCII only, upper-cased, whitespace and dashes removed, O → 0, I/L → 1),
 * or null for anything outside the alphabet or an over-long input.
 */
function symbols(input: string): string | null {
  if (typeof input !== 'string') return null;
  if (input.length > MAX_INPUT_LENGTH) return null;
  if (/[^\x00-\x7f]/.test(input)) return null;
  let cleaned = '';
  for (const ch of input.toUpperCase().replace(/[\s-]/g, '')) {
    const mapped = ch === 'O' ? '0' : ch === 'I' || ch === 'L' ? '1' : ch;
    if (!VALID.has(mapped)) return null;
    cleaned += mapped;
  }
  return cleaned;
}

export function newLoginCode(): string {
  return group(randomSymbols(LOGIN_CODE_LENGTH));
}

/**
 * Same mapping rules as `normalizeTradeCode`: ASCII only, upper-cased, whitespace and dashes
 * removed, O → 0, I/L → 1; exactly 48 symbols (or 12, the old length).
 */
export function normalizeLoginCode(input: string): string | null {
  const s = symbols(input);
  if (s === null || (s.length !== LOGIN_CODE_LENGTH && s.length !== OLD_LOGIN_CODE_LENGTH)) return null;
  return group(s);
}

export function newRecoveryCode(): string {
  return group(randomSymbols(RECOVERY_CODE_LENGTH));
}

/** 64 symbols in groups of four, or a code of the old 16-symbol format in its old form. */
export function normalizeRecoveryCode(input: string): string | null {
  const s = symbols(input);
  if (s === null) return null;
  if (s.length === RECOVERY_CODE_LENGTH) return group(s);
  if (s.length === OLD_RECOVERY_CODE_LENGTH) return normalizeTradeCode(s);
  return null;
}

/**
 * What a recovery-code box shows while someone types or pastes (owner, 12 Nov 2026: "Dashes will
 * be typed in automatically which goes for both typing and pasting"): upper case, only the code's
 * own symbols (anything else, dashes and spaces included, is dropped; O, I and L are kept as typed
 * and mapped only when compared), at most 64 of them, a dash after every fourth.
 */
export function formatRecoveryInput(input: string): string {
  const kept = input.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/U/g, '').slice(0, RECOVERY_CODE_LENGTH);
  return group(kept);
}
