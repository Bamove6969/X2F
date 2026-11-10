// @vitest-environment happy-dom
// Hold model v3 (lead hold v3 review item 3; owner G29, G31, G32, G36): the drafts' review and
// submit, the waiting changes with Cancel, the shell's banner and change-cap popup, the new recovery
// code shown once, the staged answer on a change, and the alert lines.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApiError } from '@x2f/auth-client';
import { AccountChanges, AccountChangesScreen, ChangesBanner, ChangesCapPopup, StagedNote, changesCapOf, reportChangesCap } from '../src/screens/settings/HoldChanges.js';
import { NewRecoveryCode } from '../src/screens/settings/NewRecoveryCode.js';
import { Devices } from '../src/screens/settings/Devices.js';
import { Security } from '../src/screens/settings/Security.js';
import { CHANGES_PATH, HOLD_COPY, MEMBER_HOLD_COPY, NEW_CODE_COPY, changeWords, codeGroups } from '../src/screens/settings/holdCopy.js';
import { alertDetail, alertWords } from '../src/screens/settings/Alerts.js';
import { refreshSession } from '../src/session/useSession.js';
import { formatDateTime as utcDateTime } from '../src/ui/dates.js';
import { holdChangesCantDoText } from '../src/ui/cantDoCodes.js';
import { fire, render } from './render.js';

interface Call {
  url: string;
  method: string;
  body: unknown;
}

const DUE = '2026-11-08T15:00:00.000Z';
const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const W1 = '33333333-3333-4333-8333-333333333333';
const W2 = '44444444-4444-4444-8444-444444444444';

let calls: Call[];
let me: Record<string, unknown>;
let hold: { status: number; body: unknown };
let replies: Record<string, { status: number; body: unknown }>;

function json(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const view = (o: { drafts?: unknown[]; items?: unknown[]; strong?: boolean } = {}) => ({
  accountHold: null,
  changes: { count: (o.items ?? []).length, takesEffectAt: (o.items ?? []).length > 0 ? DUE : null, items: o.items ?? [] },
  drafts: o.drafts ?? [],
  changesWait: o.strong !== true,
});

beforeEach(() => {
  calls = [];
  me = { kind: 'trader', level: 'full', displayName: 'nightowl', methods: ['password'], termsCurrent: true, member: null, pendingChanges: null, recoveryCodeToShow: false };
  hold = { status: 200, body: view() };
  replies = {};
  refreshSession();
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url: input, method, body });
    const r = replies[`${method} ${input}`];
    if (r !== undefined) return json(r.status, r.body);
    if (input === '/v1/account/me') return json(200, me);
    if (input === '/v1/account/hold') return json(hold.status, hold.body);
    if (input === '/v1/team') return json(200, { members: [{ id: 'm1', displayName: 'Aurora', roles: ['trades'], status: 'active' }], max: 3 });
    if (method === 'DELETE' && input.startsWith('/v1/account/hold/changes')) return json(204, null);
    return json(404, { error: 'not-found' });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });

const byPart = (host: ParentNode, part: string) => host.querySelector(`[data-part="${part}"]`);
const allByPart = (host: ParentNode, part: string) => [...host.querySelectorAll(`[data-part="${part}"]`)];
const click = (el: Element | null) => fire(el!, new MouseEvent('click', { bubbles: true }));

