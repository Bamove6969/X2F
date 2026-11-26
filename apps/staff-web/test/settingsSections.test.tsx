// @vitest-environment happy-dom
// Spec 6.6 "Settings": the owner Settings sections beyond Rulings and Staff pay, against a fake staff
// API in the shapes of apps/api/src/staff/{settings,starterLimits,feeSweep,pay}.ts. Each section
// checks its fields the way the API does, keeps its Save disabled until there is a valid change, and
// taps where the API needs a tap (starter-limits, fee-sweep), with the intent the API re-derives.
import { NAV, STARTER_DEFAULTS } from '@x2f/staff';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { atomicOf } from '../src/screens/settings/FeeSweepSection.js';
import { centsText } from '../src/screens/settings/StaffPaySection.js';
import { button, click, fakeApi, field, honestTapStart, refused, render, settle, typeInto } from './helpers.js';

const webauthn = vi.hoisted(() => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => webauthn);

const H = 3_600_000;
const OWNER = { tradeTag: 'lumen.k', role: 'owner', nav: NAV.owner, sessionEndsAt: new Date(Date.now() + H).toISOString() };
const SETTINGS = { largeTradeLimitUsd: 1000, firstResponseH: 4, appealWindowH: 48, moderatorContactUrl: null, communityMatrixUrl: 'https://matrix.to/#/#x2f:matrix.org', communityTelegramUrl: null };
const PAY = { modDisputeUsdCents: null, seniorDisputeUsdCents: null, seniorLargeTradeBp: null, largeTradeThresholdUsd: null };
const STARTER = { ...STARTER_DEFAULTS, updatedAt: null as string | null };
const COLD = `4${'A'.repeat(94)}`;
const SWEEP = { thresholdAtomic: null, floatAtomic: null, coldAddress: null, on: false, walletWired: false, lastSweep: null };
const TAPS = {
  'POST /staff/v1/taps/start': honestTapStart('tap-1'),
  'POST /staff/v1/taps/:id/finish': { body: { tapId: 'tap-1' } },
};

function api(extra: Record<string, Parameters<typeof fakeApi>[0][string]> = {}) {
  return fakeApi({
    'GET /staff/v1/me': { body: OWNER },
    'GET /staff/v1/settings': { body: SETTINGS },
    'GET /staff/v1/pay/settings': { body: PAY },
    'GET /staff/v1/starter-limits': { body: STARTER },
    'GET /staff/v1/fee-sweep': { body: SWEEP },
    'GET /staff/v1/pay/staff': { body: { members: [] } },
    ...TAPS,
    ...extra,
  });
}

async function open() {
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <App />
    </MemoryRouter>,
  );
  await settle();
}

const region = (name: string) => document.querySelector(`section[aria-label="${name}"]`)!;
const taps = (calls: { path: string; body: unknown }[]) => calls.filter((c) => c.path === '/staff/v1/taps/start').map((c) => c.body);
const puts = (calls: { method: string; path: string; body: unknown }[], path: string) => calls.filter((c) => c.method === 'PUT' && c.path === path);

beforeEach(() => {
  webauthn.startAuthentication.mockReset().mockResolvedValue({ id: 'cred', response: {} });
});

describe('Settings sections', () => {
  it('every section is on the page, the page keeps its one primary action, and each Save starts disabled', async () => {
    api();
    await open();
    for (const name of ['Rulings', 'Staff pay', 'Starter limits', 'Contact and community links', 'Fee wallet', 'Staff pay owed']) expect(region(name), name).not.toBeNull();
    expect(document.querySelectorAll('[data-screen="staff-settings"] [data-primary]')).toHaveLength(1);
    for (const label of ['Save starter limits', 'Save links', 'Save fee wallet']) expect(button(label)!.disabled, label).toBe(true);
  });
});

