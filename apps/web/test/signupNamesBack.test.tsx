// @vitest-environment happy-dom
// Signup-team review F8 (8 Nov 2026): Back and "Change your names" lead to the display-name
// screen when that is the name to change; the display-name step needs a username first.
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApiError } from '@x2f/auth-client';
import { INITIAL, RegisterError, SetupContext, type SetupApi, type SetupState } from '../src/screens/setup/kit.js';
import { Login } from '../src/screens/setup/Login.js';
import { SetupFlow } from '../src/screens/setup/SetupFlow.js';
import { setupError } from '../src/screens/setup/register.js';
import { render } from './render.js';

beforeEach(() => {
  // Anything the flow asks for (the session) fails: these screens need no answer.
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'internal' }), { status: 500, headers: { 'content-type': 'application/json' } }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const byPart = (host: ParentNode, part: string) => host.querySelector<HTMLElement>(`[data-part="${part}"]`);

function setup(state: Partial<SetupState> = {}): SetupApi {
  return {
    state: { ...INITIAL, terms: { version: 'v1' }, displayName: 'Lumen.K', loginName: 'juniper.oak', ...state },
    update: vi.fn(),
    returnTo: '/sell',
    go: vi.fn(),
    path: (s) => `/setup/${s}`,
  };
}

function show(el: React.ReactNode, api: SetupApi) {
  return render(
    <MemoryRouter>
      <SetupContext.Provider value={api}>{el}</SetupContext.Provider>
    </MemoryRouter>,
  ).host;
}

describe('F8: the way back to the display name', () => {
  it("the login-method step's back arrow goes to the display-name screen", () => {
    const host = show(<Login />, setup());
    expect(host.querySelector('a[aria-label="Back"]')!.getAttribute('href')).toBe('/setup/display-name');
  });

  it('"Change your names" goes to the screen of the name that was refused', () => {
    const fallback = 'fallback';
    for (const [code, step] of [
      ['display-name-taken', 'display-name'],
      ['display-name-reserved', 'display-name'],
      ['display-name-invalid', 'display-name'],
      ['names-unavailable', 'name'],
      ['login-name-invalid', 'name'],
      ['names-same', 'name'],
    ] as const) {
      const error = setupError(new AuthApiError(409, code), fallback);
      const host = show(<RegisterError error={error} />, setup());
      expect(byPart(host, 'change-names')!.getAttribute('href'), code).toBe(`/setup/${step}`);
    }
  });

  it('the display-name step needs a username first', () => {
    const host = render(
      <MemoryRouter initialEntries={['/setup/display-name?returnTo=%2Fsell']}>
        <Routes>
          <Route path="/setup/*" element={<SetupFlow />} />
        </Routes>
      </MemoryRouter>,
    ).host;
    expect(host.querySelector('[data-screen="setup-display-name"]')).toBeNull();
  });
});
