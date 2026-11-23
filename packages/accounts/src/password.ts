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

/** `space`: the password holds a space, other white space or a blank-looking character (note #108). */
export type PasswordRule = 'length' | 'upper' | 'lower' | 'number' | 'symbol' | 'space' | 'too-long';
export type PasswordCheck = { ok: true } | { ok: false; missing: PasswordRule[] };

const UPPER = /\p{Lu}/u;
const LOWER = /\p{Ll}/u;
const NUMBER = /\p{Nd}/u;
/** Symbol: any code point that is not a letter, a number or whitespace. */
const SYMBOL = /[^\p{L}\p{N}\s]/u;
/**
 * A space, or a character that looks like one (security review of note #108): any white space
 * (\s: the plain space, tabs, line breaks, the no-break and ideographic spaces), every invisible
 * character (Default_Ignorable_Code_Point: zero-width spaces, joiners, variation selectors, the
 * Hangul fillers), the next-line control U+0085, the Hangul filler U+3164 and the blank Braille
 * pattern U+2800 by name, whatever the engine's Unicode version says.
 */
const SPACE_LIKE = /[\s\p{Default_Ignorable_Code_Point}\u0085\u3164\u2800]/u;

/** Whether a typed password holds a space or a blank-looking character (the `space` rule; for the inline line). */
export function hasPasswordSpace(pw: string): boolean {
  return pw.length <= MAX_RAW_LENGTH && SPACE_LIKE.test(pw.normalize('NFC'));
}

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
  if (chars.some((c) => SPACE_LIKE.test(c))) missing.push('space');
  if (chars.length > PASSWORD_MAX) missing.push('too-long');
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
