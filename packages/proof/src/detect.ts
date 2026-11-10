// Sensitive-detail detection over OCR words and plain text (Plan 5 Task 7, spec 4.2).
//
// Fail-safe (review 2026-10-24): the Luhn and mod-97 checks only choose a region's label, never
// whether it is masked; one misread digit must not leave a real card or IBAN visible. The only
// things ever kept are the trade code, the trade amount and dates (the smart card needs them).
//
// A SAFETY NET (owner item 35, 2026-11-02): the detector is not the only guard. The sender always
// sees the blurred picture before it is sent and can blur more by hand (Plan 5 Task 15), so the
// detector aims to catch what it can (best effort), not to be the last word on what is hidden.
//
// THE AMOUNT (owner 2026-11-02): the automatic blur never hides the trade amount. No region covers
// a character of it, and `amountBoxes` gives its boxes so `padAndMerge` keeps padding and merging
// off it too. The uploader can only add blur (a `manual` region), never take an automatic one away.
import { normalizeTradeCode } from '@x2f/core';
import { findAmounts } from './amounts.js';
import { NAME_LABELS } from './nameLabels.js';
import { NUMBER_LABELS, type NumberLabelKind } from './numberLabels.js';
import { type OcrWord, linesOf } from './ocr.js';

export type HiddenKind = 'name' | 'account' | 'card' | 'iban' | 'address' | 'phone' | 'email' | 'handle' | 'manual';

/** A box in image pixels (x1, y1 exclusive). */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A box in image pixels (x1, y1 exclusive) and why it is hidden. */
export interface Region extends Box {
  kind: HiddenKind;
}

/** What `detectSensitive` must never hide. `fiatCents` is the trade amount in minor units. */
export interface Keep {
  tradeCode: string;
  fiatCents: bigint;
  exponent: number;
}

/** A detected span in a line: character range, the label it gets, and its class rank (lower wins). */
interface Span {
  start: number;
  end: number;
  kind: HiddenKind;
  rank: number;
}

// Class ranks: where spans overlap, the more specific class labels the character. The rank belongs
// to the class, not the label: a Luhn-invalid card is still the card class, labelled `account`.
// `labelled` (owner G17): a number after a field label takes the label's kind over the phone, account
// and Monero guesses, but not over a card or IBAN found by its own shape (a Luhn-invalid card stays
// `account` whatever its label, as review 2026-10-24 set it).
const RANK = { iban: 0, card: 1, email: 2, labelled: 2.5, phone: 3, handle: 4, monero: 5, account: 6, address: 7, name: 8 } as const;

/** Marks a kept character in the text the classifiers see, so no match can run across it. */
const BLANK = '\u0000';

/**
 * UPI IDs (`name@bank`, the payment address on Indian UPI screenshots) are masked as `account` in
 * images and refused in notes (review R3-M3). Owner, 2026-11-02: item 34, blurred in proofs; item 36,
 * review notes refuse all personal details, UPI IDs included. One flag for both. Chat is not checked
 * here (UPI IDs stay in chat as dispute evidence).
 */
export const UPI_IDS = true;

/** Detection options. Only for tests; callers pass nothing. */
export interface DetectOptions {
  /** Mask UPI IDs (`name@bank`); defaults to `UPI_IDS`. */
  upiIds?: boolean;
  /**
   * `detectSensitiveText` only: the field-label kinds (owner G17, `numberLabels.ts`) that make the
   * number after them a detail; defaults to all of them. Review notes pass `REVIEW_NOTE_NUMBER_LABELS`.
   */
  numberLabels?: readonly NumberLabelKind[];
}

/**
 * Lead default pending owner p11-142 (review 2026-11-10 finding 5): review notes read only the
 * account and IBAN field labels, not the card and phone ones, so `Paid with Visa 1500 EUR` or `Sent
 * via mobile 2500 MXN` is feedback, not a card or phone number; a card or phone number is still
 * refused by its own shape. Proof screenshots keep every label (F15: after `Card` it is the card).
 */
export const REVIEW_NOTE_NUMBER_LABELS: readonly NumberLabelKind[] = ['iban', 'account'];

// ---------------------------------------------------------------------------------------------
// Normalisation (reviews R3-I3 and R4). Detection runs on a copy of each line where every Unicode
// dash (`\p{Pd}`, the minus sign and the marks typed as hyphens), space, tab and line separator, every
// full-width form and every digit (`\p{Nd}`, and the other-number digits whose NFKC form is ASCII
// digits, such as superscript and circled ones) is ASCII; invisible format characters (`\p{Cf}`), the
// other default-ignorable characters (fillers such as U+3164, variation selectors; review R5-M1) and
// combining marks after a digit (accents, keycaps) are deleted, a combining mark that composes with the
// letter before it is composed into it (NFC, review RV4-M3), and the braille blank U+2800 is a space.
// Dash look-alikes outside `\p{Pd}` (modifier, superscript and subscript minus, heavy minus, horizontal
// line extension and box-drawing lines; review R5-M2) are hyphens. The copy can be shorter or longer than
// the original, so it carries a map from each of its units back to the original, and regions are
// placed over the original words through that map.

const HYPHEN = /[\p{Pd}\u02d7\u207b\u208b\u2212\u2043\u23af\u2500\u2501\u2574\u2576\u2578\u257a\u2796\u30fc\uff70]/u;
const SPACE = /[\t\v\f\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u2800\u3000]/;
const FORMAT = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/u;
const MARK = /\p{M}/u;
const ND = /\p{Nd}/u;
const digitValues = new Map<number, string>();

/** The value of a decimal digit: Unicode encodes each digit set as a run of ten from zero. */
function digitValue(cp: number): string {
  let v = digitValues.get(cp);
  if (v === undefined) {
    let zero = cp;
    while (zero > 0 && ND.test(String.fromCodePoint(zero - 1))) zero--;
    v = String((cp - zero) % 10);
    digitValues.set(cp, v);
  }
  return v;
}

function isAsciiDigit(c: number): boolean {
  return c >= 48 && c <= 57;
}

/** Circled digits with no NFKC form (dingbats): the first code point of each run of ten and its first value. */
const CIRCLED_RUNS: Array<[number, number, number]> = [
  [0x2776, 0x277f, 1],
  [0x2780, 0x2789, 1],
  [0x278a, 0x2793, 1],
  [0x24eb, 0x24f4, 11],
  [0x24f5, 0x24fe, 1],
  [0x24ff, 0x24ff, 0],
  [0x1f10b, 0x1f10c, 0],
];

/** The ASCII digits a non-decimal number character stands for, or null. */
function otherDigits(cp: number, ch: string): string | null {
  for (const [first, last, value] of CIRCLED_RUNS) if (cp >= first && cp <= last) return String(value + cp - first);
  const n = ch.normalize('NFKC');
  return n !== ch && /\d/.test(n) && /^[\x20-\x7e]+$/.test(n) ? n : null;
}

/**
 * A normalised line and, for each UTF-16 unit of the original, the range of normalised units it became
 * (both halves of a surrogate pair share their code point's range; a deleted character has an empty one).
 */
interface Normalized {
  text: string;
  start: number[];
  end: number[];
}

