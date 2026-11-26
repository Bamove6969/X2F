// @vitest-environment happy-dom
// A team member's own access, read only (MyAccess.tsx, GET /v1/team/me): on Settings → Security,
// where a member lands, and never for the account owner.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MyAccess } from '../src/screens/settings/MyAccess.js';
import { Security } from '../src/screens/settings/Security.js';
import { refreshSession } from '../src/session/useSession.js';
import { fire, render, waitFor } from './render.js';

let isMember: boolean;
let teamMe: { status: number; body: unknown };
let fetched: string[];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const ACCESS = {
  name: 'Aurora',
  chatLabel: 'Calcium Assistant 2',
  lead: { tradeTag: 'Calcium' },
  preset: null,
  groups: [
    {
      id: 'trades', label: 'Trades', boxes: [
        { id: 'trades-see-active', label: 'See active trades', does: 'See open trades and their state', always: false, ready: true },
        { id: 'trades-export-history', label: 'Export trade history', does: 'Download the history as a file', always: false, ready: false },
      ],
    },
    { id: 'team', label: 'Team administration', boxes: [{ id: 'team-see-log', label: 'See the team log', does: 'Read their own team log rows', always: false, ready: true }] },
    { id: 'security', label: 'Security and sessions', boxes: [{ id: 'own-login-methods', label: 'Own login methods', does: 'Set up their own login, any strength', always: true, ready: true }] },
  ],
  limits: { band: null, hours: 'any', insideNow: true, workingUntil: null },
  serverNow: '2026-11-26T12:00:00.000Z',
};

