// @vitest-environment happy-dom
import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OwnerOnly } from '../src/screens/settings/OwnerOnly.js';
import { refreshSession, sessionEnded } from '../src/session/useSession.js';
import { fire, render } from './render.js';

function Where() {
  const loc = useLocation();
  return <output data-where={loc.pathname} />;
}

function mount(screenName: string, children: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/protected']}>
      <Routes>
        <Route path="/protected" element={<OwnerOnly screen={screenName}>{children}</OwnerOnly>} />
        <Route path="/sell" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });

describe('OwnerOnly screen guard', () => {
  beforeEach(() => {
    refreshSession();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders children for the account owner (member is null)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input === '/v1/account/me') {
          return new Response(
            JSON.stringify({
              kind: 'trader',
              level: 'full',
              termsCurrent: true,
              displayName: 'lead_owner',
              member: null,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(null, { status: 404 });
      }),
    );
    refreshSession();

    const { host } = mount('settings-security', <div data-part="secret-content">Secret Owner Content</div>);
    await flush();

    expect(host.querySelector('[data-part="secret-content"]')).not.toBeNull();
    expect(host.querySelector('[data-owner-only]')).toBeNull();
    expect(host.textContent).toContain('Secret Owner Content');
  });

  it('renders children when signed out', async () => {
    sessionEnded();
    const { host } = mount('settings-security', <div data-part="secret-content">Secret Content</div>);
    await flush();

    expect(host.querySelector('[data-part="secret-content"]')).not.toBeNull();
    expect(host.querySelector('[data-owner-only]')).toBeNull();
  });

  it('blocks team members with CantDoThat and navigates to /sell on close', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input === '/v1/account/me') {
          return new Response(
            JSON.stringify({
              kind: 'trader',
              level: 'full',
              termsCurrent: true,
              displayName: 'team_account',
              member: {
                name: 'helper_bob',
                roles: ['trades'],
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(null, { status: 404 });
      }),
    );
    refreshSession();

    const { host } = mount('settings-wallets', <div data-part="secret-content">Secret Owner Content</div>);
    await flush();

    // Children are NOT rendered
    expect(host.querySelector('[data-part="secret-content"]')).toBeNull();

    // Guard screen with data-owner-only
    const screen = host.querySelector('main[data-screen="settings-wallets"][data-owner-only]');
    expect(screen).not.toBeNull();

    // CantDoThat popup is visible (Sheet portals to document.body)
    const cantDoThat = document.querySelector('[data-part="cant-do-that"]');
    expect(cantDoThat).not.toBeNull();
    expect(cantDoThat?.getAttribute('data-from')).toBe('owner-only');

    // Clicking OK button navigates to /sell
    const okBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('OK'));
    expect(okBtn).toBeDefined();
    act(() => {
      fire(okBtn!, new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    const where = host.querySelector('[data-where]');
    expect(where?.getAttribute('data-where')).toBe('/sell');
  });
});