function normalize(text: string): Normalized {
  let out = '';
  const start: number[] = [];
  const end: number[] = [];
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const units = cp > 0xffff ? 2 : 1;
    const ch = text.slice(i, i + units);
    i += units;
    let from = out.length;
    let other: string | null;
    let composed: string;
    if (cp < 0x80 && ch !== '\t' && ch !== '\v' && ch !== '\f') out += ch;
    else if (SPACE.test(ch)) out += ' ';
    else if (FORMAT.test(ch)) {
      // Deleted: invisible.
    } else if (MARK.test(ch) && isAsciiDigit(out.charCodeAt(out.length - 1))) {
      // Deleted: a combining mark or keycap on a digit (`4\u0301`, `4\ufe0f\u20e3`).
    } else if (MARK.test(ch) && out.length > 0 && (composed = (out[out.length - 1]! + ch).normalize('NFC')).length === 1) {
      // A combining mark that composes with the letter before it (decomposed text, review RV4-M3:
      // `Empfa\u0308nger` reads `Empfänger`): one composed letter, which both units map to.
      out = out.slice(0, -1) + composed;
      from = out.length - 1;
    } else if (HYPHEN.test(ch)) out += '-';
    else if (cp >= 0xff01 && cp <= 0xff5e) out += String.fromCharCode(cp - 0xfee0);
    else if (ND.test(ch)) out += digitValue(cp);
    else if ((other = otherDigits(cp, ch)) !== null) out += other;
    else out += ch;
    for (let u = 0; u < units; u++) {
      start.push(from);
      end.push(out.length);
    }
  }
  return { text: out, start, end };
}

/** The line as detection reads it (see `normalize`). */
export function normalizeText(text: string): string {
  return normalize(text).text;
}

/**
 * Per-character results on the normalised line, carried back to the original line's UTF-16 units.
 * A unit that became characters takes the best-ranked span among them, and is kept when all of them
 * are; a deleted unit takes the span of its two neighbours when they have the same one, and is kept
 * when both are.
 */
function toOriginal(n: Normalized, best: Array<Span | null>, keep: boolean[]): { best: Array<Span | null>; keep: boolean[] } {
  const len = n.text.length;
  const ob: Array<Span | null> = [];
  const ok: boolean[] = [];
  for (let j = 0; j < n.start.length; j++) {
    const a = n.start[j]!;
    const b = n.end[j]!;
    if (a < b) {
      let s: Span | null = null;
      let kept = true;
      for (let k = a; k < b; k++) {
        const c = best[k] ?? null;
        if (c && (!s || c.rank < s.rank)) s = c;
        kept &&= keep[k]!;
      }
      ob.push(s);
      ok.push(kept);
    } else {
      const before = a > 0 ? (best[a - 1] ?? null) : null;
      const after = a < len ? (best[a] ?? null) : null;
      ob.push(before !== null && before === after ? before : null);
      ok.push(a > 0 && a < len && keep[a - 1]! && keep[a]!);
    }
  }
  return { best: ob, keep: ok };
}

// ---------------------------------------------------------------------------------------------
// Kept spans: dates, times, the trade code, the trade amount.

const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const B = '(?<![A-Za-z0-9])';
const E = '(?![A-Za-z0-9])';
/**
 * Not inside a longer run of digit groups (review 2026-10-30 I1): `06.12.34` in the phone number
 * `06.12.34.56.78` is not a date, and `14:32` in `14:32.555.0134` is not a time.
 */
const NB = '(?<!\\d[-/.:])';
const NA = '(?![-/.:]\\d)';

const DATE_TEXT: RegExp[] = [
  // Oct 16, 2026 / October 16 2026 / Oct 16
  new RegExp(`${B}${MONTH}\\.? \\d{1,2}(?:st|nd|rd|th)?(?:,? \\d{4})?${E}`, 'gi'),
  // 16 Oct 2026 / 16 October, 2026 / 16 Oct
  new RegExp(`${B}\\d{1,2}(?:st|nd|rd|th)? ${MONTH}\\.?(?:,? \\d{4})?${E}`, 'gi'),
  // 2026-10-16, optionally with a time
  new RegExp(`${NB}${B}\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}(?:[ T]\\d{1,2}:\\d{2}(?::\\d{2})?)?${E}${NA}`, 'g'),
  // 14:32 / 14:32:05 / 2:32 PM
  new RegExp(`${NB}${B}\\d{1,2}:\\d{2}(?::\\d{2})?(?: ?[AaPp]\\.?[Mm]\\.?)?${E}${NA}`, 'g'),
];
/** 16-10-2026, 10/16/26, 16.10.2026: kept only when one order is a real day and month. */
const DATE_NUMERIC = new RegExp(`${NB}${B}(\\d{1,2})([-/.])(\\d{1,2})\\2(\\d{4}|\\d{2})${E}${NA}`, 'g');
/** `16. 10. 2026`: a spaced date (Czech, Polish, German), 4-digit year only (review R3-M5). */
const DATE_SPACED = new RegExp(`${NB}${B}(\\d{1,2})\\. (\\d{1,2})\\. (\\d{4})${E}${NA}`, 'g');
/** `16.10.2026-17.10.2026`: a range of two numeric dates with 4-digit years (review R3-M5). */
const DATE_RANGE = new RegExp(`${NB}${B}(\\d{1,2})([./])(\\d{1,2})\\2(\\d{4}) ?- ?(\\d{1,2})\\2(\\d{1,2})\\2(\\d{4})${E}${NA}`, 'g');
/** A UK sort code label: a dashed `12-05-26` on its line is a sort code, not a date (review M5). */
const SORT_CODE = /(?<![A-Za-z])sort[\s-]*code(?![A-Za-z])/i;

/**
 * A phone-like digit group right before a 2-digit-year date, joined by a space (review R2-I2:
 * `0470 01.02.03` is a Belgian mobile): a group starting with `0` or `+`, or of 3-4 digits, after
 * a space, the line start or `)` (review R3-I2: `+32 (0)470 01.02.03`).
 */
const PHONE_GROUP_BEFORE = /(?:^|[\s)])(?:\+\d{1,4}|0\d*|\d{3,4}) $/;

function dayMonth(a: number, b: number): boolean {
  return (a >= 1 && a <= 12 && b >= 1 && b <= 31) || (a >= 1 && a <= 31 && b >= 1 && b <= 12);
}

/** Marks every date and time in a normalised line in `keep` (exported for Task 9's date check). */
export function markDates(text: string, keep: boolean[]): void {
  for (const re of DATE_TEXT) for (const m of text.matchAll(re)) mark(keep, m.index, m.index + m[0].length);
  const sortCode = SORT_CODE.test(text);
  for (const m of text.matchAll(DATE_NUMERIC)) {
    if (sortCode && m[2] === '-' && m[4]!.length === 2) continue;
    if (m[4]!.length === 2 && PHONE_GROUP_BEFORE.test(text.slice(0, m.index))) continue;
    if (dayMonth(Number(m[1]), Number(m[3]))) mark(keep, m.index, m.index + m[0].length);
  }
  for (const m of text.matchAll(DATE_SPACED)) {
    if (dayMonth(Number(m[1]), Number(m[2]))) mark(keep, m.index, m.index + m[0].length);
  }
  for (const m of text.matchAll(DATE_RANGE)) {
    if (dayMonth(Number(m[1]), Number(m[3])) && dayMonth(Number(m[5]), Number(m[6]))) mark(keep, m.index, m.index + m[0].length);
  }
}

