// The smart proof check and the lines of the seller's proof card (Plan 5 Task 9, spec 4.2, P5-A28,
// board SellerConfirm). The seller's own app runs it on the OCR of the blurred image it decrypted
// (Task 16); nothing here trusts a value from the buyer except the `hidden` list it is given.
import { normalizeTradeCode } from '@x2f/core';
import { parseAmounts } from './amounts.js';
import { type HiddenKind, codePattern, detectSensitive, markDates, normalizeText } from './detect.js';
import { type OcrWord, linesOf } from './ocr.js';

/** What the screenshot shows next to what the trade expects (spec 4.2: amount, date, reference, payer name). */
export interface ProofCheck {
  readable: boolean;
  amount: { status: 'match' | 'mismatch' | 'not-found'; seen: bigint | null };
  reference: 'match' | 'not-found';
  date: 'in-range' | 'out-of-range' | 'not-found';
  name: 'hidden' | 'visible' | 'not-found';
}

/**
 * What the trade expects. `fiatCents` is the trade amount in minor units of `currency` with
 * `exponent` decimals; `earliest` is the day before `securedAt` and `latest` is now (the caller
 * passes both; this package reads no clock).
 */
export interface ProofExpected {
  fiatCents: bigint;
  currency: string;
  exponent: number;
  tradeCode: string;
  earliest: Date;
  latest: Date;
}

/**
 * The trade as the card shows it: the buyer's name, the total and the code as the caller writes them
 * on the screen. `currency` and `exponent` format the amount the screenshot shows on a mismatch
 * (the plan's `t` has no way to format it; technical call, Task 9).
 */
export interface CardTrade {
  buyer: string;
  total: string;
  code: string;
  currency: string;
  exponent: number;
}

export interface CardLine {
  tone: 'escrow' | 'caution';
  text: string;
}

/** OCR with fewer than this many words at `MIN_CONF` or better is unreadable. */
const MIN_WORDS = 3;
const MIN_CONF = 60;
const HOUR = 60 * 60 * 1000;

/**
 * Check OCR words from a proof screenshot against the trade. `readable` is false when fewer than 3
 * words have `conf >= 60`; an unreadable screenshot then reports nothing found (its name is still
 * `hidden` when the buyer hid one). The amount matches when any amount in the trade's currency is
 * the trade amount; otherwise `seen` is the first one in reading order. The reference matches the
 * trade code in any grouping or case, with Crockford look-alikes (O for 0, I or L for 1), as Task 7
 * keeps it. A date is in range when any reading of it is a day that overlaps `earliest..latest` in
 * some time zone (UTC-12 to UTC+14).
 */
export function checkProof(words: OcrWord[], expected: ProofExpected, hidden: HiddenKind[]): ProofCheck {
  const code = normalizeTradeCode(expected.tradeCode);
  if (code === null) throw new RangeError('expected.tradeCode is not a trade code');
  const earliest = expected.earliest.getTime();
  const latest = expected.latest.getTime();
  if (!Number.isFinite(earliest) || !Number.isFinite(latest) || earliest > latest) throw new RangeError('expected.earliest..latest is not a range');

  const nameHidden = hidden.includes('name');
  const readable = words.filter((w) => w.conf >= MIN_CONF && w.text.trim().length > 0).length >= MIN_WORDS;
  if (!readable) {
    return { readable, amount: { status: 'not-found', seen: null }, reference: 'not-found', date: 'not-found', name: nameHidden ? 'hidden' : 'not-found' };
  }

  const amounts = parseAmounts(words, expected.currency, expected.exponent);
  const amount: ProofCheck['amount'] = amounts.includes(expected.fiatCents)
    ? { status: 'match', seen: expected.fiatCents }
    : amounts.length > 0
      ? { status: 'mismatch', seen: amounts[0]! }
      : { status: 'not-found', seen: null };

  const texts = linesOf(words).map((l) => normalizeText(l.text));
  const codeRe = codePattern(code);
  const reference = texts.some((t) => [...t.matchAll(codeRe)].length > 0) ? 'match' : 'not-found';

  const days = texts.flatMap((t) => datesIn(t, new Date(latest).getUTCFullYear()));
  const date: ProofCheck['date'] =
    days.length === 0 ? 'not-found' : days.some((d) => d - 14 * HOUR <= latest && d + 24 * HOUR + 12 * HOUR >= earliest) ? 'in-range' : 'out-of-range';

  const name: ProofCheck['name'] = nameHidden
    ? 'hidden'
    : detectSensitive(words, { tradeCode: code, fiatCents: expected.fiatCents, exponent: expected.exponent }).some((r) => r.kind === 'name')
      ? 'visible'
      : 'not-found';

  return { readable, amount, reference, date, name };
}

