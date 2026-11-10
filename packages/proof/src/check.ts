// The smart proof check and the lines of the seller's proof card (Plan 5 Task 9, spec 4.2, P5-A28,
// board SellerConfirm). The seller's own app runs it on the OCR of the blurred image it decrypted
// (Task 16); nothing here trusts a value from the buyer except the `hidden` list it is given and the
// photo's own time (`proof.attached` `photoTakenAt`), which is the buyer's claim: it can fill in a date
// the screenshot does not show, or make the proof out of range, but never clears a stale date the
// screenshot shows (`DATE_OUT_OF_RANGE_IF_EITHER`, review 2026-11-10 finding 2).
import { normalizeTradeCode } from '@x2f/core';
import { findAmounts, parseAmounts } from './amounts.js';
import { type HiddenKind, codePattern, markDates, normalizeText, showsWholeAmount } from './detect.js';
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
 * `hidden` when the buyer hid one). Every check reads the text after Task 7's `normalizeText`
 * (Unicode digits, dashes and spaces as ASCII). The amount matches when any amount in the trade's
 * currency is the trade amount, or when a line shows it as a whole number with no marker that Task 7
 * keeps clear (`showsWholeAmount`: after an amount label or on its own, review RV4-M4); otherwise `seen` is the amount closest to it (the first of a tie),
 * so a fee or `$0.00` is not reported (review N2). The reference matches the trade code in any
 * grouping or case, with Crockford look-alikes (O for 0, I or L for 1), as Task 7 keeps it, also
 * with spaces around its dashes and wrapped onto the next line (review N1). A date is in range when
 * any reading of it is a day that overlaps `earliest..latest` in some time zone (UTC-12 to UTC+14).
 * `takenAt` is the photo's own time from the poster's device (`proof.attached`, owner G16), combined
 * with the screenshot's dates by `combineDates` (out of range when either is; lead default pending
 * owner p11-140); with an unreadable screenshot it alone decides.
 * The name is `visible` only after a sender label (review N3, see `senderNameShown`).
 */
export function checkProof(words: OcrWord[], expected: ProofExpected, hidden: HiddenKind[], takenAt: Date | null = null): ProofCheck {
  const code = normalizeTradeCode(expected.tradeCode);
  if (code === null) throw new RangeError('expected.tradeCode is not a trade code');
  const { earliest, latest } = dateRange(expected);

  const nameHidden = hidden.includes('name');
  const readable = isReadable(words);
  if (!readable) {
    const date = combineDates(takenAt === null ? 'not-found' : photoDateStatus(takenAt, earliest, latest), 'not-found');
    return { readable, amount: { status: 'not-found', seen: null }, reference: 'not-found', date, name: nameHidden ? 'hidden' : 'not-found' };
  }

  const normalized = words.map((w) => ({ ...w, text: normalizeText(w.text) }));
  const texts = linesOf(normalized).map((l) => l.text);
  const amounts = parseAmounts(normalized, expected.currency, expected.exponent);
  // A whole amount with no marker that Task 7 keeps clear (`Total 250000`, owner Q17) is the amount
  // too, read by Task 7's own rule (review RV4-M4).
  const keep = { tradeCode: expected.tradeCode, fiatCents: expected.fiatCents, exponent: expected.exponent };
  if (!amounts.includes(expected.fiatCents) && texts.some((t, i) => showsWholeAmount(t, keep, texts[i - 1]))) amounts.push(expected.fiatCents);
  const amount: ProofCheck['amount'] = amounts.includes(expected.fiatCents)
    ? { status: 'match', seen: expected.fiatCents }
    : amounts.length > 0
      ? { status: 'mismatch', seen: closest(amounts, expected.fiatCents) }
      : { status: 'not-found', seen: null };

  const codeRe = codePattern(code);
  const reference = codeCandidates(texts).some((t) => hasMatch(t, codeRe)) ? 'match' : 'not-found';

  const date = combineDates(takenAt === null ? 'not-found' : photoDateStatus(takenAt, earliest, latest), screenshotDateStatus(texts, earliest, latest));

  const name: ProofCheck['name'] = nameHidden
    ? 'hidden'
    : senderNameShown(texts, codeRe, expected.exponent)
      ? 'visible'
      : 'not-found';

  return { readable, amount, reference, date, name };
}

function isReadable(words: OcrWord[]): boolean {
  return words.filter((w) => w.conf >= MIN_CONF && w.text.trim().length > 0).length >= MIN_WORDS;
}

function dateRange(w: { earliest: Date; latest: Date }): { earliest: number; latest: number } {
  const earliest = w.earliest.getTime();
  const latest = w.latest.getTime();
  if (!Number.isFinite(earliest) || !Number.isFinite(latest) || earliest > latest) throw new RangeError('expected.earliest..latest is not a range');
  return { earliest, latest };
}

