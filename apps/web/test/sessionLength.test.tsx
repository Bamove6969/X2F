// @vitest-environment happy-dom
// Session length chosen at every login, and "Stay logged in?" (owner, 2 Nov 2026; boards
// SessionLength, SessionExtend, Devices on wip/design-brief). The server ends the session at its
// length; the web asks for the length after every login, opens the prompt SESSION_PROMPT_MS before
// the end, and extends only with a confirm token for `extend-session` from a login method.
import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_PROMPT_MS, type SessionInfo } from '@x2f/auth-client';
import { afterLogin } from '../src/screens/auth/authApi.js';
import { SESSION_LENGTH_PATH, SessionLengthScreen } from '../src/screens/auth/SessionLength.js';
import { SessionPrompt } from '../src/screens/auth/SessionPrompt.js';
import { Devices } from '../src/screens/settings/Devices.js';
import { publishSessionWatch, resetSessionWatch } from '../src/session/sessionWatch.js';
import { fire, render } from './render.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Handler = (url: string, init: RequestInit | undefined) => Response | undefined;
let handler: Handler;
let calls: Array<{ url: string; method: string; body: unknown }>;

const T0 = Date.parse('2026-11-02T12:00:00Z');
const info = (o: Partial<SessionInfo> = {}): SessionInfo => ({
  lengthHours: 4, choices: [2, 4, 6, 12], expiresAt: new Date(T0 + 4 * 3_600_000).toISOString(), canExtend: true, serverNow: new Date(T0).toISOString(), ...o,
});
const ME = { displayName: 'mira.k', needsLoginName: false, kind: 'trader', level: 'full', holdUntil: null, methods: ['password'], hasBackup: false, suggestions: [], termsCurrent: true };

beforeEach(() => {
  calls = [];
  handler = () => undefined;
  resetSessionWatch();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body !== undefined ? JSON.parse(String(init.body)) : undefined });
      return handler(url, init) ?? json(404, { error: 'not-found' });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const part = (host: ParentNode, p: string) => host.querySelector(`[data-part="${p}"]`);
