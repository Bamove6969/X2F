// @vitest-environment happy-dom
// Spec 6.6 "Account actions" (Plan 4 Task 27): the Accounts page, ModCase's Account actions card and
// the owner's Reset security, against a fake staff API in the shapes of apps/api/src/staff/
// accountLookup.ts, bans.ts and invites.ts. Every action has a sheet saying exactly what happens;
// bans and lifts are tapped (ban-account, lift-ban); the role gates match the API's (accounts.ban:
// senior moderators and the owner; reset-security: the owner only).
import { BAN_RULES, NAV, inviteTokenHash } from '@x2f/staff';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { banBody, banUntil, statusLines } from '../src/screens/AccountActions.js';
import { describeLog } from '../src/screens/logModel.js';
import { button, cleanup, click, fakeApi, field, honestTapStart, refused, render, settle, tick, typeInto } from './helpers.js';

const webauthn = vi.hoisted(() => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => webauthn);

const H = 3_600_000;
const DAY = 24 * H;
const ends = () => new Date(Date.now() + H).toISOString();
const OWNER = { tradeTag: 'lumen.k', role: 'owner', nav: NAV.owner, sessionEndsAt: ends() };
const SENIOR = { tradeTag: 'sarah.v', role: 'senior', nav: NAV.senior, grants: ['accounts.ban', 'accounts.unban'], sessionEndsAt: ends() };
const MOD = { tradeTag: 'dmitri_k', role: 'mod', nav: NAV.mod, sessionEndsAt: ends() };
const ACCT = '7c3f6a52-2f0e-4b8a-9d55-0a1b2c3d4e5f';
const SELLER = '1b2c3d4e-2f0e-4b8a-9d55-0a1b2c3d4e5f';
const BAN = '0d6f8a52-2f4e-4c55-9d0b-6a3f2b1c0e9d';
const CODE = '7RWD3MXEKQ84HN2T';

const account = (o: Record<string, unknown> = {}) => ({
  accountId: ACCT, tradeTag: 'harbor_lin', matchedBy: 'name', side: null, completedTrades: 30, positivePct: 97,
  disputes: { won: 1, lost: 2 }, stage: 'graduated', status: { bans: [], frozen: false, lien: false }, ...o,
});
const bans = (o: Record<string, unknown> = {}) => ({ priorOffences: 0, bans: [], rules: BAN_RULES, ...o });
const TAPS = { 'POST /staff/v1/taps/start': honestTapStart('tap-1'), 'POST /staff/v1/taps/:id/finish': { body: { tapId: 'tap-1' } } };
const tapIntents = (calls: { path: string; body: unknown }[]) => calls.filter((c) => c.path === '/staff/v1/taps/start').map((c) => c.body as Record<string, unknown>);
const part = (p: string) => document.querySelector(`[data-part="${p}"]`);
const pick = async (name: string, value: string) => {
  const input = document.querySelector<HTMLInputElement>(`[data-part="${name}"] input[value="${value}"]`);
  if (!input) throw new Error(`no ${name} ${value}`);
  await click(input);
};

async function open(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  await settle();
}

async function lookUp(q: string) {
  typeInto(field('Trade Tag or trade code'), q);
  await click(button('Look up'));
  // The lookup, then each card's own bans read.
  await settle();
}

beforeEach(() => {
  webauthn.startAuthentication.mockReset().mockResolvedValue({ id: 'cred', response: {} });
});

describe('helpers', () => {
  it('a ban end is an exact ISO instant with milliseconds', () => {
    const now = new Date('2026-11-26T12:00:00.000Z');
    expect(banUntil(7, now)).toBe('2026-12-03T12:00:00.000Z');
  });
  it('the ban body says what happens: a trade ban lets open trades finish; a permanent site ban puts names and keys on the ban list', () => {
    const rule = BAN_RULES.find((r) => r.id === 'scamming')!;
    expect(banBody('harbor_lin', 'trade', rule, '2026-12-03T12:00:00.000Z')).toContain("harbor_lin can't post or take offers until 2026-12-03 12:00 UTC. Trades already open still finish.");
    const site = banBody('harbor_lin', 'site', rule, null);
    expect(site).toContain('for good');
    expect(site).toContain('ban list');
    expect(site).toContain('"Problems in trades"');
    expect(site).toContain('never the rule or your note');
  });
  it('the status lines: bans with their end and general reason, a freeze and a lien', () => {
    const lines = statusLines(account({
      status: {
        bans: [{ id: BAN, kind: 'site', reasonCode: 'abuse', until: null, permanent: true }],
        frozen: true,
        lien: true,
      },
    }) as never);
    expect(lines).toEqual([
      'Site ban, Permanent: Abuse of other traders',
      'Frozen in a dispute',
      'A lien blocks all trading until the repayment trade completes',
    ]);
  });
});

