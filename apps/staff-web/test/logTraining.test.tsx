// @vitest-environment happy-dom
// Plan 4 Task 19: the Activity log page (board StaffLog) and the training library (no board, A8).
// The log: the board's summary lines, the trade code typed with or without dashes, the filters
// sent to the API, "Show older entries", the owner's chain check and log alarm (a moderator never
// asks for them), and one sentence per action that never shows anything but ids and figures. The
// training library: the list of closed cases and the scrubbed case reader with its masks marked.
import { NAV } from '@x2f/staff';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import type { LogEntry } from '../src/api.js';
import { describeLog, whenText } from '../src/screens/logModel.js';
import { button, click, fakeApi, render, settle, typeInto } from './helpers.js';

const webauthn = vi.hoisted(() => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => webauthn);

const later = new Date(Date.now() + 3600_000).toISOString();
const OWNER = { displayName: 'lumen.k', role: 'owner', nav: NAV.owner, sessionEndsAt: later };
const MOD = { displayName: 'dmitri_k', role: 'mod', nav: NAV.mod, sessionEndsAt: later };
const A = 'K7M29QXA4FTR8WPN';
const MOD_ID = '11111111-1111-4111-8111-111111111111';

const entry = (o: Partial<LogEntry>): LogEntry => ({
  id: '1', at: new Date().toISOString(), tradeCode: A, actor: { kind: 'system', role: null, id: null, name: null }, action: 'trade.setup-done', detail: {}, ...o,
});
const ENTRIES: LogEntry[] = [
  entry({ id: '9', action: 'chat.read', actor: { kind: 'staff', role: 'mod', id: MOD_ID, name: 'dmitri_k' } }),
  entry({ id: '8', action: 'trade.mark-paid', actor: { kind: 'trader', role: 'buyer', id: null, name: 'mira.k' } }),
  entry({ id: '7', action: 'trade.chain', detail: { receivedAtomic: '1250000000000', unlockedAtomic: '1250000000000', confirmations: 10 } }),
  entry({ id: '6', tradeCode: null, action: 'settings.changed', actor: { kind: 'staff', role: 'owner', id: 'o', name: 'lumen.k' }, detail: { field: 'large_trade_limit_usd', from: 500, to: 1000 } }),
];

async function open(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  await settle();
}
const rows = (label: string) => [...document.querySelectorAll(`table[aria-label="${label}"] tbody tr`)].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
const summary = () => document.querySelector('[data-part="summary"]')?.textContent;

function logApi(me: unknown, over: Record<string, unknown> = {}) {
  return fakeApi({
    'GET /staff/v1/me': { body: me },
    'GET /staff/v1/log': (_b, path) => {
      const q = new URL(path, 'https://x').searchParams;
      if (q.get('before') === '6') return { body: { scope: 'all', entries: [entry({ id: '5', action: 'site.stopped', tradeCode: null })], names: {}, next: null } };
      if (q.get('code') && q.get('code') !== 'K7M2-9QXA-4FTR-8WPN') return { body: { scope: 'all', entries: [], names: {}, next: null } };
      return { body: { scope: 'all', entries: ENTRIES, names: { [MOD_ID]: 'dmitri_k' }, next: '6' } };
    },
    'GET /staff/v1/log/filters': { body: { scope: 'all', actors: [{ id: MOD_ID, name: 'dmitri_k', role: 'mod' }], kinds: ['trade', 'dispute', 'chat', 'ruling', 'account', 'staff', 'owner', 'site', 'other'] } },
    'GET /staff/v1/log/active-disputes': { body: { items: [{ code: A, method: 'ZELLE', methodName: 'Zelle', xmr: '1800000000000', status: 'awaiting-approval' }] } },
    'GET /staff/v1/log/integrity': { body: { checkedAt: new Date().toISOString(), chain: { ok: true, headId: '9' }, entries: 9, alarm: null } },
    ...over,
  } as Parameters<typeof fakeApi>[0]);
}

