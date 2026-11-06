// Money amounts read from OCR text (Plan 5 Task 7): `parseAmounts` for the smart proof card
// (Task 9) and `findAmounts` for the "keep the trade's amount" rule of `detectSensitive`.
import { type OcrWord, linesOf } from './ocr.js';

/** A number found in a line of text, with the currency marker next to it (if any). */
export interface AmountSpan {
  /** Character range in the line, the marker included. */
  start: number;
  end: number;
  /** The amount in minor units (cents for exponent 2). */
  value: bigint;
  /** True when the number had a decimal part. */
  decimals: boolean;
  /** The currency the marker names: an ISO code, or null when there is no marker or it is ambiguous. */
  marker: { codes: readonly string[] } | null;
}

/** Symbols and their ISO codes. `$` and `¥` stand for several currencies. */
const SYMBOLS: ReadonlyArray<readonly [string, readonly string[]]> = [
  // Longest first, so `US$` wins over `$`.
  ['US$', ['USD']],
  ['CA$', ['CAD']],
  ['AU$', ['AUD']],
  ['NZ$', ['NZD']],
  ['HK$', ['HKD']],
  ['R$', ['BRL']],
  ['C$', ['CAD']],
  ['A$', ['AUD']],
  ['S$', ['SGD']],
  ['zł', ['PLN']],
  ['$', ['USD', 'CAD', 'AUD', 'NZD', 'MXN', 'SGD', 'HKD', 'ARS', 'CLP', 'COP']],
  ['€', ['EUR']],
  ['£', ['GBP']],
  ['¥', ['JPY', 'CNY']],
  ['₹', ['INR']],
  ['₽', ['RUB']],
  ['₩', ['KRW']],
  ['₺', ['TRY']],
  ['₴', ['UAH']],
  ['₱', ['PHP']],
  ['₦', ['NGN']],
  ['₪', ['ILS']],
  ['₫', ['VND']],
  ['₿', ['BTC']],
];

/** Thousands separators that are never decimal points: spaces of every width and the Swiss apostrophe. */
const THIN = new Set([' ', ' ', ' ', ' ', "'", '’']);

