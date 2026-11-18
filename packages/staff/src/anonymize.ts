import { normalizeTradeCode } from '@x2f/core';

/**
 * Plan 4 Task 19: the training library's anonymizer. Pure, and it runs in the browser too: under
 * the chat key-membership design (design-chat-membership-keys-2026-11-08, Q12) the chat is
 * decrypted and scrubbed in the staff member's own browser, never on a server; the API scrubs the
 * texts it already holds (the dispute note, the rulings' reasons, the appeal).
 *
 * Revision 2026-10-29b: no separate copy is stored. A closed case is shown through these masks.
 *
 * Review 2026-11-18 (M1-M3): over-masking is fine, under-masking is not. What it does to a text:
 * - normalizes it first: NFKC, then every default-ignorable character removed (zero-width
 *   characters, the soft hyphen, the word joiner, variation selectors...). The output is this
 *   normalized text;
 * - matches on a skeleton of it (never shown): Cyrillic and Greek look-alikes folded to Latin
 *   (`mirа.k` with a Cyrillic а is `mira.k`), and every run of whitespace one space;
 * - replaces the traders' names with "Buyer" and "Seller" and staff names with "Moderator",
 *   case-insensitively, with `.`, `_`, `-` and space interchangeable between a name's parts
 *   (`mira_k`, `mira k` and `Mira\nKowal` all match), never inside a longer word (`admira.kx`
 *   stays), but with a short letter suffix (up to 2 letters) after a name of 4 or more characters
 *   (`Miras`, `mira.kx`): lead call on the review's owner question 1;
 * - replaces the case's own trade code written with any separators (`FTYB.J3ZD.7MCZ.WKRA`,
 *   `FTYBJ3ZD/7MCZWKRA`), even glued to a word, and any other grouped code, with `XXXX-XXXX-XXXX-XXXX`;
 * - masks Monero addresses (95 characters starting 4 or 8, or a test network's 5, 7, 9, A or B;
 *   106-character integrated addresses), also split by any short run of punctuation or spaces
 *   (`-`, a line break, `> ` of a quoted line) or glued to a word, as `[address]`; 64-hex
 *   transaction ids (also `0x...` or split) as `[tx]`; 16-hex payment ids as `[payment id]`;
 *   40-hex PGP fingerprints (spaced or not) as `[fingerprint]`;
 * - masks IBANs as `[account]`, Luhn-valid 13 to 19 digit card numbers (spaces, dashes or dots) as
 *   `[card]`, email addresses and Jabber ids (also `name at host dot de`, `[at]`, `(dot)`, with a
 *   resource) as `[email]`, phone numbers of 7 to 15 digits (spaces, dots, dashes, slashes,
 *   brackets) as `[phone]`, URLs (with a scheme, `www.`, a path, or a common top-level domain) as
 *   `[link]`, `@handles` as `[handle]`, and IPv4 (also `a.b.c` and with a port) and IPv6 addresses
 *   as `[ip]`.
 * Free text can still name a payer the masks do not know (Review Focus 5): every mask is listed, so
 * the page can highlight them, and `manual` masks can be added over the output.
 */

export type MaskKind = 'address' | 'account' | 'card' | 'email' | 'phone' | 'tx' | 'payment-id' | 'fingerprint' | 'link' | 'handle' | 'ip' | 'manual';

/** Where a mask sits in the anonymized text (UTF-16 offsets, end exclusive). */
export interface Mask {
  start: number;
  end: number;
  kind: MaskKind;
}

export interface Scrubbed {
  text: string;
  masks: Mask[];
}

/** The names to replace: each list may hold a public display name and a login name. */
export interface AnonymizeNames {
  buyer: readonly string[];
  seller: readonly string[];
  staff: readonly string[];
}

export const TRADE_CODE_MASK = 'XXXX-XXXX-XXXX-XXXX';
// The mask labels are shown on the training pages. COPY-UNSIGNED
const LABEL: Readonly<Record<Exclude<MaskKind, 'manual'>, string>> = {
  address: '[address]',
  account: '[account]',
  card: '[card]',
  email: '[email]',
  phone: '[phone]',
  tx: '[tx]',
  'payment-id': '[payment id]',
  fingerprint: '[fingerprint]',
  link: '[link]',
  handle: '[handle]',
  ip: '[ip]',
};
/** What a manual mask shows in place of the text it covers. */
export const MANUAL_MASK = '[hidden]';

const IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;
const WORD = /[\p{L}\p{N}_]/u;
const ALNUM = /[\p{L}\p{N}]/u;
const SPACE = /\s/u;

/**
 * Cyrillic and Greek letters that look like Latin ones, folded for matching only (each one UTF-16
 * unit to one). Latin look-alikes NFKC leaves alone (dotless i, script a) too.
 */
const CONFUSABLE: Readonly<Record<string, string>> = Object.fromEntries(
  [
    // Cyrillic lower case
    'аa', 'вb', 'еe', 'ёe', 'һh', 'іi', 'їi', 'јj', 'кk', 'ӏl', 'мm', 'нh', 'оo', 'рp', 'сc', 'тt', 'уy', 'ўy', 'хx', 'ѕs', 'ԁd', 'ԛq', 'ԝw', 'ьb', 'ѵv', 'үy', 'ғf', 'ɡg',
    // Cyrillic upper case
    'АA', 'ВB', 'ЕE', 'ЁE', 'ҺH', 'ІI', 'ЇI', 'ЈJ', 'КK', 'ӀI', 'МM', 'НH', 'ОO', 'РP', 'СC', 'ТT', 'УY', 'ХX', 'ЅS', 'ԚQ', 'ԜW', 'ҮY', 'ѴV',
    // Greek lower case
    'αa', 'βb', 'γy', 'εe', 'ηn', 'ιi', 'κk', 'νv', 'οo', 'ρp', 'σo', 'τt', 'υu', 'χx', 'ωw', 'ϲc', 'ϳj', 'ϱp', 'ϵe',
    // Greek upper case
    'ΑA', 'ΒB', 'ΕE', 'ΖZ', 'ΗH', 'ΙI', 'ΚK', 'ΜM', 'ΝN', 'ΟO', 'ΡP', 'ΤT', 'ΥY', 'ΧX', 'ϹC', 'ϒY', 'ϺM',
    // Latin look-alikes
    'ıi', 'ȷj', 'ɑa', 'ɩi', 'ʟL', 'ɪI',
  ].map((p) => [p[0]!, p[1]!]),
);

/** NFKC with every default-ignorable character removed (twice: NFKC can recompose across one). */
function normalizeText(t: string): string {
  return t.normalize('NFKC').replace(IGNORABLE, '').normalize('NFKC').replace(IGNORABLE, '');
}

/** The matching skeleton of a normalized text, and where each of its units came from. */
interface Skeleton {
  s: string;
  /** For each unit of `s`: the start and end (exclusive) of what it stands for in the text. */
  from: number[];
  to: number[];
}

function skeleton(t: string): Skeleton {
  let s = '';
  const from: number[] = [];
  const to: number[] = [];
  for (let i = 0; i < t.length; ) {
    if (SPACE.test(t[i]!)) {
      let j = i;
      while (j < t.length && SPACE.test(t[j]!)) j++;
      s += ' ';
      from.push(i);
      to.push(j);
      i = j;
      continue;
    }
    s += CONFUSABLE[t[i]!] ?? t[i]!;
    from.push(i);
    to.push(i + 1);
    i++;
  }
  return { s, from, to };
}