describe('the words of a change (owner G29: before and after)', () => {
  it('names each kind of change, never a secret, and each new wallet by its address end', () => {
    expect(changeWords({ kind: 'password' })).toEqual({ title: 'Password', before: 'Your current password', after: 'A new password' });
    expect(changeWords({ kind: 'webauthn', method: 'passkey' })).toEqual({ title: 'Passkey', before: 'Not on your account', after: 'A new passkey' });
    expect(changeWords({ kind: 'remove-method', method: 'security-key' })).toEqual({ title: 'Security key', before: 'On your account', after: 'Removed' });
    expect(changeWords({ kind: 'one-device', on: true })).toMatchObject({ before: 'Off', after: 'On' });
    expect(changeWords({ kind: 'one-device', on: false })).toMatchObject({ before: 'On', after: 'Off' });
    expect(changeWords({ kind: 'wallets', wallets: 2, addressEnds: ['k3Fzab', '9QpLcd'] }).after).toBe('2 new wallets added: …k3Fzab, …9QpLcd');
    expect(changeWords({ kind: 'wallets', wallets: 1 }).after).toBe('1 new wallet added');
    expect(changeWords({ kind: 'recovery-codes' }).after).toBe('A new recovery code');
    expect(changeWords({ kind: 'something-new' }).title).toBe('Account setting');
  });

  it("names a team member's role change by the member's name when it is known", () => {
    const c = { kind: 'team-roles', memberId: 'm1', roles: ['offers', 'trades'] };
    expect(changeWords(c, new Map([['m1', 'Aurora']]))).toEqual({ title: "Aurora's roles", before: 'Their current roles', after: 'Offers and Trades' });
    expect(changeWords(c).title).toBe("A team member's roles");
  });

  it("names a team member's boxes change by the boxes' labels (Job 1c, review 2026-11-09 item 10)", () => {
    const c = { kind: 'team-abilities', memberId: 'm1', abilities: ['offers-see', 'hold-end'], abilityLabels: ['See offers', 'End a hold'] };
    expect(changeWords(c, new Map([['m1', 'Aurora']]))).toEqual({ title: "Aurora's abilities", before: 'Their current abilities', after: 'See offers, End a hold' });
    expect(changeWords(c).title).toBe("A team member's abilities");
  });

  it('reads a recovery code in groups of four', () => {
    expect(codeGroups('K7QM4XD2VT9BHP3A')).toEqual(['K7QM', '4XD2', 'VT9B', 'HP3A']);
    expect(codeGroups('K7QM-4XD2 VT9B')).toEqual(['K7QM', '4XD2', 'VT9B']);
  });
});

describe('the alert list', () => {
  it('words every hold v3 alert kind', () => {
    for (const k of ['hold-extended', 'hold-changes-submitted', 'hold-changes-cancelled', 'hold-changes-discarded', 'hold-changes-applied', 'recovery-code-renewed']) {
      expect(alertWords(k)).not.toBe('Security alert');
    }
    expect(alertWords('recovery-code-renewed')).toBe('You have a new recovery code');
  });

  it('gives each a line from its detail', () => {
    expect(alertDetail('hold-changes-submitted', { count: 3, changes: [], takesEffectAt: DUE })).toBe(
      `3 changes waiting. They take effect on ${utcDateTime(new Date(DUE))} unless someone cancels them.`,
    );
    expect(alertDetail('hold-changes-cancelled', { count: 1, changes: [] })).toBe('1 change cancelled. Nothing on your account changed.');
    expect(alertDetail('hold-changes-discarded', { count: 2, changes: [], reason: 'owner-login' })).toContain('after a login with a passkey, a security key or a PGP key');
    expect(alertDetail('hold-changes-applied', { applied: ['password', 'totp'], dropped: [] })).toBe('2 changes applied.');
    expect(alertDetail('hold-changes-applied', { applied: ['password'], dropped: ['wallets'] })).toContain('1 change could not be applied');
    expect(alertDetail('recovery-code-renewed', {})).toContain('Write down the new one');
    expect(alertDetail('hold-changes-submitted', null)).toBeNull();
    expect(alertDetail('new-login', {})).toBeNull();
  });
});

