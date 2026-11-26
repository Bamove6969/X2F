// @vitest-environment happy-dom
// Plan 7 Task 4: Settings → Privacy states the retention rule the purges apply, from the shared
// constants: the whole trade (tradeDeleteAt), its chat (chatPurgeDue) and its payment proofs (on
// the chat's rule), and, owner 26 Nov 2026, that an unpaid lien keeps all three until it ends.
import {
  CHAT_AFTER_CLOSE_DAYS,
  CHAT_AFTER_DISPUTE_DAYS,
  CHAT_PRETRADE_IDLE_DAYS,
  DISPUTE_KEEP_DAYS,
  TRADE_KEEP_DAYS,
  chatPurgeDue,
  tradeDeleteAt,
} from '@x2f/trade';
import { readFileSync } from 'node:fs';
import { URL as NodeURL, fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Privacy } from '../src/screens/settings/Privacy.js';
import { PRIVACY_COPY, PRIVACY_PATH } from '../src/screens/settings/privacyCopy.js';
import { settingsTabOf } from '../src/screens/settings/settingsCopy.js';
import { render } from './render.js';

afterEach(() => vi.unstubAllGlobals());

const DAY = 86_400_000;
const T0 = new Date('2026-11-01T00:00:00Z');
const at = (d: number, ms = 0) => new Date(T0.getTime() + d * DAY + ms);
const src = (p: string) => readFileSync(fileURLToPath(new NodeURL(`../src/${p}`, import.meta.url)), 'utf8');

describe('Privacy', () => {
  it('states the rule with the shared numbers, calls no API and offers no choices', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { host } = render(<Privacy />);
    const text = host.textContent ?? '';
    expect(host.querySelector('h1')!.textContent).toBe(PRIVACY_COPY.title);
    expect(text).toContain(`self-destructs ${TRADE_KEEP_DAYS} days after it ends`);
    expect(text).toContain(`kept ${DISPUTE_KEEP_DAYS} days after its last dispute closes`);
    expect(text).toContain(`${CHAT_PRETRADE_IDLE_DAYS} days after its last message`);
    expect(text).toContain('Nobody can delete a trade early, not even X2F.');
    for (const t of [...PRIVACY_COPY.deleted, ...PRIVACY_COPY.stays]) expect(text).toContain(t);
    expect(host.querySelectorAll('input, select, button, textarea')).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('owner 26 Nov 2026: says an unpaid lien keeps the trade, its chat and its payment proofs, and when they go after', () => {
    const lien = PRIVACY_COPY.deleted.find((t) => /lien/.test(t));
    expect(lien).toBeDefined();
    expect(lien).toContain('the trade, its chat and its payment proofs are kept');
    expect(lien).toContain(`deleted ${DISPUTE_KEEP_DAYS} days later, or on their usual date if that comes later`);
  });

  it('the page and the purges agree: one number for the trade, its chat and its proofs, the lien included', () => {
    expect(CHAT_AFTER_CLOSE_DAYS).toBe(TRADE_KEEP_DAYS);
    expect(CHAT_AFTER_DISPUTE_DAYS).toBe(DISPUTE_KEEP_DAYS);
    const trade = { closedAt: T0, disputed: true, disputeOpen: false, disputeClosedAt: at(3), refundDisputeWindowEndsAt: null, awaitingAction: false, watchEndsAt: null };
    const chat = { tradeLinked: true, tradeClosedAt: T0, disputeOpen: false, disputed: true, disputeClosedAt: at(3), createdAt: at(-1), lastMessageAt: null };
    // Unpaid: no date for the trade, and the chat (so the proofs) never due.
    expect(tradeDeleteAt({ ...trade, lienOpen: true })).toBeNull();
    expect(chatPurgeDue({ ...chat, lienOpen: true }, at(4000))).toBe(false);
    // Ended late: DISPUTE_KEEP_DAYS after it ended, for both.
    const late = { lienOpen: false, lienEndedAt: at(200) };
    expect(tradeDeleteAt({ ...trade, ...late })).toEqual(at(200 + DISPUTE_KEEP_DAYS));
    expect(chatPurgeDue({ ...chat, ...late }, at(200 + DISPUTE_KEEP_DAYS))).toBe(false);
    expect(chatPurgeDue({ ...chat, ...late }, at(200 + DISPUTE_KEEP_DAYS, 1))).toBe(true);
    // Ended early: the usual date (DISPUTE_KEEP_DAYS after the dispute closed).
    const early = { lienOpen: false, lienEndedAt: at(1) };
    expect(tradeDeleteAt({ ...trade, ...early })).toEqual(at(3 + DISPUTE_KEEP_DAYS));
    expect(chatPurgeDue({ ...chat, ...early }, at(3 + DISPUTE_KEEP_DAYS, 1))).toBe(true);
  });

  it('types no number of days itself, promises no backup, and every line is COPY-UNSIGNED', () => {
    const copy = src('screens/settings/privacyCopy.ts');
    const body = copy.slice(copy.indexOf('export const PRIVACY_COPY'));
    expect(body.replace(/\/\/.*$/gm, '')).not.toMatch(/\b(7|14|30|31|48|90)\b/);
    expect(JSON.stringify(PRIVACY_COPY)).not.toMatch(/backup/i);
    // One mark per entry: title, link, the two card titles and their two lists.
    expect((body.match(/\/\/ COPY-UNSIGNED/g) ?? []).length).toBe(6);
    expect(src('screens/settings/Privacy.tsx')).not.toMatch(/style=\{/);
  });

  it('is under the Help tab, routed at its path, and linked from Settings → Help', () => {
    expect(settingsTabOf(PRIVACY_PATH)).toBe('help');
    expect(src('App.tsx')).toMatch(/<Route path=\{PRIVACY_PATH\} element=\{<Privacy \/>\} \/>/);
    expect(src('screens/settings/Security.tsx')).toMatch(/<SettingsRow to=\{PRIVACY_PATH\} part="privacy-link">/);
  });
});