/** A pattern for one trade code as OCR may show it: any case, O for 0, I or L for 1, any grouping (also Task 9's reference check). */
export function codePattern(normalized: string): RegExp {
  const chars = [...normalized.replace(/-/g, '')].map((c) => {
    if (c === '0') return '[0Oo]';
    if (c === '1') return '[1IiLl]';
    if (/[A-Z]/.test(c)) return `[${c}${c.toLowerCase()}]`;
    return c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- every character is a class built here or escaped above
  return new RegExp(`${B}${chars.join('[ -]?')}${E}`, 'g');
}

/** Any well-formed trade code (grouped, with at least one letter), for review notes. */
// Not inside a longer dashed run, and not a valid IBAN: `DE89-3704-0044-0532-0130-00` and the
// 16-character `BE68-5390-0754-7034` are IBANs, not trade codes (found with review R3-I3's tests).
const ANY_CODE = new RegExp(`(?<![0-9A-Za-z]-)${B}[0-9A-Za-z]{4}(?:-[0-9A-Za-z]{4}){3}${E}(?!-[0-9A-Za-z])`, 'g');

function isIban(s: string): boolean {
  const c = s.replace(/-/g, '').toUpperCase();
  return /^[A-Z]{2}\d{2}/.test(c) && mod97(c);
}

function mark(keep: boolean[], start: number, end: number): void {
  for (let i = start; i < end; i++) keep[i] = true;
}

// ---------------------------------------------------------------------------------------------
// Classifiers. Each runs on the line with kept characters blanked.

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function mod97(iban: string): boolean {
  const s = iban.slice(4) + iban.slice(0, 4);
  let r = 0;
  for (const c of s) {
    const v = c >= 'A' && c <= 'Z' ? String(c.charCodeAt(0) - 55) : c;
    for (const d of v) r = (r * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return r === 1;
}

/** Digit groups joined by single spaces or dashes (`4111 1111 1111 1111`, `12-34-56`). */
const DIGIT_RUN = /\d+(?:[ -]\d+)*/g;
/** IBAN shape: country, check digits, 11-30 more letters or digits, optionally grouped. */
const IBAN = new RegExp(`${B}[A-Z]{2}\\d{2}(?:[ -]?[A-Z0-9]){11,30}${E}`, 'g');
/**
 * Masked tails such as `••••1234`, `****1234`, `xx1234`, `°°°°1234` (review M1). The dot and
 * ellipsis forms `...1234` and `…1234` take exactly 4 digits right after them (review R2-M1), so
 * `Waited ... 15 minutes` is not one.
 */
const MASKED_TAIL = new RegExp(`${B}(?:[•*●·∙°xX]{2,} ?\\d{2,}|(?:…+|\\.{3,}|[•*●xX])\\d{4}(?!\\d))`, 'g');
/** The 4 digits after `ending` or `ending in` (`Account ending in 1234`). */
const ENDING = /(?<=(?<![A-Za-z])ending(?: in)?:? ?)\d{4}(?!\d)/gi;
/** In notes, not a year (`contract ending in 2026`, review R3-M5). Images keep the wider rule. */
const ENDING_NOTES = /(?<=(?<![A-Za-z])ending(?: in)?:? ?)(?!19\d\d|20\d\d)\d{4}(?!\d)/gi;
/** Letters or digits of any script in the local part and the domain (review M4: `jane@exämple.com`). */
// The top-level domain may hold a digit OCR misread (`example.c0m`, review R3-M3), not only digits.
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.(?=\p{N}*\p{L})[\p{L}\p{N}]{2,}/gu;
/**
 * An email OCR split around its `@` or its last dot (`jane.doe @example.com`, `jane.doe@ example.com`,
 * `jane@example .com`, review R3-M3): one space at most on each side of each. Images only.
 */
const SPLIT_EMAIL = /(?<![\p{L}\p{N}._%+@-])[\p{L}\p{N}._%+-]+ ?@ ?[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)* ?\. ?(?=\p{N}*\p{L})[\p{L}\p{N}]{2,}(?![\p{L}\p{N}])/gu;
/** A UPI ID or an email cut before its dot: `name@bank` with no top-level domain (R3-M3, `UPI_IDS`). */
const UPI_ID = /(?<![\p{L}\p{N}._%+@-])[\p{L}\p{N}._-]+@\p{L}[\p{L}\p{N}]+(?![\p{L}\p{N}@_-]|\.[\p{L}\p{N}])/gu;
/**
 * Phone candidates: an optional `+`, digits with spaces, dots, dashes, slashes (`0470/12.34.56`,
 * review R2-I2) or brackets between them. Dates are blanked before this runs.
 */
const PHONE = /(?<![A-Za-z0-9+])\+?\(?\d(?:[\d ().\/-]*\d)?\)?/g;
const HANDLE = /(?<![A-Za-z0-9._%+-])[@$][A-Za-z][A-Za-z0-9_.-]*[A-Za-z0-9_]|(?<![A-Za-z0-9._%+-])[@$][A-Za-z]/g;
/**
 * Monero addresses, also misread, wrapped over two lines or on stagenet and testnet (review M3): any
 * base58 token of 30 or more characters with a Monero prefix, and any token of 40 or more letters
 * and digits that is almost all base58.
 */
const MONERO = new RegExp(`${B}[45789AB][1-9A-HJ-NP-Za-km-z]{29,}${E}`, 'g');
const LONG_TOKEN = new RegExp(`${B}[0-9A-Za-z]{40,}${E}`, 'g');
/**
 * A mainnet address shortened in the middle (`44AFFq…QBEP3A`, review R2-M4): `4` or `8`, then a
 * digit, `A` or `B` as real addresses have, at least 5 base58 characters, dots or an ellipsis, and
 * at least 4 more.
 */
const MONERO_SHORT = new RegExp(`${B}[48][1-9AB][1-9A-HJ-NP-Za-km-z]{3,}\\s*(?:…|\\.{2,})\\s*[1-9A-HJ-NP-Za-km-z]{4,}${E}`, 'g');
/** A base58 token, for following an address split over words or lines (review R3-M2). */
const BASE58_TOKEN = new RegExp(`${B}[1-9A-HJ-NP-Za-km-z]+${E}`, 'g');
/** The rest of a wrapped address on the next line: a base58 token of 20 or more characters. */
const BASE58_TAIL = new RegExp(`${B}[1-9A-HJ-NP-Za-km-z]{20,}${E}`, 'g');
const NOT_BASE58 = /[0OIl]/g;

/**
 * Characters OCR reads in place of digits (review M2). A token of only digits and these, with at
 * least as many digits as look-alikes, counts as digits for the digit-run rules, so `l111` in
 * `4111 1111 1111 l111` is masked with the rest of the card.
 */
// Also the Cyrillic and Greek letters that look like them (review R4-M3: `3О`, `З4`).
const LOOKALIKE = /^[0-9OolI|SBОоΟοЗІіӀЅБб]+$/;
const TOKEN = /[0-9A-Za-z|ОоΟοЗІіӀЅБб]+/g;

/**
 * The text with look-alikes in digit tokens turned into `0`, and which characters were turned.
 * `loose` turns any such token with one digit or more (`l7l`), for the phone rule (review R3-M4).
 */
function withLookalikeDigits(text: string, loose = false): { text: string; changed: boolean[] } {
  // UTF-16 units, as `m.index` counts them (review R2-M2: `[...text]` shifts after an emoji).
  const chars = text.split('');
  const changed: boolean[] = new Array<boolean>(text.length).fill(false);
  for (const m of text.matchAll(TOKEN)) {
    const t = m[0];
    if (!LOOKALIKE.test(t)) continue;
    const digits = t.replace(/\D/g, '').length;
    if (digits === 0 || (!loose && t.length - digits > digits)) continue;
    for (let i = 0; i < t.length; i++) {
      if (!/\d/.test(t[i]!)) {
        chars[m.index + i] = '0';
        changed[m.index + i] = true;
      }
    }
  }
  return { text: chars.join(''), changed };
}

function digitsOf(s: string): string {
  return s.replace(/\D/g, '');
}

/** The money classes (P5-A6): cards, IBANs, account numbers, Monero addresses, emails, phones. */
function moneySpans(text: string, notes: boolean, upi: boolean): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(IBAN)) {
    // Labelled `iban` when the match, or a prefix of it that ends at a group break (`… 00 EUR`),
    // passes mod-97. The whole match is masked either way.
    const raw = m[0];
    let validEnd = -1;
    for (let end = raw.length; end >= 15; end--) {
      if (end < raw.length && raw[end] !== ' ' && raw[end] !== '-') continue;
      const compact = raw.slice(0, end).replace(/[ -]/g, '');
      if (compact.length >= 15 && compact.length <= 34 && mod97(compact)) {
        validEnd = end;
        break;
      }
    }
    if (validEnd > 0) {
      out.push({ start: m.index, end: m.index + validEnd, kind: 'iban', rank: RANK.iban });
      if (validEnd < raw.length) out.push({ start: m.index + validEnd, end: m.index + raw.length, kind: 'account', rank: RANK.account });
    } else {
      out.push({ start: m.index, end: m.index + raw.length, kind: 'account', rank: RANK.iban });
    }
  }
  const look = withLookalikeDigits(text);
  for (const m of look.text.matchAll(DIGIT_RUN)) {
    const digits = digitsOf(m[0]);
    const span = { start: m.index, end: m.index + m[0].length };
    // The label comes from the real digits: a run with a look-alike in it is never labelled `card`.
    const real = !look.changed.slice(span.start, span.end).some(Boolean);
    // A run right after `+` is an international phone number, never a card (`+52 1 55 1234 5678`).
    const intl = look.text[m.index - 1] === '+';
    if (digits.length >= 13 && digits.length <= 19 && !intl) out.push({ ...span, kind: real && luhn(digits) ? 'card' : 'account', rank: RANK.card });
    if (digits.length >= 6) out.push({ ...span, kind: 'account', rank: RANK.account });
  }
  for (const m of text.matchAll(MASKED_TAIL)) out.push({ start: m.index, end: m.index + m[0].length, kind: 'account', rank: RANK.account });
  for (const m of text.matchAll(notes ? ENDING_NOTES : ENDING)) out.push({ start: m.index, end: m.index + m[0].length, kind: 'account', rank: RANK.account });
  for (const m of text.matchAll(MONERO)) out.push({ start: m.index, end: m.index + m[0].length, kind: 'account', rank: RANK.monero });
  for (const m of text.matchAll(MONERO_SHORT)) out.push({ start: m.index, end: m.index + m[0].length, kind: 'account', rank: RANK.monero });
  for (const m of text.matchAll(LONG_TOKEN)) {
    if ((m[0].match(NOT_BASE58)?.length ?? 0) * 10 <= m[0].length) out.push({ start: m.index, end: m.index + m[0].length, kind: 'account', rank: RANK.monero });
  }
  for (const m of text.matchAll(EMAIL)) out.push({ start: m.index, end: m.index + m[0].length, kind: 'email', rank: RANK.email });
  if (upi) for (const m of text.matchAll(UPI_ID)) out.push({ start: m.index, end: m.index + m[0].length, kind: 'account', rank: RANK.account });
  // Phones are found on the text with look-alikes read as digits (`(4l5) 555-Ol34`, review R3-M4).
  for (const m of withLookalikeDigits(text, true).text.matchAll(PHONE)) {
    const s = m[0];
    const digits = digitsOf(s);
    if (digits.length >= 7 && (s.startsWith('+') || /[ ()./-]/.test(s))) out.push({ start: m.index, end: m.index + s.length, kind: 'phone', rank: RANK.phone });
  }
  return out;
}

/**
 * Monero addresses split over several words or lines (review R3-M2): a base58 token of 20 or more
 * characters starting with `4` or `8`, followed by a base58 token of 8 or more as the next word or
 * as the first word of the next line, starts a chain; the whole chain is masked.
 */
function moneroChains(texts: string[]): Span[][] {
  const tokens = texts.map((t) => [...t.matchAll(BASE58_TOKEN)].map((m) => ({ start: m.index, end: m.index + m[0].length })));
  const out: Span[][] = texts.map(() => []);
  const next = (i: number, j: number): [number, number] | null => {
    const line = tokens[i]!;
    const cur = line[j]!;
    const after = line[j + 1];
    if (after) {
      const gap = texts[i]!.slice(cur.end, after.start);
      return /^\s+$/.test(gap) && after.end - after.start >= 8 ? [i, j + 1] : null;
    }
    if (texts[i]!.slice(cur.end).trim() !== '') return null;
    const first = tokens[i + 1]?.[0];
    if (!first || texts[i + 1]!.slice(0, first.start).trim() !== '' || first.end - first.start < 8) return null;
    return [i + 1, 0];
  };
  tokens.forEach((line, i) => {
    line.forEach((tok, j) => {
      if (tok.end - tok.start < 20 || !/^[48]/.test(texts[i]!.slice(tok.start))) return;
      let at: [number, number] | null = next(i, j);
      if (!at) return;
      out[i]!.push({ start: tok.start, end: tok.end, kind: 'account', rank: RANK.monero });
      for (let n = 0; at && n < 64; n++) {
        const [a, b] = at;
        const t = tokens[a]![b]!;
        out[a]!.push({ start: t.start, end: t.end, kind: 'account', rank: RANK.monero });
        at = next(a, b);
      }
    });
  });
  return out;
}

// Names: the rest of the line after a label, or the next line when the label stands alone. The
// labels, English and the other languages, are data in `nameLabels.ts` (owner item 30, 2026-11-02).

/**
 * The text with accents dropped, one UTF-16 unit for one (`Empfänger` reads `Empfanger`), so a label
 * matches with or without the accents OCR may lose, at the same indexes as the text.
 */
function foldAccents(text: string): string {
  let out = '';
  for (const c of text) {
    const d = c.length === 1 ? c.normalize('NFD').replace(/\p{M}/gu, '') : c;
    out += d.length === c.length ? d : c;
  }
  return out;
}

/** Labels as a regex alternation, longest first (`titular de la cuenta` before `titular`). */
function alternation(labels: string[]): string {
  return [...new Set(labels.map(foldAccents))]
    .sort((a, b) => b.length - a.length)
    .map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+').replace(/'/g, "['\u2019]"))
    .join('|');
}