interface Span {
  start: number;
  end: number;
  /** The text put in its place. */
  out: string;
  /** Set for a mask (listed in `masks`); unset for a name or a trade code. */
  kind?: Exclude<MaskKind, 'manual'>;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const NAME_SEP = '[._\\- ]{0,3}';

function nameSpans(text: string, names: AnonymizeNames): Span[] {
  const out: Span[] = [];
  const lists: Array<[readonly string[], string]> = [
    [names.buyer, 'Buyer'],
    [names.seller, 'Seller'],
    [names.staff, 'Moderator'],
  ];
  for (const [list, word] of lists) {
    for (const raw of list) {
      const parts = skeleton(normalizeText(raw)).s.split(/[._\- ]+/).filter((p) => p !== '');
      const letters = parts.join('').length;
      if (letters < 2) continue;
      // Never inside a longer word: the characters on either side are not letters, digits or _.
      // A name of 4 or more characters may carry a suffix of up to 2 letters ("Miras").
      const suffix = letters >= 4 ? '\\p{L}{0,2}' : '';
      const re = new RegExp(`(?<![\\p{L}\\p{N}_])${parts.map(escapeRe).join(NAME_SEP)}${suffix}(?![\\p{L}\\p{N}_])`, 'giu');
      for (const m of text.matchAll(re)) out.push({ start: m.index, end: m.index + m[0].length, out: word });
    }
  }
  return out;
}

/** One character of a known trade code, as the text may hold it (Crockford: O is 0, I and L are 1). */
function codeChar(c: string): string {
  if (c === '0') return '[0Oo]';
  if (c === '1') return '[1IiLl]';
  return /[A-Z]/.test(c) ? `[${c}${c.toLowerCase()}]` : c;
}

function tradeCodeSpans(text: string, known: ReadonlySet<string>): Span[] {
  const out: Span[] = [];
  // The case's own codes: their 16 characters with up to 3 separators of any kind between any two,
  // even glued to a word (a known code is 80 random bits: it does not occur by chance).
  for (const code of known) {
    const re = new RegExp(code.replace(/-/g, '').split('').map(codeChar).join('[^\\p{L}\\p{N}]{0,3}'), 'gu');
    for (const m of text.matchAll(re)) out.push({ start: m.index, end: m.index + m[0].length, out: TRADE_CODE_MASK });
  }
  // Grouped with dashes or spaces, or 16 in a row. Tried at every word start (a zero-width match
  // with a capture), so "Also 3HW8-…" is not swallowed by a candidate starting at "Also".
  for (const w of text.matchAll(/(?<![\p{L}\p{N}_])(?=([0-9A-Za-z]{4}(?:[- ]?[0-9A-Za-z]{4}){3})(?![\p{L}\p{N}_]))/gu)) {
    const m = { index: w.index, 0: w[1]! };
    const code = normalizeTradeCode(m[0]);
    if (code === null) continue;
    // Any other code needs letters and digits, and dashes or upper case (a card number or a long
    // word is not a code).
    const mixed = /\d/.test(m[0]) && /[A-Za-z]/.test(m[0]);
    const plausible = known.has(code) || (mixed && (/^[0-9A-Za-z]{4}(?:-[0-9A-Za-z]{4}){3}$/.test(m[0]) || /^[0-9A-Z]{16}$/.test(m[0])));
    if (plausible) out.push({ start: m.index, end: m.index + m[0].length, out: TRADE_CODE_MASK });
  }
  return out;
}

const BASE58_RUN = /[1-9A-HJ-NP-Za-km-z]+/g;
/** First characters of a 95-character address: mainnet 4 and 8 (the plan's), and the stagenet (5, 7) and testnet (9, A, B) ones, masked as well. */
const NETWORK_FIRST = '4857' + '9AB';
/** First characters of a 106-character integrated address: mainnet 4, stagenet 5, testnet A. */
const INTEGRATED_FIRST = '45A';
/** The most characters between two pieces of one split address: punctuation and spaces only. */
const ADDRESS_GAP = 3;

/** Prefix counts of digits, upper and lower case letters, so a window's mix is read in constant time. */
function mixCounts(chars: string): { d: number[]; u: number[]; l: number[] } {
  const d = [0];
  const u = [0];
  const l = [0];
  for (const c of chars) {
    const isD = c >= '0' && c <= '9';
    const isU = c >= 'A' && c <= 'Z';
    d.push(d[d.length - 1]! + (isD ? 1 : 0));
    u.push(u[u.length - 1]! + (isU ? 1 : 0));
    l.push(l[l.length - 1]! + (!isD && !isU ? 1 : 0));
  }
  return { d, u, l };
}

/** Whether chars[k..e] looks like a random base58 string: digits, upper and lower case. */
function looksRandom(mix: ReturnType<typeof mixCounts>, k: number, e: number): boolean {
  return mix.d[e + 1]! - mix.d[k]! >= 3 && mix.u[e + 1]! - mix.u[k]! >= 8 && mix.l[e + 1]! - mix.l[k]! >= 8;
}

/**
 * Monero addresses: 95 characters (NETWORK_FIRST) or 106 (INTEGRATED_FIRST), in pieces joined across
 * up to ADDRESS_GAP characters that are neither letters nor digits. First the exact ones (whole
 * pieces, a word on each side); then, over what is left, any stretch that looks random, glued to a
 * word or not, masked out to the ends of the pieces it touches.
 */
function addressSpans(text: string): Span[] {
  const pieces = [...text.matchAll(BASE58_RUN)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
  const out: Span[] = [];
  let p = 0;
  while (p < pieces.length) {
    // One stream: pieces joined by short gaps of punctuation or spaces.
    let q = p;
    while (q + 1 < pieces.length) {
      const gap = text.slice(pieces[q]!.end, pieces[q + 1]!.start);
      if (gap.length > ADDRESS_GAP || ALNUM.test(gap)) break;
      q++;
    }
    const pos: number[] = [];
    const pieceOf: number[] = [];
    for (let k = p; k <= q; k++) {
      for (let i = pieces[k]!.start; i < pieces[k]!.end; i++) {
        pos.push(i);
        pieceOf.push(k);
      }
    }
    const chars = pos.map((i) => text[i]!).join('');
    const covered = new Array<boolean>(chars.length).fill(false);
    const lengths = (first: string) => (INTEGRATED_FIRST.includes(first) ? [106, 95] : [95]);
    // Exact: starts a piece and a word, ends a piece and a word.
    for (let k = 0; k < chars.length; k++) {
      if (!NETWORK_FIRST.includes(chars[k]!)) continue;
      const piece = pieces[pieceOf[k]!]!;
      if (pos[k] !== piece.start || (piece.start > 0 && WORD.test(text[piece.start - 1]!))) continue;
      for (const len of lengths(chars[k]!)) {
        const e = k + len - 1;
        if (e >= chars.length) continue;
        const endPiece = pieces[pieceOf[e]!]!;
        if (pos[e]! + 1 !== endPiece.end || (endPiece.end < text.length && WORD.test(text[endPiece.end]!))) continue;
        out.push({ start: pos[k]!, end: pos[e]! + 1, out: LABEL.address, kind: 'address' });
        covered.fill(true, k, e + 1);
        k = e;
        break;
      }
    }
    // Looks random: any window over characters not already masked, to the ends of its pieces.
    const windows: Array<{ start: number; end: number }> = [];
    const mix = mixCounts(chars);
    const cov = [0];
    for (const c of covered) cov.push(cov[cov.length - 1]! + (c ? 1 : 0));
    for (let k = 0; k < chars.length; k++) {
      if (covered[k] || !NETWORK_FIRST.includes(chars[k]!)) continue;
      for (const len of lengths(chars[k]!)) {
        const e = k + len - 1;
        if (e >= chars.length || cov[e + 1]! - cov[k]! > 0 || !looksRandom(mix, k, e)) continue;
        windows.push({ start: pieces[pieceOf[k]!]!.start, end: pieces[pieceOf[e]!]!.end });
      }
    }
    windows.sort((a, b) => a.start - b.start);
    const merged: Array<{ start: number; end: number }> = [];
    for (const w of windows) {
      const last = merged[merged.length - 1];
      if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
      else merged.push({ ...w });
    }
    for (const w of merged) out.push({ start: w.start, end: w.end, out: LABEL.address, kind: 'address' });
    p = q + 1;
  }
  return out;
}

function luhn(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

function ibanValid(raw: string): boolean {
  const s = raw.replace(/\s/g, '').toUpperCase();
  if (s.length < 15 || s.length > 34 || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
}

/** Common top-level domains: a bare `name.tld` with one of these is a link even without a path. */
const TLDS =
  'com|net|org|info|biz|io|me|co|app|dev|xyz|online|site|page|link|top|club|onion|i2p|de|uk|ru|ua|by|kz|pl|fr|es|it|pt|nl|be|ch|at|se|no|fi|dk|cz|sk|hu|ro|bg|gr|tr|eu|us|ca|mx|br|ar|in|jp|cn|kr|au|nz|za|ng|cc|tv|ly|gg|so|to|su|im|is|li|lu|ws|pro|chat|social';
const URL_END = /[.,;:!?'")\]}>]+$/;
const LOCAL = '[\\p{L}\\p{N}._%+\\-]+';
const LABEL_PART = '[\\p{L}\\p{N}\\-]+';
const OPEN = '[\\[({<]';
const CLOSE = '[\\])}>]';
/** `@` (spaced on both sides or neither), `[at]`, `(at)`, `{@}`... */
const AT_STRONG = `(?:@| @ | ?${OPEN} ?(?:at|@) ?${CLOSE} ?)`;
/** `.`, ` . `, `[dot]`, `(.)`, ` dot `. */
const DOT = `(?:\\.| \\. | ?${OPEN} ?(?:dot|\\.) ?${CLOSE} ?| dot )`;
const RESOURCE = '(?:/[\\p{L}\\p{N}._\\-]+)?';
/** An email or Jabber id, `@` or bracketed `at` (with a resource). */
const EMAIL_STRONG = new RegExp(`(?<![\\p{L}\\p{N}._%+\\-])${LOCAL}${AT_STRONG}${LABEL_PART}(?:${DOT}${LABEL_PART})*${DOT}\\p{L}{2,}${RESOURCE}`, 'giu');
/** `name at host dot de`: a spelled-out `at` and at least one dot. */
const EMAIL_WORDS = new RegExp(`(?<![\\p{L}\\p{N}_.%+\\-])${LOCAL} at ${LABEL_PART}(?:${DOT}${LABEL_PART})*${DOT}\\p{L}{2,}${RESOURCE}(?![\\p{L}\\p{N}])`, 'giu');

function ipv6Valid(raw: string): boolean {
  const s = raw.replace(/^\[|\]$/g, '');
  if (!/[0-9A-Fa-f]/.test(s)) return false;
  const doubles = s.split('::').length - 1;
  if (doubles > 1) return false;
  const groups = s.split(':').filter((g) => g !== '');
  if (groups.some((g) => !/^[0-9A-Fa-f]{1,4}$/.test(g) && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(g))) return false;
  return doubles === 1 ? groups.length <= 7 : groups.length >= 4 && groups.length <= 8;
}

function patternSpans(text: string): Span[] {
  const out: Span[] = [];
  const add = (re: RegExp, kind: Exclude<MaskKind, 'manual' | 'address'>, ok: (m: string) => boolean = () => true, trim?: RegExp) => {
    for (const m of text.matchAll(re)) {
      const v = trim ? m[0].replace(trim, '') : m[0];
      if (v !== '' && ok(v)) out.push({ start: m.index, end: m.index + v.length, out: LABEL[kind], kind });
    }
  };
  // A tx id: 64 hex, optionally 0x, possibly split by up to 3 characters of punctuation or space.
  add(/(?<![\p{L}\p{N}_])(?:0[xX])?[0-9a-fA-F](?:[^\p{L}\p{N}]{0,3}[0-9a-fA-F]){63}(?![\p{L}\p{N}_])/gu, 'tx');
  // A PGP fingerprint: 40 hex, in groups of 4 with spaces or colons, or not.
  add(/(?<![\p{L}\p{N}_])(?:0[xX])?[0-9a-fA-F]{4}(?:[ :]?[0-9a-fA-F]{4}){9}(?![\p{L}\p{N}_])/gu, 'fingerprint');
  add(EMAIL_STRONG, 'email');
  add(EMAIL_WORDS, 'email');
  // Links: with a scheme, `www.`, a host with a path, or a host under a common top-level domain.
  add(/(?<![\p{L}\p{N}_])(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>"']+/giu, 'link', () => true, URL_END);
  add(/(?<![\p{L}\p{N}_@.\-])(?:[\p{L}\p{N}\-]+\.)+\p{L}{2,}(?::\d{1,5})?\/[^\s<>"']*/gu, 'link', () => true, URL_END);
  add(new RegExp(`(?<![\\p{L}\\p{N}_@.\\-])(?:[\\p{L}\\p{N}\\-]+\\.)+(?:${TLDS})(?::\\d{1,5})?(?![\\p{L}\\p{N}_\\-])`, 'giu'), 'link');
  add(/(?<![\p{L}\p{N}_.@])@[\p{L}\p{N}_](?:[\p{L}\p{N}_.]*[\p{L}\p{N}_])?/gu, 'handle');
  // IPv4, also the short a.b.c form, with an optional port; and IPv6 (with :: or 4 or more groups).
  add(/(?<![\p{N}.])\d{1,3}(?:\.\d{1,3}){2,3}(?::\d{1,5})?(?!\p{N}|\.\d)/gu, 'ip');
  add(/(?<![\p{L}\p{N}_:.])\[?(?:[0-9A-Fa-f]{0,4}:){2,7}(?:[0-9A-Fa-f]{1,4}|\d{1,3}(?:\.\d{1,3}){3})?\]?(?![\p{L}\p{N}_:])/gu, 'ip', ipv6Valid);
  // An IBAN, spaced in groups or not: the longest prefix of the run that passes the mod-97 check
  // (a run can swallow the next word, "DE89 3704 0044 0532 0130 00 please").
  for (const m of text.matchAll(/(?<![\p{L}\p{N}_])[A-Za-z]{2}\d{2}(?: ?[A-Za-z0-9]){11,40}/gu)) {
    for (let e = m[0].length; e >= 15; e--) {
      const sub = m[0].slice(0, e);
      const next = text[m.index + e];
      if (sub.endsWith(' ') || (next !== undefined && WORD.test(next))) continue;
      if (ibanValid(sub)) {
        out.push({ start: m.index, end: m.index + e, out: LABEL.account, kind: 'account' });
        break;
      }
    }
  }
  add(/(?<![\p{N}])\d(?:[ .-]?\d){12,18}(?![\p{N}])/gu, 'card', (m) => {
    const d = m.replace(/\D/g, '');
    return d.length >= 13 && d.length <= 19 && luhn(d);
  });
  // A payment id: 16 hex (after the card check, so a card number shows as a card).
  add(/(?<![\p{L}\p{N}_])(?:0[xX])?[0-9a-fA-F]{16}(?![\p{L}\p{N}_])/gu, 'payment-id');
  // A phone number: an optional +, then digits with spaces, dots, dashes, slashes or brackets, 7 to 15 digits.
  add(/(?<![\p{L}\p{N}_.,])(?:\+|\(\+?)?\d[\d ()./-]{5,}\d(?![\p{L}\p{N}_])/gu, 'phone', (m) => {
    const d = m.replace(/\D/g, '').length;
    const t = m.trim();
    // A decimal amount ("1.25", "1,320.00") is not a phone number.
    if (/^\d+\.\d{1,2}$/.test(t)) return false;
    // Nor is a date (2026-11-02, 02.11.2026, 2/11/2026).
    if (/^\d{4}-\d{2}-\d{2}$/.test(t) || /^\d{1,2}[./]\d{1,2}[./]\d{2,4}$/.test(t) || /^\d{4}[./]\d{1,2}[./]\d{1,2}$/.test(t)) return false;
    return d >= 7 && d <= 15;
  });
  return out;
}

/**
 * Chooses spans that do not overlap: the earliest first, the longer one on a tie; a mask beats a
 * name or code of the same length (an email holding the username is masked whole). Two spans that
 * overlap become one covering both (nothing of either is left showing), shown as the mask if
 * either is one, else as the longer.
 */
function pick(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start) || (a.kind ? -1 : 1) - (b.kind ? -1 : 1));
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start < last.end) {
      if (s.end > last.end) {
        const longer = s.end - s.start > last.end - last.start ? s : last;
        const shown = last.kind && s.kind ? longer : last.kind ? last : s.kind ? s : longer;
        out[out.length - 1] = { start: last.start, end: s.end, out: shown.out, ...(shown.kind ? { kind: shown.kind } : {}) };
      }
      continue;
    }
    out.push(s);
  }
  return out;
}

/** Scrubs one text (see the module comment). `tradeCodes` are the case's own codes, in any form. */
export function anonymizeText(text: string, names: AnonymizeNames, tradeCodes: readonly string[] = []): Scrubbed {
  const clean = normalizeText(text);
  const sk = skeleton(clean);
  const known = new Set(tradeCodes.map((c) => normalizeTradeCode(c)).filter((c): c is string => c !== null));
  const found = pick([...addressSpans(sk.s), ...patternSpans(sk.s), ...tradeCodeSpans(sk.s, known), ...nameSpans(sk.s, names)]);
  // Back from the skeleton to the normalized text.
  const spans = found.map((s) => ({ ...s, start: sk.from[s.start]!, end: sk.to[s.end - 1]! }));
  let out = '';
  let at = 0;
  const masks: Mask[] = [];
  for (const s of spans) {
    out += clean.slice(at, s.start);
    if (s.kind) masks.push({ start: out.length, end: out.length + s.out.length, kind: s.kind });
    out += s.out;
    at = s.end;
  }
  out += clean.slice(at);
  return { text: out, masks };
}

/**
 * Adds manual masks over an already scrubbed text (offsets into it): each covered stretch becomes
 * `[hidden]`. Overlapping or out-of-range masks are refused (RangeError), as is one cutting into an
 * automatic mask.
 */
export function applyManualMasks(s: Scrubbed, manual: readonly { start: number; end: number }[]): Scrubbed {
  const sorted = [...manual].sort((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i]!;
    if (!Number.isInteger(m.start) || !Number.isInteger(m.end) || m.start < 0 || m.end > s.text.length || m.start >= m.end) throw new RangeError('mask out of range');
    if (i > 0 && m.start < sorted[i - 1]!.end) throw new RangeError('masks overlap');
    if (s.masks.some((a) => m.start < a.end && a.start < m.end && !(m.start <= a.start && a.end <= m.end))) throw new RangeError('mask cuts an automatic mask');
  }
  let out = '';
  let at = 0;
  const masks: Mask[] = [];
  const auto = [...s.masks].sort((a, b) => a.start - b.start);
  let k = 0;
  const copyAuto = (upTo: number) => {
    while (k < auto.length && auto[k]!.end <= upTo) {
      const a = auto[k]!;
      if (a.start >= at) masks.push({ start: out.length + (a.start - at), end: out.length + (a.end - at), kind: a.kind });
      k++;
    }
  };
  for (const m of sorted) {
    copyAuto(m.start);
    out += s.text.slice(at, m.start);
    // Automatic masks inside a manual one are swallowed by it.
    while (k < auto.length && auto[k]!.end <= m.end) k++;
    masks.push({ start: out.length, end: out.length + MANUAL_MASK.length, kind: 'manual' });
    out += MANUAL_MASK;
    at = m.end;
  }
  copyAuto(Number.POSITIVE_INFINITY);
  out += s.text.slice(at);
  return { text: out, masks };
}

/** "T+0:42": the time since the case opened, in hours and minutes (never a date or a clock time). */
export function offsetLabel(at: Date, openedAt: Date): string {
  const min = Math.max(0, Math.floor((at.getTime() - openedAt.getTime()) / 60_000));
  return `T+${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
}

export interface CaseMessage {
  from: 'buyer' | 'seller' | 'mod' | 'system';
  at: Date;
  text: string;
}

export interface TrainingMessage {
  from: CaseMessage['from'];
  /** `offsetLabel` from the case's opening. */
  at: string;
  text: string;
  masks: Mask[];
}

export interface TrainingBody {
  tradeCode: typeof TRADE_CODE_MASK;
  method: string;
  amountXmr: string;
  messages: TrainingMessage[];
  ruling: { outcome: string; reason: Scrubbed };
}

/**
 * The plan's `anonymizeCase`: a whole case (its chat, once a staff device can read it, and its
 * ruling) scrubbed with the case's own names and code; times become offsets from the first message.
 * `masks` lists every automatic mask by message (the ruling's reason is `messageIndex` -1).
 */
export function anonymizeCase(c: {
  buyer: string | readonly string[];
  seller: string | readonly string[];
  staff: readonly string[];
  tradeCode: string;
  openedAt?: Date;
  messages: readonly CaseMessage[];
  ruling: { outcome: string; reason: string };
  method: string;
  amountXmr: string;
}): { body: TrainingBody; masks: Array<{ messageIndex: number; start: number; end: number; kind: MaskKind }> } {
  const list = (v: string | readonly string[]) => (typeof v === 'string' ? [v] : v);
  const names: AnonymizeNames = { buyer: list(c.buyer), seller: list(c.seller), staff: c.staff };
  const base = c.openedAt ?? c.messages[0]?.at ?? new Date(0);
  const masks: Array<{ messageIndex: number; start: number; end: number; kind: MaskKind }> = [];
  const messages = c.messages.map((m, i) => {
    const s = anonymizeText(m.text, names, [c.tradeCode]);
    for (const k of s.masks) masks.push({ messageIndex: i, ...k });
    return { from: m.from, at: offsetLabel(m.at, base), text: s.text, masks: s.masks };
  });
  const reason = anonymizeText(c.ruling.reason, names, [c.tradeCode]);
  for (const k of reason.masks) masks.push({ messageIndex: -1, ...k });
  return {
    body: { tradeCode: TRADE_CODE_MASK, method: c.method, amountXmr: c.amountXmr, messages, ruling: { outcome: c.ruling.outcome, reason } },
    masks,
  };
}
