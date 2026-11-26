// @vitest-environment happy-dom
// The help library (owner, 18 Nov 2026; screens/help/helpLibrary.ts and HelpLibrary.tsx): the content
// rules (every answer has a source note that still points at real code, short plain answers, no
// "half"), the facts check (every timer, limit and count an answer names is rebuilt here from the
// constant in the code, so a changed constant or an undeclared number turns this red), and the page
// (grouping, expand and collapse, search over questions and answers, deep links, accessibility).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { X2F_FEE_BPS } from '@x2f/core';
import {
  BAND_MIN_TRADES,
  CHAT_AFTER_CLOSE_DAYS,
  CHAT_AFTER_DISPUTE_DAYS,
  CHAT_PRETRADE_IDLE_DAYS,
  GIFT_CARD_CHECK_MIN,
  GIFT_CARD_MAX_AGE_DAYS,
  LAUNCH_TRADE_CAP_USD_CENTS,
  MAX_BANDS,
  MAX_CURRENCIES,
  MAX_MARGIN_BPS,
  MAX_METHODS,
  DISPUTE_KEEP_DAYS,
  SELLER_CONFIRM_CANCEL_TIMEOUT_H,
  TIMERS,
  TRADE_KEEP_DAYS,
  UNLOCK_CONFIRMATIONS,
} from '@x2f/trade';
import { GIFT_CARD_COPY } from '../src/screens/giftcard/giftCardCopy.js';
import { FLAGGED_QUESTIONS, LIBRARY_TOPICS, QUESTIONS, libraryQuestions, type HelpQuestion } from '../src/screens/help/helpLibrary.js';
import { LIBRARY_COPY, OLD_ANCHOR_REDIRECTS, matches, questionAnchor, searchWords } from '../src/screens/help/HelpLibrary.js';
import { HelpTopic } from '../src/screens/HelpTopic.js';
import { fire, render } from './render.js';

const state = vi.hoisted(() => ({ session: { status: 'signed-out' } as unknown }));
vi.mock('../src/session/useSession.js', async (orig) => ({ ...(await orig<object>()), useSession: () => state.session }));
afterEach(() => {
  state.session = { status: 'signed-out' };
  vi.unstubAllEnvs();
});

const ROOT = join(import.meta.dirname, '..', '..', '..');
const source = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Both answer sets: a build without the proof upload (the default) and one with it (VITE_X2F_PROOF_UPLOAD=1). */
const VARIANTS: ReadonlyArray<readonly [string, readonly HelpQuestion[]]> = [
  ['proof upload off', libraryQuestions(false)],
  ['proof upload on', libraryQuestions(true)],
];

/**
 * The number a constant is set to in a source file, for the constants the web app does not import
 * (the API's, @x2f/accounts', @x2f/staff's): `NAME = 24 * 3_600_000;` gives 86400000. Only digits,
 * underscores and `*` are read, so anything cleverer fails here instead of guessing.
 */
function constIn(file: string, name: string, read: (p: string) => string = source): number {
  const m = new RegExp(`\\b${name}\\s*(?::[^=]+)?=\\s*([0-9_ *n]+);`).exec(read(file));
  if (m === null) throw new Error(`${name} not found in ${file}`);
  return m[1]!
    .split('*')
    .map((x) => Number(x.replace(/[_\sn]/g, '')))
    .reduce((a, b) => a * b, 1);
}
/** A key's number inside an object literal in a source file: `appealWindowH: 48,`. */
function keyIn(file: string, key: string, read: (p: string) => string = source): number {
  const m = new RegExp(`\\b${key}:\\s*(\\d+)`).exec(read(file));
  if (m === null) throw new Error(`${key} not found in ${file}`);
  return Number(m[1]);
}
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const orList = (ns: readonly number[]) => `${ns.slice(0, -1).join(', ')} or ${ns[ns.length - 1]}`;
const hoursList = (type: 'trader' | 'vendor', read: (p: string) => string) => {
  const m = new RegExp(`${type}: \\[([0-9, ]+)\\]`).exec(read('packages/accounts/src/sessionLength.ts'));
  if (m === null) throw new Error(`no ${type} session hours`);
  return m[1]!.split(',').map((x) => Number(x.trim()));
};
/** "within a year" for 365 days, else "within N days": the answer's words for the purged-mark time. */
const withinDays = (days: number) => (days === 365 ? 'within a year' : `within ${days} days`);

