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

const DATE_TEXT: RegExp[] = [
  // Oct 16, 2026 / October 16 2026 / Oct 16
  new RegExp(`${B}${MONTH}\\.? \\d{1,2}(?:st|nd|rd|th)?(?:,? \\d{4})?${E}`, 'gi'),
  // 16 Oct 2026 / 16 October, 2026 / 16 Oct
  new RegExp(`${B}\\d{1,2}(?:st|nd|rd|th)? ${MONTH}\\.?(?:,? \\d{4})?${E}`, 'gi'),
  // 2026-10-16, optionally with a time
  new RegExp(`${B}\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}(?:[ T]\\d{1,2}:\\d{2}(?::\\d{2})?)?${E}`, 'g'),
  // 14:32 / 14:32:05 / 2:32 PM
  new RegExp(`${B}\\d{1,2}:\\d{2}(?::\\d{2})?(?: ?[AaPp]\\.?[Mm]\\.?)?${E}`, 'g'),
];
/** 16-10-2026, 10/16/26, 16.10.2026: kept only when one order is a real day and month. */
const DATE_NUMERIC = new RegExp(`${B}(\\d{1,2})([-/.])(\\d{1,2})\\2(\\d{4}|\\d{2})${E}`, 'g');

function markDates(text: string, keep: boolean[]): void {
  for (const re of DATE_TEXT) for (const m of text.matchAll(re)) mark(keep, m.index, m.index + m[0].length);
  for (const m of text.matchAll(DATE_NUMERIC)) {
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
/** Masked tails such as `••••1234`, `****1234`, `xx1234`. */
const MASKED_TAIL = new RegExp(`${B}[•*●·∙xX]{2,} ?\\d{2,}`, 'g');
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
/** Phone candidates: an optional `+`, digits with spaces, dots, dashes or brackets between them. */
const PHONE = /(?<![A-Za-z0-9+])\+?\(?\d(?:[\d ().-]*\d)?\)?/g;
const HANDLE = /(?<![A-Za-z0-9._%+-])[@$][A-Za-z][A-Za-z0-9_.-]*[A-Za-z0-9_]|(?<![A-Za-z0-9._%+-])[@$][A-Za-z]/g;
/** Monero standard or integrated addresses (base58). */
const MONERO = new RegExp(`${B}[48][1-9A-HJ-NP-Za-km-z]{94}(?:[1-9A-HJ-NP-Za-km-z]{11})?${E}`, 'g');

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
  for (const m of text.matchAll(DIGIT_RUN)) {
    const digits = digitsOf(m[0]);
    const span = { start: m.index, end: m.index + m[0].length };
    if (digits.length >= 13 && digits.length <= 19) out.push({ ...span, kind: luhn(digits) ? 'card' : 'account', rank: RANK.card });
    if (digits.length >= 6) out.push({ ...span, kind: 'account', rank: RANK.account });
  }
  for (const m of text.matchAll(MASKED_TAIL)) out.push({ start: m.index, end: m.index + m[0].length, kind: 'account', rank: RANK.account });
  for (const m of text.matchAll(MONERO)) out.push({ start: m.index, end: m.index + m[0].length, kind: 'account', rank: RANK.monero });
  for (const m of text.matchAll(EMAIL)) out.push({ start: m.index, end: m.index + m[0].length, kind: 'email', rank: RANK.email });
  for (const m of text.matchAll(PHONE)) {
    const s = m[0];
    const digits = digitsOf(s);
    if (digits.length >= 7 && (s.startsWith('+') || /[ ().-]/.test(s))) out.push({ start: m.index, end: m.index + s.length, kind: 'phone', rank: RANK.phone });
  }
  return out;
}

// Names: the rest of the line after a label, or the next line when the label stands alone.
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
    if (isAddressLine(t)) spans[i]!.push({ start: 0, end: t.length, kind: 'address', rank: RANK.address });
    const ns = nameStart(l.text);
    if (ns === 'next') {
      const next = spans[i + 1];
      if (next && lines[i + 1]) next.push({ start: 0, end: lines[i + 1]!.text.length, kind: 'name', rank: RANK.name });
    } else if (ns >= 0) {
      spans[i]!.push({ start: ns, end: l.text.length, kind: 'name', rank: RANK.name });
    }
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
      flush();
      const len = end - start;
      let c = start;
      while (c < end) {
        if (!best[c]) {
          c++;
          continue;
        }
        const kind = best[c]!.kind;
        let d = c;
        while (d < end && best[d] && best[d]!.kind === kind) d++;
        const w = word.x1 - word.x0;
        out.push({
          x0: Math.floor(word.x0 + (w * (c - start)) / len),
          y0: word.y0,
          x1: Math.ceil(word.x0 + (w * (d - start)) / len),
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
    for (const m of line.matchAll(ANY_CODE)) {
      if (/[A-Za-z]/.test(m[0]) && normalizeTradeCode(m[0]) !== null) mark(k, m.index, m.index + m[0].length);
    }
    const best = visible(line, resolve(line.length, moneySpans(blanked(line, k)), k));
    for (const b of best) if (b) found.add(b.kind);
  }
  return TEXT_ORDER.filter((k) => found.has(k));
}