describe('the activity log', () => {
  it('words a lookup, by the account found or none', () => {
    const actor = { kind: 'staff', role: 'senior', id: 's-1', name: 'sarah.v' } as const;
    expect(describeLog({ action: 'account.looked-up', detail: { by: 'code', accountId: ACCT }, actor }, { [ACCT]: 'harbor_lin' })).toBe('Looked up harbor_lin by trade code');
    expect(describeLog({ action: 'account.looked-up', detail: { by: 'name', found: 0 }, actor })).toBe('Looked up an account by Trade Tag; none matched');
  });
});

describe('the Accounts page (spec 6.6)', () => {
  it('is in the menu of the owner and senior moderators only; a moderator who opens it sees nothing for their role', async () => {
    fakeApi({ 'GET /staff/v1/me': { body: SENIOR } });
    await open('/accounts');
    expect(document.querySelector('[data-nav="accounts"]')?.textContent).toBe('Accounts');
    expect(document.querySelector('[data-screen="accounts"]')).not.toBeNull();
    cleanup();
  });

  it('a moderator has no Accounts item, and the page is not served at /accounts', async () => {
    const api = fakeApi({ 'GET /staff/v1/me': { body: MOD } });
    await open('/accounts');
    expect(document.querySelector('[data-nav="accounts"]')).toBeNull();
    expect(document.querySelector('[data-screen="accounts"]')).toBeNull();
    expect(part('nothing-for-role')).not.toBeNull();
    expect(api.calls.some((c) => c.path.startsWith('/staff/v1/accounts'))).toBe(false);
  });

  it('owner 26 Nov 2026: a senior moderator without the Ban box sees the history but no ban button', async () => {
    fakeApi({
      'GET /staff/v1/me': { body: { ...SENIOR, grants: [] } },
      'GET /staff/v1/accounts/lookup': { body: { accounts: [account()] } },
      'GET /staff/v1/accounts/:id/bans': { body: bans() },
    });
    await open('/accounts');
    await lookUp('harbor_lin');
    expect(part('account-bans')).not.toBeNull();
    expect(button('Ban harbor_lin')).toBeUndefined();
  });

  it('looks up by name and shows the card: reputation and status; no match says so', async () => {
    const api = fakeApi({
      'GET /staff/v1/me': { body: SENIOR },
      'GET /staff/v1/accounts/lookup': (_b, path) => ({ body: { accounts: path.includes('nobody') ? [] : [account()] } }),
      'GET /staff/v1/accounts/:id/bans': { body: bans() },
    });
    await open('/accounts');
    await lookUp('harbor_lin');
    expect(api.calls.find((c) => c.path.startsWith('/staff/v1/accounts/lookup'))!.path).toBe('/staff/v1/accounts/lookup?q=harbor_lin');
    expect(part('account-reputation')?.textContent).toBe('30 trades · 97% positive · Disputes: 1 won, 2 lost');
    expect(part('account-status')?.textContent).toBe('No ban, freeze or lien.');
    expect(button('Ban harbor_lin')).toBeDefined();
    await lookUp('nobody');
    expect(part('lookup-empty')?.textContent).toContain('"nobody"');
  });

  it('bans: kind, reason and length, then the tap dialog says exactly what happens; the tap binds the ban; the card reads again', async () => {
    let placed: Record<string, unknown> | null = null;
    const api = fakeApi({
      'GET /staff/v1/me': { body: SENIOR },
      'GET /staff/v1/accounts/lookup': () => ({ body: { accounts: [account(placed ? { status: { bans: [{ id: placed.banId, kind: 'trade', reasonCode: 'abuse', until: placed.until, permanent: false }], frozen: false, lien: false } } : {})] } }),
      'GET /staff/v1/accounts/:id/bans': { body: bans() },
      ...TAPS,
      'POST /staff/v1/accounts/:id/bans': (b) => {
        placed = b as Record<string, unknown>;
        return { status: 201, body: { id: placed.banId } };
      },
    });
    await open('/accounts');
    await lookUp('harbor_lin');
    await click(button('Ban harbor_lin'));
    const review = button('Review the ban');
    expect(review?.disabled).toBe(true);
    await pick('ban-kind', 'trade');
    await pick('ban-rule', 'abuse');
    // A first offence of a rule that is not lifetime-from-first: lengths only, no Permanent.
    expect(document.querySelector('[data-part="ban-term"] input[value="permanent"]')).toBeNull();
    await pick('ban-term', '7');
    typeInto(field('Staff note'), 'Threatened a buyer in chat');
    expect(review?.disabled).toBe(false);
    const before = Date.now();
    await click(review);
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("harbor_lin can't post or take offers until");
    expect(dialog.textContent).toContain('Trades already open still finish.');
    expect(dialog.textContent).toContain('"Abuse of other traders"');
    await click(button('Tap security key'));
    const [intent] = tapIntents(api.calls);
    expect(intent).toMatchObject({ kind: 'ban-account', accountId: ACCT, banKind: 'trade', ruleId: 'abuse' });
    const until = Date.parse(intent!.until as string);
    expect(until - before).toBeGreaterThanOrEqual(7 * DAY - 60_000);
    expect(until - before).toBeLessThanOrEqual(7 * DAY + 60_000);
    expect(placed).toEqual({ banId: intent!.banId, kind: 'trade', ruleId: 'abuse', until: intent!.until, note: 'Threatened a buyer in chat', tapId: 'tap-1' });
    expect(part('account-done')?.textContent).toContain('harbor_lin is banned from trading until');
    expect(part('account-status')?.textContent).toContain('Trade ban, until');
    // The trade ban stands, so only a site ban is left to offer.
    await click(button('Ban harbor_lin'));
    expect(document.querySelector('[data-part="ban-kind"] input[value="trade"]')).toBeNull();
    expect(document.querySelector('[data-part="ban-kind"] input[value="site"]')).not.toBeNull();
  });

  it('the third offence is permanent only; a scam can be permanent from the first', async () => {
    fakeApi({
      'GET /staff/v1/me': { body: OWNER },
      'GET /staff/v1/accounts/lookup': { body: { accounts: [account()] } },
      'GET /staff/v1/accounts/:id/bans': { body: bans({ priorOffences: 2 }) },
    });
    await open('/accounts');
    await lookUp('harbor_lin');
    await click(button('Ban harbor_lin'));
    await pick('ban-kind', 'site');
    await pick('ban-rule', 'terms');
    expect(part('ban-term-lifetime')?.textContent).toBe('Permanent: this is offence 3 for this account.');
    expect(button('Review the ban')?.disabled).toBe(false);
    cleanup();

    fakeApi({
      'GET /staff/v1/me': { body: OWNER },
      'GET /staff/v1/accounts/lookup': { body: { accounts: [account()] } },
      'GET /staff/v1/accounts/:id/bans': { body: bans() },
    });
    await open('/accounts');
    await lookUp('harbor_lin');
    await click(button('Ban harbor_lin'));
    await pick('ban-kind', 'site');
    await pick('ban-rule', 'scamming');
    expect(document.querySelector('[data-part="ban-term"] input[value="permanent"]')).not.toBeNull();
  });

  it('a ban placed meanwhile is a fault that says so, and nothing else changes', async () => {
    fakeApi({
      'GET /staff/v1/me': { body: SENIOR },
      'GET /staff/v1/accounts/lookup': { body: { accounts: [account()] } },
      'GET /staff/v1/accounts/:id/bans': { body: bans() },
      ...TAPS,
      'POST /staff/v1/accounts/:id/bans': refused(409, 'already-banned'),
    });
    await open('/accounts');
    await lookUp('harbor_lin');
    await click(button('Ban harbor_lin'));
    await pick('ban-kind', 'trade');
    await pick('ban-rule', 'abuse');
    await pick('ban-term', '1');
    await click(button('Review the ban'));
    await click(button('Tap security key'));
    expect(part('account-fault')?.textContent).toBe('harbor_lin already has a trade ban in force. The list is up to date now.');
  });

  it('lifts a ban in force with a lift-ban tap, after saying what happens', async () => {
    const active = { id: BAN, kind: 'site', ruleId: 'abuse', reasonCode: 'abuse', until: null, permanent: true, note: 'Doxxed a seller', createdAt: '2026-11-20T10:00:00.000Z', endedAt: null, liftedAt: null, active: true };
    const api = fakeApi({
      'GET /staff/v1/me': { body: SENIOR },
      'GET /staff/v1/accounts/lookup': { body: { accounts: [account({ status: { bans: [{ id: BAN, kind: 'site', reasonCode: 'abuse', until: null, permanent: true }], frozen: false, lien: false } })] } },
      'GET /staff/v1/accounts/:id/bans': { body: bans({ priorOffences: 1, bans: [active] }) },
      ...TAPS,
      'POST /staff/v1/accounts/:id/bans/:banId/lift': { body: { ...active, active: false, liftedAt: new Date().toISOString() } },
    });
    await open('/accounts');
    await lookUp('harbor_lin');
    expect(part('ban-history')?.textContent).toContain('Staff note: Doxxed a seller');
    await click(button('Lift this site ban'));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('their names and keys come off the ban list');
    await click(button('Tap security key'));
    expect(tapIntents(api.calls)).toEqual([{ kind: 'lift-ban', accountId: ACCT, banId: BAN }]);
    expect(api.calls.find((c) => c.path.endsWith('/lift'))).toMatchObject({ path: `/staff/v1/accounts/${ACCT}/bans/${BAN}/lift`, body: { tapId: 'tap-1' } });
  });

});

