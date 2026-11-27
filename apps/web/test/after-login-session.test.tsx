// @vitest-environment happy-dom
// A login lands in the app signed in without a page reload: afterLogin drops the shared session
// answer the login page loaded (signed out), so the app shell's live events and the "accepted your
// offer" sheet start at once (found by the demo's two-device browser run, 2026-11-08).
import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { afterLogin } from '../src/screens/auth/authApi.js';
import { resetNewsStore } from '../src/screens/news-model.js';
import { useSession, type Session } from '../src/session/useSession.js';
import { render } from './render.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let signedIn = false;

beforeEach(() => {
  window.localStorage.clear();
  resetNewsStore();
  signedIn = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = String(input);
      if (url === '/v1/account/me') return signedIn ? json(200, { tradeTag: 'demo_ana', kind: 'trader', level: 'full', termsCurrent: true }) : json(401, { error: 'not-authenticated' });
      if (url === '/v1/news') return json(200, { items: [], serverNow: '2026-11-08T12:00:00.000Z' });
      return json(404, { error: 'not-found' });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
}

it('a mounted screen that saw "signed out" sees the session after the login, with no reload', async () => {
  const seen: Session['status'][] = [];
  function Probe() {
    const s = useSession();
    seen.push(s.status);
    return null;
  }
  render(<Probe />);
  await settle();
  expect(seen.at(-1)).toBe('signed-out');

  signedIn = true;
  const go: string[] = [];
  await act(async () => afterLogin((to) => go.push(to), '/sell'));
  await settle();
  expect(go).toEqual(['/sell']);
  expect(seen.at(-1)).toBe('signed-in');
});