// ---------------------------------------------------------------------------------------------
// Dates: Task 7's `markDates` finds them; this reads each found span as calendar days.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const MONTH_DAY = new RegExp(`${MONTH}\\.? (\\d{1,2})(?!\\d)(?:st|nd|rd|th)?(?:,? (\\d{4})(?!\\d))?`, 'gi');
const DAY_MONTH = new RegExp(`(?<!\\d)(\\d{1,2})(?:st|nd|rd|th)? ${MONTH}\\.?(?:,? (\\d{4})(?!\\d))?`, 'gi');
const ISO = /(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/g;
const NUMERIC = /(?<!\d)(\d{1,2})([-/.]|\. )(\d{1,2})\2(\d{4}|\d{2})(?!\d)/g;

/** Midnight UTC of a real calendar day, or null. */
function day(y: number, m: number, d: number): number | null {
  const t = Date.UTC(y, m - 1, d);
  const c = new Date(t);
  return c.getUTCFullYear() === y && c.getUTCMonth() === m - 1 && c.getUTCDate() === d ? t : null;
}

/**
 * Every calendar day (midnight UTC) the dates in a normalised line could mean. A numeric date reads
 * both ways round (day/month and month/day); a 2-digit year is 20yy; a date with no year is this
 * year or last year (`thisYear` from `latest`).
 */
function datesIn(text: string, thisYear: number): number[] {
  const keep: boolean[] = new Array<boolean>(text.length).fill(false);
  markDates(text, keep);
  const out: number[] = [];
  const push = (y: number | null, m: number, d: number): void => {
    for (const yy of y === null ? [thisYear, thisYear - 1] : [y]) {
      const t = day(yy, m, d);
      if (t !== null) out.push(t);
    }
  };
  let i = 0;
  while (i < text.length) {
    if (!keep[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < text.length && keep[j]) j++;
    const span = text.slice(i, j);
    i = j;
    const month = (s: string): number => MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1;
    for (const m of span.matchAll(MONTH_DAY)) push(m[3] ? Number(m[3]) : null, month(m[1]!), Number(m[2]));
    for (const m of span.matchAll(DAY_MONTH)) push(m[3] ? Number(m[3]) : null, month(m[2]!), Number(m[1]));
    for (const m of span.matchAll(ISO)) push(Number(m[1]), Number(m[2]), Number(m[3]));
    for (const m of span.matchAll(NUMERIC)) {
      const y = m[4]!.length === 2 ? 2000 + Number(m[4]) : Number(m[4]);
      push(y, Number(m[3]), Number(m[1]));
      push(y, Number(m[1]), Number(m[3]));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Card lines (board SellerConfirm). Board lines are exact; the rest carry `// COPY-UNSIGNED`.

/**
 * Minor units as money in `currency` with `exponent` decimals, written as the web app writes it
 * (`formatMinor` in apps/web/src/screens/quote/quoteModel.ts: en-US, the whole part formatted as a
 * bigint and the fraction written in by hand). 40000n USD → "$400.00".
 */
function formatMinor(minor: bigint, currency: string, exponent: number): string {
  const unit = 10n ** BigInt(exponent);
  const whole = minor / unit;
  const frac = (minor % unit).toString().padStart(exponent, '0');
  const nf = new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: exponent, maximumFractionDigits: exponent });
  return nf
    .formatToParts(whole)
    .map((p) => (p.type === 'fraction' ? frac : p.value))
    .join('');
}

/**
 * The card's lines in the board's order (amount, reference, name), then always the board's closing
 * line. An unreadable screenshot gets only the "couldn't read" line before it. No line is shown for
 * an amount or name that was not found, nor for the date (the plan gives no copy; PENDING LEAD).
 */
export function proofCardLines(c: ProofCheck, t: CardTrade): CardLine[] {
  const lines: CardLine[] = [];
  if (!c.readable) {
    // COPY-UNSIGNED
    lines.push({ tone: 'caution', text: "We couldn't read this screenshot" });
  } else {
    if (c.amount.status === 'match') {
      lines.push({ tone: 'escrow', text: `Shows ${t.total}, the right amount` });
    } else if (c.amount.status === 'mismatch' && c.amount.seen !== null) {
      // COPY-UNSIGNED
      lines.push({ tone: 'caution', text: `Shows ${formatMinor(c.amount.seen, t.currency, t.exponent)}, not ${t.total}` });
    }
    if (c.reference === 'match') {
      lines.push({ tone: 'escrow', text: `Note says ${t.code}, this trade's code` });
    } else {
      // COPY-UNSIGNED
      lines.push({ tone: 'caution', text: "This trade's code isn't in the note" });
    }
    if (c.name === 'hidden') {
      lines.push({ tone: 'caution', text: `Sender name hidden by ${t.buyer}` });
    } else if (c.name === 'visible') {
      // COPY-UNSIGNED (P5-A28)
      lines.push({ tone: 'caution', text: 'Shows a sender name. Check it matches the sender in your bank.' });
    }
  }
  // The board's closing line, always last. Its tone is a technical call: the board shows it as muted
  // text, and the type has only 'escrow' and 'caution'.
  lines.push({
    tone: 'caution',
    text: `Look for a ${t.total} payment with the note ${t.code} in your bank. Screenshot checks catch mistakes, but only your bank proves the money arrived.`,
  });
  return lines;
}
