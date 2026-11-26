// @vitest-environment happy-dom
// Order #2 M3: Security screen accessible to team members with owner-only sections hidden.
// Since owner demo note #101 Settings is four tabs (SettingsTabs.tsx): the alarm and alerts are on
// Alerts, account type / team / blocked on Account, the tour on Help. The member rules follow them.
import { act, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HelpSettings, Security } from '../src/screens/settings/Security.js';
import { AccountSettings, AlertsSettings } from '../src/screens/settings/SettingsTabs.js';
import { TourProvider } from '../src/tour/TourProvider.js';
import { refreshSession } from '../src/session/useSession.js';
import { render, waitFor, waitUntil } from './render.js';

let isMember = false;
let fetchedUrls: string[] = [];

function json(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  isMember = false;
  fetchedUrls = [];
  refreshSession();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = String(input).split('?')[0]!;
      fetchedUrls.push(url);
      if (url === '/v1/account/me') {
        return json(200, {
          kind: 'trader',
          level: 'full',
          termsCurrent: true,
          displayName: 'Calcium',
          methods: ['pgp', 'passkey'],
          accountType: 'vendor',
          member: isMember ? { name: 'Aurora', roles: ['trades'] } : null,
        });
      }
      if (url === '/v1/account/alerts') return json(200, []);
      if (url === '/v1/account/jabber') return json(200, { available: false });
      if (url === '/v1/account/methods') return json(200, [{ type: 'pgp', id: 'pgp-1', label: 'PGP key', createdAt: null, lastUsedAt: null }, { type: 'passkey', id: 'pk-1', label: 'Passkey', createdAt: null, lastUsedAt: null }]);
      if (url === '/v1/wallets/rule') return json(200, { firstWallet: true, strongMethods: ['pgp', 'passkey'] });
      return json(404, { error: 'not-found' });
    }),
  );
});

afterEach(() => {
  for (const u of extra.splice(0)) u();
  vi.unstubAllGlobals();
  refreshSession();
});


/** Each tab page, mounted for its own checks and unmounted before the session is reset. */
const extra: (() => void)[] = [];

/** Mounts `el` at `path` and waits for `ready` (a selector that shows the page has loaded). */
async function mountAt(path: string, el: ReactNode, ready: string): Promise<HTMLElement> {
  let host: HTMLElement = null!;
  await act(async () => {
    const res = render(
      <MemoryRouter initialEntries={[path]}>
        <TourProvider>{el}</TourProvider>
      </MemoryRouter>,
    );
    host = res.host;
    extra.push(res.unmount);
  });
  await waitFor(host, ready);
  return host;
}

const tabs = (host: HTMLElement) => [...host.querySelectorAll('[data-part="settings-tabs"] a')].map((a) => a.textContent);

