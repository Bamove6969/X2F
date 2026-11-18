// @vitest-environment happy-dom
// The help library (owner, 18 Nov 2026; screens/help/helpLibrary.ts and HelpLibrary.tsx): the content
// rules (every answer has a source note that still points at real code, short plain answers, no
// "half"), the facts check (every timer, limit and count an answer names is rebuilt here from the
// constant in the code, so a changed constant or an undeclared number turns this red), and the page
// (grouping, expand and collapse, search over questions and answers, deep links, accessibility).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
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
  SELLER_CONFIRM_CANCEL_TIMEOUT_H,
  TIMERS,
  UNLOCK_CONFIRMATIONS,
} from '@x2f/trade';
import { LIBRARY_TOPICS, QUESTIONS } from '../src/screens/help/helpLibrary.js';
import { LIBRARY_COPY, matches, searchWords } from '../src/screens/help/HelpLibrary.js';
import { HelpTopic } from '../src/screens/HelpTopic.js';
import { fire, render } from './render.js';

const state = vi.hoisted(() => ({ session: { status: 'signed-out' } as unknown }));
vi.mock('../src/session/useSession.js', async (orig) => ({ ...(await orig<object>()), useSession: () => state.session }));
afterEach(() => {
  state.session = { status: 'signed-out' };
});

const ROOT = join(import.meta.dirname, '..', '..', '..');
const source = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/**
 * The number a constant is set to in a source file, for the constants the web app does not import
 * (the API's, @x2f/accounts', @x2f/staff's): `NAME = 24 * 3_600_000;` gives 86400000. Only digits,
 * underscores and `*` are read, so anything cleverer fails here instead of guessing.
 */
function constIn(file: string, name: string): number {
  const m = new RegExp(`\\b${name}\\s*(?::[^=]+)?=\\s*([0-9_ *n]+);`).exec(source(file));
  if (m === null) throw new Error(`${name} not found in ${file}`);
  return m[1]!
    .split('*')
    .map((x) => Number(x.replace(/[_\sn]/g, '')))
    .reduce((a, b) => a * b, 1);
}
/** A key's number inside an object literal in a source file: `appealWindowH: 48,`. */
function keyIn(file: string, key: string): number {
  const m = new RegExp(`\\b${key}:\\s*(\\d+)`).exec(source(file));
  if (m === null) throw new Error(`${key} not found in ${file}`);
  return Number(m[1]);
}
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const orList = (ns: readonly number[]) => `${ns.slice(0, -1).join(', ')} or ${ns[ns.length - 1]}`;
const hoursList = (type: 'trader' | 'vendor') => {
  const m = new RegExp(`${type}: \\[([0-9, ]+)\\]`).exec(source('packages/accounts/src/sessionLength.ts'));
  if (m === null) throw new Error(`no ${type} session hours`);
  return m[1]!.split(',').map((x) => Number(x.trim()));
};
const blockSeconds = Number(/blockSeconds = (\d+)/.exec(source('packages/trade/src/machine.ts'))![1]);

/**
 * Every timer, limit and count an answer may name, as the words the answer uses, rebuilt from the
 * constant in the code. A question lists the keys it uses in `facts`.
 */
