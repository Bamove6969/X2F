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
import { currentSessionWatch, publishSessionWatch, resetSessionWatch } from '../src/session/sessionWatch.js';
import { currentIdleReminder, resetIdleReminder } from '../src/session/idleReminderWatch.js';
import { fire, render } from './render.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Handler = (url: string, init: RequestInit | undefined) => Response | undefined;

/** BroadcastChannel between "tabs" of one test: delivers to every other open channel of the same name. */
class FakeChannel {
  static all = new Set<FakeChannel>();
  onmessage: ((e: { data: unknown }) => void) | null = null;
  posted: unknown[] = [];
  constructor(readonly name: string) {
    FakeChannel.all.add(this);
  }
  postMessage(data: unknown) {
    this.posted.push(data);
    for (const c of [...FakeChannel.all]) if (c !== this && c.name === this.name) c.onmessage?.({ data });
  }
  close() {
    FakeChannel.all.delete(this);
  }
}
let handler: Handler;
let calls: Array<{ url: string; method: string; body: unknown }>;

const T0 = Date.parse('2026-11-02T12:00:00Z');
const info = (o: Partial<SessionInfo> = {}): SessionInfo => ({
  lengthHours: 4, choices: [2, 4, 8, 12], expiresAt: new Date(T0 + 4 * 3_600_000).toISOString(), canExtend: true, serverNow: new Date(T0).toISOString(), ...o,
});
const ME = { displayName: 'mira.k', needsLoginName: false, kind: 'trader', level: 'full', methods: ['pgp'], hasBackup: false, suggestions: [], termsCurrent: true };

