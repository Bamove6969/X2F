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

const ITEM = { id: 'a'.repeat(32), closedMonth: '2026-11', method: 'REVOLUT', methodName: 'Revolut', xmr: '1300000000000', outcome: 'release-to-buyer', overturned: false, afterRefund: false };
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
    // Review m1: the closing month only, and the amount the API rounded, shown as rounded.
    expect(rows('Training cases')).toEqual([['2026-11', 'Revolut', 'about 1.30 XMR', 'Release to buyer', 'Read the case']]);
    // Review m6: no purge is promised before Task 23 deletes dispute records.
    const lead = document.querySelector('[data-screen="training"] .x2f-staff-page__lead')!.textContent!;
    expect(lead).not.toMatch(/90 days|\bdays?\b/);
    expect(lead).toContain('Closed disputes');
    await click([...document.querySelectorAll('a')].find((a) => a.textContent === 'Read the case'));
    expect(api.calls.map((c) => c.path)).toContain(`/staff/v1/training/${ITEM.id}`);
    const page = document.querySelector('[data-screen="training-case"]')!;
    expect(page.textContent).toContain('XXXX-XXXX-XXXX-XXXX');
    expect(page.textContent).toContain('about 1.30 XMR · closed in 2026-11 (T+52:00 after it opened)');
    expect(page.textContent).not.toContain('2026-11-13');
    expect([...page.querySelectorAll('mark[data-mask]')].map((m) => [m.textContent, m.getAttribute('data-mask')])).toEqual([
      ['[phone]', 'phone'], ['[card]', 'card'],
    ]);
    expect(page.textContent).toContain("Buyer's card [card] paid Seller.");
    expect(page.querySelector('[data-part="no-chat"]')).not.toBeNull();
    expect(rows('How the case ran')).toEqual([['T+0:00', 'Seller', 'Dispute opened'], ['T+3:00', 'Moderator', 'Published the ruling']]);
  });

  it('says so when no case is in the library yet; a moderator is not offered the review', async () => {
    fakeApi({ 'GET /staff/v1/me': { body: MOD }, 'GET /staff/v1/training': { body: { items: [], next: null } } });
    await open('/training');
    expect(rows('Training cases')).toEqual([['No training cases yet.']]);
    expect(document.querySelector('a[href="/training/review"]')).toBeNull();
  });
});

// Lead call 18 Nov (re-review): the library is review-first. The owner (training.curate) reviews each
// closed case pre-masked, hides more text by selecting it or a whole text, and marks it.
describe('Training review (curator)', () => {
  const REVIEW = {
    ...CASE,
    status: 'unmarked',
    manual: [],
    fields: {
      note: CASE.note,
      'ruling.1.reason': CASE.rulings[0]!.reason,
      'ruling.1.evidence.0': CASE.rulings[0]!.evidence[0]!,
    },
  };
  const reviewApi = (over: Record<string, unknown> = {}) =>
    fakeApi({
      'GET /staff/v1/me': { body: OWNER },
      'GET /staff/v1/training': { body: { items: [], next: null } },
      'GET /staff/v1/training/review': { body: { items: [{ ...ITEM, status: 'unmarked' }, { ...ITEM, id: 'b'.repeat(32), status: 'stale' }] } },
      [`GET /staff/v1/training/review/${ITEM.id}`]: { body: { ...REVIEW, ...over } },
      [`PUT /staff/v1/training/review/${ITEM.id}`]: { body: { id: ITEM.id, status: 'marked' } },
      [`DELETE /staff/v1/training/review/${ITEM.id}`]: { body: { id: ITEM.id, status: 'unmarked' } },
    });

  /** Selects `text` inside the review field `field` (across marks too), as a curator dragging over it would. */
  function select(field: string, text: string) {
    const box = document.querySelector(`[data-field="${field}"] [data-part="field-text"]`)!;
    const at = (box.textContent ?? '').indexOf(text);
    if (at < 0) throw new Error(`no ${text} in ${field}`);
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    const r = document.createRange();
    let seen = 0;
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      const len = (n.textContent ?? '').length;
      if (at >= seen && at < seen + len) r.setStart(n, at - seen);
      if (at + text.length > seen && at + text.length <= seen + len) r.setEnd(n, at + text.length - seen);
      seen += len;
    }
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
  }

  it('the owner reaches the review from the library and sees each closed case\'s status', async () => {
    reviewApi();
    await open('/training');
    await click(document.querySelector('a[href="/training/review"]'));
    expect(document.querySelector('[data-screen="training-review"]')).not.toBeNull();
    expect(rows('Closed cases')).toEqual([
      ['2026-11', 'Revolut', 'about 1.30 XMR', 'Release to buyer', 'Not in the library', 'Review the case'],
      ['2026-11', 'Revolut', 'about 1.30 XMR', 'Release to buyer', 'Hidden: review the masks again', 'Review the case'],
    ]);
  });

  it('hides a selected stretch and a whole text, then marks the case with exactly those masks', async () => {
    const api = reviewApi();
    await open(`/training/review/${ITEM.id}`);
    const page = document.querySelector('[data-screen="training-review-case"]')!;
    expect(page.querySelector('[data-field="note"]')!.textContent).toContain('Buyer never paid, call me on [phone]');
    select('note', 'never paid');
    await click(button('Hide the selected text', page.querySelector('[data-field="note"]')!));
    expect([...page.querySelectorAll('[data-field="note"] mark[data-mask="manual"]')].map((m) => m.textContent)).toEqual(['never paid']);
    await click(button('Hide this whole text', page.querySelector('[data-field="ruling.1.evidence.0"]')!));
    // A selection that cuts into an automatic mask is refused, and nothing is added.
    select('note', 'on [ph');
    await click(button('Hide the selected text', page.querySelector('[data-field="note"]')!));
    expect(page.textContent).toContain('Select whole words outside the marked details.');
    expect(page.querySelectorAll('[data-field="note"] mark[data-mask="manual"]')).toHaveLength(1);
    await click(button('Mark as training case'));
    const put = api.calls.find((c) => c.method === 'PUT')!;
    expect(put.path).toBe(`/staff/v1/training/review/${ITEM.id}`);
    expect(put.body).toEqual({ masks: [{ field: 'note', start: 6, end: 16 }, { field: 'ruling.1.evidence.0', whole: true }] });
    expect(page.textContent).toContain('This case is in the training library.');
  });

  it('a stale case says why it is hidden; a marked one can be unmarked', async () => {
    const api = reviewApi({ status: 'stale', manual: [{ field: 'note', start: 6, end: 16 }] });
    await open(`/training/review/${ITEM.id}`);
    expect(document.querySelector('[data-part="review-status"]')!.textContent).toContain('no longer fit');
    await click(button('Take it out of the library'));
    expect(api.calls.some((c) => c.method === 'DELETE' && c.path === `/staff/v1/training/review/${ITEM.id}`)).toBe(true);
    expect(document.querySelector('[data-part="review-status"]')!.textContent).toContain('not in the training library');
  });

  it('describes marking and unmarking in the log', () => {
    const d = (action: string, detail: Record<string, unknown>) => describeLog({ action, detail, actor: { kind: 'staff', role: 'owner', id: 'o', name: 'lumen.k' } });
    expect(d('staff.training-marked', { trainingId: 'a'.repeat(32), masks: 2 })).toBe('Marked a case for the training library (2 extra masks)');
    expect(d('staff.training-unmarked', { trainingId: 'a'.repeat(32) })).toBe('Took a case out of the training library');
  });
});