describe('Security screen for team members vs owner (Order #2 M3)', () => {
  it('renders owner sections and links for the account owner', async () => {
    isMember = false;
    refreshSession();
    let host: HTMLElement = null!;
    await act(async () => {
      const res = render(
        <MemoryRouter initialEntries={['/settings/security']}>
          <Security />
        </MemoryRouter>,
      );
      host = res.host;
    });
    await waitFor(host, '[data-part="devices-link"]');
    await waitUntil(() => tabs(host).length === 4, 'the owner\'s four settings tabs');

    expect(host.querySelector('[data-owner-only]')).toBeNull();
    expect(host.querySelector('[data-part="session-length-link"]')).toBeNull();
    expect(host.querySelector('[data-part="idle-reminder-link"]')).not.toBeNull();
    expect([...host.querySelectorAll('[data-part="settings-tabs"] a')].map((a) => a.textContent)).toEqual(['Security', 'Alerts', 'Account', 'Help']);

    // The owner's other tabs (note #101): Account's links, Help's tour replay, Alerts' list.
    const account = await mountAt('/settings/account', <AccountSettings />, '[data-part="account-type-link"]');
    expect(account.querySelector('[data-part="team-link"]')).not.toBeNull();
    expect(account.querySelector('[data-part="blocked-link"]')).not.toBeNull();
    await mountAt('/settings/help', <HelpSettings />, '[data-part="tour-replay"]');
    await mountAt('/settings/alerts', <AlertsSettings />, '#alerts-h');
  });

  it('renders member settings, hides owner sections, and does not fire owner fetches for a team member (M1, M2, M3, m1)', async () => {
    isMember = true;
    refreshSession();
    let host: HTMLElement = null!;
    await act(async () => {
      const res = render(
        <MemoryRouter initialEntries={['/settings/security']}>
          <Security />
        </MemoryRouter>,
      );
      host = res.host;
    });

    // M1: On initial render while session is loading, no owner sections mount and no owner calls go out
    const ownerUrls = ['/v1/account/methods', '/v1/wallets/rule', '/v1/account/jabber', '/v1/account/alerts'];
    expect(fetchedUrls.filter((u) => ownerUrls.includes(u))).toEqual([]);

    await waitFor(host, '[data-part="idle-reminder-link"]');
    await waitUntil(() => tabs(host).length === 3, 'the member\'s three settings tabs');

    // No CantDoThat / OwnerOnly refusal
    expect(host.querySelector('[data-owner-only]')).toBeNull();
    expect(host.querySelector('.x2f-screen__title')?.textContent).toBe('Settings');
    // A member has no Account tab (account type, team and blocked are the owner's).
    expect([...host.querySelectorAll('[data-part="settings-tabs"] a')].map((a) => a.textContent)).toEqual(['Security', 'Alerts', 'Help']);

    // Owner sections hidden
    expect(host.querySelector('[data-part="devices-link"]')).toBeNull();
    expect(host.querySelector('[data-part="devices-row"]')).toBeNull();
    expect(host.querySelector('[data-part="methods"]')).toBeNull();

    // M3: Session length link dropped
    expect(host.querySelector('[data-part="session-length-link"]')).toBeNull();

    // Member sections shown: the idle reminder on Security
    expect(host.querySelector('[data-part="idle-reminder-link"]')).not.toBeNull();

    // Alerts tab: the alarm settings, not the owner's alerts list
    const alerts = await mountAt('/settings/alerts', <AlertsSettings />, '[data-part="alarm"]');
    expect(alerts.querySelector('[data-part="alerts"]')).toBeNull();

    // Help tab, m1: tour replay hidden for members, the welcome link kept
    const help = await mountAt('/settings/help', <HelpSettings />, '[data-part="welcome-link"]');
    expect(help.querySelector('[data-part="tour-replay"]')).toBeNull();
    expect(help.querySelector('[data-part="welcome-link"]')).not.toBeNull();

    // Account tab opened by address, M2: the owner-only refusal, no Blocked link
    const account = await mountAt('/settings/account', <AccountSettings />, '[data-owner-only]');
    expect(account.querySelector('[data-part="blocked-link"] a[href="/settings/blocked"]')).toBeNull();
    expect(account.querySelector('[data-part="team-link"]')).toBeNull();

    // M1: Even after settle, owner calls were never fired for member
    expect(fetchedUrls.filter((u) => ownerUrls.includes(u))).toEqual([]);
  });

  it('does not unmount Methods on refreshSession() for the owner (B1)', async () => {
    isMember = false;
    refreshSession();
    let host: HTMLElement = null!;
    await act(async () => {
      const res = render(
        <MemoryRouter initialEntries={['/settings/security']}>
          <Security />
        </MemoryRouter>,
      );
      host = res.host;
    });
    const methodsEl = await waitFor(host, '[data-part="methods"]');

    // Trigger refreshSession(), which transitions useSession to loading
    const asked = fetchedUrls.filter((u) => u === '/v1/account/me').length;
    await act(async () => {
      refreshSession();
    });

    // Sections should still remain mounted during reload (DOM identity preserved)
    expect(host.querySelector('[data-part="methods"]')).toBe(methodsEl);

    await waitUntil(() => fetchedUrls.filter((u) => u === '/v1/account/me').length > asked, 'the session to be asked for again');
    await waitUntil(() => true, 'the reloaded session to settle');

    expect(host.querySelector('[data-part="methods"]')).toBe(methodsEl);
  });
});