beforeEach(() => {
  calls = [];
  handler = () => undefined;
  resetSessionWatch();
  resetIdleReminder();
  FakeChannel.all.clear();
  vi.stubGlobal('BroadcastChannel', FakeChannel);
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

/** Confirms it's you in the open prompt with the PGP key: asks for the message, pastes the code, taps Confirm. */
async function confirmWithPgp(): Promise<void> {
  click(document.querySelector('[data-method="pgp"]'));
  await settle();
  type(document.querySelector('[data-method="pgp-code"] input[aria-label="Login code"]'), '123456');
  const confirm = [...document.querySelectorAll('[data-method="pgp-code"] button')].find((b) => b.textContent === 'Confirm')!;
  click(confirm);
  await settle();
}

/** The PGP confirm's two steps, answered. */
function pgpConfirm(url: string, init: RequestInit | undefined): Response | undefined {
  if (url === '/v1/confirm/pgp/start' && init?.method === 'POST') return json(200, { challengeId: 'ch', encryptedMessage: '-----BEGIN PGP MESSAGE-----' });
  if (url === '/v1/confirm/pgp/finish' && init?.method === 'POST') return json(200, { confirmToken: 'tok' });
  return undefined;
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

  it('sets up the warning and the idle reminder with the full me, methods included (review 3)', async () => {
    const session = info();
    handler = (url) =>
      url === '/v1/account/me'
        ? json(200, { ...ME, methods: ['pgp', 'passkey'], idleReminderMinutes: 30, session })
        : url.startsWith('/v1/news') ? json(200, []) : undefined;
    await afterLogin(() => undefined, '/wallets');
    expect(currentSessionWatch()).toEqual({ info: session, methods: ['pgp', 'passkey'] });
    expect(currentIdleReminder()).toBe(30);
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
      if (url === '/v1/account/session/length' && init?.method === 'PUT') return json(200, info({ lengthHours: 8 }));
      return undefined;
    };
    const { host } = mount();
    await settle();
    expect(host.textContent).toContain("You're logged in as mira.k.");
    const select = part(host, 'session-length-select') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(select.tagName).toBe('SELECT');
    expect([...select.options].map((o) => o.textContent)).toEqual(['Choose a time', '2 hours', '4 hours', '8 hours', '12 hours']);
    const go = part(host, 'session-length-continue') as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    expect(host.textContent).toContain('Pick a time to continue.');
    choose(select, '8');
    expect(go.disabled).toBe(false);
    click(go);
    await settle();
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([{ url: '/v1/account/session/length', method: 'PUT', body: { hours: 8 } }]);
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

  it(`warns ${SESSION_PROMPT_MS / 60_000} minutes before the end (owner Q73) and extends with a login method through a confirm token`, async () => {
    handler = (url, init) => {
      const confirm = pgpConfirm(url, init);
      if (confirm) return confirm;
      if (url === '/v1/account/session/extend' && init?.method === 'POST') return json(200, info({ expiresAt: new Date(T0 + 8 * 3_600_000).toISOString() }));
      return undefined;
    };
    const { host } = render(<MemoryRouter><SessionPrompt /></MemoryRouter>);
    act(() => publishSessionWatch({ info: info(), methods: ['pgp'] }));
    expect(SESSION_PROMPT_MS).toBe(5 * 60_000);
    tick(4 * 3_600_000 - SESSION_PROMPT_MS - 2_000);
    expect(document.body.textContent).not.toContain('Stay logged in?');
    tick(3_000);
    expect(document.body.textContent).toContain('Stay logged in?');
    // Review M2: no fixed "5 minutes" or stored length in the words; the countdown tells the time.
    expect(document.body.textContent).toContain("Your session is about to end. Confirm it's you to stay logged in.");
    expect(document.body.textContent).not.toContain('5 minutes');
    // Kit handoff 1.5 timer rule (on main since 2af5a10b): parts, no colon.
    expect(document.querySelector('[data-part="session-countdown"]')?.textContent).toContain('Logging out in 4 min 59 s');
    // The same choices as at login, the session's own length picked.
    const select = document.querySelector('[data-part="session-extend"] [data-part="session-length-select"]') as HTMLSelectElement;
    expect([...select.options].filter((o) => !o.disabled).map((o) => o.value)).toEqual(['2', '4', '8', '12']);
    expect(select.value).toBe('4');
    await confirmWithPgp();
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['POST', '/v1/confirm/pgp/start', { action: { kind: 'extend-session' } }],
      ['POST', '/v1/confirm/pgp/finish', { challengeId: 'ch', code: '123456' }],
      ['POST', '/v1/account/session/extend', { confirmToken: 'tok', hours: 4 }],
    ]);
    expect(document.body.textContent).toContain("You're logged in for another 4 h.");
    // The new end is watched: no prompt until 5 minutes before it.
    tick(3 * 3_600_000);
    expect(document.body.textContent).not.toContain('Stay logged in?');
    expect(host).toBeTruthy();
  });

  it('the new token from an extend (review S-m1) needs nothing from the page: past the old end, no logout and no re-check', async () => {
    // The server sets the new session cookie on the extend's answer; the browser swaps it. The page
    // keeps no token of its own, so it only has to watch the new end: nothing at the old one.
    handler = (url, init) => {
      const confirm = pgpConfirm(url, init);
      if (confirm) return confirm;
      if (url === '/v1/account/session/extend' && init?.method === 'POST') return json(200, info({ expiresAt: new Date(T0 + 8 * 3_600_000).toISOString() }));
      return undefined;
    };
    render(<MemoryRouter><SessionPrompt /></MemoryRouter>);
    act(() => publishSessionWatch({ info: info(), methods: ['pgp'] }));
    tick(4 * 3_600_000 - 60_000);
    await confirmWithPgp();
    const sent = calls.length;
    // Past the old end (4 h): no logout, no "You're logged out", no call at all.
    tick(2 * 60_000);
    await settle();
    expect(calls.slice(sent)).toEqual([]);
    expect(document.body.textContent).not.toContain("You're logged out");
    expect(currentSessionWatch()?.info.expiresAt).toBe(new Date(T0 + 8 * 3_600_000).toISOString());
  });

  it('extends for another of the login choices when the person picks one', async () => {
    handler = (url, init) => {
      const confirm = pgpConfirm(url, init);
      if (confirm) return confirm;
      if (url === '/v1/account/session/extend' && init?.method === 'POST') {
        return json(200, info({ lengthHours: 12, expiresAt: new Date(T0 + 16 * 3_600_000).toISOString() }));
      }
      return undefined;
    };
    render(<MemoryRouter><SessionPrompt /></MemoryRouter>);
    act(() => publishSessionWatch({ info: info(), methods: ['pgp'] }));
    tick(4 * 3_600_000 - 60_000);
    choose(document.querySelector('[data-part="session-extend"] [data-part="session-length-select"]'), '12');
    await confirmWithPgp();
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
    expect(document.querySelector('[data-method="pgp"]')).not.toBeNull();
    expect(document.querySelector('[data-method="security-key"]')).not.toBeNull();
  });

  it('with no answer the person is logged out when the time is up', async () => {
    handler = (url) => (url === '/v1/logout' ? json(200, { ok: true }) : url === '/v1/account/me' ? json(401, { error: 'not-authenticated' }) : undefined);
    render(<MemoryRouter><SessionPrompt /></MemoryRouter>);
    act(() => publishSessionWatch({ info: info(), methods: ['passkey'] }));
    tick(4 * 3_600_000 - 60_000);
    expect(document.body.textContent).toContain('Stay logged in?');
    tick(61_000);
    await settle();
    // Review 2: it asks the server first whether another tab extended the session.
    expect(calls.map((c) => [c.method, c.url])).toEqual([['GET', '/v1/account/me'], ['POST', '/v1/logout']]);
    expect(document.body.textContent).toContain("You're logged out");
    expect(document.body.textContent).toContain('Your session time ran out. Log in again to keep trading.');
  });

  it('another tab extended the session: at the old end it re-reads me, watches the new end and stays logged in (review 2)', async () => {
    const later = info({ expiresAt: new Date(T0 + 8 * 3_600_000).toISOString() });
    // The server answers with its time as it reads (now).
    handler = (url) =>
      url === '/v1/account/me'
        ? json(200, { ...ME, methods: ['passkey'], session: { ...later, serverNow: new Date(Date.now()).toISOString() } })
        : url === '/v1/logout' ? json(200, { ok: true }) : undefined;
    render(<MemoryRouter><SessionPrompt /></MemoryRouter>);
    act(() => publishSessionWatch({ info: info(), methods: ['passkey'] }));
    tick(4 * 3_600_000 - 60_000);
    expect(document.body.textContent).toContain('Stay logged in?');
    tick(61_000);
    await settle();
    expect(calls.map((c) => [c.method, c.url])).toEqual([['GET', '/v1/account/me']]);
    expect(document.body.textContent).not.toContain("You're logged out");
    expect(document.body.textContent).not.toContain('Stay logged in?');
    expect(currentSessionWatch()?.info.expiresAt).toBe(later.expiresAt);
    // The new end is watched: the prompt comes again 5 minutes before it.
    tick(4 * 3_600_000 - SESSION_PROMPT_MS - 3_000);
    expect(document.body.textContent).not.toContain('Stay logged in?');
    tick(3_000);
    expect(document.body.textContent).toContain('Stay logged in?');
  });

  it('tabs share an extended end (review 2): an extend in one tab closes the prompt in the others', async () => {
    handler = (url, init) => {
      const confirm = pgpConfirm(url, init);
      if (confirm) return confirm;
      if (url === '/v1/account/session/extend' && init?.method === 'POST') return json(200, info({ expiresAt: new Date(T0 + 8 * 3_600_000).toISOString() }));
      return undefined;
    };
    render(<MemoryRouter><SessionPrompt /></MemoryRouter>);
    act(() => publishSessionWatch({ info: info(), methods: ['pgp'] }));
    tick(4 * 3_600_000 - 60_000);
    expect(document.body.textContent).toContain('Stay logged in?');
    // Another tab extends: its end reaches this one, which goes back to waiting.
    const other = new FakeChannel('x2f-session');
    // The other tab's answer carries the server's time as it extended (now).
    const later = info({ expiresAt: new Date(T0 + 12 * 3_600_000).toISOString(), lengthHours: 12, serverNow: new Date(Date.now()).toISOString() });
    act(() => other.postMessage({ type: 'session-info', info: later }));
    expect(document.body.textContent).not.toContain('Stay logged in?');
    expect(currentSessionWatch()).toEqual({ info: later, methods: ['pgp'] });
    // This tab's own extend is sent to the others.
    tick(8 * 3_600_000 - 60_000);
    await confirmWithPgp();
    expect(other.posted).toHaveLength(1);
    expect(FakeChannel.all.size).toBe(2);
    const mine = [...FakeChannel.all].find((c) => c !== other)!;
    expect(mine.posted).toEqual([{ type: 'session-info', info: info({ expiresAt: new Date(T0 + 8 * 3_600_000).toISOString() }) }]);
  });

  it('an authenticator app never confirms: staying logged in offers the login methods only (owner, 26 Nov 2026)', async () => {
    handler = () => undefined;
    render(<MemoryRouter><SessionPrompt /></MemoryRouter>);
    act(() => publishSessionWatch({ info: info(), methods: ['pgp', 'totp'] }));
    tick(4 * 3_600_000 - 60_000);
    expect(document.querySelector('[data-method="pgp"]')).not.toBeNull();
    expect(document.querySelector('#confirm-totp')).toBeNull();
    expect(document.querySelector('[data-method="totp"]')).toBeNull();
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
    act(() => publishSessionWatch({ info: info({ canExtend: false }), methods: ['pgp'] }));
    tick(4 * 3_600_000 - 60_000);
    expect(document.body.textContent).not.toContain('Stay logged in?');
    tick(61_000);
    await settle();
    expect(document.body.textContent).toContain("You're logged out");
  });
});

