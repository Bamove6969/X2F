import { normalizeTradeCode } from '@x2f/core';

/**
 * Plan 4 Task 19: the training library's anonymizer. Pure, and it runs in the browser too: under
 * the chat key-membership design (design-chat-membership-keys-2026-11-08, Q12) the chat is
 * decrypted and scrubbed in the staff member's own browser, never on a server; the API scrubs the
 * texts it already holds (the dispute note, the rulings' reasons, the appeal).
 *
 * Revision 2026-10-29b: no separate copy is stored. A closed case is shown through these masks.
 *
 * What it does to a text:
 * - removes zero-width characters (U+200B to U+200D, U+FEFF) first, so `mi​ra.k` is `mira.k`;
 * - replaces the traders' names with "Buyer" and "Seller" and staff names with "Moderator",
 *   case-insensitively, and never inside a longer word (`admira.kx` stays);
 * - replaces any trade code with `XXXX-XXXX-XXXX-XXXX`;
 * - masks Monero addresses (95 characters starting 4 or 8, or a test network's 5, 7, 9, A or B;
 *   106-character integrated addresses;
 *   also split by spaces or line breaks) as `[address]`, IBANs as `[account]`, Luhn-valid 13 to 19
 *   digit card numbers as `[card]`, email addresses as `[email]`, phone numbers of 7 or more digits
 *   as `[phone]` and 64-hex transaction ids as `[tx]`.
 * Free text can still name a payer the masks do not know (Review Focus 5): every mask is listed, so
 * the page can highlight them, and `manual` masks can be added over the output.
 */

export type MaskKind = 'address' | 'account' | 'card' | 'email' | 'phone' | 'tx' | 'manual';

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
const LABEL: Readonly<Record<Exclude<MaskKind, 'manual'>, string>> = {
  address: '[address]',
  account: '[account]',
  card: '[card]',
  email: '[email]',
  phone: '[phone]',
  tx: '[tx]',
};
/** What a manual mask shows in place of the text it covers. */
export const MANUAL_MASK = '[hidden]';

const ZERO_WIDTH = /[​-‍﻿]/g;
const WORD = /[\p{L}\p{N}_]/u;

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

function nameSpans(text: string, names: AnonymizeNames): Span[] {
  const out: Span[] = [];
  const lists: Array<[readonly string[], string]> = [
    [names.buyer, 'Buyer'],
    [names.seller, 'Seller'],
    [names.staff, 'Moderator'],
  ];
  for (const [list, word] of lists) {
    for (const raw of list) {
      const name = raw.replace(ZERO_WIDTH, '').trim();
      if (name.length < 2) continue;
      const re = new RegExp(escapeRe(name), 'giu');
      for (const m of text.matchAll(re)) {
        const start = m.index;
        const end = start + m[0].length;
        // Never inside a longer word: the characters on either side are not letters, digits or _.
        if (start > 0 && WORD.test(text[start - 1]!)) continue;
        if (end < text.length && WORD.test(text[end]!)) continue;
        out.push({ start, end, out: word });
      }
    }
  }
  return out;
}

function tradeCodeSpans(text: string, known: ReadonlySet<string>): Span[] {
  const out: Span[] = [];
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

/** Monero addresses, joined across whitespace: 95 characters (NETWORK_FIRST) or 106 (INTEGRATED_FIRST). */
function addressSpans(text: string): Span[] {
  const runs = [...text.matchAll(BASE58_RUN)].map((m) => ({ start: m.index, end: m.index + m[0].length, s: m[0] }));
  const out: Span[] = [];
  for (let i = 0; i < runs.length; i++) {
    const first = runs[i]!;
    if (!NETWORK_FIRST.includes(first.s[0]!)) continue;
    // The run must start a word (not the tail of a longer token such as `x4abc…`).
    if (first.start > 0 && WORD.test(text[first.start - 1]!)) continue;
    let len = 0;
    let best: { j: number; len: number } | null = null;
    for (let j = i; j < runs.length; j++) {
      const r = runs[j]!;
      if (j > i && !/^\s+$/.test(text.slice(runs[j - 1]!.end, r.start))) break;
      len += r.s.length;
      if (len > 106) break;
      const endsWord = r.end >= text.length || !WORD.test(text[r.end]!);
      if (endsWord && (len === 95 || (len === 106 && INTEGRATED_FIRST.includes(first.s[0]!)))) best = { j, len };
    }
    if (best !== null) {
      out.push({ start: first.start, end: runs[best.j]!.end, out: LABEL.address, kind: 'address' });
      i = best.j;
    }
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

function patternSpans(text: string): Span[] {
  const out: Span[] = [];
  const add = (re: RegExp, kind: Exclude<MaskKind, 'manual' | 'address'>, ok: (m: string) => boolean = () => true) => {
    for (const m of text.matchAll(re)) if (ok(m[0])) out.push({ start: m.index, end: m.index + m[0].length, out: LABEL[kind], kind });
  };
  add(/(?<![\p{L}\p{N}_])[0-9a-fA-F]{64}(?![\p{L}\p{N}_])/gu, 'tx');
  add(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu, 'email');
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
  add(/(?<![\p{N}])\d(?:[ -]?\d){12,18}(?![\p{N}])/gu, 'card', (m) => {
    const d = m.replace(/\D/g, '');
    return d.length >= 13 && d.length <= 19 && luhn(d);
  });
  // A phone number: an optional +, then digits with spaces, dots, dashes or brackets, 7 to 15 digits.
  add(/(?<![\p{L}\p{N}_.,])(?:\+|\(\+?)?\d[\d ().-]{5,}\d(?![\p{L}\p{N}_])/gu, 'phone', (m) => {
    const d = m.replace(/\D/g, '').length;
    // A decimal amount ("1.25", "1,320.00") is not a phone number.
    if (/^\d+\.\d{1,2}$/.test(m.trim())) return false;
    // Nor is a date (2026-11-02).
    if (/^\d{4}-\d{2}-\d{2}$/.test(m.trim())) return false;
    return d >= 7 && d <= 15;
  });
  return out;
}

/**
 * Chooses spans that do not overlap: the earliest first, the longer one on a tie; a mask beats a
 * name or code of the same length (an email holding the username is masked whole).
 */
function pick(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start) || (a.kind ? -1 : 1) - (b.kind ? -1 : 1));
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start < last.end) {
      // A longer span that starts inside the last one replaces it only when it covers it entirely.
      if (s.start === last.start && s.end > last.end) out[out.length - 1] = s;
      continue;
    }
    out.push(s);
  }
  return out;
}

/** Scrubs one text (see the module comment). `tradeCodes` are the case's own codes, in any form. */
export function anonymizeText(text: string, names: AnonymizeNames, tradeCodes: readonly string[] = []): Scrubbed {
  const clean = text.replace(ZERO_WIDTH, '');
  const known = new Set(tradeCodes.map((c) => normalizeTradeCode(c)).filter((c): c is string => c !== null));
  const spans = pick([...addressSpans(clean), ...patternSpans(clean), ...tradeCodeSpans(clean, known), ...nameSpans(clean, names)]);
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
