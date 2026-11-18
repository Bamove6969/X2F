import { normalizeTradeCode } from '@x2f/core';

/**
 * Plan 4 Task 19: the training library's anonymizer. Pure, and it runs in the browser too: under
 * the chat key-membership design (design-chat-membership-keys-2026-11-08, Q12) the chat is
 * decrypted and scrubbed in the staff member's own browser, never on a server; the API scrubs the
 * texts it already holds (the dispute note, the rulings' reasons, the appeal).
 *
 * Revision 2026-10-29b: no separate copy is stored. A closed case is shown through these masks.
 * Lead call 18 Nov (re-review): the library is review-first. These masks only pre-mask a case; a
 * curator (`training.curate`) reviews it, adds manual masks and marks it before it is listed.
 *
 * Reviews 2026-11-18 (M1-M3, then B1, M1, M2, m1, m2): over-masking is fine, under-masking is not.
 * What it does to a text:
 * - normalizes it first: NFKC, then every default-ignorable character removed (zero-width
 *   characters, the soft hyphen, the word joiner, variation selectors...). The output is this
 *   normalized text. Past MAX_TEXT (20 000) characters the rest is one `[long text]` mask;
 * - matches on a skeleton of it (never shown): each character decomposed with its combining marks
 *   dropped (`m̀ira`, `José` as `Jose`), `ß` as `ss`, `İ` as `I`, Cyrillic, Greek, Armenian and
 *   small-capital look-alikes folded to Latin, and every run of whitespace one space;
 * - replaces the traders' names with "Buyer" and "Seller" and staff names with "Moderator",
 *   case-insensitively: any punctuation or space between a name's parts (`mira_k`, `mira/k`,
 *   `Mira\nKowal`), `0` for `o` and `1` for `i` or `l`, and for a name of 4 or more letters up to 2
 *   characters of punctuation or space between its letters (`m.i.r.a.k`) and a suffix of up to 2
 *   letters (`Miras`); any name may carry a digit or `_` suffix (`quietfox99`, `quietfox_real`).
 *   Never inside a longer word (`admira.kx` stays);
 * - replaces the case's own trade code written with any separators, even glued to a word, and any
 *   other code (letters and digits, any case, grouped by one kind of separator or not), with
 *   `XXXX-XXXX-XXXX-XXXX`;
 * - masks Monero addresses as `[address]`: 95 characters starting 4 or 8 (or a test network's 5,
 *   7, 9, A or B), 106-character integrated ones; one word, or split into pieces joined across
 *   short runs of punctuation or spaces (pieces of 8 or more, or equal groups, that look random
 *   together); a single word of 95 or more characters that looks random (an address glued to a
 *   word or with a character typed into it). Randomness is only ever judged inside one word or one
 *   split address, never across the words of a sentence (re-review B1). Bitcoin addresses (base58
 *   and bech32) as `[address]`; any other single word of 20 or more characters mixing digits,
 *   upper and lower case as `[id]`;
 * - masks 64-hex transaction ids (also `0x...`, split, or any word of 24+ hex characters, `O` read
 *   as `0`) as `[tx]`, 16-hex payment ids as `[payment id]`, 40-hex PGP fingerprints as
 *   `[fingerprint]`, Session ids (66 hex starting 05) as `[session id]`;
 * - masks IBANs (spaces, dashes or dots) as `[account]`, Luhn-valid 13 to 19 digit card numbers
 *   (spaces, dashes, dots, slashes) as `[card]`, email addresses and Jabber ids (also `name at
 *   host dot de`, `[at]`, `(dot)`, with a resource) as `[email]`, phone numbers of 7 to 15 digits as
 *   `[phone]`, URLs and bare host names (any top-level domain) as `[link]`, `@handles` as
 *   `[handle]`, IPv4 and IPv6 addresses as `[ip]`;
 * - masks clock times (`14:32`, `9:05 pm`, `7am`) as `[time]` and XMR amounts (`1.2345 XMR`,
 *   `XMR 0.5`) as `[amount]`; fiat amounts and days are kept (re-review m1, lead call).
 * Free text can still name a payer the masks do not know (Review Focus 5): every mask is listed, so
 * the page can highlight them, and the curator's `manual` masks are added over the output.
 */

