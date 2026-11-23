// @vitest-environment happy-dom
// Security review of wip/lead-notes-all, M2 (owner 16 Nov 2026: a password alone does not finish
// sign-up). A setup-only session (me.setupOnly: the account's only login is a password) is told on
// Security to add a second way to log in, and sees none of the session screens it may not open;
// the sign-up's end (POST /v1/account/onboarding/end) is no longer ignored when it fails.
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Security } from '../src/screens/settings/Security.js';
import { EndSignup } from '../src/screens/setup/SetupFlow.js';
import { TourProvider } from '../src/tour/TourProvider.js';
import { SECOND_METHOD_MESSAGE, SECOND_METHOD_SIGNUP } from '../src/ui/cantDoCodes.js';
import { refreshSession } from '../src/session/useSession.js';
import { fire, render } from './render.js';

let setupOnly = true;
let endAnswer: () => Response = () => new Response(null, { status: 204 });
const ends: number[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  setupOnly = true;
  ends.length = 0;
  endAnswer = () => json(200, { ok: true });
  refreshSession();
  vi.stubGlobal('fetch', async (input: string) => {
    const url = String(input).split('?')[0]!;
    if (url === '/v1/account/me') {
      return json(200, { kind: 'trader', level: 'full', termsCurrent: true, displayName: 'Calcium', methods: ['password'], hasBackup: false, suggestions: [], holdUntil: null, member: null, setupOnly });
    }
    if (url === '/v1/account/onboarding/end') {
      ends.push(1);
      return endAnswer();
    }
    if (url === '/v1/account/methods') return json(200, [{ type: 'password', id: 'password', label: '', createdAt: null, lastUsedAt: null }]);
    if (url === '/v1/account/hold') return json(200, { level: 'none', count: 0, changes: [] });
    if (url === '/v1/wallets/rule') return json(200, { firstWallet: true, strongMethods: [], password: 'immediate', waitHours: 24 });
    return json(403, { error: 'second-method-required' });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  refreshSession();
});

const settle = () => act(async () => new Promise<void>((r) => setTimeout(r, 10)));

async function security(): Promise<HTMLElement> {
  let host: HTMLElement = null!;
  await act(async () => {
    host = render(
      <MemoryRouter initialEntries={['/settings/security']}>
        <TourProvider>
          <Security />
        </TourProvider>
      </MemoryRouter>,
    ).host;
  });
  await settle();
  return host;
}

describe('review M2: Security for a setup-only session', () => {
  it('says to add a second way to log in, keeps Login methods, and links to no session screen', async () => {
    const host = await security();
    const note = host.querySelector('[data-part="setup-only"]')!;
    expect(note).not.toBeNull();
    expect(note.textContent).toContain('Add a second way to log in');
    expect(note.textContent).toContain(SECOND_METHOD_MESSAGE);
    expect(host.querySelector('[data-part="methods"]')).not.toBeNull();
    expect(host.querySelector('[data-part="devices-link"]')).toBeNull();
  });

  it('a normal session sees no such notice', async () => {
    setupOnly = false;
    const host = await security();
    expect(host.querySelector('[data-part="setup-only"]')).toBeNull();
    expect(host.querySelector('[data-part="devices-link"]')).not.toBeNull();
  });
});

describe('review M2: the end of sign-up is not ignored', () => {
  function welcome() {
    return render(
      <MemoryRouter initialEntries={['/setup/welcome']}>
        <Routes>
          <Route
            path="/setup/welcome"
            element={
              <EndSignup registered>
                <p data-part="welcome-child">Welcome</p>
              </EndSignup>
            }
          />
          <Route path="/settings/security" element={<p data-part="went-security">Security</p>} />
        </Routes>
      </MemoryRouter>,
    ).host;
  }

  it('ends sign-up quietly when it works', async () => {
    const host = welcome();
    await settle();
    expect(ends).toHaveLength(1);
    expect(host.querySelector('[data-part="welcome-child"]')).not.toBeNull();
    expect(host.querySelector('[data-part="end-signup-failed"]')).toBeNull();
  });

  it('409 password-alone: says why, and goes on to Security to add a second way to log in', async () => {
    endAnswer = () => json(409, { error: 'password-alone' });
    const host = welcome();
    await settle();
    expect(document.body.textContent).toContain(SECOND_METHOD_SIGNUP);
    expect(host.querySelector('[data-part="welcome-child"]')).toBeNull();
    const close = [...document.body.querySelectorAll('button')].find((b) => /close|ok|got it/i.test(b.textContent ?? ''))!;
    fire(close, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(host.querySelector('[data-part="went-security"]')).not.toBeNull();
  });

  it('any other failure says so with Try again, which asks again', async () => {
    endAnswer = () => json(500, { error: 'internal' });
    const host = welcome();
    await settle();
    expect(host.querySelector('[data-part="end-signup-failed"]')!.textContent).toContain('Could not finish your sign-up.');
    endAnswer = () => json(200, { ok: true });
    fire(host.querySelector('[data-part="end-signup-retry"]')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(ends).toHaveLength(2);
    expect(host.querySelector('[data-part="end-signup-failed"]')).toBeNull();
  });
});