describe('AccountChanges: the drafts in one review, then one submit', () => {
  const drafts = [
    { id: D1, kind: 'password', createdAt: DUE },
    { id: D2, kind: 'team-roles', memberId: 'm1', roles: ['trades'], createdAt: DUE },
  ];

  it('lists every draft before → after, says the 24-hour wait and the stronger login, and submits exactly those ids', async () => {
    hold = { status: 200, body: view({ drafts }) };
    replies['POST /v1/account/hold/changes/submit'] = { status: 200, body: { status: 'queued', count: 2, takesEffectAt: DUE } };
    const { host } = render(
      <MemoryRouter>
        <AccountChanges />
      </MemoryRouter>,
    );
    await settle();
    const rows = allByPart(host, 'change');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('Password');
    expect(rows[0]!.textContent).toContain('Before Your current password');
    expect(rows[0]!.textContent).toContain('After A new password');
    // The member's name, from the team list.
    expect(rows[1]!.textContent).toContain("Aurora's roles");
    expect(byPart(host, 'drafts-count')!.textContent).toBe('2 changes · up to 20');
    expect(byPart(host, 'drafts-wait')!.textContent).toContain('Every change, removals included, applies after 24 h.');
    expect(byPart(host, 'drafts-wait')!.textContent).toContain(HOLD_COPY.throwAway);
    expect(byPart(host, 'drafts-stronger')!.textContent).toContain('Add a passkey, a security key or a PGP key');
    const submit = byPart(host, 'drafts-submit')!;
    expect(submit.textContent).toBe('Submit 2 changes');

    hold = { status: 200, body: view({ items: drafts.map((d) => ({ ...d, submittedAt: DUE, by: 'Browser on Linux', mine: true })) }) };
    click(submit);
    await settle();
    expect(calls.find((c) => c.method === 'POST')).toEqual({ url: '/v1/account/hold/changes/submit', method: 'POST', body: { ids: [D1, D2] } });
    expect(byPart(host, 'changes-status')!.textContent).toBe(HOLD_COPY.submitted(DUE));
    // Now they wait, with their date.
    expect(byPart(host, 'change-drafts')).toBeNull();
    expect(byPart(host, 'waiting-when')!.textContent).toBe(`2 changes waiting. The next takes effect on ${utcDateTime(new Date(DUE))}`);
  });

  it('a list changed elsewhere (409 changes-changed) says so and loads the list again', async () => {
    hold = { status: 200, body: view({ drafts }) };
    replies['POST /v1/account/hold/changes/submit'] = { status: 409, body: { error: 'changes-changed' } };
    const { host } = render(
      <MemoryRouter>
        <AccountChanges />
      </MemoryRouter>,
    );
    await settle();
    const before = calls.filter((c) => c.url === '/v1/account/hold').length;
    click(byPart(host, 'drafts-submit'));
    await settle();
    expect(byPart(host, 'changes-status')!.textContent).toBe(HOLD_COPY.changed);
    expect(calls.filter((c) => c.url === '/v1/account/hold').length).toBeGreaterThan(before);
  });

  it('removes one draft by its id', async () => {
    hold = { status: 200, body: view({ drafts }) };
    const { host } = render(
      <MemoryRouter>
        <AccountChanges />
      </MemoryRouter>,
    );
    await settle();
    click(allByPart(host, 'draft-remove')[0]!);
    await settle();
    expect(calls.some((c) => c.method === 'DELETE' && c.url === `/v1/account/hold/changes/${D1}`)).toBe(true);
  });
});