export type MaskKind =
  | 'address' | 'account' | 'card' | 'email' | 'phone' | 'tx' | 'payment-id' | 'fingerprint' | 'link' | 'handle' | 'ip'
  | 'session-id' | 'id' | 'time' | 'amount' | 'long' | 'manual';

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
  'session-id': '[session id]',
  id: '[id]',
  time: '[time]',
  amount: '[amount]',
  long: '[long text]',
};
/** What a manual mask shows in place of the text it covers. */
export const MANUAL_MASK = '[hidden]';
/** The most characters of one text the anonymizer reads, after normalizing (re-review m2). */
export const MAX_TEXT = 20_000;

const IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;
const MARKS = /\p{M}/gu;
const WORD = /[\p{L}\p{N}_]/u;
const ALNUM = /[\p{L}\p{N}]/u;
const SPACE = /\s/u;

/**
 * Characters folded for matching only: Cyrillic, Greek, Armenian and small-capital letters that
 * look like Latin ones, Latin look-alikes NFKC leaves alone, and `ß`/`İ` (one to many).
 */
const FOLD: Readonly<Record<string, string>> = Object.fromEntries(
  [
    // Cyrillic lower case
    'аa', 'вb', 'еe', 'ёe', 'һh', 'іi', 'їi', 'јj', 'кk', 'ӏl', 'мm', 'нh', 'оo', 'рp', 'сc', 'тt', 'уy', 'ўy', 'хx', 'ѕs', 'ԁd', 'ԛq', 'ԝw', 'ьb', 'ѵv', 'үy', 'ғf',
    // Cyrillic upper case
    'АA', 'ВB', 'ЕE', 'ЁE', 'ҺH', 'ІI', 'ЇI', 'ЈJ', 'КK', 'ӀI', 'МM', 'НH', 'ОO', 'РP', 'СC', 'ТT', 'УY', 'ХX', 'ЅS', 'ԚQ', 'ԜW', 'ҮY', 'ѴV',
    // Greek lower case
    'αa', 'βb', 'γy', 'εe', 'ηn', 'ιi', 'κk', 'νv', 'οo', 'ρp', 'σo', 'τt', 'υu', 'χx', 'ωw', 'ϲc', 'ϳj', 'ϱp', 'ϵe',
    // Greek upper case
    'ΑA', 'ΒB', 'ΕE', 'ΖZ', 'ΗH', 'ΙI', 'ΚK', 'ΜM', 'ΝN', 'ΟO', 'ΡP', 'ΤT', 'ΥY', 'ΧX', 'ϹC', 'ϒY', 'ϺM',
    // Armenian
    'օo', 'ոn', 'սu', 'ցg', 'հh', 'ռn', 'Օo', 'Սu',
    // Small capitals and other Latin look-alikes
    'ᴀa', 'ʙb', 'ᴄc', 'ᴅd', 'ᴇe', 'ɢg', 'ʜh', 'ɪi', 'ᴊj', 'ᴋk', 'ʟl', 'ᴍm', 'ɴn', 'ᴏo', 'ᴘp', 'ʀr', 'ꜱs', 'ᴛt', 'ᴜu', 'ᴠv', 'ᴡw', 'ʏy', 'ᴢz',
    'ıi', 'ȷj', 'ɑa', 'ɩi', 'ɡg',
  ].map((p) => [p[0]!, p[1]!]),
);
const FOLD_MANY: Readonly<Record<string, string>> = { ß: 'ss', ẞ: 'SS', İ: 'I', ﬀ: 'ff' };

/** NFKC with every default-ignorable character removed (twice: NFKC can recompose across one). */
function normalizeText(t: string): string {
  return t.normalize('NFKC').replace(IGNORABLE, '').normalize('NFKC').replace(IGNORABLE, '');
}