/** The constants the web app imports, so a test can hand in a changed one (review m4). */
const IMPORTED = {
  X2F_FEE_BPS,
  BAND_MIN_TRADES,
  CHAT_AFTER_CLOSE_DAYS,
  CHAT_AFTER_DISPUTE_DAYS,
  CHAT_PRETRADE_IDLE_DAYS,
  DISPUTE_KEEP_DAYS,
  GIFT_CARD_CHECK_MIN,
  GIFT_CARD_MAX_AGE_DAYS,
  GIFT_CARD_RANGE: GIFT_CARD_COPY.rangeCardOnly,
  LAUNCH_TRADE_CAP_USD_CENTS,
  MAX_BANDS,
  MAX_CURRENCIES,
  MAX_MARGIN_BPS,
  MAX_METHODS,
  SELLER_CONFIRM_CANCEL_TIMEOUT_H,
  TIMERS,
  TRADE_KEEP_DAYS,
  UNLOCK_CONFIRMATIONS,
};
/** Widened, so a test may hand in a changed value of any constant. */
type Imported = { [K in keyof typeof IMPORTED]: (typeof IMPORTED)[K] extends number ? number : (typeof IMPORTED)[K] };

/**
 * Every timer, limit and count an answer may name, as the words the answer uses, rebuilt from the
 * constant in the code. A question lists the keys it uses in `facts`.
 */
function buildFacts(c: Imported = IMPORTED, read: (p: string) => string = source): Record<string, string> {
  const k = (file: string, name: string) => constIn(file, name, read);
  const blockSeconds = Number(/blockSeconds = (\d+)/.exec(read('packages/trade/src/machine.ts'))![1]);
  return {
    feePercent: `${Number(c.X2F_FEE_BPS) / 100}%`,
    pgpCodeMinutes: `${k('apps/api/src/auth/pgp.ts', 'PGP_CHALLENGE_TTL_MS') / MIN} minutes`,
    pgpRsaBits: `${k('packages/accounts/src/pgp.ts', 'MIN_RSA_BITS')} bits`,
    traderSessionHours: `${orList(hoursList('trader', read))} hours`,
    vendorSessionHours: `${orList(hoursList('vendor', read))} hours`,
    sessionPromptMinutes: `${k('packages/accounts/src/sessionLength.ts', 'SESSION_PROMPT_MS') / MIN} minutes`,
    inactiveDays: `${k('apps/api/src/accountInactivity.ts', 'INACTIVE_MS') / DAY} days`,
    maxCurrencies: `up to ${c.MAX_CURRENCIES} currencies`,
    maxMethods: `up to ${c.MAX_METHODS} payment methods`,
    offerCapBuy: `${keyIn('apps/api/src/offers/routes.ts', 'buy', read)} buy offers`,
    offerCapSell: `${keyIn('apps/api/src/offers/routes.ts', 'sell', read)} sell offers`,
    maxMarginPercent: `${c.MAX_MARGIN_BPS / 100}%`,
    maxBands: `up to ${c.MAX_BANDS} bands`,
    bandMinTrades: orList(c.BAND_MIN_TRADES),
    launchCapUsd: `${(Number(c.LAUNCH_TRADE_CAP_USD_CENTS) / 100).toLocaleString('en-US')} US dollars`,
    setupMinutes: `${c.TIMERS.setupMin} minutes`,
    fundMinutes: `${c.TIMERS.fundMin} minutes`,
    extendMinutes: `${c.TIMERS.extendMin} more minutes`,
    maxExtensions: `up to ${c.TIMERS.maxExtensions} times`,
    unlockConfirmations: `${c.UNLOCK_CONFIRMATIONS} confirmations`,
    confirmCancelHours: `${c.SELLER_CONFIRM_CANCEL_TIMEOUT_H} hours`,
    nudgeMinutes: `every ${k('apps/api/src/nudge/routes.ts', 'NUDGE_GAP_MS') / MIN} minutes`,
    giftCardAgeDays: `last ${c.GIFT_CARD_MAX_AGE_DAYS} days`,
    giftCardCheckMinutes: `${c.GIFT_CARD_CHECK_MIN} minutes`,
    // The example card the app's own gift-card words name (giftCardCopy.ts rangeCardOnly, G52).
    giftCardRangeExample: /like a (Visa \d+ to \d+)/.exec(c.GIFT_CARD_RANGE)![1]!,
    escrowKeys: `${k('packages/escrow/src/monero.ts', 'SIGNERS')} keys`,
    escrowThreshold: `Any ${k('packages/escrow/src/monero.ts', 'THRESHOLD')} keys`,
    checkWords: `${k('packages/trade/src/checkWords.ts', 'WORDS')} words`,
    unlockMinutes: `about ${(c.UNLOCK_CONFIRMATIONS * blockSeconds) / 60} minutes`,
    rulingGoalHours: `within ${k('packages/staff/src/dispute.ts', 'RULING_GOAL_H')} hours`,
    appealWindowHours: `within ${keyIn('apps/api/src/staff/settingsDefaults.ts', 'appealWindowH', read)} hours of the ruling`,
    appealGoalHours: `decide within ${k('packages/staff/src/dispute.ts', 'APPEAL_GOAL_H')} hours`,
    minMethodKinds: `at least ${['no', 'one', 'two', 'three', 'four'][k('packages/accounts/src/loginRule.ts', 'MIN_METHOD_KINDS')]} different kinds`,
    recoveryWindowMinutes: `${k('apps/api/src/auth/sessions.ts', 'RECOVERY_WINDOW_MS') / MIN} minutes`,
    approvalMinutes: `${k('apps/api/src/auth/approval.ts', 'APPROVAL_TTL_MS') / MIN} minutes`,
    maxDevices: `up to ${k('apps/api/src/auth/approval.ts', 'DEFAULT_MAX_DEVICES')} at a time`,
    trustedDeviceDays: `${k('apps/api/src/auth/device.ts', 'TRUSTED_DEVICE_TTL_MS') / DAY} days`,
    maxTeamMembers: `up to ${k('apps/api/src/team/perms.ts', 'MAX_TEAM_MEMBERS')} team members`,
    inviteHours: `${k('apps/api/src/team/members.ts', 'INVITE_TTL_MS') / HOUR} hours`,
    chatAfterCloseDays: `${c.CHAT_AFTER_CLOSE_DAYS} days after the trade closes`,
    chatAfterDisputeDays: `${c.CHAT_AFTER_DISPUTE_DAYS} days after the dispute closes`,
    chatPretradeDays: `${c.CHAT_PRETRADE_IDLE_DAYS} days without a message`,
    chatPurgedMarkYear: withinDays(k('apps/api/src/chat/retention.ts', 'CHAT_PURGED_MARK_DAYS')),
    tradeKeepDays: `${c.TRADE_KEEP_DAYS} days after it closes`,
    tradeDisputeKeepDays: `${c.DISPUTE_KEEP_DAYS} days after the dispute closes`,
    addressDays: `${k('apps/api/src/trades/purge.ts', 'TRADE_ADDRESS_RETENTION_MS') / DAY} days after the trade closes`,
  };
}
const FACTS = buildFacts();