describe('Starter limits', () => {
  it('shows the saved numbers; a change taps all seven, then saves them', async () => {
    const c = api({ 'PUT /staff/v1/starter-limits': (b) => ({ body: { ...(b as object), updatedAt: '2026-11-26T10:00:00.000Z' } }) });
    await open();
    const s = region('Starter limits');
    expect((field('Starter: largest trade', s) as HTMLInputElement).value).toBe('200');
    expect((field('Graduated: account age', s) as HTMLInputElement).value).toBe('30');
    typeInto(field('Starter: largest trade', s), '150');
    typeInto(field('Building from', s), '6');
    await settle();
    expect(button('Save starter limits')!.disabled).toBe(false);
    await click(button('Save starter limits'));
    expect(puts(c.calls, '/staff/v1/starter-limits')).toEqual([]);
    await click(button('Tap security key'));
    const next = { ...STARTER_DEFAULTS, starterCapUsd: 150, buildingMinTrades: 6 };
    expect(taps(c.calls)).toEqual([{ kind: 'starter-limits', ...next }]);
    expect(puts(c.calls, '/staff/v1/starter-limits')[0]!.body).toEqual({ ...next, tapId: 'tap-1' });
    expect(s.querySelector('[data-part="starter-limits-saved"]')).not.toBeNull();
    expect(s.querySelector('[data-part="starter-limits-updated"]')?.textContent).toBe('Last changed 2026-11-26 10:00 UTC');
    // Saved again as it is now: nothing to save.
    expect(button('Save starter limits')!.disabled).toBe(true);
  });

  it('a number out of bounds or stages out of order is named, and Save stays disabled', async () => {
    const c = api();
    await open();
    const s = region('Starter limits');
    typeInto(field('Starter: open trades at once', s), '0');
    await settle();
    expect(s.querySelector('[data-part="starter-limits-invalid"]')?.textContent).toContain('Starter: open trades at once (a whole number from 1 to 1,000)');
    expect(button('Save starter limits')!.disabled).toBe(true);
    typeInto(field('Starter: open trades at once', s), '3');
    typeInto(field('Building: largest trade', s), '100');
    await settle();
    expect(s.querySelector('[data-part="starter-limits-invalid"]')?.textContent).toContain("Building's largest trade (at least Starter's)");
    expect(button('Save starter limits')!.disabled).toBe(true);
    typeInto(field('Building: largest trade', s), '12.5');
    await settle();
    expect(button('Save starter limits')!.disabled).toBe(true);
    expect(c.calls.some((x) => x.method === 'PUT')).toBe(false);
  });

  it('a cancelled tap saves nothing and lets the owner try again', async () => {
    const c = api();
    await open();
    typeInto(field('Starter: largest trade', region('Starter limits')), '300');
    typeInto(field('Building: largest trade', region('Starter limits')), '1000');
    await settle();
    await click(button('Save starter limits'));
    await click(button('Cancel'));
    expect(puts(c.calls, '/staff/v1/starter-limits')).toEqual([]);
    expect(button('Save starter limits')!.disabled).toBe(false);
  });
});

describe('Contact and community links', () => {
  it('saves only the changed links, with no tap; an empty field removes a link', async () => {
    const c = api({ 'PUT /staff/v1/settings': (b) => ({ body: { ...SETTINGS, ...(b as object) } }) });
    await open();
    const s = region('Contact and community links');
    expect((field('Community on Matrix', s) as HTMLInputElement).value).toBe('https://matrix.to/#/#x2f:matrix.org');
    typeInto(field('Moderator contact', s), 'https://t.me/x2f_mods');
    typeInto(field('Community on Matrix', s), '');
    await settle();
    await click(button('Save links'));
    expect(taps(c.calls)).toEqual([]);
    expect(puts(c.calls, '/staff/v1/settings').map((x) => x.body)).toEqual([{ moderatorContactUrl: 'https://t.me/x2f_mods', communityMatrixUrl: null }]);
    expect(s.querySelector('[data-part="links-saved"]')).not.toBeNull();
    expect(button('Save links')!.disabled).toBe(true);
  });

  it('a moderator contact that is not matrix.to or t.me, or a community link that is not https, is refused before it is sent', async () => {
    const c = api();
    await open();
    const s = region('Contact and community links');
    typeInto(field('Moderator contact', s), 'https://discord.gg/x2f');
    await settle();
    expect(s.querySelector('[data-part="links-invalid"]')?.textContent).toContain('Moderator contact (a matrix.to or t.me link)');
    expect(button('Save links')!.disabled).toBe(true);
    typeInto(field('Moderator contact', s), '');
    typeInto(field('Community on Telegram', s), 'http://t.me/x2f');
    await settle();
    expect(s.querySelector('[data-part="links-invalid"]')?.textContent).toContain('Community on Telegram');
    expect(button('Save links')!.disabled).toBe(true);
    expect(c.calls.some((x) => x.method === 'PUT')).toBe(false);
  });
});