beforeEach(() => {
  isMember = true;
  fetched = [];
  teamMe = { status: 200, body: ACCESS };
  refreshSession();
  vi.stubGlobal('fetch', async (input: string) => {
    const url = String(input).split('?')[0]!;
    fetched.push(url);
    if (url === '/v1/account/me') {
      return json(200, {
        kind: 'trader', level: 'full', termsCurrent: true, tradeTag: 'Calcium', methods: ['pgp'], accountType: 'vendor',
        member: isMember ? { name: 'Aurora', roles: ['trades'], abilities: ['trades-see-active'] } : null,
      });
    }
    if (url === '/v1/team/me') return json(teamMe.status, teamMe.body);
    if (url === '/v1/account/methods') return json(200, [{ method: 'pgp', registered: true }]);
    if (url === '/v1/wallets/rule') return json(200, { firstWallet: true, strongMethods: ['pgp'] });
    return json(404, { error: 'not-found' });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  refreshSession();
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });

const byPart = (host: ParentNode, part: string) => host.querySelector(`[data-part="${part}"]`);

describe('MyAccess', () => {
  it("shows the lead, the boxes in the catalogue's words by group, and the limits; read only", async () => {
    const { host } = render(<MemoryRouter><MyAccess /></MemoryRouter>);
    await settle();
    const card = byPart(host, 'my-access')!;
    expect(card.querySelector('.x2f-card__title')?.textContent).toBe('Your access');
    expect(byPart(card, 'my-access-lead')?.textContent).toBe('Team lead: Calcium');
    expect(byPart(card, 'my-access-name')?.textContent).toBe('Your name in the team: Aurora');
    expect(byPart(card, 'my-access-chat')?.textContent).toBe('In trade chats you show as Calcium Assistant 2');
    expect([...card.querySelectorAll('[data-group]')].map((g) => g.getAttribute('data-group'))).toEqual(['trades', 'team', 'security']);
    expect(card.querySelector('[data-box="trades-see-active"]')?.textContent).toBe('See active tradesSee open trades and their state');
    // A ticked box X2F does not offer yet says so; an always-on one says every member has it.
    expect(byPart(card.querySelector('[data-box="trades-export-history"]')!, 'my-access-not-ready')?.textContent).toBe('Ticked for you, but X2F does not offer this yet.');
    expect(card.querySelector('[data-box="own-login-methods"]')?.textContent).toContain('Every member has this.');
    expect(byPart(card, 'my-access-band')?.textContent).toBe('Any trade size');
    expect(byPart(card, 'my-access-hours')?.textContent).toBe('Any time');
    expect(byPart(card, 'my-access-now')?.textContent).toBe('You can work at any time.');
    // "See the team log" opens the member's own rows.
    expect(byPart(card, 'my-team-log-link')?.getAttribute('href')).toBe('/settings/team/log');
    // Nothing to change here: no inputs, no buttons.
    expect(card.querySelectorAll('input, select, button').length).toBe(0);
  });

  it('a band and a window: the sizes, the days and hours, and the end of the window now (dates.ts)', async () => {
    teamMe = {
      status: 200,
      body: {
        ...ACCESS,
        groups: [],
        limits: { band: { minAtomic: '100000000000', maxAtomic: '3000000000000' }, hours: { days: ['Tue', 'Thu'], start: '09:00', end: '17:30', tz: 'Europe/Berlin' }, insideNow: true, workingUntil: '2026-11-26T16:30:00.000Z' },
      },
    };
    const { host } = render(<MemoryRouter><MyAccess /></MemoryRouter>);
    await settle();
    const card = byPart(host, 'my-access')!;
    expect(card.textContent).toContain('Your team lead has not ticked any boxes for you yet.');
    expect(byPart(card, 'my-access-band')?.textContent).toBe('Trades of 0.1 to 3 XMR');
    expect(byPart(card, 'my-access-hours')?.textContent).toBe('Tue, Thu 09:00 to 17:30 (Europe/Berlin)');
    const now = byPart(card, 'my-access-now')!;
    expect(now.getAttribute('data-inside')).toBe('yes');
    expect(now.textContent).toBe('You are inside your working hours now. They end at 26 Nov 2026, 16:30 UTC.');
    expect(now.querySelector('time')?.getAttribute('datetime')).toBe('2026-11-26T16:30:00.000Z');
    expect(byPart(card, 'my-team-log-link')).toBeNull();
  });

  it('outside the hours it says so; without limits in the answer it shows none', async () => {
    teamMe = { status: 200, body: { ...ACCESS, limits: { ...ACCESS.limits, hours: { days: ['Mon'], start: '08:00', end: '09:00', tz: 'UTC' }, insideNow: false, workingUntil: '2026-11-26T12:00:00.000Z' } } };
    const a = render(<MemoryRouter><MyAccess /></MemoryRouter>);
    await settle();
    expect(byPart(a.host, 'my-access-now')?.textContent).toBe('You are outside your working hours now.');
    a.unmount();
    const { limits: _, ...noLimits } = ACCESS;
    teamMe = { status: 200, body: noLimits };
    const b = render(<MemoryRouter><MyAccess /></MemoryRouter>);
    await settle();
    expect(byPart(b.host, 'my-access-lead')).not.toBeNull();
    expect(byPart(b.host, 'my-access-band')).toBeNull();
    expect(byPart(b.host, 'my-access-now')).toBeNull();
  });

  it('the account owner (403) and an older API (404) get nothing; a failure says so and tries again', async () => {
    for (const status of [403, 404]) {
      teamMe = { status, body: { error: status === 403 ? 'forbidden' : 'not-found' } };
      const r = render(<MemoryRouter><MyAccess /></MemoryRouter>);
      await settle();
      expect(byPart(r.host, 'my-access'), String(status)).toBeNull();
      r.unmount();
    }
    teamMe = { status: 500, body: { error: 'internal' } };
    const { host } = render(<MemoryRouter><MyAccess /></MemoryRouter>);
    await settle();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Could not load your access. Try again.');
    teamMe = { status: 200, body: ACCESS };
    fire(byPart(host, 'my-access-retry')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(byPart(host, 'my-access-lead')?.textContent).toBe('Team lead: Calcium');
  });
});

describe('Settings → Security', () => {
  it('a team member lands on their access card; the owner never asks for it', async () => {
    const m = render(<MemoryRouter initialEntries={['/settings/security']}><Security /></MemoryRouter>);
    await waitFor(m.host, '[data-part="my-access-lead"]');
    expect(byPart(m.host, 'my-access-lead')?.textContent).toBe('Team lead: Calcium');
    m.unmount();

    isMember = false;
    refreshSession();
    fetched = [];
    const o = render(<MemoryRouter initialEntries={['/settings/security']}><Security /></MemoryRouter>);
    await waitFor(o.host, '[data-part="devices-link"]');
    await settle();
    expect(byPart(o.host, 'my-access')).toBeNull();
    expect(fetched).not.toContain('/v1/team/me');
  });
});
