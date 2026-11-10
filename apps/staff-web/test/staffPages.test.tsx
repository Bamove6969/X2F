// @vitest-environment happy-dom
// J-21: the owner's Prices page (owner Q13: the price-health page moves to the staff site) and the
// per-person checkboxes on the Staff page (owner Q60: moderators' and helpers' permissions are
// granular; a senior moderator always has Feedback). Neither is drawn yet (DESIGN: not drawn).
import { NAV, navFor } from '@x2f/staff';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { NAV_LABELS } from '../src/ui/StaffShell.js';
import { button, click, fakeApi, refused, render, settle, tick } from './helpers.js';

const webauthn = vi.hoisted(() => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => webauthn);

const OWNER = { displayName: 'lumen.k', role: 'owner', nav: NAV.owner, sessionEndsAt: new Date(Date.now() + 3600_000).toISOString() };

async function open(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  await settle();
}

const navLabels = () => [...document.querySelectorAll('nav[aria-label="Staff"] a')].map((a) => a.textContent);
const tableRows = (label: string) =>
  [...document.querySelectorAll(`table[aria-label="${label}"] tbody tr`)].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));

beforeEach(() => {
  webauthn.startAuthentication.mockReset().mockResolvedValue({ id: 'cred', response: {} });
});

const HEALTH = {
  xmr: [
    { name: 'Kraken', lastGoodAt: '2026-11-10T09:58:00.000Z', consecutiveFailures: 0, inUse: true },
    { name: 'Bitfinex', lastGoodAt: null, consecutiveFailures: 4, inUse: false },
  ],
  fx: [{ name: 'ECB', rank: 1, lastGoodAt: '2026-11-10T06:00:00.000Z', consecutiveFailures: 0, stale: false, inUse: true, usedFor: ['EUR', 'GBP'] }],
  rejected: [{ source: 'Coinbase', currency: 'JPY', at: '2026-11-10T09:30:00.000Z' }],
  paused: ['ARS', 'NGN'],
  settings: { staleAfterMinutes: 1440, sanityPercent: 5 },
};

describe('Prices (owner Q13, J-21)', () => {
  it('is in the owner\'s menu, after Performance, and nobody else\'s', () => {
    expect(NAV_LABELS.prices).toBe('Prices');
    expect(NAV.owner.indexOf('prices')).toBe(NAV.owner.indexOf('performance') + 1);
    for (const role of ['senior', 'mod', 'helper'] as const) expect(navFor(role, ['feedback.read', 'tickets.handle'])).not.toContain('prices');
  });

  it('shows each price source, each exchange-rate source, the refused rates, the paused currencies and the settings', async () => {
    const api = fakeApi({ 'GET /staff/v1/me': { body: OWNER }, 'GET /staff/v1/price-health': { body: HEALTH } });
    await open('/prices');
    expect(navLabels()).toContain('Prices');
    expect(document.querySelector('[data-screen="prices"]')).not.toBeNull();
    expect(api.calls.filter((c) => c.path === '/staff/v1/price-health')).toHaveLength(1);
    expect(tableRows('XMR price sources')).toEqual([
      ['Kraken', '2026-11-10 09:58 UTC', '0', 'Yes'],
      ['Bitfinex', 'Never', '4', 'No'],
    ]);
    expect(tableRows('Exchange-rate sources')).toEqual([['ECB', '1', '2026-11-10 06:00 UTC', '0', 'No', 'EUR, GBP']]);
    expect(tableRows('Refused rates')).toEqual([['Coinbase', 'JPY', '2026-11-10 09:30 UTC']]);
    expect(document.querySelector('[data-part="paused"]')?.textContent).toContain('ARS, NGN');
    expect(document.querySelector('[data-part="price-settings"]')?.textContent).toContain('1440 minutes');
    expect(document.querySelector('[data-part="price-settings"]')?.textContent).toContain('5%');
    await click(button('Reload'));
    expect(api.calls.filter((c) => c.path === '/staff/v1/price-health')).toHaveLength(2);
  });

  it('no paused currency reads as such; a refusal of the data shows the fault, not an empty page', async () => {
    fakeApi({ 'GET /staff/v1/me': { body: OWNER }, 'GET /staff/v1/price-health': { body: { ...HEALTH, paused: [], rejected: [] } } });
    await open('/prices');
    expect(document.querySelector('[data-part="paused"]')?.textContent).toContain('No currency is paused.');
    expect(tableRows('Refused rates')).toEqual([['No rate was refused.']]);
    document.body.innerHTML = '';
    fakeApi({ 'GET /staff/v1/me': { body: OWNER }, 'GET /staff/v1/price-health': refused(503, 'internal') });
    await open('/prices');
    expect(document.querySelector('[data-part="prices-fault"]')).not.toBeNull();
  });
});