const SETS = Object.values(NAME_LABELS);
const LABEL = alternation(SETS.flatMap((s) => [...s.labels]));
const ANY_LABEL = alternation(SETS.flatMap((s) => [...s.labels, ...s.colonOnly]));
/** A label at the start of the line, with or without a colon; a colon-only label with its colon. */
// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- built from the constant NAME_LABELS lists, each label escaped by alternation()
const LABEL_START = new RegExp(`^\\s*(?:(?:${LABEL})(?=\\s|:|$)|(?:${ANY_LABEL}) ?(?=:))(?: ?:)?\\s*`, 'iu');
/** A label later in the line, only with a colon (`Status: done  From: Jane Doe`, French `Nom : Jean`). */
// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- built from the constant NAME_LABELS lists, each label escaped by alternation()
const LABEL_COLON = new RegExp(`(?<![\\p{L}\\p{N}])(?:${ANY_LABEL}) ?:\\s*`, 'giu');

/** Where the name starts after a label in this line: its index, `'next'` for a lone label, or -1. */
function nameStart(line: string): number | 'next' {
  const text = foldAccents(line);
  const m = LABEL_START.exec(text);
  if (m) return m[0].length >= text.trimEnd().length ? 'next' : m[0].length;
  for (const c of text.matchAll(LABEL_COLON)) {
    const at = c.index + c[0].length;
    if (at < text.trimEnd().length) return at;
  }
  return -1;
}