describe('StaffLog', () => {
  it('shows the board\'s table, one sentence per entry, and the board\'s summary', async () => {
    logApi(OWNER);
    await open('/log');
    expect(document.querySelector('[data-screen="staff-log"]')).not.toBeNull();
    expect([...document.querySelectorAll('table[aria-label="Activity log"] th')].map((t) => t.textContent)).toEqual(['When', 'Trade', 'Who', 'What happened']);
    const r = rows('Activity log');
    expect(r.map((x) => x[1])).toEqual(['K7M2-9QXA-4FTR-8WPN', 'K7M2-9QXA-4FTR-8WPN', 'K7M2-9QXA-4FTR-8WPN', '']);
    expect(r.map((x) => x[2])).toEqual(['dmitri_k Moderator', 'mira.k Buyer', 'system ', 'lumen.k Owner']);
    expect(r.map((x) => x[3])).toEqual([
      'Opened the trade chat', "Tapped I've paid", 'Escrow secured after 10 confirmations', 'Changed the large-trade limit from 500 to 1,000 USD',
    ]);
    expect(r[0]![0]).toMatch(/^Today \d\d:\d\d$/);
    expect(summary()).toBe('Showing everything, newest first.');
    const select = document.querySelector<HTMLSelectElement>('select')!;
    expect([...select.options].map((o) => o.textContent)).toEqual(['Active disputes (1)', 'K7M2-9QXA-4FTR-8WPN · Zelle · 1.80 XMR · waiting for approval']);
  });

  it('searches by a code typed without dashes, and says when a code has no entries', async () => {
    const api = logApi(OWNER);
    await open('/log');
    typeInto(document.querySelector('input[type="search"]'), 'k7m29qxa4ftr8wpn');
    await settle();
    expect(api.calls.some((c) => c.path === '/staff/v1/log?code=K7M2-9QXA-4FTR-8WPN')).toBe(true);
    expect(summary()).toBe('4+ entries for trade K7M29QXA4FTR8WPN, newest first.');
    typeInto(document.querySelector('input[type="search"]'), '3hw8-zd2n-rt6k-q9vb');
    await settle();
    expect(summary()).toBe('No entries for 3HW8-ZD2N-RT6K-Q9VB. Check the code and try again.');
    // Not a code at all: no call, the board's sentence.
    const before = api.calls.length;
    typeInto(document.querySelector('input[type="search"]'), 'nope');
    await settle();
    expect(api.calls.length).toBe(before);
    expect(summary()).toBe('No entries for NOPE. Check the code and try again.');
    await click(button('Show everything'));
    expect(summary()).toBe('Showing everything, newest first.');
  });

  it('sends who, kind and the dates as filters, and pages with Show older entries', async () => {
    const api = logApi(OWNER);
    await open('/log');
    const selects = [...document.querySelectorAll<HTMLSelectElement>('select')];
    const set = async (el: HTMLSelectElement | HTMLInputElement, v: string) => {
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v);
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
      await settle();
    };
    await set(selects[1]!, MOD_ID);
    await set(selects[2]!, 'chat');
    const dates = [...document.querySelectorAll<HTMLInputElement>('input[type="date"]')];
    await set(dates[0]!, '2026-11-01');
    await set(dates[1]!, '2026-11-02');
    expect(api.calls.map((c) => c.path)).toContain(`/staff/v1/log?actor=${MOD_ID}&kind=chat&from=2026-11-01&to=2026-11-02`);
    await click(button('Show everything'));
    await click(button('Show older entries'));
    expect(api.calls.map((c) => c.path)).toContain('/staff/v1/log?before=6');
    expect(rows('Activity log')).toHaveLength(5);
    expect(button('Show older entries')).toBeUndefined();
  });

  it('the owner sees the chain check, a broken chain and the log alarm', async () => {
    logApi(OWNER);
    await open('/log');
    expect(document.querySelector('[data-part="integrity"]')?.textContent).toMatch(/^Chain check passed at \d\d:\d\d: all 9 entries link up and none has been changed\./);
    document.body.innerHTML = '';
    logApi(OWNER, {
      'GET /staff/v1/log/integrity': { body: { checkedAt: new Date().toISOString(), chain: { ok: false, brokenAt: '42' }, entries: 50, alarm: '2026-11-10T08:00:00.000Z' } },
    });
    await open('/log');
    const text = document.querySelector('[data-part="integrity"]')?.textContent ?? '';
    expect(text).toMatch(/The activity log failed its integrity check at \d\d:\d\d\. Contact your security reviewer\./);
    expect(text).toContain('Chain check failed at entry 42: an entry was changed or removed.');
  });

  it('a moderator gets the staff scope\'s words, no chain check, and "Clear filters"', async () => {
    const api = logApi(MOD);
    await open('/log');
    expect(summary()).toBe('Showing every entry on disputed trades, newest first.');
    expect(document.querySelector('[data-part="integrity"]')).toBeNull();
    expect(api.calls.some((c) => c.path === '/staff/v1/log/integrity')).toBe(false);
    typeInto(document.querySelector('input[type="search"]'), A);
    await settle();
    expect(button('Show everything')).toBeUndefined();
    expect(button('Clear filters')).toBeDefined();
  });
});