/** A run of digits with single separators between them. */
const NUMBER = /\d+(?:[.,   '’ ]\d+)*/g;

function checkExponent(exponent: number): void {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 8) throw new RangeError('exponent must be an integer 0..8');
}

/**
 * Read one number as an amount in minor units, or null when it is not a plausible amount for that
 * exponent. The last `.` or `,` is the decimal point when it differs from the other separators or is
 * followed by 1..exponent digits; a separator followed by exactly three digits is a thousands
 * separator (except for three-decimal currencies). Spaces separate thousands only with a decimal comma.
 */
function readNumber(s: string, exponent: number): { value: bigint; decimals: boolean } | null {
  const seps = [...s].filter((c) => !(c >= '0' && c <= '9'));
  if (seps.length === 0) {
    if (s.length > 15) return null;
    return { value: BigInt(s) * 10n ** BigInt(exponent), decimals: false };
  }
  const puncts = seps.filter((c) => c === '.' || c === ',');
  let decimalSep: string | null = null;
  const lastPunct = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  if (lastPunct >= 0) {
    const c = s[lastPunct]!;
    const tail = s.length - lastPunct - 1;
    const others = puncts.filter((p) => p !== c);
    const same = puncts.filter((p) => p === c).length;
    const tailIsDigits = /^\d+$/.test(s.slice(lastPunct + 1));
    if (!tailIsDigits) return null;
    if (others.length > 0) {
      // Both kinds: the last one is the decimal point, and it appears once.
      if (same !== 1) return null;
      decimalSep = c;
    } else if (same === 1 && tail !== 3) {
      decimalSep = c;
    } else if (same === 1 && tail === 3 && exponent === 3) {
      decimalSep = c;
    }
  }
  let intPart = s;
  let fracPart = '';
  if (decimalSep !== null) {
    intPart = s.slice(0, lastPunct);
    fracPart = s.slice(lastPunct + 1);
    if (fracPart.length > exponent) return null;
  }
  const thin = [...intPart].some((c) => THIN.has(c));
  if (thin && [...intPart].some((c) => c === ' ') && decimalSep !== ',') return null;
  const groups = intPart.split(/[.,   '’ ]/);
  if (groups.length > 1) {
    const intSeps = [...intPart].filter((c) => !(c >= '0' && c <= '9'));
    // One thousands separator kind per number.
    if (new Set(intSeps).size > 1) return null;
    if (decimalSep !== null && intSeps[0] === decimalSep) return null;
    if (!/^\d{1,3}$/.test(groups[0]!)) return null;
    if (!groups.slice(1).every((g) => /^\d{3}$/.test(g))) return null;
  }
  const digits = groups.join('');
  if (digits.length === 0 || digits.length > 15) return null;
  const value = BigInt(digits) * 10n ** BigInt(exponent) + (fracPart ? BigInt(fracPart.padEnd(exponent, '0')) : 0n);
  return { value, decimals: decimalSep !== null };
}

function endsAt(line: string, k: number, sym: string): boolean {
  return k >= sym.length && line.slice(k - sym.length, k) === sym;
}

function markerBefore(line: string, at: number): { codes: readonly string[]; start: number } | null {
  // Skip a sign ("-$412.50" is a debit of $412.50) and one space ("USD 412.50").
  const i = line[at - 1] === '-' || line[at - 1] === '+' ? at - 1 : at;
  for (const k of line[i - 1] === ' ' || line[i - 1] === '\u00a0' ? [i, i - 1] : [i]) {
    for (const [sym, codes] of SYMBOLS) {
      if (endsAt(line, k, sym)) return { codes, start: k - sym.length };
    }
    if (k >= 3 && /^[A-Z]{3}$/.test(line.slice(k - 3, k)) && !/[A-Za-z]/.test(line[k - 4] ?? '')) {
      return { codes: [line.slice(k - 3, k)], start: k - 3 };
    }
  }
  return null;
}

function markerAfter(line: string, at: number): { codes: readonly string[]; end: number } | null {
  for (const k of line[at] === ' ' || line[at] === '\u00a0' ? [at, at + 1] : [at]) {
    for (const [sym, codes] of SYMBOLS) {
      if (line.startsWith(sym, k)) return { codes, end: k + sym.length };
    }
    if (/^[A-Z]{3}$/.test(line.slice(k, k + 3)) && !/[A-Za-z]/.test(line[k + 3] ?? '')) {
      return { codes: [line.slice(k, k + 3)], end: k + 3 };
    }
  }
  return null;
}

function pushNumber(line: string, at: number, raw: string, exponent: number, out: AmountSpan[]): void {
  // A letter glued to the front (a reference like "TX8392") is not an amount, unless it is a marker.
  const before = markerBefore(line, at);
  if (!before && /[A-Za-z]/.test(line[at - 1] ?? '')) return;
  const read = readNumber(raw, exponent);
  if (read === null) {
    // "3 412.50": a quantity and an amount; read each space-separated part on its own.
    if (raw.includes(' ')) {
      let offset = at;
      for (const part of raw.split(' ')) {
        pushNumber(line, offset, part, exponent, out);
        offset += part.length + 1;
      }
    }
    return;
  }
  const after = before ? null : markerAfter(line, at + raw.length);
  const marker = before ?? after;
  out.push({
    start: before ? before.start : at,
    end: after ? after.end : at + raw.length,
    value: read.value,
    decimals: read.decimals,
    marker: marker ? { codes: marker.codes } : null,
  });
}

/** Every number in one line of text read as an amount, with its marker, in reading order. */
export function findAmounts(line: string, exponent: number): AmountSpan[] {
  checkExponent(exponent);
  const out: AmountSpan[] = [];
  for (const m of line.matchAll(NUMBER)) pushNumber(line, m.index, m[0], exponent, out);
  return out;
}

/**
 * Amounts in `currency` (ISO code) in OCR words, in reading order, as minor units with `exponent`
 * decimals. A number counts when a marker for that currency is next to it, or when it has no marker
 * and a decimal part; bare whole numbers (years, times, references) and other currencies are skipped.
 * Handles `$412.50`, `412,50 €`, `USD 412.50`, `1,234.56`, `1.234,56` and `1 234,56`.
 */
export function parseAmounts(words: OcrWord[], currency: string, exponent: number): bigint[] {
  checkExponent(exponent);
  const cur = currency.toUpperCase();
  const out: bigint[] = [];
  for (const line of linesOf(words)) {
    for (const a of findAmounts(line.text, exponent)) {
      if (a.marker === null ? a.decimals : a.marker.codes.includes(cur)) out.push(a.value);
    }
  }
  return out;
}
