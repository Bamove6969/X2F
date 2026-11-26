// @vitest-environment happy-dom
// Plan 4 Task 17: the owner pages StaffList, StaffSettings and StaffOverview, against a fake staff
// API in the shapes of apps/api/src/staff/{members,invites,settings,pay,site,revenue}.ts. Every
// tapped action (create-invite, switch-on, set-role, remove-staff, settings, pay-settings,
// emergency-stop, resume-trading) goes through KeyTapDialog with the intent the API re-derives;
// the switch-off, hours, banner and maintenance changes are not tapped (Tasks 7 and 8).
import { NAV, bannerPublishIntent, inviteTokenHash, maintenanceOnIntent, maintenancePlannedIntent } from '@x2f/staff';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { button, click, fakeApi, field, honestTapStart, refused, render, settle, tick, typeInto } from './helpers.js';

const webauthn = vi.hoisted(() => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => webauthn);

const H = 3_600_000;
const OWNER = { displayName: 'lumen.k', role: 'owner', nav: NAV.owner, sessionEndsAt: new Date(Date.now() + H).toISOString() };

async function open(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  await settle();
}

beforeEach(() => {
  webauthn.startAuthentication.mockReset().mockResolvedValue({ id: 'cred', response: {} });
});

const TAPS = {
  'POST /staff/v1/taps/start': honestTapStart('tap-1'),
  'POST /staff/v1/taps/:id/finish': { body: { tapId: 'tap-1' } },
};

const tapIntents = (calls: { path: string; body: unknown }[]) => calls.filter((c) => c.path === '/staff/v1/taps/start').map((c) => c.body);
const tableRows = (label: string) =>
  [...document.querySelectorAll(`table[aria-label="${label}"] tbody tr`)].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent ?? ''));
const row = (name: string) => [...document.querySelectorAll('table[aria-label="Staff"] tbody tr')].find((tr) => tr.querySelector('td')?.textContent === name)!;

// ---------------------------------------------------------------------------------------------
// StaffList

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const MEMBERS = () => [
  { accountId: 'o-1', inviteId: null, displayName: 'lumen.k', role: 'owner', status: 'active', grants: [], hours: 'any', joinedAt: '2026-08-01T00:00:00Z', lastActiveAt: ago(20_000), openCases: 0, expiresAt: null, missingMethods: [] },
  { accountId: 's-1', inviteId: null, displayName: 'sarah.v', role: 'senior', status: 'active', grants: [], hours: 'any', joinedAt: '2026-09-04T00:00:00Z', lastActiveAt: ago(12 * 60_000 + 5_000), openCases: 41, expiresAt: null, missingMethods: [] },
  {
    accountId: 'm-1', inviteId: null, displayName: 'dmitri_k', role: 'mod', status: 'active', grants: [], hours: { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], start: '09:00', end: '17:00', tz: 'UTC' },
    joinedAt: '2026-10-02T00:00:00Z', lastActiveAt: ago(2 * H + 5_000), openCases: 17, expiresAt: null, missingMethods: ['security-key'],
  },
  {
    accountId: 'h-1', inviteId: null, displayName: 'tobi.w', role: 'helper', status: 'switched-off', grants: [], hours: { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], start: '18:00', end: '23:00', tz: 'UTC' },
    joinedAt: '2026-10-09T00:00:00Z', lastActiveAt: ago(30 * H), openCases: 0, expiresAt: null, missingMethods: [],
  },
  {
    accountId: null, inviteId: 'i-1', displayName: null, role: 'mod', status: 'waiting', grants: [], hours: { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], start: '09:00', end: '17:00', tz: 'UTC' },
    joinedAt: null, lastActiveAt: null, openCases: 0, expiresAt: new Date(Date.now() + 21 * H + 30 * 60_000).toISOString(), missingMethods: [],
  },
];

