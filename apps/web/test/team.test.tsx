// @vitest-environment happy-dom
// Plan 2 Task 18: the Team screen and the join page against a stubbed API.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemberInvite, inviteFromHash } from '../src/screens/auth/MemberInvite.js';
import { Team, inviteLink } from '../src/screens/settings/Team.js';
import { rolesText } from '../src/screens/settings/teamCopy.js';
import { fire, render } from './render.js';

interface Call {
  url: string;
  method: string;
  body: unknown;
}

let calls: Call[];
let members: unknown[];
let audit: unknown[];
let teamStatus: number;
let inviteReply: { status: number; body: unknown };

const CODE = 'A'.repeat(43);

function json(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  calls = [];
  teamStatus = 200;
  members = [
    { id: 'm1', displayName: 'Aurora', roles: ['trades'], status: 'active', inviteExpiresAt: null, joinedAt: '2026-10-29T10:00:00.000Z', createdAt: '2026-10-29T09:00:00.000Z' },
    { id: 'm2', displayName: 'Basil', roles: ['offers', 'trades'], status: 'invited', inviteExpiresAt: '2026-10-31T10:00:00.000Z', joinedAt: null, createdAt: '2026-10-30T10:00:00.000Z' },
  ];
  audit = [{ id: '1', at: '2026-10-30T08:00:00.000Z', memberId: 'm1', memberName: 'Aurora', action: 'mark-paid', tradeCode: 'AAAA-BBBB-CCCC-DDDD', detail: {} }];
  inviteReply = { status: 201, body: { id: 'm3', invite: CODE, expiresAt: '2026-10-31T10:00:00.000Z' } };
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url: input, method, body });
    if (input === '/v1/account/me') return json(200, { kind: 'trader', level: 'full', displayName: 'Calcium', methods: ['pgp'] });
    if (input === '/v1/team' && method === 'GET') return teamStatus === 200 ? json(200, { members, max: 3 }) : json(teamStatus, { error: 'owner-only' });
    if (input === '/v1/team/audit') return teamStatus === 200 ? json(200, audit) : json(teamStatus, { error: 'owner-only' });
    if (input === '/v1/team/invites') return json(inviteReply.status, inviteReply.body);
    if (input === '/v1/team/invite') return body?.invite === CODE ? json(200, { team: 'Calcium', displayName: 'Aurora', roles: ['trades'], expiresAt: '2026-10-31T10:00:00.000Z' }) : json(404, { error: 'not-found' });
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

function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  set.call(input, value);
  fire(input, new Event('input', { bubbles: true }));
}

describe('helpers', () => {
  it('the invite link carries the code in the fragment only', () => {
    expect(inviteLink('https://x2f.test', CODE)).toBe(`https://x2f.test/team/join#${CODE}`);
    expect(inviteFromHash(`#${CODE}`)).toBe(CODE);
    expect(inviteFromHash('#short')).toBeNull();
    expect(inviteFromHash('')).toBeNull();
  });

  it('roles read in a fixed order', () => {
    expect(rolesText(['trades', 'offers'])).toBe('Offers and Trades');
    expect(rolesText(['trades'])).toBe('Trades');
  });
});

describe('Team (settings)', () => {
  it('lists members with roles and status, the count, and the activity log', async () => {
    const { host } = render(<MemoryRouter><Team /></MemoryRouter>);
    await settle();
    expect([...host.querySelectorAll('[data-part="member-list"] [data-username]')].map((e) => e.textContent)).toEqual(['Aurora', 'Basil']);
    expect(byPart(host, 'team-count')?.textContent).toBe('2 of 3 members');
    expect(host.querySelector('[data-member="Basil"]')?.textContent).toContain('Offers and Trades · Invited');
    expect(host.querySelector('[data-action="mark-paid"]')?.textContent).toContain('Aurora marked the payment sent');
    expect(host.querySelector('[data-action="mark-paid"]')?.textContent).toContain('trade AAAA-BBBB-CCCC-DDDD');
    // One primary on the screen.
    expect(host.querySelectorAll('[data-primary]').length).toBe(1);
  });

  it('Make an invite link sends the name and roles and shows the link once', async () => {
    const { host } = render(<MemoryRouter><Team /></MemoryRouter>);
    await settle();
    type(host.querySelector<HTMLInputElement>('#team-name')!, 'Cosmo');
    await settle();
    fire(byPart(host, 'invite')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(calls.find((c) => c.url === '/v1/team/invites')).toEqual({ url: '/v1/team/invites', method: 'POST', body: { displayName: 'Cosmo', roles: ['offers'] } });
    expect(byPart(host, 'invite-url')?.textContent).toBe(`${window.location.origin}/team/join#${CODE}`);
  });

  it('the member limit opens CantDoThat with the feedback line', async () => {
    inviteReply = { status: 409, body: { error: 'too-many-members', max: 3 } };
    const { host } = render(<MemoryRouter><Team /></MemoryRouter>);
    await settle();
    type(host.querySelector<HTMLInputElement>('#team-name')!, 'Cosmo');
    await settle();
    fire(byPart(host, 'invite')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    const popup = byPart(document, 'cant-do-that');
    expect(popup?.getAttribute('data-from')).toBe('too-many-members');
    expect(popup?.textContent).toContain('A team can have at most 3 members.');
  });

  it("during the account's 24-hour hold a team change opens CantDoThat with the hold's sentence (owner 2026-10-30)", async () => {
    inviteReply = { status: 403, body: { error: 'recovery-hold', holdUntil: '2026-10-31T10:00:00.000Z' } };
    const { host } = render(<MemoryRouter><Team /></MemoryRouter>);
    await settle();
    type(host.querySelector<HTMLInputElement>('#team-name')!, 'Cosmo');
    await settle();
    fire(byPart(host, 'invite')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    const popup = byPart(document, 'cant-do-that');
    expect(popup?.getAttribute('data-from')).toBe('recovery-hold');
    expect(popup?.textContent).toContain('Your account is on a 24-hour hold');
    expect(byPart(host, 'invite-url')).toBeNull();
  });

  it('a team member opening the screen gets owner-only through CantDoThat', async () => {
    teamStatus = 403;
    render(<MemoryRouter><Team /></MemoryRouter>);
    await settle();
    expect(byPart(document, 'cant-do-that')?.getAttribute('data-from')).toBe('owner-only');
  });
});

describe('MemberInvite (join)', () => {
  it('reads the invite from the fragment, clears it from the address bar, and shows who invited', async () => {
    window.history.replaceState(null, '', `/team/join#${CODE}`);
    const { host } = render(<MemoryRouter><MemberInvite /></MemoryRouter>);
    await settle();
    expect(calls.find((c) => c.url === '/v1/team/invite')?.body).toEqual({ invite: CODE });
    expect(window.location.hash).toBe('');
    expect(byPart(host, 'invite-who')?.textContent).toBe('Calcium invited you as Aurora, for Trades.');
  });

  it('a link without a usable code says so and calls nothing', async () => {
    window.history.replaceState(null, '', '/team/join#nope');
    const { host } = render(<MemoryRouter><MemberInvite /></MemoryRouter>);
    await settle();
    expect(byPart(host, 'invite-gone')).not.toBeNull();
    expect(calls.some((c) => c.url === '/v1/team/invite')).toBe(false);
  });
});
