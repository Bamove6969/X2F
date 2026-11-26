// @vitest-environment happy-dom
// Owner demo notes 12 Nov 2026 (#27 a8b080ad, #30 4a8a6e47): when multiple login methods are
// ticked on /setup/login, the setup flow walks through every ticked method in SIGNUP_ORDER
// (pgp -> security-key -> passkey -> totp) and opens the recovery-code screen
// (/setup/backup) only after all chosen methods have been set up.
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL, SetupContext, nextStep, type SetupApi, type SetupState } from '../src/screens/setup/kit.js';
import { PgpChallenge } from '../src/screens/setup/PgpChallenge.js';
import { SetupFlow } from '../src/screens/setup/SetupFlow.js';
import { clearPendingSignup, writePendingSignup } from '../src/screens/setup/signupPending.js';
import { fire, render } from './render.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    if (url === '/v1/account/me') {
      return json(200, {
        displayName: 'Lumen.K',
        loginNameSet: true,
        kind: 'trader',
        level: 'full',
        methods: ['pgp'],
        hasBackup: false,
        suggestions: [],
        termsCurrent: true,
      });
    }
    if (url === '/v1/wallets') return json(200, []);
    return json(200, {});
  });
});

afterEach(() => {
  clearPendingSignup();
  vi.unstubAllGlobals();
});

const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });

function mountAt(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/setup/*" element={<SetupFlow />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('setup flow multi-method checklist order (#27, #30)', () => {
  it('redirects /setup/backup, /setup/wallet, /setup/welcome and later method steps to the next ticked method until all chosen methods are done', async () => {
    writePendingSignup({
      displayName: 'Lumen.K',
      method: 'pgp',
      methods: ['pgp', 'security-key', 'passkey', 'totp'],
      done: ['pgp'],
    });

    for (const path of ['/setup/backup', '/setup/wallet', '/setup/welcome', '/setup/passkey', '/setup/authenticator']) {
      const { host, unmount } = mountAt(path);
      await flush();
      expect(host.querySelector('[data-screen]')?.getAttribute('data-screen'), path).toBe('setup-security-key');
      unmount();
    }
  });

  it('walks through each remaining ticked method in SIGNUP_ORDER and reaches /setup/backup only after all are done', async () => {
    const steps: Array<{ done: ('pgp' | 'security-key' | 'passkey' | 'totp')[]; expectedScreen: string }> = [
      { done: ['pgp'], expectedScreen: 'setup-security-key' },
      { done: ['pgp', 'security-key'], expectedScreen: 'setup-passkey' },
      { done: ['pgp', 'security-key', 'passkey'], expectedScreen: 'setup-authenticator' },
      { done: ['pgp', 'security-key', 'passkey', 'totp'], expectedScreen: 'setup-backup' },
    ];

    for (const { done, expectedScreen } of steps) {
      writePendingSignup({
        displayName: 'Lumen.K',
        method: 'pgp',
        methods: ['pgp', 'security-key', 'passkey', 'totp'],
        done,
      });
      const { host, unmount } = mountAt('/setup/backup');
      await flush();
      expect(host.querySelector('[data-screen]')?.getAttribute('data-screen'), done.join(',')).toBe(expectedScreen);
      unmount();
    }
  });

  it('marks pgp done when PgpChallenge verify succeeds so nextStep advances to the next ticked method before Continue (prevents /setup/pgp-key Back redirect loop)', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url === '/v1/register/pgp/finish') return json(201, { displayName: 'Lumen.K' });
      if (url === '/v1/pgp/signing-key') return json(200, { fingerprint: '3f2a9c417b0ed5a261c80e4b92d71f6ac3b80d15', publicKey: '' });
      if (url === '/v1/account/me') {
        return json(200, {
          displayName: 'Lumen.K',
          loginNameSet: true,
          kind: 'trader',
          level: 'full',
            methods: ['pgp'],
          hasBackup: false,
          suggestions: [],
          termsCurrent: true,
        });
      }
      return json(200, {});
    });

    let current: SetupState = {
      ...INITIAL,
      terms: { version: 'v1' },
      displayName: 'Lumen.K',
      loginName: 'juniper.oak',
      method: 'pgp',
      methods: ['pgp', 'security-key', 'totp'],
      done: [],
      challenge: {
        challengeId: 'c1',
        encryptedMessage: '-----BEGIN PGP MESSAGE-----',
        expiresAt: '2099-01-01T00:00:00.000Z',
        fingerprint: 'aa',
      } as SetupState['challenge'],
    };

    const api: SetupApi = {
      get state() {
        return current;
      },
      update: vi.fn((patch: Partial<SetupState>) => {
        current = { ...current, ...patch };
      }),
      returnTo: '/sell',
      go: vi.fn(),
      path: (s) => `/setup/${s}`,
    };

    const { host, unmount } = render(
      <MemoryRouter>
        <SetupContext.Provider value={api}>
          <PgpChallenge />
        </SetupContext.Provider>
      </MemoryRouter>,
    );
    await flush();

    const input = host.querySelector<HTMLInputElement>('#phrase')!;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(input, 'ABCD-EFGH-JKMN');
    fire(input, new Event('input', { bubbles: true }));
    fire(host.querySelector('[data-part="pgp-verify"]')!, new MouseEvent('click', { bubbles: true }));
    await flush();

    expect(current.registered).toBe(true);
    expect(current.done).toEqual(['pgp']);
    expect(nextStep(current)).toBe('security-key');
    unmount();
  });
});