/**
 * What the facts check finds wrong with `questions` against `facts`: a fact an answer does not say,
 * an unknown fact, or a number no fact covers. Empty when all is well.
 */
function factProblems(questions: readonly HelpQuestion[], facts: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const q of questions) {
    // Names that hold a digit but no number: X2F and the PGP key types.
    let rest = `${q.q}\n${q.a}`.replace(/\b(?:X2F|Ed25519|Ed448)\b/g, 'NAME');
    for (const key of q.facts ?? []) {
      const words = facts[key];
      if (words === undefined) {
        problems.push(`${q.id}: unknown fact ${key}`);
        continue;
      }
      if (!rest.includes(words) && !`${q.q}\n${q.a}`.includes(words)) problems.push(`${q.id}: says "${words}" (${key})`);
      rest = rest.split(words).join(' ');
    }
    // Whatever is left holds no number: a new one needs a fact rebuilt from the code above.
    if (/\d/.test(rest)) problems.push(`${q.id}: a number with no fact`);
    if (/\b(?:two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|thirty|forty|sixty|ninety|hundred)\b/i.test(rest)) {
      problems.push(`${q.id}: a number in words with no fact`);
    }
  }
  return problems;
}

/** A source note's parts: `path:line[-line] words`, or null when it is not in that form. */
function parseNote(s: string): { path: string; first: number; last: number | undefined; words: string } | null {
  const m = /^([\w./-]+):(\d+)(?:-(\d+))? (.+)$/.exec(s);
  if (m === null) return null;
  return { path: m[1]!, first: Number(m[2]), last: m[3] === undefined ? undefined : Number(m[3]), words: m[4]! };
}

/** How far a note's words may drift from its cited line(s) and still pass (lead, 20 Nov). */
const NOTE_SLACK = 40;

/**
 * What is wrong with the questions' source notes. A note passes when its words are in its file
 * within NOTE_SLACK lines of the cited line (or range), so adding lines to a cited file does not
 * break this test. It warns, naming the line, when the words are only further away and are in the
 * file exactly once. It fails when the note is malformed, the file is gone, or the words are not in
 * the file, or are only further away and more than once (lead default: a note that cannot be told
 * apart is a failure, not a guess).
 */