const click = (el: Element | null) => fire(el!, new MouseEvent('click', { bubbles: true }));
function choose(select: Element | null, value: string) {
  const el = select as HTMLSelectElement;
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
function type(input: Element | null, value: string) {
  const el = input as HTMLInputElement;
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function Where() {
  const l = useLocation();
  return <span data-part="where">{l.pathname + l.search}</span>;
}

describe('after login: the session length comes first', () => {
  it('asks for the length when the session has none, carrying where the login was going', async () => {
    handler = (url) => (url === '/v1/account/me' ? json(200, { ...ME, session: info({ lengthHours: null }) }) : url.startsWith('/v1/news') ? json(200, []) : undefined);
    const go: string[] = [];
    await afterLogin((to) => go.push(to), '/wallets');
    expect(go).toEqual([`${SESSION_LENGTH_PATH}?returnTo=%2Fwallets`]);
  });

  it('goes straight on for a session with no length to choose (staff, backup)', async () => {
    handler = (url) => (url === '/v1/account/me' ? json(200, { ...ME, session: null }) : url.startsWith('/v1/news') ? json(200, []) : undefined);
    const go: string[] = [];
    await afterLogin((to) => go.push(to), '/wallets');
    expect(go).toEqual(['/wallets']);
  });
});

describe('SessionLength board: the question after every login', () => {
  const mount = () =>
    render(
      <MemoryRouter initialEntries={[`${SESSION_LENGTH_PATH}?returnTo=%2Fwallets`]}>
        <Routes>
          <Route path={SESSION_LENGTH_PATH} element={<SessionLengthScreen />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );

  it("offers the account type's choices with nothing pre-selected; Continue waits for a choice", async () => {
    handler = (url, init) => {
      if (url === '/v1/account/me') return json(200, { ...ME, session: info({ lengthHours: null }) });
      if (url === '/v1/account/session/length' && init?.method === 'PUT') return json(200, info({ lengthHours: 6 }));
      return undefined;
    };
    const { host } = mount();
    await settle();
    expect(host.textContent).toContain("You're logged in as mira.k.");
    const select = part(host, 'session-length-select') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect([...select.options].map((o) => o.textContent)).toEqual(['Choose a time', '2 hours', '4 hours', '6 hours', '12 hours']);
    const go = part(host, 'session-length-continue') as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    expect(host.textContent).toContain('Pick a time to continue.');
    choose(select, '6');
    expect(go.disabled).toBe(false);
    click(go);
    await settle();
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([{ url: '/v1/account/session/length', method: 'PUT', body: { hours: 6 } }]);
    expect(part(host, 'where')?.textContent).toBe('/wallets');
  });

  it('a session that already has its length goes straight on', async () => {
    handler = (url) => (url === '/v1/account/me' ? json(200, { ...ME, session: info() }) : undefined);
    const { host } = mount();
    await settle();
    expect(part(host, 'where')?.textContent).toBe('/wallets');
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([]);
  });
});

describe('SessionExtend board: "Stay logged in?"', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(T0);
  });

  const tick = (ms: number) => act(() => {
    vi.advanceTimersByTime(ms);
  });

  it(`warns ${SESSION_PROMPT_MS / 60_000} minutes before the end (owner Q73) and extends with the password through a confirm token`, async () => {
    handler = (url, init) => {
      if (url === '/v1/confirm/password' && init?.method === 'POST') return json(200, { confirmToken: 'tok' });
      if (url === '/v1/account/session/extend' && init?.method === 'POST') return json(200, info({ expiresAt: new Date(T0 + 8 * 3_600_000).toISOString() }));
      return undefined;
    };
    const { host } = render(<MemoryRouter><SessionPrompt /></MemoryRouter>);
    act(() => publishSessionWatch({ info: info(), methods: ['password'] }));
    expect(SESSION_PROMPT_MS).toBe(5 * 60_000);
    tick(4 * 3_600_000 - SESSION_PROMPT_MS - 2_000);
    expect(document.body.textContent).not.toContain('Stay logged in?');
    tick(3_000);
    expect(document.body.textContent).toContain('Stay logged in?');
    expect(document.body.textContent).toContain("Your 4-hour session ends in 5 minutes. Confirm it's you to stay logged in.");
    expect(document.querySelector('[data-part="session-countdown"]')?.textContent).toContain('Logging out in 4:59');
    // The same choices as at login, the session's own length picked.
    const select = document.querySelector('[data-part="session-extend"] [data-part="session-length-select"]') as HTMLSelectElement;
    expect([...select.options].filter((o) => !o.disabled).map((o) => o.value)).toEqual(['2', '4', '6', '12']);
    expect(select.value).toBe('4');
    type(document.querySelector('#confirm-password'), 'Correct-Horse-9');
    click(document.querySelector('[data-part="confirm-password"]'));
    await settle();
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['POST', '/v1/confirm/password', { password: 'Correct-Horse-9', action: { kind: 'extend-session' } }],
      ['POST', '/v1/account/session/extend', { confirmToken: 'tok', hours: 4 }],
    ]);
    expect(document.body.textContent).toContain("You're logged in for another 4 h.");
    // The new end is watched: no prompt until 5 minutes before it.
    tick(3 * 3_600_000);
    expect(document.body.textContent).not.toContain('Stay logged in?');
    expect(host).toBeTruthy();
  });

  it('extends for another of the login choices when the person picks one', async () => {
    handler = (url, init) => {
      if (url === '/v1/confirm/password' && init?.method === 'POST') return json(200, { confirmToken: 'tok' });
      if (url === '/v1/account/session/extend' && init?.method === 'POST') {
        return json(200, info({ lengthHours: 12, expiresAt: new Date(T0 + 16 * 3_600_000).toISOString() }));
      }
      return undefined;
    };
    render(<MemoryRouter><SessionPrompt /></MemoryRouter>);
    act(() => publishSessionWatch({ info: info(), methods: ['password'] }));
    tick(4 * 3_600_000 - 60_000);
    choose(document.querySelector('[data-part="session-extend"] [data-part="session-length-select"]'), '12');
    type(document.querySelector('#confirm-password'), 'Correct-Horse-9');
    click(document.querySelector('[data-part="confirm-password"]'));
    await settle();
    expect(calls.at(-1)).toEqual({ url: '/v1/account/session/extend', method: 'POST', body: { confirmToken: 'tok', hours: 12 } });
    expect(document.body.textContent).toContain("You're logged in for another 12 h.");
  });

  it("a team member's session extends with the member's own methods (owner Q73)", async () => {
    handler = () => undefined;
    render(<MemoryRouter><SessionPrompt /></MemoryRouter>);
    // `methods` are the member's own (me sends them); canExtend is true for members now.
    act(() => publishSessionWatch({ info: info(), methods: ['pgp', 'security-key'] }));
    tick(4 * 3_600_000 - 60_000);
    expect(document.body.textContent).toContain('Stay logged in?');
    expect(document.querySelector('#confirm-password')).toBeNull();
  });

  it('with no answer the person is logged out when the time is up', async () => {
    handler = (url) => (url === '/v1/logout' ? json(200, { ok: true }) : undefined);
    render(<MemoryRouter><SessionPrompt /></MemoryRouter>);
    act(() => publishSessionWatch({ info: info(), methods: ['passkey'] }));
    tick(4 * 3_600_000 - 60_000);
    expect(document.body.textContent).toContain('Stay logged in?');
    tick(61_000);
    await settle();
    expect(calls.map((c) => [c.method, c.url])).toEqual([['POST', '/v1/logout']]);
    expect(document.body.textContent).toContain("You're logged out");
    expect(document.body.textContent).toContain('Your session time ran out. Log in again to keep trading.');
  });

  it('"Log out" ends the session at once', async () => {
    handler = (url) => (url === '/v1/logout' ? json(200, { ok: true }) : undefined);
    render(<MemoryRouter><SessionPrompt /></MemoryRouter>);
    act(() => publishSessionWatch({ info: info(), methods: ['passkey'] }));
    tick(4 * 3_600_000 - 60_000);
    click(document.querySelector('[data-part="session-log-out"]'));
    await settle();
    expect(calls.map((c) => [c.method, c.url])).toEqual([['POST', '/v1/logout']]);
  });

  it('a session the server says cannot extend: no prompt, logged out at the end', async () => {
    handler = (url) => (url === '/v1/logout' ? json(200, { ok: true }) : undefined);
    render(<MemoryRouter><SessionPrompt /></MemoryRouter>);
    act(() => publishSessionWatch({ info: info({ canExtend: false }), methods: ['password'] }));
    tick(4 * 3_600_000 - 60_000);
    expect(document.body.textContent).not.toContain('Stay logged in?');
    tick(61_000);
    await settle();
    expect(document.body.textContent).toContain("You're logged out");
  });
});

describe('Devices board: "Stay logged in for"', () => {
  it("shows this session's length and changes it", async () => {
    handler = (url, init) => {
      if (url === '/v1/account/sessions') return json(200, []);
      if (url === '/v1/account/security/devices') return json(200, { oneDevice: false, maxDevices: 3 });
      if (url === '/v1/account/me') return json(200, { ...ME, session: info({ lengthHours: 6 }) });
      if (url === '/v1/account/session/length' && init?.method === 'PUT') return json(200, info({ lengthHours: 2 }));
      return undefined;
    };
    const { host } = render(<MemoryRouter><Devices /></MemoryRouter>);
    await settle();
    const select = part(host, 'session-length-select') as HTMLSelectElement;
    expect(select.value).toBe('6');
    expect(host.textContent).toContain("Longer sessions so you don't miss a trade while you sleep.");
    choose(select, '2');
    await settle();
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([{ url: '/v1/account/session/length', method: 'PUT', body: { hours: 2 } }]);
    expect(select.value).toBe('2');
  });
});