/** One character of the text as the skeleton holds it (possibly empty, possibly several). */
function foldChar(ch: string): string {
  const base = (FOLD_MANY[ch] ?? ch).normalize('NFD').replace(MARKS, '');
  let out = '';
  for (const c of base) out += FOLD[c] ?? c;
  return out;
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
    const ch = String.fromCodePoint(t.codePointAt(i)!);
    const f = foldChar(ch);
    for (let k = 0; k < f.length; k++) {
      from.push(i);
      to.push(i + ch.length);
    }
    s += f;
    i += ch.length;
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

/** One letter of a name as the text may hold it: `0` for `o`, `1` for `i` or `l` (re-review M1, lead call). */
function nameChar(c: string): string {
  const l = c.toLowerCase();
  if (l === 'o' || l === '0') return '[o0]';
  if (l === 'i' || l === 'l' || l === '1') return '[il1]';
  return escapeRe(c);
}

const NOT_ALNUM = '[^\\p{L}\\p{N}]';

function nameSpans(text: string, names: AnonymizeNames): Span[] {
  const out: Span[] = [];
  const lists: Array<[readonly string[], string]> = [
    [names.buyer, 'Buyer'],
    [names.seller, 'Seller'],
    [names.staff, 'Moderator'],
  ];
  for (const [list, word] of lists) {
    // Re-review 3 m4: a name of several parts also matches each part of 3 or more letters on its own
    // (`Mira` or `Kowal` for `Mira Kowal`, in any order); initials do not.
    const variants: string[][] = [];
    for (const raw of list) {
      const parts = skeleton(normalizeText(raw)).s.split(/[^\p{L}\p{N}]+/u).filter((p) => p !== '');
      variants.push(parts);
      // A display name's parts are separated by spaces (`Mira Kowal`); a login's (`mira.k`) are not split.
      if (parts.length > 1 && /\s/u.test(raw.trim())) for (const p of parts) if (p.length >= 3) variants.push([p]);
    }
    for (const parts of variants) {
      const letters = parts.join('').length;
      if (letters < 2) continue;
      // A name of 4 or more letters: up to 2 characters of punctuation or space between its letters,
      // and up to 2 letters after it ("Miras"). Any name: a digit or `_` suffix ("quietfox99").
      const long = letters >= 4;
      const inner = long ? `${NOT_ALNUM}{0,2}` : '';
      const core = parts.map((p) => [...p].map(nameChar).join(inner)).join(`${NOT_ALNUM}{0,3}`);
      const suffix = `(?:[_\\p{N}][\\p{L}\\p{N}_]*${long ? '|\\p{L}{1,2}' : ''})?`;
      // Never inside a longer word: the characters on either side are not letters, digits or _.
      const re = new RegExp(`(?<![\\p{L}\\p{N}_])${core}${suffix}(?![\\p{L}\\p{N}_])`, 'giu');
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
  // Any other code: 4 groups of 4, one kind of separator between them (or none), any case. Tried at
  // every word start (a zero-width match with a capture), so "Also 3HW8-…" is not swallowed by a
  // candidate starting at "Also".
  for (const w of text.matchAll(/(?<![\p{L}\p{N}_])(?=([0-9A-Za-z]{4}([-._:/ ]?)[0-9A-Za-z]{4}\2[0-9A-Za-z]{4}\2[0-9A-Za-z]{4})(?![\p{L}\p{N}_]))/gu)) {
    const raw = w[1]!;
    const sep = w[2]!;
    const code = normalizeTradeCode(raw.replace(/[._:/]/g, ''));
    if (code === null) continue;
    const groups = raw.split(sep === '' ? /(?=(?:.{4})+$)/ : sep).filter((g) => g !== '');
    const withDigit = groups.filter((g) => /\d/.test(g)).length;
    const withLetter = groups.filter((g) => /[A-Za-z]/.test(g)).length;
    // Letters and digits (a card number or a long word is not a code); spaced, 3 groups or more hold
    // a digit and none is digits only ("Card 4111 paid 2026" or "IBAN DE89 3704 0044" is not a code).
    const mixed = withDigit > 0 && withLetter > 0;
    const allDigits = groups.some((g) => /^\d{4}$/.test(g));
    const plausible = known.has(code) || (mixed && (sep !== ' ' || (withDigit >= 3 && !allDigits)));
    if (plausible) out.push({ start: w.index, end: w.index + raw.length, out: TRADE_CODE_MASK });
  }
  return out;
}

const BASE58_RUN = /[1-9A-HJ-NP-Za-km-z]+/g;
/** First characters of a 95-character address: mainnet 4 and 8 (the plan's), and the stagenet (5, 7) and testnet (9, A, B) ones, masked as well. */
const NETWORK_FIRST = '4857' + '9AB';
/** First characters of a 106-character integrated address: mainnet 4, stagenet 5, testnet A. */
const INTEGRATED_FIRST = '45A';
/** The most characters between two pieces of one split address: punctuation and spaces only. */
const ADDRESS_GAP = 5;

/** Whether `chars` mixes digits, upper and lower case at least `d`, `u` and `l` times. */
function mixed(chars: string, d: number, u: number, l: number): boolean {
  let nd = 0;
  let nu = 0;
  let nl = 0;
  for (const c of chars) {
    if (c >= '0' && c <= '9') nd++;
    else if (c >= 'A' && c <= 'Z') nu++;
    else if (c >= 'a' && c <= 'z') nl++;
  }
  return nd >= d && nu >= u && nl >= l;
}

/**
 * Monero addresses: 95 characters (NETWORK_FIRST) or 106 (INTEGRATED_FIRST).
 * - Exact: whole base58 pieces, a word on each side, joined across up to ADDRESS_GAP characters that
 *   are neither letters nor digits. A split one must look like a split address: pieces of 8 or more
 *   characters, or equal groups between the first and the last, and random together.
 * - One word (letters and digits) of 95 or more characters that looks random: an address glued to a
 *   word, or with a non-base58 character typed into it. Never judged across words (re-review B1).
 */
function addressSpans(text: string): Span[] {
  const pieces = [...text.matchAll(BASE58_RUN)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
  const out: Span[] = [];
  const lengths = (first: string) => (INTEGRATED_FIRST.includes(first) ? [106, 95] : [95]);
  for (let i = 0; i < pieces.length; i++) {
    const first = pieces[i]!;
    const c0 = text[first.start]!;
    if (!NETWORK_FIRST.includes(c0) || (first.start > 0 && WORD.test(text[first.start - 1]!))) continue;
    let total = 0;
    let found: number | null = null;
    for (let j = i; j < pieces.length; j++) {
      const r = pieces[j]!;
      if (j > i) {
        const gap = text.slice(pieces[j - 1]!.end, r.start);
        if (gap.length > ADDRESS_GAP || ALNUM.test(gap)) break;
      }
      total += r.end - r.start;
      if (total > 106) break;
      const endsWord = r.end >= text.length || !WORD.test(text[r.end]!);
      if (!endsWord || !lengths(c0).includes(total)) continue;
      if (j === i) {
        found = j;
        break;
      }
      const lens = pieces.slice(i, j + 1).map((p) => p.end - p.start);
      const inner = lens.slice(1, -1);
      const shaped = lens.every((n) => n >= 8) || (inner.length >= 1 && inner.every((n) => n === inner[0]) && lens[0]! <= inner[0]! && lens[lens.length - 1]! <= inner[0]!);
      const chars = pieces.slice(i, j + 1).map((p) => text.slice(p.start, p.end)).join('');
      if (shaped && mixed(chars, 3, 8, 8)) {
        found = j;
        break;
      }
    }
    if (found !== null) {
      out.push({ start: first.start, end: pieces[found]!.end, out: LABEL.address, kind: 'address' });
      i = found;
    }
  }
  for (const m of text.matchAll(/[\p{L}\p{N}]{95,}/gu)) {
    if (mixed(m[0], 3, 8, 8)) out.push({ start: m.index, end: m.index + m[0].length, out: LABEL.address, kind: 'address' });
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
  const s = raw.replace(/[\s.-]/g, '').toUpperCase();
  if (s.length < 15 || s.length > 34 || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
}

/** Time zones after a dotted time (`14.32 CET`): a currency after it is an amount, kept. */
const TIME_ZONES = 'UTC|GMT|CET|CEST|EET|EEST|WET|WEST|MSK|BST|IST|EST|EDT|CST|CDT|MST|MDT|PST|PDT|AKST|HST|AEST|AEDT|ACST|AWST|JST|KST|HKT|SGT|NZST|NZDT|Uhr';
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
/**
 * A bare host name with any top-level domain: 3 or more letters, an `xn--` one, or a 2-letter
 * country code (CCTLD; `mira.kx` is a name, not a host). Bounded: no label is longer than 63.
 */
const HOST = /(?<![\p{L}\p{N}_@.\-])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.){1,10}(?:\p{L}{2,63}|xn--[a-z0-9-]{1,59})(?::\d{1,5})?(?![\p{L}\p{N}_\-@])/giu;
const CCTLD = new Set(
  ('ac ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bm bn bo br bs bt bw by bz ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz ' +
    'de dj dk dm do dz ec ee eg er es et eu fi fj fk fm fo fr ga gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir is it ' +
    'je jm jo jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mg mh mk ml mm mn mo mp mq mr ms mt mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz ' +
    'om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro rs ru rw sa sb sc sd se sg sh si sk sl sm sn so sr ss st su sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt tv tw tz ' +
    'ua ug uk us uy uz va vc ve vg vi vn vu wf ws ye yt za zm zw').split(' '),
);
const FILE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'pdf', 'txt', 'heic', 'webp', 'doc', 'docx', 'csv', 'xls', 'xlsx', 'bmp', 'tiff']);
function hostOk(m: string): boolean {
  const tld = m.replace(/:\d+$/, '').split('.').pop()!.toLowerCase();
  if (tld.length === 2 && !CCTLD.has(tld)) return false;
  // A file name (screenshot.png) is not a host: these extensions are not top-level domains.
  if (FILE_EXT.has(tld)) return false;
  // A dotted trade code (four groups of four letters and digits) is a code, not a host.
  return !(/^[0-9A-Za-z]{16}$/.test(m.replace(/\./g, '')) && /\d/.test(m));
}

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
  const add = (re: RegExp, kind: Exclude<MaskKind, 'manual'>, ok: (m: string) => boolean = () => true, trim?: RegExp) => {
    for (const m of text.matchAll(re)) {
      const v = trim ? m[0].replace(trim, '') : m[0];
      if (v !== '' && ok(v)) out.push({ start: m.index, end: m.index + v.length, out: LABEL[kind], kind });
    }
  };
  // A Session id: 66 hex starting 05 (before the tx rules, which would also take it).
  add(/(?<![\p{L}\p{N}_])05[0-9a-fA-F]{64}(?![\p{L}\p{N}_])/gu, 'session-id');
  // A PGP fingerprint: 40 hex, in groups of 4 with spaces or colons, or not.
  add(/(?<![\p{L}\p{N}_])(?:0[xX])?[0-9a-fA-F]{4}(?:[ :]?[0-9a-fA-F]{4}){9}(?![\p{L}\p{N}_])/gu, 'fingerprint');
  // A tx id: 64 hex, optionally 0x, possibly split by up to 3 characters of punctuation or space;
  // and any one word of 24 or more hex characters (O read as 0): half a tx id is one.
  add(/(?<![\p{L}\p{N}_])(?:0[xX])?[0-9a-fA-F](?:[^\p{L}\p{N}]{0,3}[0-9a-fA-F]){63}(?![\p{L}\p{N}_])/gu, 'tx');
  add(/(?<![\p{L}\p{N}_])(?:0[xX])?[0-9a-fA-FoO]{24,}(?![\p{L}\p{N}_])/gu, 'tx');
  // Bitcoin: legacy base58 (1 or 3, 26 to 35 characters, both cases) and bech32 (bc1/tb1).
  add(/(?<![\p{L}\p{N}_])[13][1-9A-HJ-NP-Za-km-z]{25,34}(?![\p{L}\p{N}_])/gu, 'address', (m) => mixed(m, 1, 1, 1));
  add(/(?<![\p{L}\p{N}_])(?:bc1|tb1)[02-9ac-hj-np-z]{11,71}(?![\p{L}\p{N}_])/giu, 'address');
  // Any other long word mixing digits, upper and lower case: a key, a token, a wallet id.
  add(/(?<![\p{L}\p{N}_])[\p{L}\p{N}]{20,94}(?![\p{L}\p{N}_])/gu, 'id', (m) => mixed(m, 2, 3, 3));
  add(EMAIL_STRONG, 'email');
  add(EMAIL_WORDS, 'email');
  // Links: with a scheme or `www.` (bounded), a host with a path, or a bare host with any top-level
  // domain (not a dotted trade code).
  add(/(?<![\p{L}\p{N}_])(?:[a-z][a-z0-9+.-]{0,15}:\/\/|www\.)[^\s<>"']{1,2000}/giu, 'link', () => true, URL_END);
  add(/(?<![\p{L}\p{N}_@.\-])(?:[\p{L}\p{N}\-]{1,63}\.){1,10}\p{L}{2,63}(?::\d{1,5})?\/[^\s<>"']{0,2000}/gu, 'link', () => true, URL_END);
  add(HOST, 'link', hostOk);
  add(/(?<![\p{L}\p{N}_.@])@[\p{L}\p{N}_](?:[\p{L}\p{N}_.]{0,62}[\p{L}\p{N}_])?/gu, 'handle');
  // IPv4, also the short a.b.c form, with an optional port; and IPv6 (with :: or 4 or more groups).
  add(/(?<![\p{N}.])\d{1,3}(?:\.\d{1,3}){2,3}(?::\d{1,5})?(?!\p{N}|\.\d)/gu, 'ip');
  add(/(?<![\p{L}\p{N}_:.])\[?(?:[0-9A-Fa-f]{0,4}:){2,7}(?:[0-9A-Fa-f]{1,4}|\d{1,3}(?:\.\d{1,3}){3})?\]?(?![\p{L}\p{N}_:])/gu, 'ip', ipv6Valid);
  // A clock time (never an offset `T+0:42`): 14:32, 14:32:05, 14h32, 9:05 pm, 7am.
  add(/(?<![\p{N}:.+])(?:[01]?\d|2[0-3])[:h][0-5]\d(?::[0-5]\d)?(?: ?[ap]\.?m\b\.?)?(?![\p{N}])/giu, 'time');
  add(/(?<![\p{L}\p{N}:.+])(?:1[0-2]|0?[1-9]) ?[ap]\.?m\b\.?/giu, 'time');
  // Re-review 3 m4: 1432h, and 14.32 or 14h32 before a time zone.
  add(/(?<![\p{L}\p{N}])(?:[01]\d|2[0-3])[0-5]\dh(?![\p{L}\p{N}])/giu, 'time');
  add(new RegExp(`(?<![\\p{N}.,:+])(?:[01]?\\d|2[0-3])[.][0-5]\\d(?= ?(?:${TIME_ZONES})(?![\\p{L}]))`, 'gu'), 'time');
  // An XMR amount: the number before or after XMR / monero (the unit stays).
  // (Re-review 3 m4: spaces around the point too, `1 . 2345 XMR`.)
  add(/(?<![\p{L}\p{N}.,])\d+(?: ?[.,] ?\d+)*(?= ?(?:xmr|monero|piconero)(?!\p{L}))/giu, 'amount');
  add(/(?<=(?:^|[^\p{L}])xmr ?)\d+(?: ?[.,] ?\d+)*(?![\p{N}])/giu, 'amount');
  // An IBAN, grouped by spaces, dashes or dots or not: the longest prefix of the run that passes the
  // mod-97 check (a run can swallow the next word, "DE89 3704 0044 0532 0130 00 please").
  for (const m of text.matchAll(/(?<![\p{L}\p{N}_])[A-Za-z]{2}\d{2}(?:[ .-]?[A-Za-z0-9]){11,40}/gu)) {
    for (let e = m[0].length; e >= 15; e--) {
      const sub = m[0].slice(0, e);
      const next = text[m.index + e];
      if (/[ .-]$/.test(sub) || (next !== undefined && WORD.test(next))) continue;
      if (ibanValid(sub)) {
        out.push({ start: m.index, end: m.index + e, out: LABEL.account, kind: 'account' });
        break;
      }
    }
  }
  add(/(?<![\p{N}])\d(?:(?: ?[-./] ?| )?\d){12,18}(?![\p{N}])/gu, 'card', (m) => {
    const d = m.replace(/\D/g, '');
    return d.length >= 13 && d.length <= 19 && luhn(d);
  });
  // A payment id: 16 hex (after the card check, so a card number shows as a card).
  add(/(?<![\p{L}\p{N}_])(?:0[xX])?[0-9a-fA-F]{16}(?![\p{L}\p{N}_])/gu, 'payment-id');
  // A phone number: an optional +, then digits with spaces, dots, dashes, slashes or brackets, 7 to 15 digits.
  add(/(?<![\p{L}\p{N}_.,])(?:\+|\(\+?)?\d[\d ()./-]{5,40}\d(?![\p{L}\p{N}_])/gu, 'phone', (m) => {
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

/** How far past MAX_TEXT the masks still read, so an identifier crossing the cut is seen whole (re-review 3 m5). */
const CUT_LOOKAHEAD = 1000;

/** Every span of `clean`, in the normalized text's offsets. */
function spansOf(clean: string, names: AnonymizeNames, known: ReadonlySet<string>): Span[] {
  const sk = skeleton(clean);
  const found = pick([...addressSpans(sk.s), ...patternSpans(sk.s), ...tradeCodeSpans(sk.s, known), ...nameSpans(sk.s, names)]);
  // Back from the skeleton to the normalized text, with any combining marks right after a span.
  return found.map((s) => {
    let end = sk.to[s.end - 1]!;
    while (end < clean.length && /\p{M}/u.test(clean[end]!)) end++;
    return { ...s, start: sk.from[s.start]!, end };
  });
}

/**
 * Where to cut a text longer than MAX_TEXT (re-review 3 m5): at MAX_TEXT, moved back before any
 * span that crosses it (a split address, an IBAN with spaces, `Mira | Kowal`: the masks read past the
 * cut, so they see it whole) and before any word that crosses it; never inside a surrogate pair.
 */
function cutAt(t: string, spans: readonly Span[]): number {
  let cut = MAX_TEXT;
  for (let moved = true; moved; ) {
    moved = false;
    for (const s of spans) {
      if (s.start < cut && s.end > cut) {
        cut = s.start;
        moved = true;
      }
    }
    while (cut > 0 && !SPACE.test(t[cut - 1]!) && cut < t.length && !SPACE.test(t[cut]!)) {
      cut--;
      moved = true;
    }
  }
  const c = t.charCodeAt(cut - 1);
  if (c >= 0xd800 && c <= 0xdbff) cut--;
  return cut;
}

/** Scrubs one text (see the module comment). `tradeCodes` are the case's own codes, in any form. */
export function anonymizeText(text: string, names: AnonymizeNames, tradeCodes: readonly string[] = []): Scrubbed {
  const normalized = normalizeText(text);
  const known = new Set(tradeCodes.map((c) => normalizeTradeCode(c)).filter((c): c is string => c !== null));
  // Re-review m2: past MAX_TEXT characters the rest is one mask (and is never shown).
  const over = normalized.length > MAX_TEXT;
  const read = over ? normalized.slice(0, MAX_TEXT + CUT_LOOKAHEAD) : normalized;
  const all = spansOf(read, names, known);
  const cut = over ? cutAt(read, all) : normalized.length;
  const clean = normalized.slice(0, cut);
  const spans = all.filter((s) => s.end <= cut);
  let out = '';
  let at = 0;
  const masks: Mask[] = [];
  for (const s of spans) {
    // Re-review 3 m2: a span starting inside the source character that ended the last one (a `ß`
    // folded to `ss`) is clamped to where the last one ended, never dropped.
    if (s.end <= at) continue;
    const start = Math.max(s.start, at);
    out += clean.slice(at, start);
    if (s.kind) masks.push({ start: out.length, end: out.length + s.out.length, kind: s.kind });
    out += s.out;
    at = s.end;
  }
  out += clean.slice(at);
  if (over) {
    masks.push({ start: out.length, end: out.length + LABEL.long.length, kind: 'long' });
    out += LABEL.long;
  }
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