const FACTS: Record<string, string> = {
  feePercent: `${Number(X2F_FEE_BPS) / 100}%`,
  pgpCodeMinutes: `${constIn('apps/api/src/auth/pgp.ts', 'PGP_CHALLENGE_TTL_MS') / MIN} minutes`,
  pgpRsaBits: `${constIn('packages/accounts/src/pgp.ts', 'MIN_RSA_BITS')} bits`,
  passwordMin: `${constIn('packages/accounts/src/password.ts', 'PASSWORD_MIN')} characters`,
  traderSessionHours: `${orList(hoursList('trader'))} hours`,
  vendorSessionHours: `${orList(hoursList('vendor'))} hours`,
  sessionPromptMinutes: `${constIn('packages/accounts/src/sessionLength.ts', 'SESSION_PROMPT_MS') / MIN} minutes`,
  inactiveDays: `${constIn('apps/api/src/accountInactivity.ts', 'INACTIVE_MS') / DAY} days`,
  maxCurrencies: `up to ${MAX_CURRENCIES} currencies`,
  maxMethods: `up to ${MAX_METHODS} payment methods`,
  offerCapBuy: `${keyIn('apps/api/src/offers/routes.ts', 'buy')} buy offers`,
  offerCapSell: `${keyIn('apps/api/src/offers/routes.ts', 'sell')} sell offers`,
  maxMarginPercent: `${MAX_MARGIN_BPS / 100}%`,
  maxBands: `up to ${MAX_BANDS} bands`,
  bandMinTrades: orList(BAND_MIN_TRADES),
  launchCapUsd: `${(Number(LAUNCH_TRADE_CAP_USD_CENTS) / 100).toLocaleString('en-US')} US dollars`,
  setupMinutes: `${TIMERS.setupMin} minutes`,
  fundMinutes: `${TIMERS.fundMin} minutes`,
  extendMinutes: `${TIMERS.extendMin} more minutes`,
  maxExtensions: `up to ${TIMERS.maxExtensions} times`,
  unlockConfirmations: `${UNLOCK_CONFIRMATIONS} confirmations`,
  confirmCancelHours: `${SELLER_CONFIRM_CANCEL_TIMEOUT_H} hours`,
  nudgeMinutes: `every ${constIn('apps/api/src/nudge/routes.ts', 'NUDGE_GAP_MS') / MIN} minutes`,
  giftCardAgeDays: `last ${GIFT_CARD_MAX_AGE_DAYS} days`,
  giftCardCheckMinutes: `${GIFT_CARD_CHECK_MIN} minutes`,
  // The example card the rule itself names (packages/trade/src/giftCards.ts, G52).
  giftCardRangeExample: /a (Visa \d+ to \d+)/.exec(source('packages/trade/src/giftCards.ts'))![1]!,
  escrowKeys: `${/\d-of-(\d) multisig/.exec(source('docs/public/x2f-crypto-spec.md'))![1]} keys`,
  escrowThreshold: `Any ${constIn('packages/escrow/src/monero.ts', 'THRESHOLD')} keys`,
  checkWords: `${constIn('packages/trade/src/checkWords.ts', 'WORDS')} words`,
  payoutWaitHours: `${constIn('apps/api/src/wallets/routes.ts', 'PAYOUT_WAIT_MS') / HOUR} hours`,
  unlockMinutes: `about ${(UNLOCK_CONFIRMATIONS * blockSeconds) / 60} minutes`,
  rulingGoalHours: `within ${constIn('packages/staff/src/dispute.ts', 'RULING_GOAL_H')} hours`,
  appealWindowHours: `within ${keyIn('apps/api/src/staff/settingsDefaults.ts', 'appealWindowH')} hours of the ruling`,
  appealGoalHours: `decide within ${constIn('packages/staff/src/dispute.ts', 'APPEAL_GOAL_H')} hours`,
  holdHours: `${constIn('apps/api/src/auth/hold.ts', 'HOLD_MS') / HOUR} hours`,
  maxHoldChanges: `Up to ${constIn('apps/api/src/auth/holdChanges.ts', 'MAX_HOLD_CHANGES')} changes`,
  recoveryHoldHours: `${constIn('apps/api/src/auth/recovery.ts', 'RECOVERY_HOLD_MS') / HOUR} hours`,
  approvalMinutes: `${constIn('apps/api/src/auth/approval.ts', 'APPROVAL_TTL_MS') / MIN} minutes`,
  maxDevices: `Up to ${constIn('apps/api/src/auth/approval.ts', 'DEFAULT_MAX_DEVICES')} at a time`,
  trustedDeviceDays: `${constIn('apps/api/src/auth/device.ts', 'TRUSTED_DEVICE_TTL_MS') / DAY} days`,
  maxTeamMembers: `up to ${constIn('apps/api/src/team/perms.ts', 'MAX_TEAM_MEMBERS')} team members`,
  inviteHours: `${constIn('apps/api/src/team/members.ts', 'INVITE_TTL_MS') / HOUR} hours`,
  chatAfterCloseDays: `${CHAT_AFTER_CLOSE_DAYS} days after the trade closes`,
  chatAfterDisputeDays: `${CHAT_AFTER_DISPUTE_DAYS} days after the dispute closes`,
  chatPretradeDays: `${CHAT_PRETRADE_IDLE_DAYS} days without a message`,
  addressDays: `${constIn('apps/api/src/trades/purge.ts', 'TRADE_ADDRESS_RETENTION_MS') / DAY} days after the trade closes`,
};

