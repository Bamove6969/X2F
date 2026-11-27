// @vitest-environment happy-dom
// Settings → Team: one member's signed-in sessions (MemberSessions.tsx) against a stubbed API.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogueView } from '../../api/src/team/abilities.js';
import { MEMBER_SESSIONS_COPY as C, MemberSessions } from '../src/screens/settings/MemberSessions.js';
import { Team } from '../src/screens/settings/Team.js';
import { formatDateTime } from '../src/ui/dates.js';
import { fire, render } from './render.js';

interface Call {
  url: string;
  method: string;
}

let calls: Call[];
let sessions: { id: string; deviceLabel: string; createdAt: string; lastSeenAt: string }[];
let endReply: { status: number; body: unknown };

function json(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const MEMBERS = [
  { id: 'm1', displayName: 'Aurora', roles: ['trades'], status: 'active', inviteExpiresAt: null, joinedAt: '2026-10-29T10:00:00.000Z', createdAt: '2026-10-29T09:00:00.000Z' },
  { id: 'm2', displayName: 'Basil', roles: ['offers'], status: 'invited', inviteExpiresAt: '2026-10-31T10:00:00.000Z', joinedAt: null, createdAt: '2026-10-30T10:00:00.000Z' },
];

beforeEach(() => {
  calls = [];
  endReply = { status: 204, body: null };
  sessions = [
    { id: 's1', deviceLabel: 'Firefox on Linux', createdAt: '2026-11-20T08:00:00.000Z', lastSeenAt: '2026-11-26T09:30:00.000Z' },
    { id: 's2', deviceLabel: 'Safari on iPhone', createdAt: '2026-11-21T12:15:00.000Z', lastSeenAt: '2026-11-25T18:05:00.000Z' },
  ];
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ url: input, method });
    if (input === '/v1/account/me') return json(200, { kind: 'trader', level: 'full', displayName: 'Calcium', methods: ['pgp'], member: null });
    if (input === '/v1/team') return json(200, { members: MEMBERS, max: 3 });
    if (input === '/v1/team/audit') return json(200, []);
    if (input === '/v1/team/permissions') return json(200, catalogueView());
    if (input === '/v1/team/members/m1/sessions' && method === 'GET') return json(200, { sessions });
    if (input === '/v1/team/members/m1/sessions/s1' && method === 'DELETE') {
      if (endReply.status === 204) sessions = sessions.filter((s) => s.id !== 's1');
      return json(endReply.status, endReply.body);
    }
    if (input === '/v1/team/members/m1/sessions' && method === 'DELETE') {
      const n = sessions.length;
      sessions = [];
      return json(200, { ended: n });
    }
    return json(500, { error: 'internal' });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });

const byPart = (host: ParentNode, part: string) => host.querySelector(`[data-part="${part}"]`);
const click = (el: Element | null) => fire(el!, new MouseEvent('click', { bubbles: true }));

async function opened(): Promise<HTMLElement> {
  const { host } = render(<MemoryRouter><MemberSessions member={{ id: 'm1', displayName: 'Aurora' }} /></MemoryRouter>);
  // Nothing is read until the owner opens the row.
  expect(calls.filter((c) => c.url.includes('/sessions'))).toEqual([]);
  click(byPart(host, 'member-sessions'));
  await settle();
  return host;
}

describe('MemberSessions', () => {
  it('on the Team screen, only an active member has the sessions row', async () => {
    const { host } = render(<MemoryRouter><Team /></MemoryRouter>);
    await settle();
    expect(host.querySelector('[data-member="Aurora"] [data-part="member-sessions"]')).not.toBeNull();
    expect(host.querySelector('[data-member="Basil"] [data-part="member-sessions"]')).toBeNull();
  });

  it('lists each session with its device, when the member signed in and when it was last seen', async () => {
    const host = await opened();
    expect(calls).toContainEqual({ url: '/v1/team/members/m1/sessions', method: 'GET' });
    const rows = [...host.querySelectorAll('[data-session]')];
    expect(rows.map((r) => r.getAttribute('data-session'))).toEqual(['s1', 's2']);
    expect(rows[0]!.querySelector('[data-part="session-device"]')?.textContent).toBe('Firefox on Linux');
    const times = rows[0]!.querySelector('[data-part="session-times"]')!;
    expect(times.textContent).toBe(`Signed in ${formatDateTime(sessions[0]!.createdAt)} · last seen ${formatDateTime(sessions[0]!.lastSeenAt)}`);
    expect([...times.querySelectorAll('time')].map((t) => t.getAttribute('datetime'))).toEqual([sessions[0]!.createdAt, sessions[0]!.lastSeenAt]);
    expect(rows[0]!.querySelector('[data-part="end-member-session"]')?.getAttribute('aria-label')).toBe("End Aurora's session on Firefox on Linux");
  });

  it('ends one session after asking, and the list reloads without it', async () => {
    const host = await opened();
    click(host.querySelector('[data-session="s1"] [data-part="end-member-session"]'));
    await settle();
    expect(document.body.textContent).toContain(C.ask.oneTitle('Aurora'));
    expect(document.body.textContent).toContain(C.ask.oneText('Aurora', 'Firefox on Linux'));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    click(byPart(document.body, 'end-member-confirm'));
    await settle();
    expect(calls).toContainEqual({ url: '/v1/team/members/m1/sessions/s1', method: 'DELETE' });
    expect(byPart(host, 'member-sessions-said')?.textContent).toBe('Aurora was logged out of Firefox on Linux.');
    expect([...host.querySelectorAll('[data-session]')].map((r) => r.getAttribute('data-session'))).toEqual(['s2']);
    // One session left: no "End all sessions".
    expect(byPart(host, 'end-member-sessions')).toBeNull();
  });

  it('cancelling the question ends nothing', async () => {
    const host = await opened();
    click(host.querySelector('[data-session="s1"] [data-part="end-member-session"]'));
    await settle();
    click(byPart(document.body, 'end-member-cancel'));
    await settle();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(host.querySelectorAll('[data-session]')).toHaveLength(2);
  });

  it('ends all of them after asking', async () => {
    const host = await opened();
    click(byPart(host, 'end-member-sessions'));
    await settle();
    expect(document.body.textContent).toContain(C.ask.allTitle('Aurora'));
    expect(document.body.textContent).toContain('Aurora is logged out of 2 devices right away.');
    click(byPart(document.body, 'end-member-confirm'));
    await settle();
    expect(calls).toContainEqual({ url: '/v1/team/members/m1/sessions', method: 'DELETE' });
    expect(byPart(host, 'member-sessions-said')?.textContent).toBe('Aurora was logged out of every device.');
    expect(byPart(host, 'sessions-none')?.textContent).toBe('Aurora is not signed in on any device.');
  });

  it('a username-and-password login is refused through CantDoThat, and the session stays', async () => {
    endReply = { status: 403, body: { error: 'weak-session' } };
    const host = await opened();
    click(host.querySelector('[data-session="s1"] [data-part="end-member-session"]'));
    await settle();
    click(byPart(document.body, 'end-member-confirm'));
    await settle();
    expect(document.body.textContent).toContain("That device can't be logged out from here");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelectorAll('[data-session]')).toHaveLength(2);
  });

  it('a list that did not load says so and can be tried again', async () => {
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', async () => json(500, { error: 'internal' }));
    const host = await opened();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(C.loadFailed);
    vi.stubGlobal('fetch', real);
    click(byPart(host, 'sessions-retry'));
    await settle();
    expect(host.querySelectorAll('[data-session]')).toHaveLength(2);
  });
});