describe('Devices board: "Stay logged in for"', () => {
  it("shows this session's length and changes it (this session only, owner F18)", async () => {
    handler = (url, init) => {
      if (url === '/v1/account/sessions') return json(200, []);
      if (url === '/v1/account/security/devices') return json(200, { oneDevice: false, maxDevices: 3 });
      if (url === '/v1/account/me') return json(200, { ...ME, session: info({ lengthHours: 8 }) });
      if (url === '/v1/account/session/length' && init?.method === 'PUT') return json(200, info({ lengthHours: 2 }));
      return undefined;
    };
    const { host } = render(<MemoryRouter><Devices /></MemoryRouter>);
    await settle();
    const select = part(host, 'session-length-select') as HTMLSelectElement;
    expect(select.value).toBe('8');
    expect(host.textContent).toContain("Longer sessions so you don't miss a trade while you sleep.");
    choose(select, '2');
    await settle();
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([{ url: '/v1/account/session/length', method: 'PUT', body: { hours: 2 } }]);
    expect(select.value).toBe('2');
    expect(host.textContent).toContain('Saved.');
  });

  it('a time that ends later asks to confirm it\'s you, then starts now (owner G24)', async () => {
    const extended = info({ lengthHours: 12, expiresAt: new Date(T0 + 12 * 3_600_000).toISOString() });
    handler = (url, init) => {
      if (url === '/v1/account/sessions') return json(200, []);
      if (url === '/v1/account/security/devices') return json(200, { oneDevice: false, maxDevices: 3 });
      if (url === '/v1/account/me') return json(200, { ...ME, session: info() });
      if (url === '/v1/account/session/length' && init?.method === 'PUT') return json(403, { error: 'confirm-required', action: 'extend-session' });
      if (url === '/v1/account/session/extend' && init?.method === 'POST') return json(200, extended);
      return undefined;
    };
    const asked: unknown[] = [];
    const { host } = render(
      <MemoryRouter>
        <Devices prove={async (a) => (asked.push(a), 'tok')} />
      </MemoryRouter>,
    );
    await settle();
    choose(part(host, 'session-length-select'), '12');
    await settle();
    expect(asked).toEqual([{ kind: 'extend-session' }]);
    expect(calls.filter((c) => c.method !== 'GET').map((c) => [c.method, c.url, c.body])).toEqual([
      ['PUT', '/v1/account/session/length', { hours: 12 }],
      ['POST', '/v1/account/session/extend', { confirmToken: 'tok', hours: 12 }],
    ]);
    expect((part(host, 'session-length-select') as HTMLSelectElement).value).toBe('12');
    expect(currentSessionWatch()?.info).toEqual(extended);
    expect(host.textContent).toContain('Saved.');
  });
});