function noteProblems(
  questions: readonly HelpQuestion[],
  read: (p: string) => string = source,
  exists: (p: string) => boolean = (p) => existsSync(join(ROOT, p)),
): { failures: string[]; warnings: string[] } {
  const failures: string[] = [];
  const warnings: string[] = [];
  for (const q of questions) {
    for (const s of q.sources) {
      const n = parseNote(s);
      if (n === null) {
        failures.push(`${q.id}: "${s}" is not "path:line[-line] words"`);
        continue;
      }
      if (!exists(n.path)) {
        failures.push(`${q.id}: ${s}: no such file`);
        continue;
      }
      const to = n.last ?? n.first;
      if (n.first < 1 || to < n.first) {
        failures.push(`${q.id}: ${s}: the line range is backwards or below 1`);
        continue;
      }
      const hits = read(n.path)
        .split('\n')
        .flatMap((line, i) => (line.includes(n.words) ? [i + 1] : []));
      if (hits.length === 0) failures.push(`${q.id}: ${s}: "${n.words}" is not in the file`);
      else if (hits.some((h) => h >= n.first - NOTE_SLACK && h <= to + NOTE_SLACK)) continue;
      else if (hits.length === 1) warnings.push(`${q.id}: ${s}: the words are now at line ${hits[0]}; re-point the note`);
      else failures.push(`${q.id}: ${s}: "${n.words}" is ${hits.length} times in the file, none within ${NOTE_SLACK} lines`);
    }
  }
  return { failures, warnings };
}

/** `file` as it is, but with `from` replaced by `to` (the text must be there exactly once). */
function edited(file: string, from: string, to: string): (p: string) => string {
  const text = source(file);
  if (text.split(from).length !== 2) throw new Error(`"${from}" is not in ${file} exactly once`);
  return (p) => (p === file ? text.replace(from, to) : source(p));
}