describe('StaffList (board StaffList)', () => {
  it('lists every member and invite with the board\'s columns; the owner\'s row has no action', async () => {
    fakeApi({ 'GET /staff/v1/me': { body: OWNER }, 'GET /staff/v1/members': { body: { members: MEMBERS() } } });
    await open('/staff');
    expect(document.querySelector('[data-screen="staff"] h1')?.textContent).toBe('Staff');
    expect(document.body.textContent).toContain('Everyone who helps run X2F. Only you can add or remove people.');
    expect([...document.querySelectorAll('table[aria-label="Staff"] th')].map((th) => th.textContent)).toEqual(['Name', 'Role', 'Status', 'Login hours', 'Joined', 'Last active', 'Cases', 'Actions']);
    const rows = tableRows('Staff');
    expect(rows.map((r) => r.slice(0, 7))).toEqual([
      ['lumen.k', 'Owner', 'Active', 'Any time', 'Aug 2026', 'Just now', '0'],
      ['sarah.v', 'Senior moderator', 'Active', 'Any time', 'Sep 2026', '12 min ago', '41'],
      ['dmitri_k', 'Moderator', 'ActiveNo security key yet', 'Mon–Fri, 09:00–17:00 UTC', 'Oct 2026', '2 h ago', '17'],
      ['tobi.w', 'Helper', 'Switched off', 'Every day, 18:00–23:00 UTC', 'Oct 2026', 'Yesterday', '0'],
      ['Invite sent', 'Moderator', 'Waiting', 'Mon–Fri, 09:00–17:00 UTC', 'Expires in 21 h', '', ''],
    ]);
    expect(row('lumen.k').querySelectorAll('button')).toHaveLength(0);
    expect(button('Switch off', row('sarah.v'))).toBeDefined();
    expect(button('Switch on', row('tobi.w'))).toBeDefined();
    expect(button('Cancel invite', row('Invite sent'))).toBeDefined();
    expect(document.body.textContent).toContain('Switching someone off takes effect immediately; everything they did stays in the activity log.');
  });

  it('Switch off takes effect at once, with no tap: the row then reads Switched off with Switch on', async () => {
    let list = MEMBERS();
    const api = fakeApi({
      'GET /staff/v1/me': { body: OWNER },
      'GET /staff/v1/members': () => ({ body: { members: list } }),
      'POST /staff/v1/members/:id/switch-off': () => {
        list = list.map((m) => (m.accountId === 's-1' ? { ...m, status: 'switched-off' } : m));
        return { body: { status: 'switched-off' } };
      },
    });
    await open('/staff');
    await click(button('Switch off', row('sarah.v')));
    expect(api.calls.find((c) => c.method === 'POST' && c.path.endsWith('/switch-off'))).toMatchObject({ path: '/staff/v1/members/s-1/switch-off', body: {} });
    expect(tapIntents(api.calls)).toEqual([]);
    expect(row('sarah.v').textContent).toContain('Switched off');
    expect(button('Switch on', row('sarah.v'))).toBeDefined();
  });

  it('Switch on needs a tap bound to the person and their role', async () => {
    const api = fakeApi({
      'GET /staff/v1/me': { body: OWNER },
      'GET /staff/v1/members': { body: { members: MEMBERS() } },
      ...TAPS,
      'POST /staff/v1/members/:id/switch-on': { body: { status: 'active' } },
    });
    await open('/staff');
    await click(button('Switch on', row('tobi.w')));
    expect(api.calls.some((c) => c.path.endsWith('/switch-on'))).toBe(false);
    await click(button('Tap security key'));
    expect(tapIntents(api.calls)).toEqual([{ kind: 'switch-on', accountId: 'h-1', role: 'helper' }]);
    expect(api.calls.find((c) => c.path.endsWith('/switch-on'))).toMatchObject({ path: '/staff/v1/members/h-1/switch-on', body: { tapId: 'tap-1' } });
  });

  it('a refused switch-on (a moderator without a passkey) shows the refusal', async () => {
    fakeApi({
      'GET /staff/v1/me': { body: OWNER },
      'GET /staff/v1/members': { body: { members: MEMBERS().map((m) => (m.accountId === 's-1' ? { ...m, status: 'switched-off' } : m)) } },
      ...TAPS,
      'POST /staff/v1/members/:id/switch-on': refused(409, 'moderator-methods-required'),
    });
    await open('/staff');
    await click(button('Switch on', row('sarah.v')));
    await click(button('Tap security key'));
    expect(document.body.textContent).toContain('Moderators need a passkey and a PGP key.');
  });

  it('Cancel invite deletes it (no tap) and the list is read again', async () => {
    let list = MEMBERS();
    const api = fakeApi({
      'GET /staff/v1/me': { body: OWNER },
      'GET /staff/v1/members': () => ({ body: { members: list } }),
      'DELETE /staff/v1/invites/:id': () => {
        list = list.filter((m) => m.inviteId !== 'i-1');
        return { status: 204 };
      },
    });
    await open('/staff');
    await click(button('Cancel invite', row('Invite sent')));
    expect(api.calls.find((c) => c.method === 'DELETE')?.path).toBe('/staff/v1/invites/i-1');
    expect(tableRows('Staff').map((r) => r[0])).not.toContain('Invite sent');
  });

  it('Add staff member: the role cards, the day pills, From/to and the time zones, as the board sets them', async () => {
    fakeApi({ 'GET /staff/v1/me': { body: OWNER }, 'GET /staff/v1/members': { body: { members: MEMBERS() } } });
    await open('/staff');
    expect(document.querySelector('section[aria-label="Add staff member"]')).toBeNull();
    await click(button('Add staff member'));
    const panel = document.querySelector('section[aria-label="Add staff member"]')!;
    expect(panel.querySelector('h2')?.textContent).toBe('Add a staff member');
    const cards = [...panel.querySelectorAll('[role="radiogroup"][aria-label="Role"] [role="radio"]')];
    expect(cards.map((c) => c.textContent)).toEqual([
      'Senior moderatorHandles disputes and appeals, co-approves rulings above your size limit, and can freeze or ban accounts.',
      'ModeratorHandles disputes and rules alone below your size limit. Larger rulings wait for a senior moderator or you.',
      'HelperAnswers questions and support tickets. Cannot see dispute evidence or rule on anything.',
    ]);
    expect(cards.map((c) => c.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    const days = [...panel.querySelectorAll('[role="group"][aria-label="Days"] button')];
    expect(days.map((d) => `${d.textContent}:${d.getAttribute('aria-pressed')}`)).toEqual(['Mon:true', 'Tue:true', 'Wed:true', 'Thu:true', 'Fri:true', 'Sat:false', 'Sun:false']);
    expect((field('From', panel) as HTMLInputElement).value).toBe('09:00');
    expect((field('to', panel) as HTMLInputElement).value).toBe('17:00');
    const tz = panel.querySelector<HTMLSelectElement>('select#staff-tz')!;
    expect([...tz.options].map((o) => o.value)).toEqual(['UTC', 'America/Los_Angeles', 'America/New_York', 'Europe/Berlin', 'other']);
    expect(panel.textContent).toContain('They can only log in during these hours. When the window closes, any open session ends.');
    expect(panel.textContent).toContain('You can change these any time from their row. Your owner account has no time limit.');
  });

  it('Create invite link: a create-invite tap bound to the token\'s hash, then the link once, with Copy link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const api = fakeApi({
      'GET /staff/v1/me': { body: OWNER },
      'GET /staff/v1/members': { body: { members: MEMBERS() } },
      ...TAPS,
      'POST /staff/v1/invites': (b) => ({ status: 201, body: { inviteId: (b as { inviteId: string }).inviteId, link: `https://staff.x2f.example/invite/${(b as { token: string }).token}`, expiresAt: (b as { expiresAt: string }).expiresAt } }),
    });
    await open('/staff');
    await click(button('Add staff member'));
    const panel = () => document.querySelector('section[aria-label="Add staff member"]')!;
    await click(panel().querySelectorAll('[role="radio"]')[2]!);
    await click(button('Sat', panel()));
    const before = Date.now();
    await click(button('Create invite link'));
    expect(api.calls.some((c) => c.path === '/staff/v1/invites')).toBe(false);
    await click(button('Tap security key'));
    const post = api.calls.find((c) => c.path === '/staff/v1/invites')!;
    const b = post.body as { role: string; hours: unknown; inviteId: string; token: string; expiresAt: string; tapId: string };
    expect(b.role).toBe('helper');
    expect(b.hours).toEqual({ days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], start: '09:00', end: '17:00', tz: 'UTC' });
    expect(b.tapId).toBe('tap-1');
    expect(b.inviteId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(b.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const exp = Date.parse(b.expiresAt);
    expect(exp).toBeGreaterThanOrEqual(before + 24 * H - 60_000);
    expect(exp).toBeLessThanOrEqual(Date.now() + 24 * H);
    expect(tapIntents(api.calls)).toEqual([{ kind: 'create-invite', inviteId: b.inviteId, role: 'helper', tokenHash: inviteTokenHash(b.token), expiresAt: b.expiresAt }]);
    expect(panel().textContent).toContain('Invite link for a new helper. Send it to them privately. It works once and expires in 24 hours.');
    const link = panel().querySelector<HTMLInputElement>('input[aria-label="Invite link"]')!;
    expect(link.readOnly).toBe(true);
    expect(link.value).toBe(`https://staff.x2f.example/invite/${b.token}`);
    expect(button('Create invite link')).toBeUndefined();
    await click(button('Copy link'));
    expect(writeText).toHaveBeenCalledWith(link.value);
  });

  it('no day picked, or From equal to to: Create invite link stays disabled; "Any time" sends any', async () => {
    const api = fakeApi({ 'GET /staff/v1/me': { body: OWNER }, 'GET /staff/v1/members': { body: { members: MEMBERS() } }, ...TAPS, 'POST /staff/v1/invites': { status: 201, body: { inviteId: 'x', link: 'https://staff.x2f.example/invite/x', expiresAt: '2026-01-01T00:00:00.000Z' } } });
    await open('/staff');
    await click(button('Add staff member'));
    const panel = () => document.querySelector('section[aria-label="Add staff member"]')!;
    for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) await click(button(d, panel()));
    expect(button('Create invite link')!.disabled).toBe(true);
    await click(button('Mon', panel()));
    expect(button('Create invite link')!.disabled).toBe(false);
    typeInto(field('to', panel()), '09:00');
    await settle();
    expect(button('Create invite link')!.disabled).toBe(true);
    await tick(panel().querySelector('input[type="checkbox"][data-part="any-time"]'));
    expect(button('Create invite link')!.disabled).toBe(false);
    await click(button('Create invite link'));
    await click(button('Tap security key'));
    expect((api.calls.find((c) => c.path === '/staff/v1/invites')!.body as { hours: unknown }).hours).toBe('any');
  });

  it('Other… time zone: any Intl zone can be typed; an unknown one disables Create invite link', async () => {
    const api = fakeApi({ 'GET /staff/v1/me': { body: OWNER }, 'GET /staff/v1/members': { body: { members: MEMBERS() } }, ...TAPS, 'POST /staff/v1/invites': { status: 201, body: { inviteId: 'x', link: 'https://staff.x2f.example/invite/x', expiresAt: '2026-01-01T00:00:00.000Z' } } });
    await open('/staff');
    await click(button('Add staff member'));
    const panel = () => document.querySelector('section[aria-label="Add staff member"]')!;
    const tz = panel().querySelector<HTMLSelectElement>('select#staff-tz')!;
    tz.value = 'other';
    tz.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    const other = field('Other time zone', panel());
    typeInto(other, 'Mars/Olympus');
    await settle();
    expect(button('Create invite link')!.disabled).toBe(true);
    typeInto(other, 'Asia/Tokyo');
    await settle();
    expect(button('Create invite link')!.disabled).toBe(false);
    await click(button('Create invite link'));
    await click(button('Tap security key'));
    expect((api.calls.find((c) => c.path === '/staff/v1/invites')!.body as { hours: { tz: string } }).hours.tz).toBe('Asia/Tokyo');
  });

  it('a member\'s row: Change opens their role and hours; a new role is tapped (set-role), hours are not', async () => {
    const api = fakeApi({
      'GET /staff/v1/me': { body: OWNER },
      'GET /staff/v1/members': { body: { members: MEMBERS() } },
      ...TAPS,
      'PUT /staff/v1/members/:id/role': (b) => ({ body: { role: (b as { role: string }).role } }),
      'PUT /staff/v1/members/:id/hours': (b) => ({ body: { hours: (b as { hours: unknown }).hours } }),
    });
    await open('/staff');
    expect(button('Change', row('lumen.k'))).toBeUndefined();
    await click(button('Change', row('dmitri_k')));
    const sheet = () => document.querySelector('[data-part="member-edit"]')!;
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('dmitri_k');
    // Hours first: saved without a tap.
    await click(button('Sat', sheet()));
    await click(button('Save login hours', sheet()));
    expect(api.calls.find((c) => c.method === 'PUT' && c.path.endsWith('/hours'))).toMatchObject({
      path: '/staff/v1/members/m-1/hours',
      body: { hours: { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], start: '09:00', end: '17:00', tz: 'UTC' } },
    });
    expect(tapIntents(api.calls)).toEqual([]);
    // The role: tapped, bound to the person and the new role.
    await click(sheet().querySelectorAll('[role="radio"]')[0]!);
    await click(button('Save role', sheet()));
    expect(api.calls.some((c) => c.path.endsWith('/role'))).toBe(false);
    await click(button('Tap security key'));
    expect(tapIntents(api.calls)).toEqual([{ kind: 'set-role', accountId: 'm-1', role: 'senior' }]);
    expect(api.calls.find((c) => c.path.endsWith('/role'))).toMatchObject({ path: '/staff/v1/members/m-1/role', body: { role: 'senior', tapId: 'tap-1' } });
  });

  it('Remove from staff is tapped (remove-staff) and the person leaves the list', async () => {
    let list = MEMBERS();
    const api = fakeApi({
      'GET /staff/v1/me': { body: OWNER },
      'GET /staff/v1/members': () => ({ body: { members: list } }),
      ...TAPS,
      'DELETE /staff/v1/members/:id': () => {
        list = list.filter((m) => m.accountId !== 'h-1');
        return { status: 204 };
      },
    });
    await open('/staff');
    await click(button('Change', row('tobi.w')));
    await click(button('Remove from staff', document.querySelector('[data-part="member-edit"]')!));
    await click(button('Tap security key'));
    expect(tapIntents(api.calls)).toEqual([{ kind: 'remove-staff', accountId: 'h-1' }]);
    expect(api.calls.find((c) => c.method === 'DELETE')).toMatchObject({ path: '/staff/v1/members/h-1', body: { tapId: 'tap-1' } });
    expect(tableRows('Staff').map((r) => r[0])).not.toContain('tobi.w');
  });
});

