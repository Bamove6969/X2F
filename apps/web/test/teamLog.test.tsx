// @vitest-environment happy-dom
// Team audit v2: the Team log screen against a stubbed API.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { teamLogExportPath, teamLogQuery, type TeamLogEntry } from '@x2f/auth-client';
import { catalogueView } from '../../api/src/team/abilities.js';
import { TeamLog, filterOfDraft, parseFingerprint } from '../src/screens/settings/TeamLog.js';
import { logFacts, logSentence } from '../src/screens/settings/teamLogCopy.js';
import { refreshSession } from '../src/session/useSession.js';
import { fire, render } from './render.js';

const H = 'a'.repeat(64);

function entry(e: Partial<TeamLogEntry>): TeamLogEntry {
  return {
    id: '1', at: '2026-11-26T10:00:00.000Z', actorKind: 'member', memberId: 'm1', memberName: 'Aurora', byLead: false, subjectId: 'm1', subjectName: 'Aurora',
    category: 'work', action: 'mark-paid', tradeCode: null, detail: {}, hash: H, prevHash: null, ...e,
  };
}

let calls: string[];
let meMember: unknown;
let pages: Record<string, { entries: TeamLogEntry[]; next: string | null }>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  calls = [];
  meMember = null;
  pages = {
    '/v1/team/log': {
      entries: [
        entry({ id: '3', action: 'abilities-changed', category: 'team', actorKind: 'lead', memberId: null, memberName: null, detail: { added: ['notes-view'], removed: [] } }),
        entry({ id: '2', action: 'attempt-refused', category: 'access', detail: { method: 'POST', route: '/v1/wallets', reason: 'owner-only' } }),
      ],
      next: '2',
    },
    '/v1/team/log?before=2': { entries: [entry({ id: '1' })], next: null },
    '/v1/team/log?member=m1': { entries: [entry({ id: '1' })], next: null },
  };
  vi.stubGlobal('fetch', async (input: string) => {
    calls.push(input);
    if (input === '/v1/account/me') return json(200, { kind: 'trader', level: 'full', displayName: 'Calcium', methods: ['pgp'], member: meMember });
    if (input in pages) return json(200, pages[input]);
    if (input === '/v1/team/log/integrity') return json(200, { ok: true, entries: 3, brokenAt: null, head: { id: '3', hash: H } });
    if (input === `/v1/team/log/integrity?id=3&hash=${H}`) return json(200, { ok: true, entries: 3, brokenAt: null, head: { id: '3', hash: H }, fingerprint: { id: '3', matches: true } });
    if (input === '/v1/team/log/summary?days=30') {
      return json(200, { since: '', members: [{ memberId: 'm1', name: 'Aurora', status: 'active', work: 4, logins: 2, refused: 1, changes: 1, lastActionAt: null, lastLoginAt: null }] });
    }
    if (input === '/v1/team/permissions') return json(200, catalogueView());
    return json(500, { error: 'internal' });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  refreshSession();
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });

const byPart = (host: ParentNode, part: string) => host.querySelector(`[data-part="${part}"]`);

function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  set.call(input, value);
  fire(input, new Event('input', { bubbles: true }));
}