describe('Fee wallet', () => {
  it('reads atomic units from XMR as typed', () => {
    expect(atomicOf('')).toBeNull();
    expect(atomicOf('1.5')).toBe('1500000000000');
    expect(atomicOf('0.000000000001')).toBe('1');
    expect(atomicOf('1.0000000000001')).toBeUndefined();
    expect(atomicOf('abc')).toBeUndefined();
  });

  it('says the sweep is off and the wallet is not connected; turning it on taps the three values', async () => {
    const c = api({ 'PUT /staff/v1/fee-sweep': (b) => ({ body: { ...SWEEP, ...(b as object), on: true } }) });
    await open();
    const s = region('Fee wallet');
    expect(s.querySelector('[data-part="fee-sweep-state"]')?.textContent).toBe('The sweep is off.');
    expect(s.querySelector('[data-part="fee-sweep-not-wired"]')).not.toBeNull();
    typeInto(field('Move fees at', s), '5');
    await settle();
    // A threshold needs the float and the address.
    expect(s.querySelector('[data-part="fee-sweep-invalid"]')?.textContent).toContain('Keep in the fee wallet and the offline address');
    expect(button('Save fee wallet')!.disabled).toBe(true);
    typeInto(field('Keep in the fee wallet', s), '6');
    typeInto(field('Your offline wallet address', s), COLD);
    await settle();
    // Above the float only.
    expect(button('Save fee wallet')!.disabled).toBe(true);
    typeInto(field('Keep in the fee wallet', s), '0.75');
    await settle();
    await click(button('Save fee wallet'));
    await click(button('Tap security key'));
    const next = { thresholdAtomic: '5000000000000', floatAtomic: '750000000000', coldAddress: COLD };
    expect(taps(c.calls)).toEqual([{ kind: 'fee-sweep', ...next }]);
    expect(puts(c.calls, '/staff/v1/fee-sweep')[0]!.body).toEqual({ ...next, tapId: 'tap-1' });
    expect(s.querySelector('[data-part="fee-sweep-state"]')?.textContent).toBe('The sweep is on.');
    expect((field('Keep in the fee wallet', s) as HTMLInputElement).value).toBe('0.75');
  });

  it('an address the API reads as invalid on its network is said plainly', async () => {
    api({ 'PUT /staff/v1/fee-sweep': refused(400, 'address-invalid') });
    await open();
    const s = region('Fee wallet');
    typeInto(field('Your offline wallet address', s), COLD);
    await settle();
    await click(button('Save fee wallet'));
    await click(button('Tap security key'));
    expect(s.querySelector('[data-part="fee-sweep-fault"]')?.textContent).toBe('That is not a valid Monero address on this network. Check it and try again.');
  });
});

describe('Staff pay owed', () => {
  it('lists each member with what is unpaid and who owes', async () => {
    api({
      'GET /staff/v1/pay/staff': {
        body: {
          members: [
            { staffId: 's-1', tradeTag: 'sarah.v', role: 'senior', switchedOff: false, unpaidUsdCents: '250000', unpaidAtomic: '1500000000000', owed: false },
            { staffId: 'm-1', tradeTag: 'dmitri_k', role: 'mod', switchedOff: true, unpaidUsdCents: '-1250', unpaidAtomic: '0', owed: true },
            { staffId: 'h-1', tradeTag: 'tobi.w', role: 'helper', switchedOff: false, unpaidUsdCents: '0', unpaidAtomic: '0', owed: false },
          ],
        },
      },
    });
    await open();
    const rows = [...document.querySelectorAll('table[aria-label="Pay owed per person"] tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
    expect(rows).toEqual([
      ['sarah.v', 'Senior moderator', 'Active', '$2,500.00', '1.50', 'Due at clock-out'],
      ['dmitri_k', 'Moderator', 'Switched off', '-$12.50', '0.00', 'Owes X2F'],
      ['tobi.w', 'Helper', 'Active', '$0.00', '0.00', 'Nothing due'],
    ]);
    expect(centsText('5')).toBe('$0.05');
  });
});