/** The dates the screenshot shows: in range when any reading is a day that overlaps the window in some zone. */
function screenshotDateStatus(texts: string[], earliest: number, latest: number): ProofCheck['date'] {
  const days = texts.flatMap((t) => datesIn(t, new Date(latest).getUTCFullYear()));
  if (days.length === 0) return 'not-found';
  return days.some((d) => d - 14 * HOUR <= latest && d + 24 * HOUR + 12 * HOUR >= earliest) ? 'in-range' : 'out-of-range';
}

/**
 * The photo's own time (owner G16), a UTC instant: in range within 14 hours of the window either
 * side, the same zone slack the screenshot's dates get (a photo with no offset of its own was turned
 * into UTC with the poster's device zone, which may not be the bank's).
 */
function photoDateStatus(takenAt: Date, earliest: number, latest: number): ProofCheck['date'] {
  const t = takenAt.getTime();
  if (!Number.isFinite(t)) return 'not-found';
  return t >= earliest - 14 * HOUR && t <= latest + 14 * HOUR ? 'in-range' : 'out-of-range';
}

/**
 * Lead default pending owner p11-140 (review 2026-11-10 finding 2): the proof is out of range when
 * EITHER the photo's own time or a date on the screenshot is out of range; the photo's time decides
 * only when the screenshot shows no date. A fresh metadata time is trivial to get for an old receipt
 * (screenshot it again, photograph the screen, crop it), and on the seller's side it is the buyer's
 * claim. `false` would restore the 7 Nov build (the photo's time, when there is one, overrides).
 */
export const DATE_OUT_OF_RANGE_IF_EITHER = true;

/** One date verdict from the photo's own time and the screenshot's dates (see `DATE_OUT_OF_RANGE_IF_EITHER`). */
function combineDates(photo: ProofCheck['date'], screenshot: ProofCheck['date']): ProofCheck['date'] {
  if (!DATE_OUT_OF_RANGE_IF_EITHER) return photo !== 'not-found' ? photo : screenshot;
  if (photo === 'out-of-range' || screenshot === 'out-of-range') return 'out-of-range';
  if (photo === 'in-range' || screenshot === 'in-range') return 'in-range';
  return 'not-found';
}

/**
 * The proof's date as the poster's device sees it before posting (owner G16, Q42): the photo's own
 * time (`takenAt`, from `readPhotoTime`, in UTC) and the dates OCR reads on the screenshot, combined
 * as `checkProof` combines them, so both always give the same verdict. `earliest` and `latest` are
 * `checkProof`'s. `'not-found'`: the poster is warned and may still post (`posterDateLine`);
 * `'out-of-range'`: the send is blocked by item 63's pop-up (Q42).
 */
export function proofDate(words: OcrWord[], takenAt: Date | null, w: { earliest: Date; latest: Date }): ProofCheck['date'] {
  const { earliest, latest } = dateRange(w);
  const photo = takenAt === null ? 'not-found' : photoDateStatus(takenAt, earliest, latest);
  if (!isReadable(words)) return combineDates(photo, 'not-found');
  const texts = linesOf(words.map((x) => ({ ...x, text: normalizeText(x.text) }))).map((l) => l.text);
  return combineDates(photo, screenshotDateStatus(texts, earliest, latest));
}

function hasMatch(text: string, re: RegExp): boolean {
  return [...text.matchAll(re)].length > 0;
}

/** The amount closest to `want`; the first in reading order wins a tie. */
function closest(amounts: bigint[], want: bigint): bigint {
  const dist = (a: bigint): bigint => (a > want ? a - want : want - a);
  return amounts.reduce((best, a) => (dist(a) < dist(best) ? a : best));
}

/**
 * The texts the trade code is looked for in: each line, and each pair of consecutive lines joined
 * with nothing and with a space (a memo wrapped onto the next line), with spaces around dashes
 * dropped (`K7M2 - 9QXA - ...`). Review N1.
 */
function codeCandidates(texts: string[]): string[] {
  const out = [...texts];
  for (let i = 0; i + 1 < texts.length; i++) out.push(texts[i]! + texts[i + 1]!, `${texts[i]!} ${texts[i + 1]!}`);
  return out.map((t) => t.replace(/\s*-\s*/g, '-'));
}

// Sender labels only (review N3): a recipient label (`To`, `Paid to`, `Recipient`, ...) names the
// seller, not the sender. Matched like Task 7's name labels (at the start of a line with or without a
// colon, or later in the line with a colon), but English only on purpose: Task 7's labels are
// multilingual data (`nameLabels.ts`), and a name after a foreign label is auto-blurred anyway, so the
// OCR of the blurred image cannot read it (review RV4-M4 nit).
const SENDER = ['sent\\s+by', 'sender', 'payer', 'from'].join('|');
const SENDER_START = new RegExp(`^\\s*(?:${SENDER})(?::|(?=\\s)|$)\\s*`, 'i');
const SENDER_COLON = new RegExp(`(?<![A-Za-z])(?:${SENDER}):\\s*`, 'gi');