const MEMBERS = [
  { accountId: 'o-1', inviteId: null, displayName: 'lumen.k', role: 'owner', status: 'active', grants: [], hours: 'any', joinedAt: '2026-10-01T00:00:00Z', lastActiveAt: null, openCases: 0, expiresAt: null, missingMethods: [] },
  { accountId: 's-1', inviteId: null, displayName: 'iris.m', role: 'senior', status: 'active', grants: [], hours: 'any', joinedAt: '2026-10-02T00:00:00Z', lastActiveAt: null, openCases: 1, expiresAt: null, missingMethods: [] },
  { accountId: 'm-1', inviteId: null, displayName: 'nightowl_44', role: 'mod', status: 'active', grants: ['tickets.handle'], hours: 'any', joinedAt: '2026-10-03T00:00:00Z', lastActiveAt: null, openCases: 2, expiresAt: null, missingMethods: [] },
  { accountId: 'h-1', inviteId: null, displayName: 'kit.b', role: 'helper', status: 'active', grants: [], hours: 'any', joinedAt: '2026-10-04T00:00:00Z', lastActiveAt: null, openCases: 0, expiresAt: null, missingMethods: [] },
  { accountId: null, inviteId: 'i-1', displayName: null, role: 'mod', status: 'waiting', grants: [], hours: 'any', joinedAt: null, lastActiveAt: null, openCases: 0, expiresAt: '2026-11-11T00:00:00Z', missingMethods: [] },
];

const box = (member: string, perm: string) =>
  document.querySelector<HTMLInputElement>(`[data-member="${member}"] input[type="checkbox"][data-perm="${perm}"]`);

describe('Staff: per-person checkboxes (owner Q60, J-21)', () => {
  it('a senior always has Feedback (ticked, fixed); the owner and invites have no boxes; a moderator\'s and a helper\'s boxes show their grants', async () => {
    fakeApi({ 'GET /staff/v1/me': { body: OWNER }, 'GET /staff/v1/members': { body: { members: MEMBERS } } });
    await open('/staff');
    expect(document.querySelector('[data-screen="staff"]')).not.toBeNull();
    expect(box('s-1', 'feedback.read')).toMatchObject({ checked: true, disabled: true });
    expect(document.querySelector('[data-member="s-1"]')?.textContent).toContain('Senior moderators always have Feedback.');
    expect(box('m-1', 'tickets.handle')).toMatchObject({ checked: true, disabled: false });
    expect(box('m-1', 'feedback.read')).toMatchObject({ checked: false, disabled: false });
    expect(box('h-1', 'feedback.read')).toMatchObject({ checked: false, disabled: false });
    expect(document.querySelector('[data-member="o-1"] input[type="checkbox"]')).toBeNull();
    expect(document.querySelector('[data-member="i-1"]')).toBeNull();
  });

  it('a change is saved only after a key tap bound to the person and the exact sorted list', async () => {
    const api = fakeApi({
      'GET /staff/v1/me': { body: OWNER },
      'GET /staff/v1/members': { body: { members: MEMBERS } },
      'POST /staff/v1/taps/start': { body: { tapId: 'tap-1', options: { challenge: 'x' } } },
      'POST /staff/v1/taps/:id/finish': { body: { tapId: 'tap-1' } },
      'PUT /staff/v1/members/:id/grants': (b) => ({ body: { grants: (b as { grants: string[] }).grants } }),
    });
    await open('/staff');
    await tick(box('m-1', 'feedback.read'));
    expect(api.calls.some((c) => c.method === 'PUT')).toBe(false);
    await click(button('Save', document.querySelector('[data-member="m-1"]')!));
    expect(api.calls.some((c) => c.method === 'PUT')).toBe(false);
    await click(button('Tap security key'));
    expect(api.calls.find((c) => c.path === '/staff/v1/taps/start')?.body).toEqual({ kind: 'set-grants', accountId: 'm-1', grants: ['feedback.read', 'tickets.handle'] });
    expect(api.calls.find((c) => c.method === 'PUT')).toMatchObject({ path: '/staff/v1/members/m-1/grants', body: { grants: ['feedback.read', 'tickets.handle'], tapId: 'tap-1' } });
    expect(document.querySelector('[data-member="m-1"] [data-part="grants-saved"]')).not.toBeNull();
  });

  it('a refused save shows the refusal and leaves the boxes as stored', async () => {
    fakeApi({
      'GET /staff/v1/me': { body: OWNER },
      'GET /staff/v1/members': { body: { members: MEMBERS } },
      'POST /staff/v1/taps/start': { body: { tapId: 'tap-1', options: { challenge: 'x' } } },
      'POST /staff/v1/taps/:id/finish': { body: { tapId: 'tap-1' } },
      'PUT /staff/v1/members/:id/grants': refused(403, 'tap-invalid'),
    });
    await open('/staff');
    await tick(box('h-1', 'feedback.read'));
    await click(button('Save', document.querySelector('[data-member="h-1"]')!));
    await click(button('Tap security key'));
    expect(document.querySelector('[data-member="h-1"] [data-part="grants-fault"]')).not.toBeNull();
    expect(box('h-1', 'feedback.read')).toMatchObject({ checked: false });
  });
});