describe('the help library content', () => {
  it('holds 60 to 90 questions, each with a unique link id, in a known topic, and every topic has questions', () => {
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(60);
    expect(QUESTIONS.length).toBeLessThanOrEqual(90);
    const ids = QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    const topics = new Set(LIBRARY_TOPICS.map((t) => t.id));
    for (const q of QUESTIONS) expect(topics.has(q.topic), q.id).toBe(true);
    for (const t of LIBRARY_TOPICS) expect(QUESTIONS.some((q) => q.topic === t.id), t.id).toBe(true);
  });

  it('every answer has a source note, and each note still points at the words it names', () => {
    for (const q of QUESTIONS) {
      expect(q.sources.length, q.id).toBeGreaterThan(0);
      for (const s of q.sources) {
        const m = /^([\w./-]+):(\d+)(?:-(\d+))? (.+)$/.exec(s);
        expect(m, `${q.id}: "${s}" is not "path:line[-line] words"`).not.toBeNull();
        const [, path, first, last, words] = m!;
        expect(existsSync(join(ROOT, path!)), `${q.id}: ${path} exists`).toBe(true);
        const lines = source(path!).split('\n');
        const from = Number(first);
        const to = last === undefined ? from : Number(last);
        expect(from >= 1 && to >= from && to <= lines.length, `${q.id}: ${s} is inside the file`).toBe(true);
        expect(lines.slice(from - 1, to).join('\n'), `${q.id}: ${s}`).toContain(words);
      }
    }
  });

  it('every timer, limit and count an answer names matches the constant in the code, and no number goes unchecked', () => {
    for (const q of QUESTIONS) {
      let rest = `${q.q}\n${q.a}`;
      for (const key of q.facts ?? []) {
        const words = FACTS[key];
        expect(words, `${q.id}: unknown fact ${key}`).toBeDefined();
        expect(rest.includes(words!) || `${q.q}\n${q.a}`.includes(words!), `${q.id}: says "${words}" (${key})`).toBe(true);
        rest = rest.split(words!).join(' ');
      }
      // Whatever is left holds no number: a new one needs a fact rebuilt from the code above.
      expect(rest, `${q.id}: a number with no fact`).not.toMatch(/\d/);
      expect(rest, `${q.id}: a number in words with no fact`).not.toMatch(/\b(?:two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|thirty|forty|sixty|ninety)\b/i);
    }
  });

  it('a changed constant turns the facts check red (the check is not a copy of the answer)', () => {
    const q = QUESTIONS.find((x) => x.id === 'more-time')!;
    expect(q.a).toContain(FACTS.extendMinutes);
    expect(q.a.replace(String(TIMERS.extendMin), String(TIMERS.extendMin + 1))).not.toContain(FACTS.extendMinutes);
  });

  it('answers are short (1 to 4 sentences), plain, never "half" about anything, and marked COPY-UNSIGNED', () => {
    for (const q of QUESTIONS) {
      const sentences = q.a.split(/(?<=[.?])\s+(?=[A-Z"0-9])/).filter((x) => x.trim() !== '');
      expect(sentences.length, `${q.id}: ${sentences.length} sentences`).toBeGreaterThanOrEqual(1);
      expect(sentences.length, `${q.id}: ${sentences.length} sentences`).toBeLessThanOrEqual(4);
      expect(q.q.trim().endsWith('?') || q.q.trim().endsWith('"'), `${q.id}: the question asks`).toBe(true);
      expect(q.a.trim()).toMatch(/[.]$/);
    }
    for (const text of [...QUESTIONS.flatMap((q) => [q.q, q.a]), ...LIBRARY_TOPICS.flatMap((t) => [t.title, t.intro])]) {
      expect(text).not.toMatch(/\bhalf\b/i);
    }
    expect(source('apps/web/src/screens/help/helpLibrary.ts')).toContain('COPY-UNSIGNED');
    expect(source('apps/web/src/screens/help/HelpLibrary.tsx')).toContain('COPY-UNSIGNED');
  });

  it('keeps out the claims an earlier draft got wrong', () => {
    const all = QUESTIONS.map((q) => `${q.q} ${q.a}`).join('\n');
    // Members never chat (abilities.ts: every chat route stays owner-only) and there is no 45-day claim window.
    expect(all).not.toMatch(/45[- ]day/i);
    expect(QUESTIONS.find((q) => q.id === 'member-chat')!.a).toMatch(/^Not yet\./);
    // The per-payment-method pay windows are placeholders (owner p11-29): no 90 minutes, 3 hours or the like.
    expect(all).not.toMatch(/\b90 minutes\b|\b3 hours\b/);
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

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
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
const toggleOf = (host: HTMLElement, id: string) => host.querySelector<HTMLButtonElement>(`[id="${id}"] button`)!;

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

  it('each question is a button that opens and closes its answer, a region labelled by the question', () => {
    const host = at('/help/escrow');
    const button = toggleOf(host, 'how-escrow-works');
    const panel = host.querySelector<HTMLElement>(`#${CSS.escape(button.getAttribute('aria-controls')!)}`)!;
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(panel.getAttribute('role')).toBe('region');
    expect(panel.getAttribute('aria-labelledby')).toBe(button.id);
    expect(panel.hidden).toBe(true);
    click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain(QUESTIONS.find((q) => q.id === 'how-escrow-works')!.a);
    expect(panel.querySelector('a')!.getAttribute('href')).toBe('/help/escrow#how-escrow-works');
    click(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hidden).toBe(true);
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
    const host = at('/help/fees#fee-when');
    const button = toggleOf(host, 'fee-when');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(button);
    // Nothing else is open.
    expect(host.querySelectorAll('button[aria-expanded="true"]')).toHaveLength(1);
    const all = at('/help#appeal');
    expect(toggleOf(all, 'appeal').getAttribute('aria-expanded')).toBe('true');
    // A link to another topic's question opens nothing here.
    const other = at('/help/fees#appeal');
    expect(other.querySelectorAll('button[aria-expanded="true"]')).toHaveLength(0);
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
