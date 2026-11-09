// @vitest-environment happy-dom
// The front door (owner, 8 Nov 2026): "No one gets to make it past the front door and see behind the
// curtains without signing an agreement, creating an account and logging in. There are no free tours
// for outsiders." Every route in App.tsx is checked logged out, half set up (old Terms), on a
// recovery session and logged in: only the front door's screens open without a set-up session, and
// every other one goes to the Landing board ("/", design review 2026-11-08 item 1) with where it was
// going kept in returnTo, which Create account and Log in carry on.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { api } from '../src/api/client.js';
import { RECOVERY_HOME, doorVerdict, isFrontDoor, isInside } from '../src/session/frontDoor.js';
import { refreshSession, type Session } from '../src/session/useSession.js';
import { render } from './render.js';

const APP = join(dirname(fileURLToPath(import.meta.url)), '../src/App.tsx');
/** Every path in App.tsx's route table, with example values for its parameters. */
const PATHS = [...readFileSync(APP, 'utf8').matchAll(/<Route\s+path="([^"]+)"/g)]
  .map((m) => m[1]!)
  .filter((p) => p !== '*')
  .map((p) => p.replace(':methodId', 'ZELLE').replace(':offerId', '00000000-0000-4000-8000-000000000000').replace(':code', 'ABCD-EFGH').replace('/*', ''));

const DOOR = ['/', '/setup', '/terms', '/login', '/login/backup', '/team/join'];
const BEHIND = PATHS.filter((p) => !DOOR.includes(p));

const FULL = { displayName: 'viewer_1', kind: 'trader', level: 'full', termsCurrent: true, methods: ['password'], hasBackup: true, suggestions: [], holdUntil: null };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let me: { status: number; body: unknown };
let calls: string[];