// Numbers after a field label (owner G17, 2026-11-07; F15): "read what the field is named prior to
// the number". A personal label (`numberLabels.ts`) blurs the number after it with the label's kind,
// even a short one or one equal to the trade amount (`Card ending in 4125` on a $4,125.00 trade:
// owner F15, "card ending vs amount: read the words before the digits"). The number starts right
// after the label (and an optional `number`, `no.`, `#`, `ending in`, colon), on the same line, or at
// the start of the next line when the label stands alone on its line. The trade code, the trade
// amount (after an amount label, `AMOUNT_LABEL`, or on its own) and times stay clear as before (Q50).

const NUMBER_KINDS = Object.keys(NUMBER_LABELS) as NumberLabelKind[];
/** Words between a label and its number. */
const NUMBER_TAIL = '\\.?(?:\\s*(?:number|num|no|nr|n[º°]|ending(?:\\s+in)?|ends\\s+in)\\.?)?\\s*[:：#]?\\s*';
// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- built from the constant NUMBER_LABELS lists, each label escaped by alternation()
const NUMBER_LABEL = new RegExp(
  `(?<![\\p{L}\\p{N}/])(?:${NUMBER_KINDS.map((k) => `(?<${k}>${alternation([...NUMBER_LABELS[k]])})`).join('|')})(?![\\p{L}\\p{N}])${NUMBER_TAIL}`,
  'giu',
);
/** A digit or a mask mark (`••••`, `**`, `...`, `xx` before digits) inside a labelled number. */
const VALUE_CHAR = '(?:\\d|[•*●·∙°…]|[xX](?=[xX\\d])|\\.(?=\\.*\\d))';
/** The number after a label: a `+` or bracket, then digits and masks with short separators. */
const LABELLED_VALUE = new RegExp(`\\+?\\(?${VALUE_CHAR}(?:${VALUE_CHAR}|[ ()./-]{1,2}(?=${VALUE_CHAR}|\\())*`, 'y');
const MASK_CHAR = /[•*●·∙°…xX]|\.\./;

/**
 * The numbers after personal field labels in a normalised line, as `labelled` spans with the label's
 * kind; `prev` is the line before (a label alone on it labels this line's first number). A number
 * needs 4 digits or more, or a mask and 2 digits (`Account 2 of 3` is not one).
 */
function labelledNumbers(text: string, prev?: string): Span[] {
  const look = withLookalikeDigits(text, true).text;
  const out: Span[] = [];
  const valueAt = (at: number, kind: NumberLabelKind): void => {
    LABELLED_VALUE.lastIndex = at;
    const m = LABELLED_VALUE.exec(look);
    if (!m) return;
    const digits = digitsOf(m[0]).length;
    if (digits >= 4 || (digits >= 2 && MASK_CHAR.test(m[0]))) out.push({ start: at, end: at + m[0].length, kind, rank: RANK.labelled });
  };
  const kindOf = (m: RegExpExecArray | RegExpMatchArray): NumberLabelKind => NUMBER_KINDS.find((k) => m.groups?.[k] !== undefined)!;
  for (const m of foldAccents(text).matchAll(NUMBER_LABEL)) valueAt(m.index + m[0].length, kindOf(m));
  if (prev !== undefined) {
    const p = foldAccents(prev);
    NUMBER_LABEL.lastIndex = 0;
    const m = NUMBER_LABEL.exec(p);
    NUMBER_LABEL.lastIndex = 0;
    if (m && p.slice(0, m.index).trim() === '' && m.index + m[0].length >= p.trimEnd().length) valueAt(text.length - text.trimStart().length, kindOf(m));
  }
  return out;
}

// Addresses: a house number and a street word, or a postcode, mask the whole line.
const STREET_WORDS = new Set(
  'street st road rd avenue ave av lane ln drive dr boulevard blvd bd way court ct place pl square sq terrace close crescent highway hwy parkway pkwy rue chemin allée allee impasse quai cours platz gasse ring damm calle avenida plaza paseo carrer camino via viale piazza corso largo vicolo straat laan plein gracht kade singel dijk'.split(' '),
);
const STREET_SUFFIXES = ['straße', 'strasse', 'str.', 'straat', 'gracht', 'platz', 'gasse', 'allee', 'weg', 'laan', 'plein', 'kade', 'singel', 'dijk'];
const HOUSE_NUMBER = /^\d{1,5}[A-Za-z]?[,.]?$/;

function isStreetWord(word: string): boolean {
  const w = word.toLowerCase().replace(/[,;]$/, '');
  if (STREET_WORDS.has(w) || STREET_WORDS.has(w.replace(/\.$/, ''))) return true;
  return STREET_SUFFIXES.some((s) => w.length > s.length && w.endsWith(s));
}

const POSTCODES: RegExp[] = [
  // UK: SW1A 1AA, M1 1AE, B33 8TH
  new RegExp(`${B}[A-Z]{1,2}\\d[A-Z\\d]? ?\\d[A-Z]{2}${E}`, 'g'),
  // Canada: M5V 3L9
  new RegExp(`${B}[A-Z]\\d[A-Z] ?\\d[A-Z]\\d${E}`, 'g'),
  // US: state and ZIP, CA 94103 or CA 94103-1234
  new RegExp(`${B}[A-Z]{2},? \\d{5}(?:-\\d{4})?${E}`, 'g'),
  // Germany, France, Spain, Italy: five digits and a town, 10115 Berlin, 75001 Paris
  new RegExp(`${B}\\d{5} [A-ZÀ-ÖØ-Þ][a-zß-ÿ]+`, 'g'),
  // Netherlands: 1012 AB
  new RegExp(`${B}\\d{4} ?(?!AM|PM)[A-Z]{2}${E}`, 'g'),
];

function isAddressLine(text: string): boolean {
  const words = text.split(/\s+/).filter((w) => w.length > 0 && !w.includes(BLANK));
  if (words.some((w) => HOUSE_NUMBER.test(w)) && words.some(isStreetWord)) return true;
  return POSTCODES.some((re) => {
    re.lastIndex = 0;
    return re.test(text);
  });
}

/** Handles and cashtags (`@jane-doe`, `$janedoe`). */
function handleSpans(text: string): Span[] {
  return [...text.matchAll(HANDLE)].map((m) => ({ start: m.index, end: m.index + m[0].length, kind: 'handle' as const, rank: RANK.handle }));
}

// ---------------------------------------------------------------------------------------------
// Spans to per-character kinds.

/** The winning span per character (null where nothing is detected or the character is kept). */
function resolve(length: number, spans: Span[], keep: boolean[]): Array<Span | null> {
  const best: Array<Span | null> = new Array<Span | null>(length).fill(null);
  for (const s of spans) {
    for (let i = s.start; i < s.end; i++) {
      if (keep[i]) continue;
      const cur = best[i];
      if (!cur || s.rank < cur.rank) best[i] = s;
    }
  }
  return best;
}

function blanked(text: string, keep: boolean[]): string {
  let out = '';
  for (let i = 0; i < text.length; i++) out += keep[i] ? BLANK : text[i];
  return out;
}

/** Whitespace is never a detection on its own: drop it so spans start and end on visible text. */
function visible(text: string, best: Array<Span | null>): Array<Span | null> {
  return best.map((s, i) => (s && /\s/.test(text[i] ?? '') ? null : s));
}

// ---------------------------------------------------------------------------------------------
// The trade amount (owner 2026-11-02: the automatic blur never hides the amount).