describe('AccountChanges: the waiting changes (g65), with their date, a countdown, untick and Cancel all', () => {
  const items = [
    { id: W1, kind: 'wallets', wallets: 1, addressEnds: ['k3Fzab'], createdAt: DUE, submittedAt: DUE, by: 'Chrome on Windows', mine: false },
    { id: W2, kind: 'one-device', on: true, createdAt: DUE, submittedAt: DUE, by: 'Browser on Linux', mine: true },
  ];

  it('shows each with "Applies <date> UTC", a countdown and where it came from; an unticked change is cancelled by id', async () => {
    hold = { status: 200, body: view({ items }) };
    const { host } = render(
      <MemoryRouter>
        <AccountChanges />
      </MemoryRouter>,
    );
    await settle();
    const rows = allByPart(host, 'change');
    expect(rows[0]!.textContent).toContain('1 new wallet added: …k3Fzab');
    expect(rows[0]!.textContent).toContain(`Applies ${utcDateTime(new Date(DUE))}`);
    expect(rows[0]!.textContent).toContain('From Chrome on Windows');
    expect(rows[1]!.textContent).toContain('From this device');
    expect(utcDateTime(new Date(DUE))).toBe('8 Nov 2026, 15:00 UTC');
    expect(byPart(host, 'waiting-countdown')!.querySelector('[role="timer"]')).not.toBeNull();
    // A username-and-password session: no Approve now (G58 is for a strong login).
    expect(byPart(host, 'waiting-approve')).toBeNull();
    expect(byPart(host, 'waiting-strong')).toBeNull();
    const boxes = allByPart(host, 'waiting-keep') as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([true, true]);
    expect(boxes[0]!.getAttribute('aria-label')).toBe('Keep the change: Payout wallets');
    expect(byPart(host, 'waiting-cancel-unticked')).toBeNull();
    click(boxes[0]!);
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    const cancel = byPart(host, 'waiting-cancel-unticked')!;
    expect(cancel.textContent).toBe('Cancel 1 unticked change');
    click(cancel);
    await settle();
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual([`/v1/account/hold/changes/${W1}`]);
    expect(byPart(host, 'changes-status')!.textContent).toBe(HOLD_COPY.cancelled);
  });

  it('G58: a strong login sees the same view and approves the ticked changes now; unticked ones are cancelled', async () => {
    hold = { status: 200, body: view({ items, strong: true }) };
    replies['POST /v1/account/hold/changes/approve'] = { status: 200, body: { status: 'applied' } };
    const { host } = render(
      <MemoryRouter>
        <AccountChanges />
      </MemoryRouter>,
    );
    await settle();
    expect(byPart(host, 'waiting-strong')!.textContent).toBe(HOLD_COPY.strongNote);
    expect(byPart(host, 'waiting-approve')!.textContent).toBe('Approve 2 changes now');
    expect(byPart(host, 'waiting-make-changes')!.getAttribute('href')).toBe('/settings/security#methods-h');
    click(allByPart(host, 'waiting-keep')[1]!);
    expect(byPart(host, 'waiting-approve')!.textContent).toBe('Approve now');
    hold = { status: 200, body: view({ strong: true }) };
    click(byPart(host, 'waiting-approve'));
    await settle();
    const writes = calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url} ${JSON.stringify(c.body ?? null)}`);
    expect(writes).toEqual([`DELETE /v1/account/hold/changes/${W2} null`, `POST /v1/account/hold/changes/approve {"ids":["${W1}"]}`]);
    expect(byPart(host, 'changes-status')!.textContent).toBe(HOLD_COPY.approved);
  });

  it('Cancel all changes asks first, then cancels them all', async () => {
    hold = { status: 200, body: view({ items }) };
    const { host } = render(
      <MemoryRouter>
        <AccountChanges />
      </MemoryRouter>,
    );
    await settle();
    click(byPart(host, 'waiting-cancel-all'));
    await settle();
    const ask = byPart(document, 'cancel-ask')!;
    expect(document.body.textContent).toContain('Cancel all 2 changes?');
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    hold = { status: 200, body: view() };
    click(byPart(ask, 'cancel-yes'));
    await settle();
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/v1/account/hold/changes')).toBe(true);
    expect(byPart(host, 'changes-status')!.textContent).toBe(HOLD_COPY.cancelled);
  });

  it('shows nothing on Security with no changes, nor when the list cannot be read (a team member: 403 owner-only)', async () => {
    const { host } = render(
      <MemoryRouter>
        <AccountChanges />
      </MemoryRouter>,
    );
    await settle();
    expect(host.textContent).toBe('');
    hold = { status: 403, body: { error: 'owner-only' } };
    const other = render(
      <MemoryRouter>
        <AccountChanges />
      </MemoryRouter>,
    );
    await settle();
    expect(other.host.textContent).toBe('');
  });

  it('after a strong login (G58) its Continue goes on to returnTo, only within the app', async () => {
    const { host } = render(
      <MemoryRouter initialEntries={['/settings/changes?returnTo=%2Fwallets']}>
        <AccountChangesScreen />
      </MemoryRouter>,
    );
    await settle();
    expect(byPart(host, 'changes-continue')!.getAttribute('href')).toBe('/wallets');
    const evil = render(
      <MemoryRouter initialEntries={['/settings/changes?returnTo=%2F%2Fevil.example']}>
        <AccountChangesScreen />
      </MemoryRouter>,
    );
    await settle();
    expect(byPart(evil.host, 'changes-continue')!.getAttribute('href')).not.toContain('evil');
  });

  it('its own screen says when nothing waits; a team member without hold rights sees only that a hold is on (owner p4-8)', async () => {
    const { host } = render(
      <MemoryRouter>
        <AccountChangesScreen />
      </MemoryRouter>,
    );
    await settle();
    expect(byPart(host, 'changes-none')!.textContent).toBe(HOLD_COPY.none);

    refreshSession();
    me = { ...me, member: { name: 'Aurora', roles: ['trades'] }, pendingChanges: null };
    const member = render(
      <MemoryRouter>
        <AccountChangesScreen />
      </MemoryRouter>,
    );
    await settle();
    // No hold: the member's screen says nothing waits.
    expect(member.host.querySelector('[data-owner-only]')).toBeNull();
    expect(byPart(member.host, 'changes-none')).not.toBeNull();
  });
});

describe("owner p4-8: a team member's view of the lead's hold (HoldMember board, rights none / see / cancel / end)", () => {
  const items = [
    { id: W1, kind: 'remove-wallet', label: 'Cake Wallet', addressEnds: ['k3Fzab'], createdAt: DUE, submittedAt: DUE, by: 'Laptop', mine: false },
    { id: W2, kind: 'team-remove', memberId: 'm1', createdAt: DUE, submittedAt: DUE, by: 'Laptop', mine: false },
  ];
  const memberView = (rights: string, list = items) => ({
    accountHold: null, changes: { count: rights === 'none' ? 0 : list.length, takesEffectAt: DUE, items: rights === 'none' ? [] : list },
    drafts: [], changesWait: false, rights, lead: 'satoshi_ghost',
  });
  const show = async (rights: string) => {
    me = { ...me, member: { name: 'desk_ana', roles: ['trades'] } };
    hold = { status: 200, body: memberView(rights) };
    const r = render(
      <MemoryRouter>
        <AccountChangesScreen />
      </MemoryRouter>,
    );
    await settle();
    return r.host;
  };

  it('none: "A hold is on", the countdown and what they can see; no list and no buttons', async () => {
    const host = await show('none');
    expect(byPart(host, 'changes-waiting')!.getAttribute('data-rights')).toBe('none');
    expect(host.textContent).toContain(MEMBER_HOLD_COPY.title);
    expect(byPart(host, 'member-hold')!.textContent).toContain(MEMBER_HOLD_COPY.hero('satoshi_ghost'));
    expect(byPart(host, 'waiting-countdown')!.textContent).toContain(MEMBER_HOLD_COPY.endsIn);
    expect(byPart(host, 'member-rights')!.textContent).toBe(MEMBER_HOLD_COPY.none('satoshi_ghost'));
    expect(byPart(host, 'waiting-list')).toBeNull();
    expect(byPart(host, 'waiting-cancel-all')).toBeNull();
    expect(byPart(host, 'waiting-approve')).toBeNull();
  });

  it('see: the list read-only, removals reading "Removed <date>"', async () => {
    const host = await show('see');
    const rows = allByPart(host, 'change');
    expect(rows[0]!.textContent).toContain('Wallet removed');
    expect(rows[0]!.textContent).toContain('Cake Wallet · …k3Fzab');
    expect(rows[0]!.textContent).toContain(`Removed ${utcDateTime(new Date(DUE))}`);
    expect(rows[1]!.textContent).toContain('Team member removed');
    expect(byPart(host, 'member-rights')!.textContent).toBe(MEMBER_HOLD_COPY.see);
    expect(allByPart(host, 'waiting-keep')).toEqual([]);
    expect(byPart(host, 'waiting-cancel-all')).toBeNull();
    expect(byPart(host, 'waiting-approve')).toBeNull();
  });

  it('cancel: ticks and Cancel all changes, no End the hold', async () => {
    const host = await show('cancel');
    expect(allByPart(host, 'waiting-keep')).toHaveLength(2);
    expect(byPart(host, 'waiting-cancel-all')).not.toBeNull();
    expect(byPart(host, 'waiting-approve')).toBeNull();
    click(byPart(host, 'waiting-cancel-all')!);
    await settle();
    click(byPart(document.body, 'cancel-yes')!);
    await settle();
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual(['/v1/account/hold/changes']);
    expect(byPart(host, 'changes-status')!.textContent).toBe(MEMBER_HOLD_COPY.cancelled(2));
  });

  it('end: End the hold applies the ticked changes now', async () => {
    replies['POST /v1/account/hold/changes/approve'] = { status: 200, body: { status: 'applied', count: 2 } };
    const host = await show('end');
    expect(byPart(host, 'member-end-note')!.textContent).toBe(MEMBER_HOLD_COPY.endNote);
    const end = byPart(host, 'waiting-approve')!;
    expect(end.textContent).toBe(MEMBER_HOLD_COPY.end);
    click(end);
    await settle();
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({ url: '/v1/account/hold/changes/approve', body: { ids: [W1, W2] } });
    expect(byPart(host, 'changes-status')!.textContent).toBe(MEMBER_HOLD_COPY.ended);
  });

  it('the banner tells a member only that a hold is on', async () => {
    me = { ...me, member: { name: 'desk_ana', roles: ['trades'] }, teamHold: { takesEffectAt: DUE } };
    const { host } = render(
      <MemoryRouter initialEntries={['/sell']}>
        <ChangesBanner />
      </MemoryRouter>,
    );
    await settle();
    expect(byPart(host, 'changes-banner-member')!.textContent).toBe(`${MEMBER_HOLD_COPY.banner} ${MEMBER_HOLD_COPY.bannerLink}`);
    expect(host.textContent).not.toContain('changes waiting');
  });
});

describe('the shell: banner and change cap', () => {
  it('while changes wait, the banner gives the count, the date and Review changes', async () => {
    me = { ...me, pendingChanges: { count: 3, takesEffectAt: DUE } };
    const { host } = render(
      <MemoryRouter initialEntries={['/sell']}>
        <ChangesBanner />
      </MemoryRouter>,
    );
    await settle();
    expect(byPart(host, 'changes-banner-pending')!.textContent).toBe(`3 changes waiting. The next takes effect on 8 Nov 2026, 15:00 UTC ${HOLD_COPY.review}`);
    expect(byPart(host, 'changes-banner-pending')!.querySelector('a')!.getAttribute('href')).toBe(CHANGES_PATH);
  });

  it('reminds of a new recovery code, and is not shown to a team member (G31) or on the screens that show it in full', async () => {
    me = { ...me, recoveryCodeToShow: true };
    const owner = render(
      <MemoryRouter initialEntries={['/sell']}>
        <ChangesBanner />
      </MemoryRouter>,
    );
    await settle();
    expect(byPart(owner.host, 'changes-banner-code')!.textContent).toContain(NEW_CODE_COPY.bannerText);
    const onSecurity = render(
      <MemoryRouter initialEntries={['/settings/security']}>
        <ChangesBanner />
      </MemoryRouter>,
    );
    await settle();
    expect(onSecurity.host.textContent).toBe('');

    refreshSession();
    me = { ...me, member: { name: 'Aurora', roles: ['trades'] }, pendingChanges: { count: 3, takesEffectAt: DUE }, recoveryCodeToShow: true };
    const member = render(
      <MemoryRouter initialEntries={['/sell']}>
        <ChangesBanner />
      </MemoryRouter>,
    );
    await settle();
    expect(member.host.textContent).toBe('');
  });

  it('409 too-many-changes from any screen opens CantDoThat with the cap (G36)', async () => {
    const e = new AuthApiError(409, 'too-many-changes', { max: 20 });
    expect(changesCapOf(e)).toEqual({ max: 20 });
    expect(changesCapOf(new AuthApiError(409, 'changes-changed'))).toBeNull();
    render(
      <MemoryRouter>
        <ChangesCapPopup />
      </MemoryRouter>,
    );
    expect(reportChangesCap(new Error('x'))).toBe(false);
    let shown = false;
    act(() => {
      shown = reportChangesCap(e);
    });
    expect(shown).toBe(true);
    const pop = document.querySelector('[data-part="cant-do-that"]')!;
    expect(pop.textContent).toContain(holdChangesCantDoText(20));
    expect(holdChangesCantDoText(20)).toContain('20 changes waiting or in drafts');
  });

  it('a staged note links to the review', () => {
    const { host } = render(
      <MemoryRouter>
        <StagedNote />
      </MemoryRouter>,
    );
    expect(byPart(host, 'staged-note')!.textContent).toBe(`${HOLD_COPY.staged} ${HOLD_COPY.stagedLink}`);
    expect(host.querySelector('a')!.getAttribute('href')).toBe(CHANGES_PATH);
  });
});

describe('the new recovery code (G32), shown once', () => {
  it('nothing while none waits', async () => {
    const { host } = render(<NewRecoveryCode />);
    await settle();
    expect(host.textContent).toBe('');
  });

  it('says it is an emergency way in, shows it once on request, and closes once written down', async () => {
    me = { ...me, recoveryCodeToShow: true };
    replies['POST /v1/account/recovery-code/reveal'] = { status: 200, body: { code: 'K7QM4XD2VT9BHP3A' } };
    const { host } = render(<NewRecoveryCode />);
    await settle();
    expect(host.textContent).toContain(NEW_CODE_COPY.title);
    expect(byPart(host, 'new-code-emergency')!.textContent).toContain("doesn't change your username or password, and it doesn't skip the 24-hour wait");
    expect(byPart(host, 'new-code')).toBeNull();
    click(byPart(host, 'new-code-show'));
    await settle();
    expect(allByPart(host, 'new-code')[0]!.querySelectorAll('li')).toHaveLength(4);
    expect(byPart(host, 'new-code')!.textContent).toBe('K7QM4XD2VT9BHP3A');
    expect(byPart(host, 'new-code-save')!.textContent).toContain('You will not see it again.');
    expect(calls.filter((c) => c.url === '/v1/account/recovery-code/reveal')).toHaveLength(1);
    const done = byPart(host, 'new-code-done') as HTMLButtonElement;
    expect(done.disabled).toBe(true);
    click(host.querySelector('input[type="checkbox"]'));
    expect(done.disabled).toBe(false);
    click(done);
    expect(host.textContent).toBe('');
  });

  it('a code already shown elsewhere (404) says so', async () => {
    me = { ...me, recoveryCodeToShow: true };
    replies['POST /v1/account/recovery-code/reveal'] = { status: 404, body: { error: 'not-found' } };
    const { host } = render(<NewRecoveryCode />);
    await settle();
    click(byPart(host, 'new-code-show'));
    await settle();
    expect(byPart(host, 'new-code-gone')!.textContent).toBe(NEW_CODE_COPY.gone);
  });
});

describe('a change answered 202 staged', () => {
  // The logout timer that used to be this case is retired (session length, owner 2 Nov 2026): One
  // device at a time on Devices is the staged change now.
  it('One device at a time keeps its value and says the change is a draft to review and submit', async () => {
    replies['GET /v1/account/sessions'] = { status: 200, body: [] };
    replies['GET /v1/account/security/devices'] = { status: 200, body: { oneDevice: false, maxDevices: 3 } };
    replies['PUT /v1/account/security/one-device'] = { status: 202, body: { status: 'staged', changeId: D1 } };
    const prove = vi.fn(async () => 'T'.repeat(43));
    const { host } = render(
      <MemoryRouter>
        <Devices prove={prove} />
      </MemoryRouter>,
    );
    await settle();
    click(byPart(host, 'one-device-toggle'));
    await settle();
    expect(calls.find((c) => c.method === 'PUT')!.body).toMatchObject({ on: true });
    expect(byPart(host, 'staged-note')!.textContent).toBe(`${HOLD_COPY.staged} ${HOLD_COPY.stagedLink}`);
    expect(byPart(host, 'one-device-toggle')!.getAttribute('aria-checked')).toBe('false');
  });
});
