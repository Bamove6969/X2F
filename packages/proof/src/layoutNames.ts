// Names with no label (lead, 2026-11-12): payment apps show the payee as a big line near the top
// (Zelle, Cash App, Venmo) or as the caption under an avatar's initials (Wise, Revolut). Labels
// (nameLabels.ts) cannot find those, so the page's layout does, from the OCR word heights and
// positions. Best effort, like the rest of the detector (owner item 35): the sender always sees the
// blur and can add more by hand.
//
// Never the amount or the code: a candidate line has letters only (no digit, currency sign or @),
// and `detectSensitive` still blanks every kept character (amount, code, dates) before placing any
// region, as for every other class.
import { type OcrLine } from './ocr.js';

/** A big line is this many times the page's typical line height, or more. */
export const PROMINENT_RATIO = 1.3;
/** The first line counts as an avatar's caption from this size (its initials were not read). */
export const CAPTION_RATIO = 1.1;
/** "Near the top": the line starts within this share of the text's height, from its top. */
export const TOP_SHARE = 0.45;

/**
 * Words on payment screens that are never a person's name: headings, statuses, app and brand
 * names, the parts of "you sent", "money sent", "payment details". Lower case, accents folded.
 */
const NOT_NAME_WORDS = new Set(
  (
    'you your yours me my we our to from for of the a an and with by via on at in is was ' +
    'sent send sending paid pay paying payment payments payout transfer transferred transfers money cash ' +
    'complete completed success successful done received receive request requested pending processing ' +
    'confirmed confirmation scheduled instant standard total amount details detail receipt transaction ' +
    'status today yesterday app zelle venmo revolut wise paypal monzo chime bank account balance card ' +
    'debit credit view share back home new fee fees note memo reference ref date time order invoice ' +
    'deposit withdrawal exchange personal business direct message thanks thank hello hi welcome ' +
    'dollar dollars euro euros pound pounds usd eur gbp details summary activity wallet savings'
  ).split(' '),
);

/** A name-shaped word: letters (any script), with inner apostrophes, hyphens or a final period. */
const NAME_WORD = /^\p{L}[\p{L}\p{M}]*(?:['’-]\p{L}[\p{L}\p{M}]*)*\.?$/u;
const INITIALS = /^\p{Lu}{1,3}$/u;

function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Between `min` and `max` words, each name-shaped, starting upper case where the script has case, none an app word. */
function nameShaped(words: readonly string[], min: number, max: number): boolean {
  if (words.length < min || words.length > max) return false;
  return words.every((w) => {
    if (!NAME_WORD.test(w)) return false;
    const c = w.charAt(0);
    if (c !== c.toUpperCase()) return false; // a cased script in lower case: a sentence, not a name
    return !NOT_NAME_WORDS.has(fold(w).replace(/\.$/, ''));
  });
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

interface Geometry {
  height: number;
  y0: number;
  y1: number;
}

function geometry(l: OcrLine): Geometry {
  const ws = l.words.map((p) => p.word);
  return { height: median(ws.map((w) => w.y1 - w.y0)), y0: Math.min(...ws.map((w) => w.y0)), y1: Math.max(...ws.map((w) => w.y1)) };
}

/**
 * The indices (into `lines`) of lines that hold a payee's name with no label:
 * - a prominent name-shaped line near the top (Zelle, Cash App, Venmo);
 * - an avatar's initials and the caption under them that they abbreviate (both are returned);
 * - the first line, name-shaped and a little larger than the rest: an avatar's caption whose
 *   initials the OCR did not read (white letters on a coloured circle often are not).
 */
export function layoutNameLines(lines: readonly OcrLine[]): number[] {
  if (lines.length < 2) return [];
  const geo = lines.map(geometry);
  const typical = median(geo.map((g) => g.height));
  const top = Math.min(...geo.map((g) => g.y0));
  const bottom = Math.max(...geo.map((g) => g.y1));
  const limit = top + (bottom - top) * TOP_SHARE;
  const out = new Set<number>();
  lines.forEach((l, i) => {
    const words = l.words.map((p) => p.word.text.trim()).filter((t) => t.length > 0);
    const g = geo[i]!;
    // A big name near the top.
    if (typical > 0 && g.height >= typical * PROMINENT_RATIO && g.y0 <= limit && nameShaped(words, 2, 4)) out.add(i);
    // An avatar's caption whose initials were not read: the topmost line.
    if (typical > 0 && g.y0 === top && g.height >= typical * CAPTION_RATIO && nameShaped(words, 2, 4)) out.add(i);
    // An avatar: initials alone on their line, and the next line is the name they abbreviate.
    const next = lines[i + 1];
    if (words.length === 1 && INITIALS.test(words[0]!) && next) {
      const nextWords = next.words.map((p) => p.word.text.trim()).filter((t) => t.length > 0);
      const initials = nextWords.map((w) => w.charAt(0).toUpperCase()).join('');
      if (nameShaped(nextWords, 1, 4) && initials.startsWith(words[0]!) && words[0]!.length === Math.min(initials.length, 3)) {
        out.add(i);
        out.add(i + 1);
      }
    }
  });
  return [...out].sort((a, b) => a - b);
}