/**
 * Amount labels: a whole number right after one, equal to the trade amount, is the amount even with
 * no currency marker or decimals (`Amount: 12345678`, `Total 250,000`).
 *
 * Owner Q17 (2026-11-02): without a label too, a number exactly equal to the trade amount stays
 * clear ("highly doubtful it's a reference number; most likely just another spot where the amount is
 * displayed"). Only a number standing on its own (see `standsAlone`): a longer number that merely
 * contains the amount (a card, phone, IBAN or account group) is still masked.
 */
const AMOUNT_LABEL = new RegExp(
  `(?<![\\p{L}])(?:${[
    'amount', 'total', 'sum', 'sent', 'paid', 'received', 'transferred',
    'montant', 'somme', 'betrag', 'summe', 'importe', 'monto', 'valor', 'quantia', 'bedrag',
    'kwota', 'importo', 'tutar', 'jumlah', 'nominal', 'сумма', 'сума', '金额', '金額', '합계', '금액',
  ].join('|')})\\s*[:：]?\\s*$`,
  'iu',
);
/** A run of 16 or more digits, which the amount reader does not take. */
const LONG_DIGITS = /(?<![\p{L}\p{N}])\d{16,}(?![\p{N}])/gu;

/**
 * Before a bare number: a digit, then optional spaces around one joining character (a group of a
 * longer number: `4111 1111`, `4111-1111`, `4111 - 1111`, `4111 – 1111`, review RV4-I1), or `#` or `+`.
 */