/** Text left after blanking the trade code, amounts (with a marker or decimals) and dates. */
function residue(text: string, codeRe: RegExp, exponent: number): { rest: string; hadKept: boolean } {
  const keep: boolean[] = new Array<boolean>(text.length).fill(false);
  markDates(text, keep);
  for (const m of text.matchAll(codeRe)) keep.fill(true, m.index, m.index + m[0].length);
  for (const a of findAmounts(text, exponent)) if (a.marker !== null || a.decimals) keep.fill(true, a.start, a.end);
  return { rest: [...text].map((c, i) => (keep[i] ? ' ' : c)).join(''), hadKept: keep.some(Boolean) };
}

const LETTER = /\p{L}/u;

/**
 * Whether the screenshot shows a sender's name: letters after a sender label on its line, or, for a
 * label alone on its line, a next line with letters and no trade code, amount or date (a lone `From:`
 * whose name the buyer blurred by hand is followed by the memo or the amount, not a name).
 */
function senderNameShown(texts: string[], codeRe: RegExp, exponent: number): boolean {
  return texts.some((t, i) => {
    const starts: number[] = [];
    const m = SENDER_START.exec(t);
    if (m) starts.push(m[0].length);
    for (const c of t.matchAll(SENDER_COLON)) starts.push(c.index + c[0].length);
    return starts.some((at) => {
      if (at < t.trimEnd().length) return LETTER.test(residue(t.slice(at), codeRe, exponent).rest);
      if (at !== m?.[0].length) return false;
      const next = texts[i + 1];
      if (next === undefined) return false;
      const r = residue(next, codeRe, exponent);
      return !r.hadKept && LETTER.test(r.rest);
    });
  });
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
 * year, last year or next year (`thisYear` from `latest`).
 */
function datesIn(text: string, thisYear: number): number[] {
  const keep: boolean[] = new Array<boolean>(text.length).fill(false);
  markDates(text, keep);
  const out: number[] = [];
  const push = (y: number | null, m: number, d: number): void => {
    // No year: this year, or last or next year around New Year (reviews N4, N5).
    for (const yy of y === null ? [thisYear, thisYear - 1, thisYear + 1] : [y]) {
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
 * The card's lines in the board's order (amount, reference, name), then the date line, then always
 * the board's closing line. An unreadable screenshot gets only the "couldn't read" line and the date
 * line before it. No line is shown for an amount or name that was not found, nor for a date in range.
 * The date line (owner G16, Q42): a date that could not be found warns the seller to take extra care
 * without calling the proof invalid; a date outside the trade asks for a fresh screenshot.
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
  const date = sellerDateLine(c.date, t.buyer);
  if (date !== null) lines.push(date);
  // The board's closing line, always last. Its tone is a technical call: the board shows it as muted
  // text, and the type has only 'escrow' and 'caution'.
  lines.push({
    tone: 'caution',
    text: `Look for a ${t.total} payment with the note ${t.code} in your bank. Screenshot checks catch mistakes, but only your bank proves the money arrived.`,
  });
  return lines;
}

// TODO(design): the date lines below are placeholders until the designer words them (owner G16).

function sellerDateLine(date: ProofCheck['date'], buyer: string): CardLine | null {
  if (date === 'not-found') {
    // COPY-UNSIGNED (owner G16)
    return { tone: 'caution', text: "We couldn't confirm when this proof was made. That doesn't make it invalid, but take extra care with this trade." };
  }
  if (date === 'out-of-range') {
    // COPY-UNSIGNED (owner Q42)
    return { tone: 'caution', text: `This proof is dated outside this trade. Ask ${buyer} for a fresh screenshot.` };
  }
  return null;
}

/**
 * The poster's line about the proof's date before posting (`proofDate`), or null when it is in range.
 * No date found: posting stays allowed (owner G16). Out of range: the send is blocked (item 63's
 * `ProofNotCurrent`, Q42 "No, ask for a fresh screenshot"; lead default pending owner p11-143), and
 * this line says why.
 */
export function posterDateLine(date: ProofCheck['date']): CardLine | null {
  if (date === 'not-found') {
    // COPY-UNSIGNED (owner G16)
    return { tone: 'caution', text: "We couldn't detect the date of this proof. You can still post it, and the seller will be told to take extra care." };
  }
  if (date === 'out-of-range') {
    // COPY-UNSIGNED (owner Q42; lead default pending owner p11-143: the send is blocked)
    return { tone: 'caution', text: 'This screenshot is dated outside this trade. Take a fresh screenshot of the payment.' };
  }
  return null;
}
