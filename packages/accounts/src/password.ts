/**
 * Password policy: at least 10 code points (after NFC) with an upper-case
 * letter, a lower-case letter, a number and a symbol; at most 256; no white space (owner demo note
 * #108, 17 Nov 2026). Only a new password is checked (sign-up, set, change); a login never is, so a
 * password set before the space rule still logs in. The leaked-list check and hashing live on the
 * server.
 */

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 256;
/** UTF-16 code units; anything longer is refused before any other work. */
const MAX_RAW_LENGTH = 1024;

/** `space`: the password holds a space or other white space (note #108). */
export type PasswordRule = 'length' | 'upper' | 'lower' | 'number' | 'symbol' | 'space' | 'too-long';
export type PasswordCheck = { ok: true } | { ok: false; missing: PasswordRule[] };

const UPPER = /\p{Lu}/u;
const LOWER = /\p{Ll}/u;
const NUMBER = /\p{Nd}/u;
/** Symbol: any code point that is not a letter, a number or whitespace. */
const SYMBOL = /[^\p{L}\p{N}\s]/u;
/** Any white space: the plain space, tabs, line breaks, the no-break and ideographic spaces. */
const WHITE_SPACE = /\s/u;

export function normalizePassword(pw: string): string {
  return pw.normalize('NFC');
}

export function checkPassword(pw: string): PasswordCheck {
  // Refuse huge input before NFC and spreading it into code points.
  if (pw.length > MAX_RAW_LENGTH) return { ok: false, missing: ['too-long'] };
  const chars = [...normalizePassword(pw)];
  const missing: PasswordRule[] = [];
  if (chars.length < PASSWORD_MIN) missing.push('length');
  if (!chars.some((c) => UPPER.test(c))) missing.push('upper');
  if (!chars.some((c) => LOWER.test(c))) missing.push('lower');
  if (!chars.some((c) => NUMBER.test(c))) missing.push('number');
  if (!chars.some((c) => SYMBOL.test(c))) missing.push('symbol');
  if (chars.some((c) => WHITE_SPACE.test(c))) missing.push('space');
  if (chars.length > PASSWORD_MAX) missing.push('too-long');
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