const JOINED_BEFORE = /(?:\p{N}\s?[^\p{L}\p{N}\s]?\s?|[#+])$/u;
/** After a bare number: a letter or digit, or a digit after optional spaces around one joining character. */
const JOINED_AFTER = /^(?:[\p{L}\p{N}]|\s?[^\p{L}\p{N}\s]?\s?\p{N})/u;

/**
 * A bare number (no marker, no decimals, no label) on its own: no leading zero, and not one part of a
 * longer number (`4111 1111`, `555-201-3344`, `DE89 3704`), nor glued to letters, nor after `#` or `+`.
 */
function standsAlone(text: string, start: number, end: number): boolean {
  if (text[start] === '0') return false;
  return !JOINED_BEFORE.test(text.slice(0, start)) && !JOINED_AFTER.test(text.slice(end));
}

/** Dates and the trade code, marked as kept in `k`. */
function markDatesAndCode(text: string, k: boolean[], codeRe: RegExp): void {
  markDates(text, k);
  for (const m of text.matchAll(codeRe)) mark(k, m.index, m.index + m[0].length);
}

/**
 * Per character of a normalised line: whether it is part of the trade amount.
 *
 * A whole number (no decimals; kept for a currency marker, an amount label or owner Q17) is kept
 * only when it is not part of a longer detected number. THE BINDING RULE (review RV4-I1): the amount
 * staying clear never exposes a card, phone, IBAN or account number. Detection runs first without
 * these candidates kept; a candidate inside a detected span that holds any other digit
 * is that number's group (`4111 - 1111 - 1111 - 1111`, `555 / 201 / 3344`, `06. 12. 34. 56. 78`), so
 * it is masked with the rest. A whole amount with a currency marker is checked the same way (a
 * marker can sit between a group and the real amount: in `… 1111 - 1111 $1,111.00` the `$` is also
 * read as a marker after the last group). An amount with decimals is always kept.
 */
function amountKept(text: string, keep: Keep, codeRe: RegExp, unmarkedOnly = false, prev?: string): boolean[] {
  const k: boolean[] = new Array<boolean>(text.length).fill(false);
  // Owner G17/F15: a bare number after a personal label is that detail, never the amount.
  const personal = labelledNumbers(text, prev);
  const isPersonal = (start: number, end: number): boolean => personal.some((p) => p.start < end && start < p.end);
  // [start, end, has a currency marker]
  const bare: Array<[number, number, boolean]> = [];
  for (const a of findAmounts(text, keep.exponent)) {
    if (a.value !== keep.fiatCents) continue;
    if (a.decimals) mark(k, a.start, a.end);
    else if (a.marker === null && isPersonal(a.start, a.end)) continue;
    else if (a.marker !== null || AMOUNT_LABEL.test(text.slice(0, a.start)) || standsAlone(text, a.start, a.end)) bare.push([a.start, a.end, a.marker !== null]);
  }
  const unit = 10n ** BigInt(keep.exponent);
  if (keep.fiatCents % unit === 0n) {
    const whole = (keep.fiatCents / unit).toString();
    for (const m of text.matchAll(LONG_DIGITS)) {
      const end = m.index + m[0].length;
      if (m[0].replace(/^0+(?=\d)/, '') !== whole || isPersonal(m.index, end)) continue;
      if (AMOUNT_LABEL.test(text.slice(0, m.index)) || standsAlone(text, m.index, end)) bare.push([m.index, end, false]);
    }
  }
  if (bare.length === 0) return unmarkedOnly ? k.fill(false) : k;
  const others = [...k];
  markDatesAndCode(text, others, codeRe);
  const numbers = moneySpans(blanked(text, others), false, UPI_IDS);
  const digitOutside = (sp: Span, start: number, end: number): boolean => /\d/.test(text.slice(sp.start, start) + text.slice(end, sp.end));
  const out = unmarkedOnly ? new Array<boolean>(text.length).fill(false) : k;
  for (const [start, end, marked] of bare) {
    if (unmarkedOnly && marked) continue;
    if (!numbers.some((sp) => sp.start < end && start < sp.end && digitOutside(sp, start, end))) mark(out, start, end);
  }
  return out;
}

/**
 * Whether one line shows the trade amount as a whole number with no currency marker that
 * `detectSensitive` keeps clear: after an amount label (`Total 250000`) or on its own (owner Q17),
 * and never a group of a longer number (review RV4-I1). For Task 9's amount check (review RV4-M4),
 * so the smart check never reports "not found" for an amount the automatic blur left visible. `prev` is
 * the line before (a personal label alone on it makes this line's number that detail, owner G17).
 */
export function showsWholeAmount(line: string, keep: Keep, prev?: string): boolean {
  return amountKept(normalize(line).text, keep, keepCode(keep), true, prev === undefined ? undefined : normalize(prev).text).some(Boolean);
}

/** The trade code's pattern for `keep`, or a RangeError. */
function keepCode(keep: Keep): RegExp {
  const code = normalizeTradeCode(keep.tradeCode);
  if (code === null) throw new RangeError('keep.tradeCode is not a trade code');
  return codePattern(code);
}

/**
 * The boxes of the trade amount in OCR words: a whole word, or the part of a word that holds it (by
 * character position, as `detectSensitive` cuts words). Pass them to `padAndMerge` so padding and
 * merging never cover the amount either (owner 2026-11-02).
 */
export function amountBoxes(words: OcrWord[], keep: Keep): Box[] {
  const codeRe = keepCode(keep);
  const out: Box[] = [];
  let prev: string | undefined;
  for (const l of linesOf(words)) {
    const n = normalize(l.text);
    const k = toOriginal(n, new Array<Span | null>(n.text.length).fill(null), amountKept(n.text, keep, codeRe, false, prev)).keep;
    prev = n.text;
    for (const { word, start, end } of l.words) {
      const charW = (word.x1 - word.x0) / (end - start);
      for (let c = start; c < end; ) {
        if (!k[c]) {
          c++;
          continue;
        }
        let d = c;
        while (d < end && k[d]) d++;
        out.push({
          x0: c === start ? word.x0 : Math.floor(word.x0 + charW * (c - start)),
          y0: word.y0,
          x1: d === end ? word.x1 : Math.ceil(word.x0 + charW * (d - start)),
          y1: word.y1,
        });
        c = d;
      }
    }
  }
  return out;
}

/**
 * Regions over OCR words that look like private details (spec 4.2), one per run of words of the same
 * kind on a line, in reading order. Never covers the trade code (in any grouping or case, after
 * `normalizeTradeCode`'s look-alike mapping), the trade amount or a date.
 */
export function detectSensitive(words: OcrWord[], keep: Keep, opts: DetectOptions = {}): Region[] {
  const upi = opts.upiIds ?? UPI_IDS;
  const codeRe = keepCode(keep);
  const lines = linesOf(words);
  // Detection reads the normalised text; results are carried back to the words through its map.
  const norms = lines.map((l) => normalize(l.text));
  const texts = norms.map((n) => n.text);
  const amounts = texts.map((text, i) => amountKept(text, keep, codeRe, false, texts[i - 1]));
  const kept = texts.map((text, i) => {
    const k = [...amounts[i]!];
    markDatesAndCode(text, k, codeRe);
    return k;
  });
  const spans: Span[][] = lines.map(() => []);
  const blankedTexts = texts.map((text, i) => blanked(text, kept[i]!));
  moneroChains(blankedTexts).forEach((c, i) => spans[i]!.push(...c));
  texts.forEach((text, i) => {
    const t = blankedTexts[i]!;
    spans[i]!.push(...moneySpans(t, false, upi), ...handleSpans(t), ...labelledNumbers(text, texts[i - 1]));
    for (const m of t.matchAll(SPLIT_EMAIL)) spans[i]!.push({ start: m.index, end: m.index + m[0].length, kind: 'email', rank: RANK.email });
    if (isAddressLine(t)) spans[i]!.push({ start: 0, end: t.length, kind: 'address', rank: RANK.address });
    const ns = nameStart(text);
    if (ns === 'next') {
      const next = spans[i + 1];
      if (next && texts[i + 1] !== undefined) next.push({ start: 0, end: texts[i + 1]!.length, kind: 'name', rank: RANK.name });
    } else if (ns >= 0) {
      spans[i]!.push({ start: ns, end: text.length, kind: 'name', rank: RANK.name });
    }
  });

  // A Monero-class token on one line: a base58 token of 20 or more on the next line is its rest.
  texts.forEach((_, i) => {
    const t = blankedTexts[i + 1];
    if (t === undefined || !spans[i]!.some((s) => s.rank === RANK.monero)) return;
    for (const m of t.matchAll(BASE58_TAIL)) spans[i + 1]!.push({ start: m.index, end: m.index + m[0].length, kind: 'account', rank: RANK.monero });
  });

  const out: Region[] = [];
  lines.forEach((l, i) => {
    const back = toOriginal(norms[i]!, visible(texts[i]!, resolve(texts[i]!.length, spans[i]!, kept[i]!)), kept[i]!);
    const best = back.best;
    const k = back.keep;
    // The amount alone (not dates or the code): the extra width below stops only at it (review RV4-M2).
    const amt = toOriginal(norms[i]!, [], amounts[i]!).keep;
    let open: Region | null = null;
    const flush = (): void => {
      if (open) out.push(open);
      open = null;
    };
    for (const { word, start, end } of l.words) {
      const hasKept = k.slice(start, end).some(Boolean);
      // The word's kind: the best-ranked span over any of its characters.
      let win: Span | null = null;
      for (let c = start; c < end; c++) {
        const s = best[c];
        if (s && (!win || s.rank < win.rank)) win = s;
      }
      if (!win) {
        flush();
        continue;
      }
      if (!hasKept) {
        const o: Region | null = open;
        if (o !== null && o.kind === win.kind) {
          o.x0 = Math.min(o.x0, word.x0);
          o.y0 = Math.min(o.y0, word.y0);
          o.x1 = Math.max(o.x1, word.x1);
          o.y1 = Math.max(o.y1, word.y1);
        } else {
          flush();
          open = { x0: word.x0, y0: word.y0, x1: word.x1, y1: word.y1, kind: win.kind };
        }
        continue;
      }
      // A word that holds a kept part: cover only its detected characters, by position in the word.
      // Positions by character count are approximate in a proportional font, so each part reaches
      // one more average character toward its neighbours, within the word (review M8).
      flush();
      const len = end - start;
      const charW = (word.x1 - word.x0) / len;
      let c = start;
      while (c < end) {
        if (!best[c]) {
          c++;
          continue;
        }
        const kind = best[c]!.kind;
        let d = c;
        while (d < end && best[d] && best[d]!.kind === kind) d++;
        out.push({
          // Never reaching into the amount: it wins over the extra width (owner 2026-11-02). Next to a
          // date or the trade code the extra width stays, as review M8 set it (review RV4-M2).
          x0: Math.max(word.x0, Math.floor(word.x0 + charW * (c - start - (c > start && !amt[c - 1] ? 1 : 0)))),
          y0: word.y0,
          x1: Math.min(word.x1, Math.ceil(word.x0 + charW * (d - start + (d < end && !amt[d] ? 1 : 0)))),
          y1: word.y1,
          kind,
        });
        c = d;
      }
    }
    flush();
  });
  return out;
}

/**
 * A number with one decimal point and its decimal part (group 1). Three digits after a single
 * separator may be a thousands group (`123,456`), so those stay a whole number.
 */
const DECIMAL = /(?<!\d|\d[.,])\d+[.,](\d{1,2}|\d{4,})(?!\d|[.,]\d)/g;
/** ISO 4217 codes (review R3-I1: an allowlist, so `TEL` or `SMS` is not a currency). */
const ISO_4217 =
  'AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BOV BRL BSD BTN BWP BYN BZD CAD CDF CHE CHF CHW CLF CLP CNY COP COU CRC CUC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HRK HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MXV MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SLL SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD USN UYI UYU UYW UZS VED VES VND VUV WST XAF XAG XAU XCD XCG XDR XOF XPD XPF XPT XSU XUA YER ZAR ZMW ZWG ZWL';
/** Common crypto codes and names. */
const CRYPTO = 'XMR MONERO BTC ETH LTC USDT USDC BCH DAI XRP DOGE TRX SOL BNB ADA';
/** Codes that are also everyday words: they never count, in any case (review R4-M5: `347.1234567 TRY`), except `CAPITAL_AFTER_CODES`. */
const WORD_CODES = new Set(['ALL', 'TOP', 'CUP', 'TRY', 'MOP', 'PEN', 'GEL', 'MAD', 'BOB', 'SOS', 'SOL', 'ADA']);
const CURRENCY_CODES = new Set(`${ISO_4217} ${CRYPTO}`.split(' '));
/**
 * The codes that count when not written in capitals (`0.12345678 xmr`, `Monero`). Any other code
 * counts only in capitals, as a code is written: `Ron`, `bam` or `Cad` next to a number is a word
 * (review R4-M5).
 */
const LOWERCASE_CODES = new Set(['xmr', 'monero', 'btc', 'eth', 'ltc', 'usdt', 'usdc', 'eur', 'usd']);
/** Crypto codes in `WORD_CODES` that count in capitals right after a decimal number (`0.12345678 SOL`, review R5-M4). */
const CAPITAL_AFTER_CODES = new Set(['SOL', 'ADA']);
const SYMBOL = /[$€£¥₹₽₩₺₴₱₦₪₫₿]/;

function isCurrencyWord(w: string): boolean {
  const up = w.toUpperCase();
  if (WORD_CODES.has(up)) return false;
  return w === up ? CURRENCY_CODES.has(up) : LOWERCASE_CODES.has(w.toLowerCase());
}

/** A currency or crypto code, name or symbol right after or right before a number (one space allowed). */
function markAfter(rest: string): boolean {
  const m = /^ ?(?:([A-Za-z]+)(?![A-Za-z])|(\S))/.exec(rest);
  if (m === null) return false;
  if (m[1] === undefined) return SYMBOL.test(m[2]!);
  return isCurrencyWord(m[1]) || CAPITAL_AFTER_CODES.has(m[1]);
}

function markBefore(head: string): boolean {
  const m = /(?:(?<![A-Za-z])([A-Za-z]+)|(\S)) ?$/.exec(head);
  return m !== null && (m[1] !== undefined ? isCurrencyWord(m[1]) : SYMBOL.test(m[2]!));
}

/**
 * A decimal part of 4 or more digits is kept only when the number looks like an amount (review
 * R2-I1, `347.1234567` is an Italian phone): the whole part is `0` or 1-3 digits without a leading
 * zero, and a currency or crypto code or symbol is next to it (`0.12345678 XMR`).
 */
function longDecimalIsAmount(line: string, at: number, num: string, fracLen: number): boolean {
  const whole = num.slice(0, num.length - fracLen - 1);
  if (!(whole === '0' || /^[1-9]\d{0,2}$/.test(whole))) return false;
  return markAfter(line.slice(at + num.length)) || markBefore(line.slice(0, at));
}

/** A range of years, `2023 - 2026` or `2023-2026`. */
const YEAR_RANGE = /(?<!\d|\d[-/.,] ?)(?:19|20)\d{2} ?[-–—] ?(?:19|20)\d{2}(?!\d| ?[-/.,]\d)/g;

/**
 * A whole number in thousands groups (owner item 29): 1-3 digits without a leading zero, then groups
 * of exactly 3 after one separator used throughout (`,` `.` or a space), and an optional decimal part
 * after the other mark. Not inside a longer run of digits, nor after `+`, a bracket or `/`, so a phone
 * number (`+34 612 345 678`, `+61 (0)412 345 678`) is never one.
 */
const GROUPED = /(?<![\d+()/]|[\d)/][.,' /-]|\+ )[1-9]\d{0,2}([., ])\d{3}(?:\1\d{3})*([.,]\d{1,2})?(?![\d(]|[.,' /-]\d)/g;
/** Notes allow a grouped number of at most this many digits (`123,456,789`); longer ones are refused. */
const GROUPED_MAX_DIGITS = 9;

/** The order `detectSensitiveText` reports kinds in (P5-A6's list). */
const TEXT_ORDER: HiddenKind[] = ['email', 'phone', 'card', 'iban', 'account'];

/**
 * The personal-detail kinds in plain text (review notes, P5-A6): email, phone, card, IBAN, account
 * number and Monero address (as `account`). Each kind once, in a fixed order. Dates and trade codes
 * are not details. A number after a personal field label (`phone 612 345 678`, `Acct 4821`) is that
 * detail whatever its grouping (owner G17), for the label kinds in `opts.numberLabels` (all by
 * default; review notes pass `REVIEW_NOTE_NUMBER_LABELS`).
 */
export function detectSensitiveText(s: string, opts: DetectOptions = {}): HiddenKind[] {
  const upi = opts.upiIds ?? UPI_IDS;
  const found = new Set<HiddenKind>();
  const lines = s.split(/\r\n|\r|\n/).map(normalizeText);
  const keeps = lines.map((line) => {
    const k: boolean[] = new Array<boolean>(line.length).fill(false);
    markDates(line, k);
    // Review M6: the digits after a decimal point (`0.12345678 XMR`) and year ranges (`2023 - 2026`)
    // are not details. Owner item 29 (2026-11-02): a number written with thousands separators of up
    // to 9 digits (`1,250,000`, `1.250.000`, `1 250 000`) is not one either; plain runs of 6 or more
    // digits (`250000 COP`) and longer grouped numbers still are.
    for (const m of line.matchAll(GROUPED)) {
      const dec = m[2];
      if (dec !== undefined && dec[0] === m[1]) continue;
      const whole = dec === undefined ? m[0] : m[0].slice(0, -dec.length);
      if (digitsOf(whole).length <= GROUPED_MAX_DIGITS) mark(k, m.index, m.index + m[0].length);
    }
    for (const m of line.matchAll(DECIMAL)) {
      if (m[1]!.length >= 4 && !longDecimalIsAmount(line, m.index, m[0], m[1]!.length)) continue;
      mark(k, m.index + m[0].length - m[1]!.length, m.index + m[0].length);
    }
    for (const m of line.matchAll(YEAR_RANGE)) mark(k, m.index, m.index + m[0].length);
    for (const m of line.matchAll(ANY_CODE)) {
      if (/[A-Za-z]/.test(m[0]) && !isIban(m[0]) && normalizeTradeCode(m[0]) !== null) mark(k, m.index, m.index + m[0].length);
    }
    return k;
  });
  // Owner G17: a number after a personal label is a detail even when the rules above allow it
  // (`phone 612 345 678`), unless it is a date.
  const labelKinds = opts.numberLabels ?? NUMBER_KINDS;
  const labelled = lines.map((line, i) => labelledNumbers(line, lines[i - 1]).filter((sp) => labelKinds.includes(sp.kind as NumberLabelKind)));
  lines.forEach((line, i) => {
    const dates: boolean[] = new Array<boolean>(line.length).fill(false);
    markDates(line, dates);
    for (const sp of labelled[i]!) for (let c = sp.start; c < sp.end; c++) if (!dates[c]) keeps[i]![c] = false;
  });
  const blankedLines = lines.map((line, i) => blanked(line, keeps[i]!));
  const chains = moneroChains(blankedLines);
  lines.forEach((line, i) => {
    const spans = [...moneySpans(blankedLines[i]!, true, upi), ...chains[i]!, ...labelled[i]!];
    const best = visible(line, resolve(line.length, spans, keeps[i]!));
    for (const b of best) if (b) found.add(b.kind);
  });
  return TEXT_ORDER.filter((k) => found.has(k));
}

/**
 * The boxes of the trade code (the memo) in OCR words, in any grouping or case, cut by character
 * position like `amountBoxes`. The uploader's app compares them with the uploader's own blur (owner
 * 2026-11-02 08:17: warn when their blur covers the amount or the memo; posting is still allowed).
 */
export function codeBoxes(words: OcrWord[], tradeCode: string): Box[] {
  const code = normalizeTradeCode(tradeCode);
  if (code === null) throw new RangeError('tradeCode is not a trade code');
  const codeRe = codePattern(code);
  const out: Box[] = [];
  for (const l of linesOf(words)) {
    const n = normalize(l.text);
    const kept: boolean[] = new Array<boolean>(n.text.length).fill(false);
    for (const m of n.text.matchAll(codeRe)) mark(kept, m.index, m.index + m[0].length);
    const k = toOriginal(n, new Array<Span | null>(n.text.length).fill(null), kept).keep;
    for (const { word, start, end } of l.words) {
      const charW = (word.x1 - word.x0) / (end - start);
      for (let c = start; c < end; ) {
        if (!k[c]) {
          c++;
          continue;
        }
        let d = c;
        while (d < end && k[d]) d++;
        out.push({
          x0: c === start ? word.x0 : Math.floor(word.x0 + charW * (c - start)),
          y0: word.y0,
          x1: d === end ? word.x1 : Math.ceil(word.x0 + charW * (d - start)),
          y1: word.y1,
        });
        c = d;
      }
    }
  }
  return out;
}