beforeEach(() => {
  refreshSession();
  window.localStorage.clear();
  me = { status: 401, body: { error: 'not-authenticated' } };
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = String(input);
      calls.push(url.split('?')[0]!);
      if (url === '/v1/account/me') return json(me.status, me.body);
      if (url === '/v1/site') return json(200, { maintenance: null });
      if (url === '/v1/terms') return json(200, { version: '2026-10-17', text: 'Terms' });
      return json(404, { error: 'not-found' });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  refreshSession();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

let where = '';
function Where() {
  const loc = useLocation();
  where = loc.pathname + loc.search;
  return null;
}

async function open(path: string): Promise<HTMLElement> {
  const { host } = render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <App />
    </MemoryRouter>,
  );
  await settle();
  return host;
}

const MARKET = ['/v1/methods', '/v1/offers', '/v1/price', '/v1/news'];
const login = (path: string) => `/login?returnTo=${encodeURIComponent(path)}`;
const landing = (path: string) => `/?returnTo=${encodeURIComponent(path)}`;
/** Navigation other than the Landing board's own "Get in" links (the bottom nav, the desktop header). */
const appNav = (host: HTMLElement) => host.querySelectorAll('nav:not([aria-label="Get in"])');

describe('the route table', () => {
  it('has the front door and the screens behind it, and the guard knows the same front door', () => {
    expect(BEHIND.length).toBeGreaterThan(15);
    for (const p of DOOR) expect(PATHS, p).toContain(p);
    for (const p of PATHS) expect(isFrontDoor(p), p).toBe(DOOR.includes(p));
    for (const p of ['/setup/name', '/setup/wallet', '/setup/welcome']) expect(isFrontDoor(p), p).toBe(true);
    for (const p of ['/loginx', '/login/backup/x', '/settings', '/setupx', '/terms/x', '/sell', '//', '/x']) expect(isFrontDoor(p), p).toBe(false);
  });
});

describe('logged out', () => {
  for (const path of BEHIND) {
    it(`${path} goes to the Landing board, keeping the path, with nothing of the screen and no marketplace call`, async () => {
      const host = await open(`${path}?x=1`);
      expect(where).toBe(landing(`${path}?x=1`));
      expect(host.querySelector('[data-screen="landing"]')).not.toBeNull();
      expect(calls.filter((c) => MARKET.includes(c))).toEqual([]);
      // No desktop or phone navigation to the screens behind the door.
      expect(appNav(host)).toHaveLength(0);
    });
  }

  for (const path of ['/login', '/login/backup', '/setup', '/terms']) {
    it(`${path} opens on the front door`, async () => {
      await open(path);
      expect(where.split('?')[0]).toBe(path);
      expect(calls.filter((c) => MARKET.includes(c))).toEqual([]);
    });
  }

  it('"/" is the Landing board: logo D, the slogan, and the three ways in, nothing else and no marketplace call', async () => {
    const host = await open('/');
    expect(where).toBe('/');
    const screen = host.querySelector('[data-screen="landing"]')!;
    expect(screen).not.toBeNull();
    expect(screen.querySelector('h1 svg[aria-label="X2F"]')).not.toBeNull();
    expect(screen.textContent).toContain('You’ll need Fiat to believe it.');
    const links = [...screen.querySelectorAll('nav[aria-label="Get in"] a')].map((a) => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([
      ['Create account', '/setup'],
      ['Log in', '/login'],
      ['Lost access? Recover your account', '/login/backup'],
    ]);
    expect(appNav(host)).toHaveLength(0);
    expect(calls.filter((c) => MARKET.includes(c))).toEqual([]);
  });

  it('Create account and Log in carry where the visitor was going', async () => {
    const host = await open('/sell/ZELLE?currency=USD');
    expect(where).toBe(landing('/sell/ZELLE?currency=USD'));
    const href = (label: string) => [...host.querySelectorAll('nav[aria-label="Get in"] a')].find((a) => a.textContent === label)!.getAttribute('href');
    expect(href('Create account')).toBe(`/setup?returnTo=${encodeURIComponent('/sell/ZELLE?currency=USD')}`);
    expect(href('Log in')).toBe(login('/sell/ZELLE?currency=USD'));
  });

  it('a returnTo on the Landing board that leaves the app is never carried on', async () => {
    const host = await open(`/?returnTo=${encodeURIComponent('//evil.example')}`);
    for (const a of host.querySelectorAll('nav[aria-label="Get in"] a')) expect(a.getAttribute('href'), a.textContent!).not.toContain('evil');
  });

  it('an unknown path ends at the Landing board too', async () => {
    const host = await open('/no-such-page');
    expect(where).toBe('/');
    expect(host.querySelector('[data-screen="landing"]')).not.toBeNull();
  });

  it('a returnTo that leaves the app is never kept', () => {
    expect(doorVerdict({ status: 'signed-out' }, '//evil.example', '')).toEqual({ kind: 'go', to: landing('/sell') });
  });
});

describe('half set up: an account on an old Terms version', () => {
  for (const path of BEHIND) {
    it(`${path} goes back into setup (the Terms), keeping the path`, async () => {
      me = { status: 200, body: { ...FULL, termsCurrent: false } };
      await open(path);
      expect(where).toBe(`/terms?returnTo=${encodeURIComponent(path)}`);
      expect(calls.filter((c) => MARKET.includes(c))).toEqual([]);
    });
  }
});

describe('a recovery (backup) session', () => {
  it('reaches Security, open trades and the feedback form only', () => {
    const rec: Session = { status: 'signed-in', me: { ...FULL, level: 'recovery' } as never };
    for (const p of BEHIND) {
      const v = doorVerdict(rec, p, '');
      const allowed = p === '/settings/security' || p.startsWith('/trade/') || p === '/feedback';
      expect(v, p).toEqual(allowed ? { kind: 'in' } : { kind: 'go', to: RECOVERY_HOME });
    }
  });
});

describe('logged in and set up', () => {
  it('"/" goes on to the app (the Landing board is for outsiders)', async () => {
    me = { status: 200, body: FULL };
    const host = await open('/');
    expect(where.split('?')[0]).toBe('/sell');
    expect(host.querySelector('[data-screen="landing"]')).toBeNull();
  });

  for (const path of BEHIND) {
    it(`${path} opens`, async () => {
      me = { status: 200, body: FULL };
      await open(path);
      // The screen may add its own query (the quote adds its currency); the path stays.
      expect(where.split('?')[0]).toBe(path);
    });
  }
});

describe('the verdict', () => {
  it('waits while loading, and anything short of a full set-up trader session is outside', () => {
    expect(doorVerdict({ status: 'loading' }, '/sell', '')).toEqual({ kind: 'wait' });
    expect(doorVerdict({ status: 'error', code: 'network' }, '/sell', '')).toEqual({ kind: 'go', to: landing('/sell') });
    // The session probe refused with terms-required goes the way the API client sends it: the Terms.
    expect(doorVerdict({ status: 'error', code: 'terms-required' }, '/sell', '?currency=EUR')).toEqual({ kind: 'go', to: `/terms?returnTo=${encodeURIComponent('/sell?currency=EUR')}` });
    const as = (m: Record<string, unknown>): Session => ({ status: 'signed-in', me: m as never });
    expect(isInside(as(FULL))).toBe(true);
    for (const partial of [{ kind: 'trader' }, { ...FULL, termsCurrent: undefined }, { ...FULL, level: undefined }, { ...FULL, kind: 'staff' }]) {
      expect(isInside(as(partial)), JSON.stringify(partial)).toBe(false);
      expect(doorVerdict(as(partial), '/sell', '').kind).toBe('go');
    }
  });
});

describe('a session that ends while inside', () => {
  it('a 401 not-authenticated from any call sends the screen to the Landing board, keeping the path for its Log in', async () => {
    me = { status: 200, body: FULL };
    await open('/wallets');
    expect(where).toBe('/wallets');
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { error: 'not-authenticated' })));
    await act(async () => {
      await api('/v1/wallets').catch(() => undefined);
    });
    await settle();
    expect(where).toBe(landing('/wallets'));
  });
});
