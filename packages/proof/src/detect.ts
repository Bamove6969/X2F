// Sensitive-detail detection over OCR words and plain text (Plan 5 Task 7, spec 4.2).
//
// Fail-safe (review 2026-10-24): the Luhn and mod-97 checks only choose a region's label, never
// whether it is masked; one misread digit must not leave a real card or IBAN visible. The only
// things ever kept are the trade code, the trade amount and dates (the smart card needs them).
import { normalizeTradeCode } from '@x2f/core';
import { findAmounts } from './amounts.js';
import { type OcrWord, linesOf } from './ocr.js';

export type HiddenKind = 'name' | 'account' | 'card' | 'iban' | 'address' | 'phone' | 'email' | 'handle' | 'manual';

/** A box in image pixels (x1, y1 exclusive) and why it is hidden. */
export interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
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
const RANK = { iban: 0, card: 1, email: 2, phone: 3, handle: 4, monero: 5, account: 6, address: 7, name: 8 } as const;

/** Marks a kept character in the text the classifiers see, so no match can run across it. */
const BLANK = '\u0000';

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
/** A UK sort code label: a dashed `12-05-26` on its line is a sort code, not a date (review M5). */
const SORT_CODE = /(?<![A-Za-z])sort[\s-]*code(?![A-Za-z])/i;

/**
 * A phone-like digit group right before a 2-digit-year date, joined by a space (review R2-I2:
 * `0470 01.02.03` is a Belgian mobile): a group starting with `0` or `+`, or of 3-4 digits.
 */
const PHONE_GROUP_BEFORE = /(?:^|\s)(?:\+\d{1,4}|0\d*|\d{3,4}) $/;

function markDates(text: string, keep: boolean[]): void {
  for (const re of DATE_TEXT) for (const m of text.matchAll(re)) mark(keep, m.index, m.index + m[0].length);
  const sortCode = SORT_CODE.test(text);
  for (const m of text.matchAll(DATE_NUMERIC)) {
    if (sortCode && m[2] === '-' && m[4]!.length === 2) continue;
    if (m[4]!.length === 2 && PHONE_GROUP_BEFORE.test(text.slice(0, m.index))) continue;
    const a = Number(m[1]);
    const b = Number(m[3]);
    const ok = (a >= 1 && a <= 12 && b >= 1 && b <= 31) || (a >= 1 && a <= 31 && b >= 1 && b <= 12);
    if (ok) mark(keep, m.index, m.index + m[0].length);
  }
}

/** A pattern for one trade code as OCR may show it: any case, O for 0, I or L for 1, any grouping. */
function codePattern(normalized: string): RegExp {
  const chars = [...normalized.replace(/-/g, '')].map((c) => {
    if (c === '0') return '[0Oo]';
    if (c === '1') return '[1IiLl]';
    if (/[A-Z]/.test(c)) return `[${c}${c.toLowerCase()}]`;
    return c;
  });
  return new RegExp(`${B}${chars.join('[ -]?')}${E}`, 'g');
}

/** Any well-formed trade code (grouped, with at least one letter), for review notes. */
const ANY_CODE = new RegExp(`${B}[0-9A-Za-z]{4}(?:-[0-9A-Za-z]{4}){3}${E}`, 'g');

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
const MASKED_TAIL = new RegExp(`${B}(?:[•*●·∙°xX]{2,} ?\\d{2,}|(?:…+|\\.{3,})\\d{4}(?!\\d))`, 'g');
/** The 4 digits after `ending` or `ending in` (`Account ending in 1234`). */
const ENDING = /(?<=(?<![A-Za-z])ending(?: in)?:? ?)\d{4}(?!\d)/gi;
/** Letters or digits of any script in the local part and the domain (review M4: `jane@exämple.com`). */
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;
/**
 * An email OCR split around its `@` (`jane.doe @example.com`, `jane.doe@ example.com`,
 * `jane.doe @ example.com`): one space at most on each side, at least one in all.
 */
const SPLIT_EMAIL = /(?<![\p{L}\p{N}._%+@-])[\p{L}\p{N}._%+-]+(?: @ ?|@ )[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}(?![\p{L}\p{N}])/gu;
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
const MONERO_SHORT = new RegExp(`${B}[48][1-9AB][1-9A-HJ-NP-Za-km-z]{3,}(?:…|\\.{2,})[1-9A-HJ-NP-Za-km-z]{4,}${E}`, 'g');
/** The rest of a wrapped address on the next line: a base58 token of 20 or more characters. */
const BASE58_TAIL = new RegExp(`${B}[1-9A-HJ-NP-Za-km-z]{20,}${E}`, 'g');
const NOT_BASE58 = /[0OIl]/g;

/**
 * Characters OCR reads in place of digits (review M2). A token of only digits and these, with at
 * least as many digits as look-alikes, counts as digits for the digit-run rules, so `l111` in
 * `4111 1111 1111 l111` is masked with the rest of the card.
 */