describe('ModCase: Account actions', () => {
  const trader = (name: string) => ({ tradeTag: name, completedTrades: 30, online: false, lastSeenAt: null, typicalMinutes: null, positivePct: 100, badges: [], stage: 'graduated', tradedOverXmr: null, imported: [] });
  const kase = () => ({
    code: CODE, incidentId: 'D-7RWD', seq: 1, status: 'open', round: 1, openedBy: 'buyer', reason: 'paid', note: '',
    afterRefund: false, openedAt: new Date(Date.now() - 2 * H).toISOString(), replyDueAt: new Date(Date.now() + 2 * H).toISOString(),
    rulingDueAt: new Date(Date.now() + 46 * H).toISOString(), firstReplyAt: null, usd: '330.00', overLimit: false, limitUsd: 1000,
    assignee: 'dmitri_k', assignedToYou: false, proposedByYou: false, taken: null, mayWork: true, moderator: null,
    traders: { buyer: trader('harbor_lin'), seller: trader('quietfox') },
    escrow: { state: 'escrow-secured', amountAtomic: '1000000000000', methodId: 'ZELLE', methodName: 'Zelle', currency: 'USD', centsPerXmr: '33000', fiatCents: '33000', confirmations: 10, takenAt: new Date(Date.now() - 3 * H).toISOString() },
    ruling: { proposal: null, sentBack: null, draft: null, round1: null, publishedAt: null, appealEndsAt: null, appeal: null, complyBy: null },
    freezes: { buyer: false, seller: false },
  });

  it('a senior moderator opens both accounts by the case code (only when asked); each card offers the ban', async () => {
    const api = fakeApi({
      'GET /staff/v1/me': { body: SENIOR },
      [`GET /staff/v1/disputes/${CODE}`]: { body: kase() },
      'GET /staff/v1/accounts/lookup': {
        body: { accounts: [account({ matchedBy: 'code', side: 'seller', accountId: SELLER, tradeTag: 'quietfox' }), account({ matchedBy: 'code', side: 'buyer' })] },
      },
      'GET /staff/v1/accounts/:id/bans': { body: bans() },
    });
    await open(`/disputes/${CODE}`);
    const card = part('account-actions')!;
    expect(card).not.toBeNull();
    expect(api.calls.some((c) => c.path.startsWith('/staff/v1/accounts/lookup'))).toBe(false);
    expect(part('ruling')).toBeNull();
    await click(button('Show both accounts', card));
    expect(api.calls.find((c) => c.path.startsWith('/staff/v1/accounts/lookup'))!.path).toBe(`/staff/v1/accounts/lookup?q=${CODE}`);
    const cards = [...card.querySelectorAll('[data-part="account-card"]')];
    expect(cards.map((c) => c.querySelector('.x2f-staff-eyebrow')?.textContent)).toEqual(['Buyer', 'Seller']);
    expect(button('Ban harbor_lin', card)).toBeDefined();
    expect(button('Ban quietfox', card)).toBeDefined();
  });

  it('a moderator sees no Account actions card and never looks accounts up', async () => {
    const api = fakeApi({ 'GET /staff/v1/me': { body: MOD }, [`GET /staff/v1/disputes/${CODE}`]: { body: { ...kase(), assignedToYou: true } } });
    await open(`/disputes/${CODE}`);
    expect(document.querySelector('[data-screen="mod-case"]')).not.toBeNull();
    expect(part('account-actions')).toBeNull();
    expect(api.calls.some((c) => c.path.startsWith('/staff/v1/accounts'))).toBe(false);
  });

  it('the ruling form no longer says bans come later', async () => {
    fakeApi({ 'GET /staff/v1/me': { body: MOD }, [`GET /staff/v1/disputes/${CODE}`]: { body: { ...kase(), assignedToYou: true } } });
    await open(`/disputes/${CODE}`);
    expect(part('ruling')?.textContent).not.toContain('bans come later');
    expect(part('ruling')?.textContent).toContain('a senior moderator or the owner bans in Account actions');
  });
});