describe('helpers', () => {
  it('words a row by who acted and whom it is about', () => {
    expect(logSentence(entry({}))).toBe('Aurora marked the payment sent');
    expect(logSentence(entry({ actorKind: 'lead', memberName: null, action: 'member-removed' }))).toBe('You removed Aurora');
    expect(logSentence(entry({ actorKind: 'system', memberName: null, action: 'session-ended' }))).toBe('X2F ended a session of Aurora');
    expect(logSentence(entry({ action: 'something-new' }))).toBe('Aurora something-new');
  });

  it('details read as words: amounts, boxes, limits, refusals and the fingerprint', () => {
    const f = new Map(logFacts(entry({ tradeCode: 'AAAA-BBBB-CCCC-DDDD', detail: { amountAtomic: '1500000000000', fiatCents: '41250', currency: 'USD' } }), (id) => id));
    expect(f.get('Amount')).toBe('1.5 XMR');
    expect(f.get('Fiat')).toBe('412.50 USD');
    expect(f.get('Fingerprint')).toBe(H.slice(0, 16));
    const boxes = new Map(logFacts(entry({ action: 'abilities-changed', detail: { added: ['notes-view'], removed: ['offers-delete'] } }), (id) => `<${id}>`));
    expect([boxes.get('Added'), boxes.get('Removed')]).toEqual(['<notes-view>', '<offers-delete>']);
    const limits = new Map(logFacts(entry({ action: 'limits-changed', detail: { before: { bandMinAtomic: null, hours: 'any' }, after: { bandMinAtomic: '0', bandMaxAtomic: '2000000000000', hours: 'any' } } }), (id) => id));
    expect([limits.get('Trade size before'), limits.get('Trade size now')]).toEqual(['No limit', '0 to 2 XMR']);
    const refused = new Map(logFacts(entry({ action: 'attempt-refused', detail: { method: 'GET', route: '/v1/team', reason: 'owner-only' } }), (id) => id));
    expect(refused.get('Why refused')).toBe('only you can do that');
    expect(refused.get('What they tried')).toBe('GET /v1/team');
  });

  it('builds the filter from the form, refusing a bad trade code; until includes the whole day', () => {
    expect(filterOfDraft({ member: '', categories: [], action: '', trade: 'nope', from: '', to: '' })).toBeNull();
    const f = filterOfDraft({ member: 'm1', categories: ['team'], action: 'member-login', trade: 'aaaa-bbbb-cccc-dddd', from: '2026-11-01', to: '2026-11-01' })!;
    expect(f).toMatchObject({ members: ['m1'], categories: ['team'], actions: ['member-login'], trade: 'AAAA-BBBB-CCCC-DDDD' });
    expect(new Date(f.to!).getTime() - new Date(f.from!).getTime()).toBe(86_400_000);
    expect(parseFingerprint(`#12:${H.toUpperCase()}`)).toEqual({ id: '12', hash: H });
    expect(parseFingerprint('12:abc')).toBeNull();
  });

  it('the export link carries the filters but never the paging', () => {
    expect(teamLogExportPath({ members: ['m1'], categories: ['work', 'team'], before: '9', limit: 5 }, 'csv')).toBe('/v1/team/log/export?member=m1&category=work%2Cteam&format=csv');
    expect(teamLogQuery({})).toBe('');
  });
});

describe('the screen', () => {
  it("the owner sees the integrity check, the members' summary, the entries with details, paging and the downloads", async () => {
    const { host } = render(<MemoryRouter><TeamLog /></MemoryRouter>);
    await settle();
    expect(byPart(host, 'team-log-integrity')?.textContent).toContain('Intact: all 3 entries check out');
    expect((byPart(host, 'team-log-fingerprint') as HTMLInputElement).value).toBe(`#3:${H}`);
    expect(byPart(host, 'team-log-summary')?.textContent).toContain('4 actions · 2 logins · 1 refused · 1 changes by you');
    const rows = [...host.querySelectorAll('[data-part="team-log-entries"] > li')];
    expect(rows.map((r) => r.getAttribute('data-action'))).toEqual(['abilities-changed', 'attempt-refused']);
    expect(rows[0]!.textContent).toContain('You changed the boxes of Aurora');
    fire(byPart(host, 'team-log-more')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(host.querySelectorAll('[data-part="team-log-entries"] > li')).toHaveLength(3);
    expect(byPart(host, 'team-log-more')).toBeNull();
    expect(byPart(host, 'export-csv')?.getAttribute('href')).toBe('/v1/team/log/export?format=csv');
    // A saved fingerprint is checked against the chain.
    type(host.querySelector('#team-log-kept') as HTMLInputElement, `#3:${H}`);
    fire(byPart(host, 'check-fingerprint')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(byPart(host, 'fingerprint-result')?.textContent).toBe('It matches. Nothing before that entry has changed.');
  });

  it("the summary's Show only filters the list to that member", async () => {
    const { host } = render(<MemoryRouter><TeamLog /></MemoryRouter>);
    await settle();
    fire(byPart(host, 'summary-filter')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(calls).toContain('/v1/team/log?member=m1');
    expect(host.querySelectorAll('[data-part="team-log-entries"] > li')).toHaveLength(1);
    expect(byPart(host, 'export-json')?.getAttribute('href')).toBe('/v1/team/log/export?member=m1&format=json');
  });

  it('a member sees only the list: no integrity, summary, member filter or download', async () => {
    meMember = { name: 'Aurora', roles: [], abilities: ['team-see-log'] };
    const { host } = render(<MemoryRouter><TeamLog /></MemoryRouter>);
    await settle();
    expect(host.querySelectorAll('[data-part="team-log-entries"] > li').length).toBeGreaterThan(0);
    for (const part of ['team-log-integrity', 'team-log-summary', 'filter-member', 'team-log-export']) expect(byPart(host, part), part).toBeNull();
    expect(calls.some((c) => c.startsWith('/v1/team/log/integrity') || c.startsWith('/v1/team/log/summary'))).toBe(false);
  });
});