const LOOKALIKE = /^[0-9OolI|SB]+$/;
const TOKEN = /[0-9A-Za-z|]+/g;

/** The text with look-alikes in digit tokens turned into `0`, and which characters were turned. */
function withLookalikeDigits(text: string): { text: string; changed: boolean[] } {
  // UTF-16 units, as `m.index` counts them (review R2-M2: `[...text]` shifts after an emoji).
  const chars = text.split('');
  const changed: boolean[] = new Array<boolean>(text.length).fill(false);
  for (const m of text.matchAll(TOKEN)) {
    const t = m[0];
    if (!LOOKALIKE.test(t)) continue;
    const digits = t.replace(/\D/g, '').length;
    if (digits === 0 || t.length - digits > digits) continue;
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
function moneySpans(text: string): Span[] {
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
    if (digits.length >= 13 && digits.length <= 19) out.push({ ...span, kind: real && luhn(digits) ? 'card' : 'account', rank: RANK.card });
    if (digits.length >= 6) out.push({ ...span, kind: 'account', rank: RANK.account });
  }
  for (const m of text.matchAll(MASKED_TAIL)) out.push({ start: m.index, end: m.index + m[0].length, kind: 'account', rank: RANK.account });
  for (const m of text.matchAll(ENDING)) out.push({ start: m.index, end: m.index + m[0].length, kind: 'account', rank: RANK.account });
  for (const m of text.matchAll(MONERO)) out.push({ start: m.index, end: m.index + m[0].length, kind: 'account', rank: RANK.monero });
  for (const m of text.matchAll(MONERO_SHORT)) out.push({ start: m.index, end: m.index + m[0].length, kind: 'account', rank: RANK.monero });
  for (const m of text.matchAll(LONG_TOKEN)) {
    if ((m[0].match(NOT_BASE58)?.length ?? 0) * 10 <= m[0].length) out.push({ start: m.index, end: m.index + m[0].length, kind: 'account', rank: RANK.monero });
  }
  for (const m of text.matchAll(EMAIL)) out.push({ start: m.index, end: m.index + m[0].length, kind: 'email', rank: RANK.email });
  for (const m of text.matchAll(PHONE)) {
    const s = m[0];
    const digits = digitsOf(s);
    if (digits.length >= 7 && (s.startsWith('+') || /[ ()./-]/.test(s))) out.push({ start: m.index, end: m.index + s.length, kind: 'phone', rank: RANK.phone });
  }
  return out;
}

// Names: the rest of the line after a label, or the next line when the label stands alone.
// English labels only, as built: whether to add labels for other languages is open owner question 30
// (review M7), unchanged here.
const LABELS = ['account holder', 'beneficiary', 'recipient', 'paid to', 'sent to', 'sender', 'payee', 'payer', 'name', 'from', 'to'];
const LABEL = LABELS.map((l) => l.replace(' ', '\\s+')).join('|');
/** A label at the start of the line, with or without a colon. */
const LABEL_START = new RegExp(`^\\s*(?:${LABEL})(?::|(?=\\s)|$)\\s*`, 'i');
/** A label later in the line, only with a colon (`Status: done  From: Jane Doe`). */
const LABEL_COLON = new RegExp(`(?<![A-Za-z])(?:${LABEL}):\\s*`, 'gi');

/** Where the name starts after a label in this line: its index, `'next'` for a lone label, or -1. */
function nameStart(text: string): number | 'next' {
  const m = LABEL_START.exec(text);
  if (m) return m[0].length >= text.trimEnd().length ? 'next' : m[0].length;
  for (const c of text.matchAll(LABEL_COLON)) {
    const at = c.index + c[0].length;
    if (at < text.trimEnd().length) return at;
  }
  return -1;
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

/**
 * Regions over OCR words that look like private details (spec 4.2), one per run of words of the same
 * kind on a line, in reading order. Never covers the trade code (in any grouping or case, after
 * `normalizeTradeCode`'s look-alike mapping), the trade amount or a date.
 */
export function detectSensitive(words: OcrWord[], keep: Keep): Region[] {
  const code = normalizeTradeCode(keep.tradeCode);
  if (code === null) throw new RangeError('keep.tradeCode is not a trade code');
  const codeRe = codePattern(code);
  const lines = linesOf(words);
  const kept = lines.map((l) => {
    const k: boolean[] = new Array<boolean>(l.text.length).fill(false);
    markDates(l.text, k);
    for (const m of l.text.matchAll(codeRe)) mark(k, m.index, m.index + m[0].length);
    for (const a of findAmounts(l.text, keep.exponent)) {
      if ((a.marker !== null || a.decimals) && a.value === keep.fiatCents) mark(k, a.start, a.end);
    }
    return k;
  });
  const spans: Span[][] = lines.map(() => []);
  lines.forEach((l, i) => {
    const k = kept[i]!;
    const t = blanked(l.text, k);
    spans[i]!.push(...moneySpans(t), ...handleSpans(t));
    for (const m of t.matchAll(SPLIT_EMAIL)) spans[i]!.push({ start: m.index, end: m.index + m[0].length, kind: 'email', rank: RANK.email });
    if (isAddressLine(t)) spans[i]!.push({ start: 0, end: t.length, kind: 'address', rank: RANK.address });
    const ns = nameStart(l.text);
    if (ns === 'next') {
      const next = spans[i + 1];
      if (next && lines[i + 1]) next.push({ start: 0, end: lines[i + 1]!.text.length, kind: 'name', rank: RANK.name });
    } else if (ns >= 0) {
      spans[i]!.push({ start: ns, end: l.text.length, kind: 'name', rank: RANK.name });
    }
  });

  // A Monero-class token on one line: a base58 token of 20 or more on the next line is its rest.
  lines.forEach((l, i) => {
    const next = lines[i + 1];
    if (!next || !spans[i]!.some((s) => s.rank === RANK.monero)) return;
    const t = blanked(next.text, kept[i + 1]!);
    for (const m of t.matchAll(BASE58_TAIL)) spans[i + 1]!.push({ start: m.index, end: m.index + m[0].length, kind: 'account', rank: RANK.monero });
  });

  const out: Region[] = [];
  lines.forEach((l, i) => {
    const best = visible(l.text, resolve(l.text.length, spans[i]!, kept[i]!));
    let open: Region | null = null;
    const flush = (): void => {
      if (open) out.push(open);
      open = null;
    };
    for (const { word, start, end } of l.words) {
      const k = kept[i]!;
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
          x0: Math.max(word.x0, Math.floor(word.x0 + charW * (c - start - (c > start ? 1 : 0)))),
          y0: word.y0,
          x1: Math.min(word.x1, Math.ceil(word.x0 + charW * (d - start + (d < end ? 1 : 0)))),
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
/** A currency or crypto code or symbol right after or right before a number (one space allowed). */
const MARK_AFTER = /^ ?(?:[A-Z]{3}(?![A-Za-z])|[$€£¥₹₽₩₺₴₱₦₪₫₿])/;
const MARK_BEFORE = /(?:(?<![A-Za-z])[A-Z]{3}|[$€£¥₹₽₩₺₴₱₦₪₫₿]) ?$/;

/**
 * A decimal part of 4 or more digits is kept only when the number looks like an amount (review
 * R2-I1, `347.1234567` is an Italian phone): the whole part is `0` or 1-3 digits without a leading
 * zero, and a currency or crypto code or symbol is next to it (`0.12345678 XMR`).
 */
function longDecimalIsAmount(line: string, at: number, num: string, fracLen: number): boolean {
  const whole = num.slice(0, num.length - fracLen - 1);
  if (!(whole === '0' || /^[1-9]\d{0,2}$/.test(whole))) return false;
  return MARK_AFTER.test(line.slice(at + num.length)) || MARK_BEFORE.test(line.slice(0, at));
}

/** A range of years, `2023 - 2026` or `2023-2026`. */
const YEAR_RANGE = /(?<!\d|\d[-/.,] ?)(?:19|20)\d{2} ?[-–—] ?(?:19|20)\d{2}(?!\d| ?[-/.,]\d)/g;

/** The order `detectSensitiveText` reports kinds in (P5-A6's list). */
const TEXT_ORDER: HiddenKind[] = ['email', 'phone', 'card', 'iban', 'account'];

/**
 * The personal-detail kinds in plain text (review notes, P5-A6): email, phone, card, IBAN, account
 * number and Monero address (as `account`). Each kind once, in a fixed order. Dates and trade codes
 * are not details.
 */
export function detectSensitiveText(s: string): HiddenKind[] {
  const found = new Set<HiddenKind>();
  for (const line of s.split(/\r\n|\r|\n/)) {
    const k: boolean[] = new Array<boolean>(line.length).fill(false);
    markDates(line, k);
    // Review M6: the digits after a decimal point (`0.12345678 XMR`) and year ranges (`2023 - 2026`)
    // are not details. Whole numbers of 6 or more digits (`250000 COP`, `1 250 000 IDR`) still are:
    // that rule is open owner question 29, unchanged here.
    for (const m of line.matchAll(DECIMAL)) {
      if (m[1]!.length >= 4 && !longDecimalIsAmount(line, m.index, m[0], m[1]!.length)) continue;
      mark(k, m.index + m[0].length - m[1]!.length, m.index + m[0].length);
    }
    for (const m of line.matchAll(YEAR_RANGE)) mark(k, m.index, m.index + m[0].length);
    for (const m of line.matchAll(ANY_CODE)) {
      if (/[A-Za-z]/.test(m[0]) && normalizeTradeCode(m[0]) !== null) mark(k, m.index, m.index + m[0].length);
    }
    const best = visible(line, resolve(line.length, moneySpans(blanked(line, k)), k));
    for (const b of best) if (b) found.add(b.kind);
  }
  return TEXT_ORDER.filter((k) => found.has(k));
}