describe('StaffList: Reset this member\'s security (owner, D-032)', () => {
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  const MEMBERS = () => [
    { accountId: 'o-1', inviteId: null, tradeTag: 'lumen.k', role: 'owner', status: 'active', grants: [], hours: 'any', joinedAt: '2026-08-01T00:00:00Z', lastActiveAt: ago(20_000), openCases: 0, expiresAt: null, missingMethods: [] },
    { accountId: 'm-1', inviteId: null, tradeTag: 'dmitri_k', role: 'mod', status: 'active', grants: [], hours: 'any', joinedAt: '2026-10-02T00:00:00Z', lastActiveAt: ago(H), openCases: 17, expiresAt: null, missingMethods: [] },
  ];
  const row = (name: string) => [...document.querySelectorAll('table[aria-label="Staff"] tbody tr')].find((tr) => tr.querySelector('td')?.textContent === name)!;

  it('a strong confirm: what happens, the username typed, then a reset-staff-security tap bound to the link; the link shows once', async () => {
    const api = fakeApi({
      'GET /staff/v1/me': { body: OWNER },
      'GET /staff/v1/members': { body: { members: MEMBERS() } },
      ...TAPS,
      'POST /staff/v1/members/:id/reset-security': (b) => ({ status: 201, body: { inviteId: (b as { inviteId: string }).inviteId, link: 'https://staff.x2f.test/invite/TOKEN', expiresAt: (b as { expiresAt: string }).expiresAt } }),
    });
    await open('/staff');
    await click(button('Change', row('dmitri_k')));
    await click(button("Reset this member's security"));
    const sheet = part('reset-confirm')!;
    expect(sheet.textContent).toContain('is deleted');
    expect(sheet.textContent).toContain('every session of theirs ends now');
    expect(sheet.textContent).toContain('Their open cases go back to the queue.');
    expect(sheet.textContent).toContain('works for 24 hours');
    const go = button('Reset their security', sheet)!;
    expect(go.disabled).toBe(true);
    typeInto(field('Type dmitri_k to confirm', sheet), 'dmitri');
    await settle();
    expect(go.disabled).toBe(true);
    typeInto(field('Type dmitri_k to confirm', sheet), 'dmitri_k');
    await settle();
    expect(go.disabled).toBe(false);
    await click(go);
    expect(api.calls.some((c) => c.path.endsWith('/reset-security'))).toBe(false);
    await click(button('Tap security key'));
    const [intent] = tapIntents(api.calls);
    const call = api.calls.find((c) => c.path.endsWith('/reset-security'))!;
    const body = call.body as { inviteId: string; token: string; expiresAt: string; tapId: string };
    expect(call.path).toBe('/staff/v1/members/m-1/reset-security');
    expect(intent).toEqual({ kind: 'reset-staff-security', accountId: 'm-1', inviteId: body.inviteId, tokenHash: inviteTokenHash(body.token), expiresAt: body.expiresAt });
    expect(body.tapId).toBe('tap-1');
    expect(Date.parse(body.expiresAt) - Date.now()).toBeLessThanOrEqual(24 * H);
    expect((document.querySelector('input[aria-label="Security reset link"]') as HTMLInputElement).value).toBe('https://staff.x2f.test/invite/TOKEN');
  });

  it('a non-owner never sees the button (the page is the owner\'s; the API refuses anyone else)', async () => {
    // The Change sheet as rendered for a role other than the owner: StaffList reads the role from the shell.
    fakeApi({ 'GET /staff/v1/me': { body: { ...SENIOR, nav: [...NAV.senior, 'staff'] } }, 'GET /staff/v1/members': { body: { members: MEMBERS() } } });
    await open('/staff');
    await click(button('Change', row('dmitri_k')));
    expect(part('member-edit')).not.toBeNull();
    expect(button("Reset this member's security")).toBeUndefined();
  });
});
