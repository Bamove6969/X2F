// @vitest-environment happy-dom
// Order #2 M3: Security screen accessible to team members with owner-only sections hidden
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Security } from '../src/screens/settings/Security.js';
import { refreshSession } from '../src/session/useSession.js';
import { render } from './render.js';

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
          methods: ['password'],
          accountType: 'vendor',
          pendingChanges: null,
          member: isMember ? { name: 'Aurora', roles: ['trades'] } : null,
        });
      }
      if (url === '/v1/account/alerts') return json(200, []);
      if (url === '/v1/account/jabber') return json(200, { available: false });
      if (url === '/v1/account/methods') return json(200, [{ method: 'password', registered: true }]);
      if (url === '/v1/account/hold') return json(200, { level: 'none', count: 0, changes: [] });
      if (url === '/v1/wallets/rule') return json(200, { firstWallet: true, strongMethods: [], password: 'works', waitHours: 0 });
      return json(404, { error: 'not-found' });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  refreshSession();
});

const settle = () => act(async () => new Promise<void>((r) => setTimeout(r, 10)));

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
    await settle();

    expect(host.querySelector('[data-owner-only]')).toBeNull();
    expect(host.querySelector('[data-part="devices-link"]')).not.toBeNull();
    expect(host.querySelector('[data-part="account-type-link"]')).not.toBeNull();
    expect(host.querySelector('[data-part="team-link"]')).not.toBeNull();
    expect(host.querySelector('[data-part="session-length-link"]')).toBeNull();
    expect(host.querySelector('[data-part="blocked-link"]')).not.toBeNull();
    expect(host.querySelector('[data-part="idle-reminder-link"]')).not.toBeNull();
    expect(host.querySelector('[data-part="tour-replay"]')).not.toBeNull();
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
    const ownerUrls = ['/v1/account/hold', '/v1/account/methods', '/v1/wallets/rule', '/v1/account/jabber', '/v1/account/alerts'];
    expect(fetchedUrls.filter((u) => ownerUrls.includes(u))).toEqual([]);

    await settle();

    // No CantDoThat / OwnerOnly refusal
    expect(host.querySelector('[data-owner-only]')).toBeNull();
    expect(host.querySelector('.x2f-screen__title')?.textContent).toBe('Security');

    // Owner sections hidden
    expect(host.querySelector('[data-part="devices-link"]')).toBeNull();
    expect(host.querySelector('[data-part="account-type-link"]')).toBeNull();
    expect(host.querySelector('[data-part="team-link"]')).toBeNull();
    expect(host.querySelector('[data-part="alerts"]')).toBeNull();

    // M2: Blocked link hidden for members
    expect(host.querySelector('[data-part="blocked-link"] a[href="/settings/blocked"]')).toBeNull();

    // m1: Tour replay hidden for members
    expect(host.querySelector('[data-part="tour-replay"]')).toBeNull();

    // M3: Session length link dropped
    expect(host.querySelector('[data-part="session-length-link"]')).toBeNull();

    // Member sections shown: idle reminder and alarm settings
    expect(host.querySelector('[data-part="idle-reminder-link"]')).not.toBeNull();
    expect(host.querySelector('[data-part="alarm"]')).not.toBeNull();

    // M1: Even after settle, owner calls were never fired for member
    expect(fetchedUrls.filter((u) => ownerUrls.includes(u))).toEqual([]);
  });
});