describe('the help library content', () => {
  it('holds 60 to 100 questions, each with a unique link id, in a known topic, and every topic has questions', () => {
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(60);
    expect(QUESTIONS.length).toBeLessThanOrEqual(100);
    const ids = QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    const topics = new Set(LIBRARY_TOPICS.map((t) => t.id));
    for (const q of QUESTIONS) expect(topics.has(q.topic), q.id).toBe(true);
    for (const t of LIBRARY_TOPICS) expect(QUESTIONS.some((q) => q.topic === t.id), t.id).toBe(true);
  });

  it.for(VARIANTS)('every answer has a source note, and each note still points at the words it names (%s)', async ([, questions], { annotate }) => {
    for (const q of questions) expect(q.sources.length, q.id).toBeGreaterThan(0);
    const { failures, warnings } = noteProblems(questions);
    // A note whose words sit only somewhere else in its file still passes, but says where they are
    // now: an annotation, which the reporter shows even on a passing test (console output is hidden).
    for (const w of warnings) await annotate(`help library source note: ${w}`, 'warning');
    expect(failures).toEqual([]);
  });

  // Lead, 20 Nov: a note no longer pins its exact line (every branch that added lines to a cited
  // file broke this test), but its words must still be in the cited file. Each case edits a real
  // cited file under a real note and checks what the note check then says.
  describe('the source-note check', () => {
    const note = QUESTIONS.flatMap((q) => q.sources.map((s) => ({ q, s, ...parseNote(s)! }))).find(
      // A one-line note far enough down its file to move 20 up, whose words are in the file once.
      (n) => n.last === undefined && n.first > 60 && source(n.path).split(n.words).length === 2,
    )!;
    const lines = source(note.path).split('\n');
    const withLines = (next: string[]) => (p: string) => (p === note.path ? next.join('\n') : source(p));
    const only = [{ ...note.q, sources: [note.s] }];
    const at0 = note.first - 1;

    it('passes the note as it is on main, with no warning', () => {
      expect(noteProblems(only)).toEqual({ failures: [], warnings: [] });
    });

    it('red: a note whose words were deleted from its file fails', () => {
      const gone = lines.map((l) => l.split(note.words).join(''));
      const { failures, warnings } = noteProblems(only, withLines(gone));
      expect(failures).toHaveLength(1);
      expect(failures[0]).toContain('not in the file');
      expect(warnings).toEqual([]);
    });

    it('red: a note whose file is gone fails', () => {
      const { failures } = noteProblems(only, source, (p) => p !== note.path && existsSync(join(ROOT, p)));
      expect(failures).toHaveLength(1);
      expect(failures[0]).toContain('no such file');
    });

    it('green: a note whose line moved by 20 (down or up) passes with no warning', () => {
      const down = [...lines.slice(0, at0), ...Array<string>(20).fill(''), ...lines.slice(at0)];
      expect(noteProblems(only, withLines(down))).toEqual({ failures: [], warnings: [] });
      // Up by 20: the 20 lines above it are gone (the words are in the file once, on the note's line).
      const up = [...lines.slice(0, at0 - 20), ...lines.slice(at0)];
      expect(noteProblems(only, withLines(up))).toEqual({ failures: [], warnings: [] });
    });

    it('a note moved further than 40 lines warns, naming the line, when its words are in the file once', () => {
      const far = [...lines.slice(0, at0), ...Array<string>(41).fill(''), ...lines.slice(at0)];
      const { failures, warnings } = noteProblems(only, withLines(far));
      expect(failures).toEqual([]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(`now at line ${note.first + 41}`);
    });

    it('a note moved further than 40 lines fails when its words are in the file more than once', () => {
      const far = [...lines.slice(0, at0), ...Array<string>(41).fill(''), ...lines.slice(at0), note.words];
      const { failures, warnings } = noteProblems(only, withLines(far));
      expect(failures).toHaveLength(1);
      expect(failures[0]).toContain('2 times');
      expect(warnings).toEqual([]);
    });

    it('a note that is not "path:line[-line] words" fails', () => {
      expect(noteProblems([{ ...note.q, sources: ['no line here'] }]).failures).toHaveLength(1);
    });
  });

  it.each(VARIANTS)('every timer, limit and count an answer names matches the constant in the code, and no number goes unchecked (%s)', (_name, questions) => {
    expect(factProblems(questions, FACTS)).toEqual([]);
  });

  // Review m4: the check is rebuilt from the code, so changing a constant (and only the constant,
  // never an answer) turns it red. Each case hands buildFacts a changed constant, as an imported
  // value or as a changed source file, and the same unchanged answers must then fail.
  it.each([
    ['an imported constant (TIMERS.extendMin 30 to 31)', () => buildFacts({ ...IMPORTED, TIMERS: { ...TIMERS, extendMin: (TIMERS.extendMin + 1) as typeof TIMERS.extendMin } }), 'more-time'],
    ['an imported constant (TRADE_KEEP_DAYS)', () => buildFacts({ ...IMPORTED, TRADE_KEEP_DAYS: IMPORTED.TRADE_KEEP_DAYS + 1 }), 'trade-kept addresses-kept'],
    ['a constant read from source (NUDGE_GAP_MS 15 to 20 minutes)', () => buildFacts(IMPORTED, edited('apps/api/src/nudge/routes.ts', 'NUDGE_GAP_MS = 15 * 60_000', 'NUDGE_GAP_MS = 20 * 60_000')), 'nudge'],
    ['an owner-changeable default (appealWindowH 48 to 72)', () => buildFacts(IMPORTED, edited('apps/api/src/staff/settingsDefaults.ts', 'appealWindowH: 48', 'appealWindowH: 72')), 'appeal'],
    ['a constant read from source (CHAT_PURGED_MARK_DAYS 365 to 400)', () => buildFacts(IMPORTED, edited('apps/api/src/chat/retention.ts', 'CHAT_PURGED_MARK_DAYS = 365', 'CHAT_PURGED_MARK_DAYS = 400')), 'device-copy'],
  ] as const)('a changed constant turns the facts check red: %s', (_what, changed, id) => {
    const facts = changed();
    const problems = factProblems(QUESTIONS, facts);
    expect(problems.length).toBeGreaterThan(0);
    const ids = id.split(' ');
    // Red exactly where that constant is named: every answer naming it, and no other.
    expect([...new Set(problems.map((p) => p.split(':')[0]))].sort(), problems.join('\n')).toEqual([...ids].sort());
    // The unchanged code still passes, so the red comes from the change alone.
    expect(factProblems(QUESTIONS, buildFacts())).toEqual([]);
  });

  it.each(VARIANTS)('answers are short (1 to 4 sentences), plain, never "half" about anything, and marked COPY-UNSIGNED (%s)', (_name, questions) => {
    for (const q of questions) {
      const sentences = q.a.split(/(?<=[.?])\s+(?=[A-Z"0-9])/).filter((x) => x.trim() !== '');
      expect(sentences.length, `${q.id}: ${sentences.length} sentences`).toBeGreaterThanOrEqual(1);
      expect(sentences.length, `${q.id}: ${sentences.length} sentences`).toBeLessThanOrEqual(4);
      expect(q.q.trim().endsWith('?') || q.q.trim().endsWith('"'), `${q.id}: the question asks`).toBe(true);
      expect(q.a.trim()).toMatch(/[.]$/);
    }
    for (const text of [...questions.flatMap((q) => [q.q, q.a]), ...LIBRARY_TOPICS.flatMap((t) => [t.title, t.intro])]) {
      expect(text).not.toMatch(/\bhalf\b/i);
    }
    expect(source('apps/web/src/screens/help/helpLibrary.ts')).toContain('COPY-UNSIGNED');
    expect(source('apps/web/src/screens/help/HelpLibrary.tsx')).toContain('COPY-UNSIGNED');
  });

  it.each(VARIANTS)('keeps out the claims an earlier draft got wrong (%s)', (_name, questions) => {
    const all = questions.map((q) => `${q.q} ${q.a}`).join('\n');
    // Members never chat (abilities.ts: every chat route stays owner-only) and there is no 45-day claim window.
    expect(all).not.toMatch(/45[- ]day/i);
    expect(QUESTIONS.find((q) => q.id === 'member-chat')!.a).toMatch(/^Not yet\./);
    // The per-payment-method pay windows are placeholders (owner p11-29): no 90 minutes, 3 hours or the like.
    expect(all).not.toMatch(/\b90 minutes\b|\b3 hours\b/);
    // Review B1: X2F keeps names (the display name, PGP user IDs), so no answer says it keeps no name.
    expect(all).not.toMatch(/keeps no name|asks for no name|no name, email/i);
    // Review B2: the receiver of the trade's XMR pays the network fee, so nobody gets "the full trade amount".
    expect(all).not.toMatch(/full trade amount/i);
    // Review m3: no claim the code does not back.
    expect(all).not.toMatch(/usually sooner|for most trades/i);
    const q = (id: string) => questions.find((x) => x.id === id)!.a;
    // Review B3: main's whole-trade delete, 30 days after an undisputed trade closes.
    expect(q('addresses-kept')).toContain(FACTS.tradeKeepDays);
    expect(q('trade-kept')).toContain(FACTS.tradeKeepDays);
    // Review M4: every number the owner can change in settings is said with "normally".
    expect(q('who-can-post')).toContain(`normally have ${FACTS.offerCapBuy}`);
    expect(q('appeal')).toContain(`normally ${FACTS.appealWindowHours}`);
    expect(q('device-limit')).toContain(`Normally ${FACTS.maxDevices}`);
    // Train-1: a security key needs its PIN.
    expect(q('passkey-or-security-key')).toMatch(/PIN/);
    // Re-review m1: the profile's typical payment time and opt-in traded line are named.
    expect(q('who-sees-profile')).toMatch(/typical payment time/);
    expect(q('who-sees-profile')).toMatch(/XMR you have traded if you chose to show it/);
    // Owner demo note #187 (25 Nov 2026): a trader gives no signature for the Terms, so no answer
    // to a trader speaks of one as theirs (re-review m4's erase sentence went with it).
    expect(q('closed-account-data')).not.toMatch(/signature/i);
    expect(q('what-is-stored')).not.toMatch(/signature/i);
    expect(q('personal-details')).not.toMatch(/sign your name|scribble/i);
    expect(q('create-account')).not.toMatch(/sign them/i);
  });

  it('the proof-upload questions follow the flag: two answers, each with its own sources', () => {
    expect(FLAGGED_QUESTIONS.map((q) => q.id).sort()).toEqual(['moderator-sees', 'payment-proof']);
    for (const f of FLAGGED_QUESTIONS) {
      expect(f.proofUpload.off.a, f.id).not.toBe(f.proofUpload.on.a);
      expect(libraryQuestions(false).find((q) => q.id === f.id)!.a).toBe(f.proofUpload.off.a);
      expect(libraryQuestions(true).find((q) => q.id === f.id)!.a).toBe(f.proofUpload.on.a);
    }
    const off = libraryQuestions(false);
    const on = libraryQuestions(true);
    expect(off.find((q) => q.id === 'payment-proof')!.a).toMatch(/not in the app yet/);
    expect(on.find((q) => q.id === 'payment-proof')!.a).toMatch(/^Yes\./);
    expect(off.find((q) => q.id === 'moderator-sees')!.a).not.toMatch(/unblurred/i);
    expect(on.find((q) => q.id === 'moderator-sees')!.a).toMatch(/request unblurred proof/i);
    // Re-review m2: the staff case cannot open that copy yet (ModCase.tsx), and the answer says so.
    expect(on.find((q) => q.id === 'moderator-sees')!.a).toMatch(/screens do not open it yet/);
    // Both sets hold the same questions in the same order; only those two answers differ.
    expect(on.map((q) => q.id)).toEqual(off.map((q) => q.id));
    // This test run's build has no VITE_X2F_PROOF_UPLOAD, so QUESTIONS is the off set.
    expect(QUESTIONS).toEqual(off);
  });
});

describe('search', () => {
  it('matches every word, in the question or the answer, ignoring case, accents and curly quotes', () => {
    const q = { q: 'What does "I\'ve paid" do?', a: 'It tells the seller your payment was sent.' };
    expect(matches(q, searchWords(''))).toBe(true);
    expect(matches(q, searchWords('PAID seller'))).toBe(true);
    expect(matches(q, searchWords('I’ve'))).toBe(true);
    expect(matches(q, searchWords('sént'))).toBe(true);
    expect(matches(q, searchWords('paid escrow'))).toBe(false);
  });
});

/** Where the router is now (path and hash), for the old-anchor redirect. */
const where = { now: '' };
function Where() {
  const l = useLocation();
  where.now = `${l.pathname}${l.hash}`;
  return null;
}
const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>
        <Route path="/help" element={<HelpTopic />} />
        <Route path="/help/:topic" element={<HelpTopic />} />
      </Routes>
    </MemoryRouter>,
  ).host;

function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  set.call(input, value);
  fire(input, new Event('input', { bubbles: true }));
}
const shownIds = (host: HTMLElement) => [...host.querySelectorAll('[data-question]')].map((e) => e.getAttribute('data-question'));
const click = (el: Element) => fire(el, new MouseEvent('click', { bubbles: true }));
const toggleOf = (host: HTMLElement, id: string) => host.querySelector<HTMLButtonElement>(`[data-question="${id}"] button`)!;

describe('the help page', () => {
  it('/help groups every question under its topic, h1, then an h2 per topic and an h3 per question', () => {
    const host = at('/help');
    expect(host.querySelector('main[data-screen="help"] h1')!.textContent).toBe('Help');
    const groups = [...host.querySelectorAll('section[data-topic]')];
    expect(groups.map((g) => g.getAttribute('data-topic'))).toEqual(LIBRARY_TOPICS.map((t) => t.id));
    for (const g of groups) {
      const h2 = g.querySelector('h2')!;
      expect(g.getAttribute('aria-labelledby')).toBe(h2.id);
      expect(g.querySelectorAll('h3 > button').length).toBe(QUESTIONS.filter((q) => q.topic === g.getAttribute('data-topic')).length);
    }
    expect(shownIds(host)).toHaveLength(QUESTIONS.length);
    expect(host.querySelector('[data-part="help-count"]')!.textContent).toBe(LIBRARY_COPY.count(QUESTIONS.length));
    // /help/faq is the same library.
    expect(shownIds(at('/help/faq'))).toHaveLength(QUESTIONS.length);
  });

  it('a topic page lists only that topic, each question an h2 under the topic\'s h1', () => {
    const host = at('/help/fees');
    expect(host.querySelector('main[data-screen="help-fees"] h1')!.textContent).toBe('Fees');
    const fees = QUESTIONS.filter((q) => q.topic === 'fees').map((q) => q.id);
    expect(shownIds(host)).toEqual(fees);
    expect(host.querySelectorAll('h2 > button')).toHaveLength(fees.length);
    expect(host.querySelector('nav[aria-label="Help topics"] a[aria-current="page"]')!.getAttribute('href')).toBe('/help/fees');
  });

  it('each question is a button that opens and closes its answer, a group (not a landmark) labelled by the question', () => {
    const host = at('/help/escrow');
    const button = toggleOf(host, 'how-escrow-works');
    const panel = host.querySelector<HTMLElement>(`#${CSS.escape(button.getAttribute('aria-controls')!)}`)!;
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(panel.getAttribute('role')).toBe('group');
    expect(panel.getAttribute('aria-labelledby')).toBe(button.id);
    expect(panel.hidden).toBe(true);
    click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(panel.hidden).toBe(false);
    const q = QUESTIONS.find((x) => x.id === 'how-escrow-works')!;
    expect(panel.textContent).toContain(q.a);
    const link = panel.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('/help/escrow#faq-how-escrow-works');
    // Its name starts with the words it shows and names the question, so each link is told apart.
    expect(link.textContent).toBe(LIBRARY_COPY.link);
    expect(link.getAttribute('aria-label')).toBe(`${LIBRARY_COPY.link}: ${q.q}`);
    click(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hidden).toBe(true);
  });

  it('review m7: no answer is a landmark, every answer link has its own name, and every anchor is prefixed', () => {
    const host = at('/help');
    for (const b of host.querySelectorAll<HTMLButtonElement>('[data-question] button')) click(b);
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(0);
    const names = [...host.querySelectorAll('[data-question] a')].map((a) => a.getAttribute('aria-label'));
    expect(names).toHaveLength(QUESTIONS.length);
    expect(new Set(names).size).toBe(QUESTIONS.length);
    for (const li of host.querySelectorAll('[data-question]')) expect(li.id).toBe(questionAnchor(li.getAttribute('data-question')!));
    expect(questionAnchor('price')).toBe('faq-price');
  });

  it('the search box is labelled, filters questions and answers, and says how many match in a live region', () => {
    const host = at('/help');
    const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(host.querySelector(`label[for="${input.id}"]`)!.textContent).toBe(LIBRARY_COPY.searchLabel);
    expect(host.querySelector('[role="search"]')!.contains(input)).toBe(true);
    const status = host.querySelector('[data-part="help-count"]')!;
    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    // "YubiKey" is only in an answer, never in a question.
    expect(QUESTIONS.some((q) => /yubikey/i.test(q.q))).toBe(false);
    type(input, 'yubikey');
    const hits = QUESTIONS.filter((q) => /yubikey/i.test(q.a)).map((q) => q.id);
    expect(hits.length).toBeGreaterThan(0);
    expect(shownIds(host)).toEqual(hits);
    expect(status.textContent).toBe(LIBRARY_COPY.count(hits.length));
    // A topic with nothing matching drops out with its heading.
    expect(host.querySelectorAll('section[data-topic]').length).toBe(new Set(QUESTIONS.filter((q) => hits.includes(q.id)).map((q) => q.topic)).size);
    type(input, 'zzqx');
    expect(shownIds(host)).toEqual([]);
    expect(status.textContent).toBe(LIBRARY_COPY.none('zzqx'));
    type(input, '');
    expect(shownIds(host)).toHaveLength(QUESTIONS.length);
  });

  it('a deep link opens its question and moves the focus to it, on its topic page and on /help', () => {
    const host = at('/help/fees#faq-fee-when');
    const button = toggleOf(host, 'fee-when');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(button);
    // Nothing else is open.
    expect(host.querySelectorAll('button[aria-expanded="true"]')).toHaveLength(1);
    const all = at('/help#faq-appeal');
    expect(toggleOf(all, 'appeal').getAttribute('aria-expanded')).toBe('true');
    // A link to another topic's question opens nothing here.
    const other = at('/help/fees#faq-appeal');
    expect(other.querySelectorAll('button[aria-expanded="true"]')).toHaveLength(0);
    // An anchor that is not a question opens nothing.
    expect(at('/help#faq-nope').querySelectorAll('button[aria-expanded="true"]')).toHaveLength(0);
  });

  it('a link in the first form (#price) is rewritten to #faq-price and still opens its question', () => {
    expect(OLD_ANCHOR_REDIRECTS.size).toBe(QUESTIONS.length);
    for (const q of QUESTIONS) expect(OLD_ANCHOR_REDIRECTS.get(q.id)).toBe(`faq-${q.id}`);
    const host = at('/help/trading#price');
    expect(where.now).toBe('/help/trading#faq-price');
    const button = toggleOf(host, 'price');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(button);
    expect(host.querySelectorAll('button[aria-expanded="true"]')).toHaveLength(1);
    at('/help#bans');
    expect(where.now).toBe('/help#faq-bans');
    // Anything else in the hash is left as it is.
    at('/help#zzqx');
    expect(where.now).toBe('/help#zzqx');
    // Names an object inherits are not questions (re-review m3): they are left as they are.
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(OLD_ANCHOR_REDIRECTS.has(name), name).toBe(false);
      const host = at(`/help#${name}`);
      expect(where.now, name).toBe(`/help#${name}`);
      expect(host.querySelectorAll('button[aria-expanded="true"]'), name).toHaveLength(0);
    }
  });

  it.each([
    ['', 'off'],
    ['1', 'on'],
  ] as const)('the page shows the answers for its build: VITE_X2F_PROOF_UPLOAD=%j is the %s answer', (value, side) => {
    vi.stubEnv('VITE_X2F_PROOF_UPLOAD', value);
    const host = at('/help/trading#faq-payment-proof');
    const flagged = FLAGGED_QUESTIONS.find((q) => q.id === 'payment-proof')!;
    const panel = host.querySelector('[data-question="payment-proof"] [role="group"]')!;
    expect(panel.textContent).toContain(flagged.proofUpload[side].a);
    const mod = at('/help/disputes#faq-moderator-sees');
    expect(mod.querySelector('[data-question="moderator-sees"] [role="group"]')!.textContent).toContain(
      FLAGGED_QUESTIONS.find((q) => q.id === 'moderator-sees')!.proofUpload[side].a,
    );
  });

  it('logged in or out, the library is the same and nothing on it is a primary action', () => {
    const out = at('/help');
    expect(out.querySelectorAll('[data-primary]')).toHaveLength(0);
    state.session = { status: 'signed-in', me: { displayName: 'viewer_1', kind: 'trader', level: 'full', termsCurrent: true, methods: ['password'], hasBackup: true, suggestions: [], holdUntil: null } };
    const inside = at('/help');
    expect(shownIds(inside)).toEqual(shownIds(out));
    expect(inside.querySelector('[data-part="help-back"]')!.getAttribute('href')).toBe('/sell');
  });

  it('Support, Settings and an unknown page point to the library instead of listing it', () => {
    for (const p of ['/help/support', '/help/settings', '/help/nope']) {
      const host = at(p);
      expect(shownIds(host), p).toEqual([]);
      expect(host.querySelector('[data-part="help-browse"]')!.getAttribute('href'), p).toBe('/help');
    }
  });
});