// ---------------------------------------------------------------------------------------------
// StaffSettings

const SETTINGS = { largeTradeLimitUsd: 1000, firstResponseH: 4, appealWindowH: 48, moderatorContactUrl: null, communityMatrixUrl: null, communityTelegramUrl: null };
const PAY = { modDisputeUsdCents: null, seniorDisputeUsdCents: 2500, seniorLargeTradeBp: null, largeTradeThresholdUsd: null };

function settingsApi(extra: Record<string, Parameters<typeof fakeApi>[0][string]> = {}) {
  return fakeApi({
    'GET /staff/v1/me': { body: OWNER },
    'GET /staff/v1/settings': { body: SETTINGS },
    'GET /staff/v1/pay/settings': { body: PAY },
    ...TAPS,
    'PUT /staff/v1/settings': (b) => ({ body: { ...SETTINGS, ...(b as object) } }),
    'PUT /staff/v1/pay/settings': (b) => ({ body: b }),
    ...extra,
  });
}

describe('StaffSettings (board StaffSettings)', () => {
  it('shows the three Rulings fields with the board\'s help text, and pay amounts not set as "Not set"', async () => {
    settingsApi();
    await open('/settings');
    const page = document.querySelector('[data-screen="staff-settings"]')!;
    expect(page.querySelector('h1')?.textContent).toBe('Settings');
    expect(page.textContent).toContain('Only the owner can change these. Every change is recorded in the activity log.');
    expect((field('Large-trade limit', page) as HTMLInputElement).value).toBe('1000');
    expect((field('First response deadline', page) as HTMLInputElement).value).toBe('4');
    expect((field('Appeal window', page) as HTMLInputElement).value).toBe('48');
    expect(page.textContent).toContain('A moderator can rule alone on trades below this. At or above it, a senior moderator or you must approve too.');
    expect(page.textContent).toContain('How soon a moderator must reply after a dispute opens. Traders see this deadline and their place in the queue.');
    expect(page.textContent).toContain('How long either trader has to appeal a ruling. Appeals go to a senior moderator or you, never the moderator who ruled.');
    const mod = field('Moderator, per dispute', page) as HTMLInputElement;
    expect(mod.value).toBe('');
    expect(mod.placeholder).toBe('Not set');
    expect((field('Senior moderator, per dispute', page) as HTMLInputElement).value).toBe('25.00');
    expect(page.querySelectorAll('[data-primary]')).toHaveLength(1);
    expect(button('Save settings')!.disabled).toBe(true);
  });

  it('only the first response deadline changed: saved with no tap', async () => {
    const api = settingsApi();
    await open('/settings');
    typeInto(field('First response deadline'), '6');
    await settle();
    await click(button('Save settings'));
    expect(tapIntents(api.calls)).toEqual([]);
    expect(api.calls.find((c) => c.method === 'PUT')).toMatchObject({ path: '/staff/v1/settings', body: { firstResponseH: 6 } });
    expect(document.querySelector('[data-part="settings-saved"]')).not.toBeNull();
  });

  it('the limit or the appeal window changed: a settings tap of the values after the change, then the PUT with it', async () => {
    const api = settingsApi();
    await open('/settings');
    typeInto(field('Large-trade limit'), '2,500');
    typeInto(field('Appeal window'), '72');
    await settle();
    await click(button('Save settings'));
    expect(api.calls.some((c) => c.method === 'PUT')).toBe(false);
    await click(button('Tap security key'));
    expect(tapIntents(api.calls)).toEqual([{ kind: 'settings', largeTradeLimitUsd: 2500, firstResponseH: 4, appealWindowH: 72 }]);
    expect(api.calls.find((c) => c.method === 'PUT')).toMatchObject({ path: '/staff/v1/settings', body: { largeTradeLimitUsd: 2500, appealWindowH: 72, tapId: 'tap-1' } });
  });

  it('a pay amount changed: a pay-settings tap of all four, then the PUT', async () => {
    const api = settingsApi();
    await open('/settings');
    typeInto(field('Moderator, per dispute'), '12.50');
    typeInto(field('Senior moderator, per dispute'), '');
    typeInto(field('Senior moderator, share of large-trade fees'), '2.5');
    typeInto(field('Large trade from'), '5000');
    await settle();
    await click(button('Save settings'));
    await click(button('Tap security key'));
    const next = { modDisputeUsdCents: 1250, seniorDisputeUsdCents: null, seniorLargeTradeBp: 250, largeTradeThresholdUsd: 5000 };
    expect(tapIntents(api.calls)).toEqual([{ kind: 'pay-settings', ...next }]);
    expect(api.calls.find((c) => c.method === 'PUT')).toMatchObject({ path: '/staff/v1/pay/settings', body: { ...next, tapId: 'tap-1' } });
    expect(api.calls.some((c) => c.path === '/staff/v1/settings' && c.method === 'PUT')).toBe(false);
  });

  it('both changed: the rulings tap and save first, then the pay tap and save', async () => {
    const api = settingsApi();
    await open('/settings');
    typeInto(field('Large-trade limit'), '900');
    typeInto(field('Moderator, per dispute'), '10');
    await settle();
    await click(button('Save settings'));
    await click(button('Tap security key'));
    await click(button('Tap security key'));
    expect(tapIntents(api.calls).map((i) => (i as { kind: string }).kind)).toEqual(['settings', 'pay-settings']);
    expect(api.calls.filter((c) => c.method === 'PUT').map((c) => c.path)).toEqual(['/staff/v1/settings', '/staff/v1/pay/settings']);
  });

  it('a value out of bounds is not sent: the field says what it takes', async () => {
    const api = settingsApi();
    await open('/settings');
    typeInto(field('Appeal window'), '6');
    await settle();
    expect(document.querySelector('[data-part="settings-invalid"]')?.textContent).toContain('Appeal window');
    expect(button('Save settings')!.disabled).toBe(true);
    expect(api.calls.some((c) => c.method === 'PUT')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// StaffOverview

const SITE = { tradingPaused: false, stoppedAt: null, banner: null, maintenance: null, planned: null, logAlarm: null };
const thisMonth = new Date().toISOString().slice(0, 7);
const lastMonth = (() => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
})();
const bucket = (period: string, xmr: string, cents: string, trades: number) => ({ period, trades, feeAtomic: xmr, owedCollectedAtomic: '0', owedCollections: 0, totalAtomic: xmr, usdEstimateCents: cents });
const REVENUE = {
  by: 'month', from: '2017-01-01', to: '2026-11-18',
  buckets: [bucket(lastMonth, '3070000000000', '101300', 140), bucket(thisMonth, '4820000000000', '159000', 211)],
  total: bucket('all', '7890000000000', '260300', 351),
  byCurrency: [], owedOutstandingAtomic: '0',
};

function overviewApi(site: Record<string, unknown> = {}, extra: Record<string, Parameters<typeof fakeApi>[0][string]> = {}) {
  let state: Record<string, unknown> = { ...SITE, ...site };
  return fakeApi({
    'GET /staff/v1/me': { body: OWNER },
    'GET /staff/v1/site': () => ({ body: state }),
    'GET /staff/v1/revenue': { body: REVENUE },
    ...TAPS,
    'POST /staff/v1/site/stop': () => {
      state = { ...state, tradingPaused: true, stoppedAt: '2026-11-18T01:20:00.000Z' };
      return { body: state };
    },
    'POST /staff/v1/site/resume': () => {
      state = { ...state, tradingPaused: false, stoppedAt: null };
      return { body: state };
    },
    'PUT /staff/v1/site/banner': (b) => {
      const { tapId: _tap, ...banner } = b as { text: string; kind: 'info'; tapId?: string };
      state = { ...state, banner };
      return { body: state };
    },
    'DELETE /staff/v1/site/banner': () => {
      state = { ...state, banner: null };
      return { status: 204 };
    },
    'PUT /staff/v1/site/maintenance': (b) => {
      const m = b as { on: boolean; kind?: string; message?: string | null };
      const plan = state.planned as { message: string | null } | null;
      const inherit = m.on && m.kind === 'planned' && (m.message ?? null) === null && plan !== null;
      state = { ...state, maintenance: m.on ? { since: '2026-11-18T02:00:00.000Z', kind: m.kind!, message: inherit ? plan.message : (m.message ?? null), backBy: null } : null, ...(inherit ? { planned: null } : {}) };
      return { body: state };
    },
    'PUT /staff/v1/site/maintenance/planned': (b) => {
      const { tapId: _tap, ...p } = b as { startsAt: string; endsAt: string; message: string | null; tapId: string };
      state = { ...state, planned: { startsAt: p.startsAt, endsAt: p.endsAt, message: p.message } };
      return { body: state };
    },
    'DELETE /staff/v1/site/maintenance/planned': () => {
      state = { ...state, planned: null };
      return { status: 204 };
    },
    ...extra,
  });
}

describe('StaffOverview (board StaffOverview)', () => {
  it('mod polish: the Today card counts open disputes, appeals waiting and new alerts from the existing reads; a dash when one fails', async () => {
    const q = (status: string) => ({ code: 'X', status });
    const api = overviewApi({}, {
      'GET /staff/v1/disputes': { body: { rows: [q('open'), q('appealed'), q('appealed'), q('awaiting-approval')], counts: { open: 9, overdue: 0, unassigned: 0, needApproval: 1 }, settings: { firstResponseH: 4, largeTradeLimitUsd: 1000 } } },
      'GET /staff/v1/owner/alerts': { body: { items: [], unread: 3, next: null } },
    });
    await open('/overview');
    const tile = (p: string) => document.querySelector(`[data-part="${p}"]`)?.textContent;
    expect(document.querySelector('section[aria-label="Today"] h2')?.textContent).toBe('Today');
    expect(tile('today-open')).toBe('9Open disputes');
    expect(tile('today-appeals')).toBe('2Appeals waiting');
    expect(tile('today-alerts')).toBe('3New alerts');
    expect(document.querySelector('[data-part="today-alerts"] a')?.getAttribute('href')).toBe('/notifications');
    // Reads only: no write was made for the card.
    expect(api.calls.filter((c) => c.method !== 'GET')).toEqual([]);
    expect(document.querySelector('[data-part="today"]')?.textContent).not.toMatch(/ticket/i);
    document.body.innerHTML = '';
    overviewApi({}, { 'GET /staff/v1/disputes': { status: 500, body: { error: 'internal' } } });
    await open('/overview');
    expect(tile('today-open')).toBe('–Open disputes');
    expect(tile('today-appeals')).toBe('–Appeals waiting');
  });

  it('live, then paused with a tap ("Tap key and pause"), then live again with a tap', async () => {
    const api = overviewApi();
    await open('/overview');
    const stop = () => document.querySelector('section[aria-label="Emergency stop"]')!;
    expect(stop().textContent).toContain('X2F is live. New trades are open.');
    expect(stop().textContent).toContain("If something goes wrong, such as an attack or a serious bug, pause every new trade and offer at once. Trades already in escrow can still be released, refunded or disputed, so nobody's coins get stuck.");
    await click(button('Pause all new trades'));
    expect(document.body.textContent).toContain('Tap your security key to pause all new trades. Everyone will see a notice until you resume.');
    expect(api.calls.some((c) => c.path === '/staff/v1/site/stop')).toBe(false);
    await click(button('Tap key and pause'));
    expect(tapIntents(api.calls)).toEqual([{ kind: 'emergency-stop' }]);
    expect(api.calls.find((c) => c.path === '/staff/v1/site/stop')?.body).toEqual({ tapId: 'tap-1' });
    expect(stop().textContent).toContain('New trades are paused since 01:20 UTC. Trades in escrow are carrying on.');
    await click(button('Tap key and resume trading'));
    await click(button('Tap key and resume trading', document.querySelector('[role="dialog"]')!));
    expect(tapIntents(api.calls)).toEqual([{ kind: 'emergency-stop' }, { kind: 'resume-trading' }]);
    expect(stop().textContent).toContain('X2F is live. New trades are open.');
  });

  it('Cancel on the pause dialog pauses nothing', async () => {
    const api = overviewApi();
    await open('/overview');
    await click(button('Pause all new trades'));
    await click(button('Cancel', document.querySelector('[role="dialog"]')!));
    expect(tapIntents(api.calls)).toEqual([]);
    expect(document.body.textContent).toContain('X2F is live. New trades are open.');
  });

  it('Earnings: this month, last month and all time from the revenue ledger', async () => {
    const api = overviewApi();
    await open('/overview');
    const cards = [...document.querySelectorAll('section[aria-label="Earnings"] [data-part="earnings-card"]')].map((c) => c.textContent);
    expect(cards).toEqual(['This month4.82 XMRabout $1,590 · 211 trades', 'Last month3.07 XMRabout $1,013 · 140 trades', 'All time7.89 XMRabout $2,603']);
    const q = api.calls.find((c) => c.path.startsWith('/staff/v1/revenue'))!.path;
    expect(q).toMatch(/^\/staff\/v1\/revenue\?by=month&from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-\d{2}$/);
  });

  it('the banner: a live preview, a 140-character counter (141 in danger disables Show to everyone), Information/Warning, show and remove', async () => {
    const api = overviewApi();
    await open('/overview');
    const sec = () => document.querySelector('section[aria-label="Announcement banner"]')!;
    expect(sec().textContent).toContain('Not showing.');
    typeInto(field('Message', sec()), 'x'.repeat(141));
    await settle();
    const count = sec().querySelector('[data-part="banner-count"]')!;
    expect(count.textContent).toBe('141 / 140');
    expect(count.getAttribute('data-tone')).toBe('danger');
    expect(button('Show to everyone', sec())!.disabled).toBe(true);
    typeInto(field('Message', sec()), 'Zelle payments may take longer this weekend because of a bank holiday.');
    await settle();
    expect(sec().querySelector('[data-part="banner-count"]')!.getAttribute('data-tone')).toBe('plain');
    expect(sec().querySelector('[aria-label="Banner preview"]')?.textContent).toBe('Zelle payments may take longer this weekend because of a bank holiday.');
    const kinds = [...sec().querySelectorAll('[role="radiogroup"][aria-label="Banner type"] [role="radio"]')];
    expect(kinds.map((k) => `${k.textContent}:${k.getAttribute('aria-checked')}`)).toEqual(['Information:true', 'Warning:false']);
    await click(kinds[1]!);
    expect(sec().querySelector('[aria-label="Banner preview"]')?.getAttribute('data-kind')).toBe('warning');
    await click(button('Show to everyone', sec()));
    // Review p4t22 m2 (lead default): nothing is shown before the owner's key tap, bound to this text and kind.
    expect(api.calls.some((c) => c.method === 'PUT' && c.path === '/staff/v1/site/banner')).toBe(false);
    await click(button('Tap key and show'));
    const text = 'Zelle payments may take longer this weekend because of a bank holiday.';
    expect(tapIntents(api.calls)).toEqual([bannerPublishIntent({ bannerKind: 'warning', text })]);
    expect(api.calls.find((c) => c.method === 'PUT' && c.path === '/staff/v1/site/banner')?.body).toEqual({ text, kind: 'warning', tapId: 'tap-1' });
    expect(sec().textContent).toContain('Showing to everyone now.');
    await click(button('Remove banner', sec()));
    expect(api.calls.some((c) => c.method === 'DELETE' && c.path === '/staff/v1/site/banner')).toBe(true);
    expect(sec().textContent).toContain('Not showing.');
  });

  it('maintenance: on with its kind and message (tapped, review p4t22 m2), off again (no tap)', async () => {
    const api = overviewApi();
    await open('/overview');
    const sec = () => document.querySelector('section[aria-label="Maintenance mode"]')!;
    expect(sec().textContent).toContain('For planned upgrades. Users see the message below instead of the app; trades in escrow keep their timers paused until you switch it off.');
    typeInto(field('Message to users', sec()), 'X2F is being upgraded. Back by 03:00 UTC.');
    const on = sec().querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    // No kind picked yet: the box cannot be ticked (owner G19: no default kind).
    expect(on.disabled).toBe(true);
    await click(sec().querySelectorAll('[role="radiogroup"][aria-label="Maintenance kind"] [role="radio"]')[0]!);
    expect(on.disabled).toBe(false);
    await tick(on);
    // Review p4t22 m2 (lead default): on takes the owner's key tap, bound to the kind and the message.
    expect(api.calls.some((c) => c.path === '/staff/v1/site/maintenance')).toBe(false);
    await click(button('Tap key and turn on'));
    const message = 'X2F is being upgraded. Back by 03:00 UTC.';
    expect(api.calls.find((c) => c.path === '/staff/v1/site/maintenance')?.body).toEqual({ on: true, kind: 'planned', message, tapId: 'tap-1' });
    expect(sec().querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
    await tick(sec().querySelector('input[type="checkbox"]'));
    expect(api.calls.filter((c) => c.path === '/staff/v1/site/maintenance').map((c) => c.body)).toEqual([
      { on: true, kind: 'planned', message, tapId: 'tap-1' },
      { on: false },
    ]);
    // Off takes none.
    expect(tapIntents(api.calls)).toEqual([maintenanceOnIntent({ maintenanceKind: 'planned', message, backBy: null })]);
  });

  it('review p4t22 N2: announcing a planned maintenance is tapped, bound to its start, end and message; removing it is not', async () => {
    const api = overviewApi();
    await open('/overview');
    const sec = () => document.querySelector('section[aria-label="Planned maintenance"]')!;
    expect(sec().textContent).toContain('No planned maintenance announced.');
    typeInto(field('Starts (UTC)', sec()), '2099-01-02T10:00');
    typeInto(field('Ends (UTC)', sec()), '2099-01-02T12:30');
    typeInto(field('Message to users', sec()), '  Database upgrade.  ');
    await settle();
    await click(button('Announce', sec()));
    expect(api.calls.some((c) => c.path === '/staff/v1/site/maintenance/planned')).toBe(false);
    await click(button('Tap key and announce'));
    const startsAt = '2099-01-02T10:00:00.000Z';
    const endsAt = '2099-01-02T12:30:00.000Z';
    expect(tapIntents(api.calls)).toEqual([maintenancePlannedIntent({ startsAt, endsAt, message: 'Database upgrade.' })]);
    expect(api.calls.find((c) => c.path === '/staff/v1/site/maintenance/planned')?.body).toEqual({ startsAt, endsAt, message: 'Database upgrade.', tapId: 'tap-1' });
    expect(sec().textContent).toContain('Announced: 2099-01-02 10:00 UTC to 2099-01-02 12:30 UTC.');
    expect(sec().textContent).toContain('Database upgrade.');
    await click(button('Remove the announcement', sec()));
    expect(api.calls.filter((c) => c.path === '/staff/v1/site/maintenance/planned').map((c) => c.method)).toEqual(['PUT', 'DELETE']);
    expect(tapIntents(api.calls)).toHaveLength(1);
    expect(sec().textContent).toContain('No planned maintenance announced.');
  });

  it("review p4t22 N2: a planned switch-on with no message of its own binds the announced plan's message, which it shows", async () => {
    const api = overviewApi({ planned: { startsAt: '2099-01-02T10:00:00.000Z', endsAt: '2099-01-02T12:30:00.000Z', message: 'Database upgrade.' } });
    await open('/overview');
    const sec = () => document.querySelector('section[aria-label="Maintenance mode"]')!;
    await click(sec().querySelectorAll('[role="radiogroup"][aria-label="Maintenance kind"] [role="radio"]')[0]!);
    await tick(sec().querySelector('input[type="checkbox"]'));
    await click(button('Tap key and turn on'));
    expect(tapIntents(api.calls)).toEqual([maintenanceOnIntent({ maintenanceKind: 'planned', message: 'Database upgrade.', backBy: null })]);
    expect(api.calls.find((c) => c.path === '/staff/v1/site/maintenance')?.body).toEqual({ on: true, kind: 'planned', message: null, tapId: 'tap-1' });
  });

  it('the log-alarm card shows only when log_alarm is set', async () => {
    overviewApi();
    await open('/overview');
    expect(document.querySelector('[data-part="log-alarm"]')).toBeNull();
    document.body.innerHTML = '';
    overviewApi({ logAlarm: '2026-11-01T03:04:05.000Z' });
    await open('/overview');
    expect(document.querySelector('[data-part="log-alarm"]')?.textContent).toContain(
      'The activity log failed its integrity check at 2026-11-01 03:04 UTC. Contact your security reviewer.',
    );
  });

  it('keeps the way to News for traders, and exactly one primary action', async () => {
    overviewApi();
    await open('/overview');
    expect(document.querySelector('a[href="/overview/news"]')?.textContent).toBe('News for traders');
    expect(document.querySelectorAll('[data-screen="staff-overview"] [data-primary]')).toHaveLength(1);
    document.body.innerHTML = '';
    overviewApi({ tradingPaused: true, stoppedAt: '2026-11-18T01:20:00.000Z' });
    await open('/overview');
    expect(document.querySelectorAll('[data-screen="staff-overview"] [data-primary]')).toHaveLength(1);
  });
});
