// @vitest-environment happy-dom
// Plan 2 Task 18: the Team screen and the join page against a stubbed API.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemberInvite, inviteFromHash } from '../src/screens/auth/MemberInvite.js';
import { Team, inviteLink } from '../src/screens/settings/Team.js';
import { JOIN_COPY, rolesText } from '../src/screens/settings/teamCopy.js';
import { TERMS_TEXT_VERSION } from '../src/screens/setup/termsText.js';
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
let meMember: unknown;
let inviteReply: { status: number; body: unknown };

const CODE = 'A'.repeat(43);

function json(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  calls = [];
  teamStatus = 200;
  meMember = null;
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
    if (input === '/v1/account/me') return json(200, { kind: 'trader', level: 'full', displayName: 'Calcium', methods: ['pgp'], member: meMember });
    if (input === '/v1/team' && method === 'GET') return teamStatus === 200 ? json(200, { members, max: 3 }) : json(teamStatus, { error: 'owner-only' });
    if (input === '/v1/team/audit') return teamStatus === 200 ? json(200, audit) : json(teamStatus, { error: 'owner-only' });
    if (input === '/v1/team/invites') return json(inviteReply.status, inviteReply.body);
    if (input === '/v1/team/members/m1/limits' && method === 'PUT') return json(200, { ...(members[0] as object), band: body?.band, hours: body?.hours });
    if (input === '/v1/team/invite') return body?.invite === CODE ? json(200, { displayName: 'Aurora', roles: ['trades'], expiresAt: '2026-10-31T10:00:00.000Z' }) : json(404, { error: 'not-found' });
    if (input === '/v1/terms') return json(200, { version: TERMS_TEXT_VERSION });
    if (input === '/v1/team/join/start') return json(200, { challengeId: 'c1', encryptedMessage: 'MSG', fingerprint: 'F' });
    if (input === '/v1/team/join/finish') return json(201, { setupId: 's1', needs: ['security-key', 'passkey', 'pgp'], setupUntil: '2026-10-31T10:00:00.000Z' });
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

  it('S-104: an invite with no boxes yet reads without a role list', () => {
    expect(JOIN_COPY.invited('Aurora', ['trades'])).toBe('You are invited to a team as Aurora, for Trades.');
    expect(JOIN_COPY.invited('Aurora', [])).not.toMatch(/for \.$/);
    expect(JOIN_COPY.invited('Aurora', [])).toContain('Aurora');
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

  it('a member whose boxes no role describes reads "Custom", not a role (review 2026-11-09 m3)', async () => {
    members = [
      { id: 'm4', displayName: 'Dana', roles: ['trades'], abilities: ['trades-see-active'], preset: null, custom: true, status: 'active', inviteExpiresAt: null, joinedAt: '2026-10-29T10:00:00.000Z', createdAt: '2026-10-29T09:00:00.000Z' },
    ];
    const { host } = render(<MemoryRouter><Team /></MemoryRouter>);
    await settle();
    expect(host.querySelector('[data-member="Dana"]')?.textContent).toContain('Custom · Active');
    expect(host.querySelector('[data-member="Dana"]')?.textContent).not.toContain('Trades');
  });

  it('S-105 (owner p11-25): each member shows how chats label them, the lead\'s name and a number, never their own name', async () => {
    members = [
      { id: 'm1', displayName: 'Aurora', chatLabel: 'Calcium Assistant 1', roles: ['trades'], status: 'active', inviteExpiresAt: null, joinedAt: '2026-10-29T10:00:00.000Z', createdAt: '2026-10-29T09:00:00.000Z' },
      { id: 'm2', displayName: 'Basil', chatLabel: 'Calcium Assistant 2', roles: ['offers'], status: 'invited', inviteExpiresAt: '2026-10-31T10:00:00.000Z', joinedAt: null, createdAt: '2026-10-30T10:00:00.000Z' },
    ];
    const { host } = render(<MemoryRouter><Team /></MemoryRouter>);
    await settle();
    expect([...host.querySelectorAll('[data-part="chat-label"]')].map((e) => e.textContent)).toEqual(['In chats: Calcium Assistant 1', 'In chats: Calcium Assistant 2']);
    // The invite form no longer says chats show the member's name.
    expect(host.querySelector('#team-name-hint')?.textContent).not.toContain('<their name>');
    expect(host.querySelector('#team-name-hint')?.textContent).toContain('Assistant');
  });

  it('S-104 (owner p11-21): an invite from a username-and-password login shows the link and says its boxes wait as a draft', async () => {
    inviteReply = { status: 201, body: { id: 'm3', invite: CODE, expiresAt: '2026-10-31T10:00:00.000Z', status: 'staged', changeId: 'ch1' } };
    const { host } = render(<MemoryRouter><Team /></MemoryRouter>);
    await settle();
    type(host.querySelector<HTMLInputElement>('#team-name')!, 'Cosmo');
    await settle();
    fire(byPart(host, 'invite')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(byPart(host, 'invite-url')?.textContent).toBe(`${window.location.origin}/team/join#${CODE}`);
    expect(byPart(host, 'staged-note')).not.toBeNull();
  });

  it('S-104: a member with no boxes yet says so instead of an empty role list', async () => {
    members = [
      { id: 'm5', displayName: 'Eden', chatLabel: 'Calcium Assistant 1', roles: [], abilities: [], preset: null, custom: false, status: 'invited', inviteExpiresAt: '2026-10-31T10:00:00.000Z', joinedAt: null, createdAt: '2026-10-30T10:00:00.000Z' },
    ];
    const { host } = render(<MemoryRouter><Team /></MemoryRouter>);
    await settle();
    expect(host.querySelector('[data-member="Eden"]')?.textContent).toContain('No roles yet · Invited');
  });

  it('J-20: each row shows its limits; Limits sends the band in atomic units and the hours, and a bad band sends nothing', async () => {
    members = [
      { ...(members[0] as object), band: { minAtomic: '500000000000', maxAtomic: '2000000000000' }, hours: { days: ['Mon', 'Fri'], start: '08:00', end: '18:00', tz: 'UTC' } },
      members[1],
    ];
    const { host } = render(<MemoryRouter><Team /></MemoryRouter>);
    await settle();
    expect(host.querySelector('[data-member="Aurora"] [data-part="member-limits"]')?.textContent).toBe('Trades of 0.5 to 2 XMR · Mon, Fri 08:00 to 18:00 (UTC)');
    expect(host.querySelector('[data-member="Basil"] [data-part="member-limits"]')?.textContent).toBe('Any trade size · Any time');
    fire(host.querySelector('[data-member="Aurora"] [data-part="edit-limits"]')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    type(byPart(host, 'band-min') as HTMLInputElement, '0.1');
    type(byPart(host, 'band-max') as HTMLInputElement, '0.05');
    await settle();
    fire(byPart(host, 'save-limits')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(calls.some((c) => c.url.endsWith('/limits'))).toBe(false);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('largest above zero');
    type(byPart(host, 'band-max') as HTMLInputElement, '2.5');
    fire(host.querySelector('[data-day="Tue"]')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    fire(byPart(host, 'save-limits')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(calls.find((c) => c.url === '/v1/team/members/m1/limits')).toMatchObject({
      method: 'PUT',
      body: { band: { minAtomic: '100000000000', maxAtomic: '2500000000000' }, hours: { days: ['Mon', 'Tue', 'Fri'], start: '08:00', end: '18:00', tz: 'UTC' } },
    });
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
    // Review shot 19: the title says what happened.
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe('Your team is full');
  });

  // Design review shot 19 (Team board, the full state): at the limit the invite control is disabled
  // and the board's note says why, so no popup is reached from a full list (the server's
  // too-many-members stays as a fallback, test above).
  it('a full team: Make an invite link is disabled with the board note, and tapping it opens nothing', async () => {
    members = [
      ...members,
      { id: 'm3', displayName: 'Cedric', roles: ['offers'], status: 'active', inviteExpiresAt: null, joinedAt: '2026-10-29T10:00:00.000Z', createdAt: '2026-10-29T09:00:00.000Z' },
    ];
    const { host } = render(<MemoryRouter><Team /></MemoryRouter>);
    await settle();
    expect(byPart(host, 'team-count')?.textContent).toBe('3 of 3 members');
    const note = byPart(host, 'team-full');
    expect(note?.textContent).toBe('You have 3 members, the most allowed. Remove one to add another.');
    const button = byPart(host, 'invite')!;
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-describedby')).toBe(note?.id);
    type(host.querySelector<HTMLInputElement>('#team-name')!, 'Dora');
    await settle();
    fire(button, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(byPart(document, 'cant-do-that')).toBeNull();
    expect(calls.some((c) => c.url === '/v1/team/invites')).toBe(false);
    expect(host.querySelectorAll('[data-primary]').length).toBe(1);
  });

  it('with room on the team there is no full note', async () => {
    const { host } = render(<MemoryRouter><Team /></MemoryRouter>);
    await settle();
    expect(byPart(host, 'team-full')).toBeNull();
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

  it('a weak session inviting opens CantDoThat saying team changes need a stronger login (owner 1 Nov 2026)', async () => {
    inviteReply = { status: 403, body: { error: 'weak-session' } };
    const { host } = render(<MemoryRouter><Team /></MemoryRouter>);
    await settle();
    type(host.querySelector<HTMLInputElement>('#team-name')!, 'Cosmo');
    await settle();
    fire(byPart(host, 'invite')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    const popup = byPart(document, 'cant-do-that');
    expect(popup?.getAttribute('data-from')).toBe('weak-session');
    expect(popup?.textContent).toContain("can't invite team members");
    // Lead review 8 Nov: role changes and removals from such a device wait 24 hours; they are not refused.
    expect(popup?.textContent).not.toContain('change their roles');
    expect(byPart(host, 'invite-url')).toBeNull();
  });

  it('a team member opening the screen gets owner-only through CantDoThat', async () => {
    teamStatus = 403;
    render(<MemoryRouter><Team /></MemoryRouter>);
    await settle();
    expect(byPart(document, 'cant-do-that')?.getAttribute('data-from')).toBe('owner-only');
  });

  it('J-20 F8 (p11-136, lead default): a team member sees their own trade sizes and working hours', async () => {
    teamStatus = 403;
    meMember = {
      name: 'Aurora', roles: ['trades'],
      limits: { band: { minAtomic: '500000000000', maxAtomic: '2000000000000' }, hours: { days: ['Mon', 'Fri'], start: '08:00', end: '18:00', tz: 'UTC' } },
    };
    const { host } = render(<MemoryRouter><Team /></MemoryRouter>);
    await settle();
    expect(byPart(host, 'my-limits')?.textContent).toBe('Your limitsThe account owner set these for you.Trades of 0.5 to 2 XMR · Mon, Fri 08:00 to 18:00 (UTC)');
    // No limits in the answer (an older API, or the switch off): nothing is shown.
    meMember = { name: 'Aurora', roles: ['trades'] };
    const again = render(<MemoryRouter><Team /></MemoryRouter>);
    await settle();
    expect(byPart(again.host, 'my-limits')).toBeNull();
  });
});

describe('MemberInvite (join)', () => {
  it('reads the invite from the fragment, clears it from the address bar, has the Terms signed first, then shows the invite without naming the vendor', async () => {
    window.history.replaceState(null, '', `/team/join#${CODE}`);
    const { host } = render(<MemoryRouter><MemberInvite /></MemoryRouter>);
    await settle();
    expect(calls.find((c) => c.url === '/v1/team/invite')?.body).toEqual({ invite: CODE });
    expect(window.location.hash).toBe('');
    // Review 2026-11-08 F1: the Terms come first; no name or key field until they are accepted.
    expect(host.querySelector('[data-screen="team-join-terms"]')).not.toBeNull();
    expect(byPart(host, 'join-first')).toBeNull();
    const accept = byPart(host, 'terms-accept') as HTMLButtonElement;
    expect(accept.disabled).toBe(true);
    await act(async () => {
      (byPart(host, 'terms-tick') as HTMLInputElement).click();
    });
    // Owner 9 Nov 2026 (p11-14): everyone who gets a login signs; the tick alone is not enough.
    expect(accept.disabled).toBe(true);
    await act(async () => {
      (byPart(host, 'signature-type') as HTMLButtonElement).click();
    });
    type(byPart(host, 'signature-name') as HTMLInputElement, 'AK');
    await settle();
    expect(accept.disabled).toBe(false);
    await act(async () => {
      accept.click();
    });
    await settle();
    // Review 2026-11-08 F3: the invite never names the team account before joining.
    expect(byPart(host, 'invite-who')?.textContent).toBe('You are invited to a team as Aurora, for Trades.');
    expect(host.textContent).not.toContain('Calcium');
    // The accepted version goes with the first step.
    type(host.querySelector('#join-login') as HTMLInputElement, 'aurora.login');
    const key = host.querySelector('#join-key') as HTMLTextAreaElement;
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    set.call(key, 'KEY');
    fire(key, new Event('input', { bubbles: true }));
    await act(async () => {
      (byPart(host, 'send-message') as HTMLButtonElement).click();
    });
    await settle();
    expect(calls.find((c) => c.url === '/v1/team/join/start')?.body).toEqual({ invite: CODE, loginName: 'aurora.login', publicKey: 'KEY', acceptedTerms: TERMS_TEXT_VERSION });
    // The signature goes with the first factor's finish, where the login account is made.
    type(host.querySelector('input[aria-label="Code"]') as HTMLInputElement, '12345678');
    await act(async () => {
      (byPart(host, 'prove') as HTMLButtonElement).click();
    });
    await settle();
    expect(calls.find((c) => c.url === '/v1/team/join/finish')?.body).toEqual({ challengeId: 'c1', code: '12345678', termsSignature: { kind: 'typed', name: 'AK' } });
    expect(byPart(host, 'join-second')).not.toBeNull();
  });

  it('a used or expired invite says so without naming the vendor (front door, design board InviteInvalid)', async () => {
    window.history.replaceState(null, '', `/team/join#${CODE.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))}`);
    const { host } = render(<MemoryRouter><MemberInvite /></MemoryRouter>);
    await settle();
    expect(calls.some((c) => c.url === '/v1/team/invite')).toBe(true);
    expect(byPart(host, 'invite-gone')).not.toBeNull();
    expect(byPart(host, 'invite-who')).toBeNull();
    expect(host.textContent).not.toContain('Calcium');
  });

  it('a link without a usable code says so and calls nothing', async () => {
    window.history.replaceState(null, '', '/team/join#nope');
    const { host } = render(<MemoryRouter><MemberInvite /></MemoryRouter>);
    await settle();
    expect(byPart(host, 'invite-gone')).not.toBeNull();
    expect(calls.some((c) => c.url === '/v1/team/invite')).toBe(false);
  });
});
