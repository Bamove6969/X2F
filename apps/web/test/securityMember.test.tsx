// @vitest-environment happy-dom
// Order #2 M3: Security screen accessible to team members with owner-only sections hidden
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Security } from '../src/screens/settings/Security.js';
import { refreshSession } from '../src/session/useSession.js';
import { render } from './render.js';

let isMember = false;

function json(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  isMember = false;
  refreshSession();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = String(input).split('?')[0]!;
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
    const { host } = render(
      <MemoryRouter initialEntries={['/settings/security']}>
        <Security />
      </MemoryRouter>,
    );
    await settle();

    expect(host.querySelector('[data-owner-only]')).toBeNull();
    expect(host.querySelector('[data-part="devices-link"]')).not.toBeNull();
    expect(host.querySelector('[data-part="account-type-link"]')).not.toBeNull();
    expect(host.querySelector('[data-part="team-link"]')).not.toBeNull();
    expect(host.querySelector('[data-part="session-length-link"]')).toBeNull();
    expect(host.querySelector('[data-part="blocked-link"]')).not.toBeNull();
    expect(host.querySelector('[data-part="idle-reminder-link"]')).not.toBeNull();
  });

  it('renders member settings and hides owner sections for a team member', async () => {
    isMember = true;
    refreshSession();
    const { host } = render(
      <MemoryRouter initialEntries={['/settings/security']}>
        <Security />
      </MemoryRouter>,
    );
    await settle();

    // No CantDoThat / OwnerOnly refusal
    expect(host.querySelector('[data-owner-only]')).toBeNull();
    expect(host.querySelector('.x2f-screen__title')?.textContent).toBe('Security');

    // Owner sections hidden
    expect(host.querySelector('[data-part="devices-link"]')).toBeNull();
    expect(host.querySelector('[data-part="account-type-link"]')).toBeNull();
    expect(host.querySelector('[data-part="team-link"]')).toBeNull();
    expect(host.querySelector('[data-part="alerts"]')).toBeNull();

    // Member sections shown
    expect(host.querySelector('[data-part="session-length-link"]')).not.toBeNull();
    expect(host.querySelector('[data-part="blocked-link"]')).not.toBeNull();
    expect(host.querySelector('[data-part="idle-reminder-link"]')).not.toBeNull();
  });
});