describe('describeLog', () => {
  it('has a sentence for every entry kind and never prints a detail it was not given a name for', () => {
    const d = (action: string, detail: Record<string, unknown> = {}) => describeLog({ action, detail, actor: { kind: 'staff', role: 'mod', id: MOD_ID, name: 'x' } }, { [MOD_ID]: 'dmitri_k' });
    expect(d('proof.unblurred-requested', { side: 'buyer' })).toBe('Requested the unblurred payment proof from the buyer');
    expect(d('ruling.proposed', { outcome: 'release-to-buyer', amountAtomic: '1800000000000' })).toBe('Proposed a ruling: release 1.80 XMR to the buyer');
    expect(d('staff.session-ended-hours', { staffId: MOD_ID })).toBe("Ended dmitri_k's session at the end of their login hours");
    expect(d('staff.invite-created', { inviteId: 'i', role: 'mod' })).toBe('Created an invite link for a new moderator');
    expect(d('staff.switched-off', { staffId: '22222222-2222-4222-8222-222222222222' })).toBe('Switched off a staff member');
    expect(d('chat.read', {})).toBe('Opened the trade chat');
    // A withheld entry says so.
    expect(describeLog({ action: 'chat.read', detail: {}, actor: { kind: 'system', role: null, id: null, name: null }, withheld: true })).toMatch(/not shown\)$/);
  });

  it('"When" is today, yesterday or the day', () => {
    const now = new Date(2026, 10, 18, 12, 0);
    expect(whenText(new Date(2026, 10, 18, 9, 50).toISOString(), now)).toBe('Today 09:50');
    expect(whenText(new Date(2026, 10, 17, 22, 10).toISOString(), now)).toBe('Yesterday 22:10');
    expect(whenText(new Date(2026, 10, 12, 8, 5).toISOString(), now)).toBe('12 Nov 08:05');
  });
});

const ITEM = { id: 'a'.repeat(32), closedOn: '2026-11-13', method: 'REVOLUT', methodName: 'Revolut', xmr: '1250000000000', outcome: 'release-to-buyer', overturned: false, afterRefund: false };
const CASE = {
  ...ITEM,
  tradeCode: 'XXXX-XXXX-XXXX-XXXX', openedBy: 'seller', reason: 'paid', closedAt: 'T+52:00', chat: 'not-available',
  note: { text: 'Buyer never paid, call me on [phone]', masks: [{ start: 29, end: 36, kind: 'phone' }] },
  rulings: [{ round: 1, outcome: 'release-to-buyer', at: 'T+3:00', reason: { text: "Buyer's card [card] paid Seller.", masks: [{ start: 13, end: 19, kind: 'card' }] }, evidence: [{ text: 'Screenshot sent by Seller', masks: [] }] }],
  appeal: null,
  timeline: [{ at: 'T+0:00', who: 'Seller', action: 'dispute.opened' }, { at: 'T+3:00', who: 'Moderator', action: 'ruling.published' }],
};

describe('Training library', () => {
  it('lists the closed cases and opens one, its masks marked, the chat not available', async () => {
    const api = fakeApi({
      'GET /staff/v1/me': { body: MOD },
      'GET /staff/v1/training': { body: { items: [ITEM], next: null } },
      [`GET /staff/v1/training/${ITEM.id}`]: { body: CASE },
    });
    await open('/training');
    expect(document.querySelector('[data-screen="training"]')).not.toBeNull();
    expect(rows('Training cases')).toEqual([['2026-11-13', 'Revolut', '1.25 XMR', 'Release to buyer', 'Read the case']]);
    await click([...document.querySelectorAll('a')].find((a) => a.textContent === 'Read the case'));
    expect(api.calls.map((c) => c.path)).toContain(`/staff/v1/training/${ITEM.id}`);
    const page = document.querySelector('[data-screen="training-case"]')!;
    expect(page.textContent).toContain('XXXX-XXXX-XXXX-XXXX');
    expect([...page.querySelectorAll('mark[data-mask]')].map((m) => [m.textContent, m.getAttribute('data-mask')])).toEqual([
      ['[phone]', 'phone'], ['[card]', 'card'],
    ]);
    expect(page.textContent).toContain("Buyer's card [card] paid Seller.");
    expect(page.querySelector('[data-part="no-chat"]')).not.toBeNull();
    expect(rows('How the case ran')).toEqual([['T+0:00', 'Seller', 'Dispute opened'], ['T+3:00', 'Moderator', 'Published the ruling: release to the buyer']]);
  });

  it('says so when there is no closed case yet', async () => {
    fakeApi({ 'GET /staff/v1/me': { body: MOD }, 'GET /staff/v1/training': { body: { items: [], next: null } } });
    await open('/training');
    expect(rows('Training cases')).toEqual([['No closed cases yet.']]);
  });
});
