// @vitest-environment happy-dom
// Sign-up names (design real-app review item 6; design gaps Job 1; owner Q54, G6, G14): step 1
// asks for ONE private username (the login name) with a live "is available" tick; the public
// display name follows on its own screen. Against a stubbed API.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECK_DELAY_MS } from '../src/screens/setup/availability.js';
import { DisplayName } from '../src/screens/setup/DisplayName.js';
import { INITIAL, SetupContext, type SetupApi, type SetupState } from '../src/screens/setup/kit.js';
import { Username } from '../src/screens/setup/Username.js';
import { fire, render } from './render.js';

interface Call {
  url: string;
  body: unknown;
}

let calls: Call[];
/** What the stubbed name check answers, by name; a function may hold its answer back. */
let answer: (name: string) => Promise<Response>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  calls = [];
  answer = async (name) => json(200, { available: name !== 'taken.name' });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url: input, body });
    if (input === '/v1/register/name-check') return answer((body as { loginName: string }).loginName);
    return json(500, { error: 'internal' });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const wait = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

const byPart = (host: ParentNode, part: string) => host.querySelector(`[data-part="${part}"]`);

function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  set.call(input, value);
  fire(input, new Event('input', { bubbles: true }));
}

function setup(state: Partial<SetupState> = {}) {
  const api: SetupApi = {
    state: { ...INITIAL, terms: 'v1', ...state },
    update: vi.fn(),
    returnTo: '/sell',
    go: vi.fn(),
    path: (s) => `/setup/${s}`,
  };
  return api;
}

function show(screen: 'username' | 'display', api: SetupApi) {
  return render(
    <MemoryRouter>
      <SetupContext.Provider value={api}>{screen === 'username' ? <Username /> : <DisplayName />}</SetupContext.Provider>
    </MemoryRouter>,
  ).host;
}

const checks = () => calls.filter((c) => c.url === '/v1/register/name-check');

describe('step 1: one private username with a live tick', () => {
  it('asks for one field only, the private username, and says nobody sees it', () => {
    const host = show('username', setup());
    expect(host.querySelectorAll('input').length).toBe(1);
    expect(host.querySelector('#login-name')).toBeNull();
    expect(host.querySelector('label[for="uname"]')?.textContent).toBe('Username');
    expect(host.querySelector('#uname')?.getAttribute('autocomplete')).toBe('username');
    expect(host.textContent).toContain('You type this to log in. Only you see it.');
    expect(host.textContent).not.toContain('Traders will see');
  });

  it('checks a well-formed name once the typing pauses, and shows "<name> is available"', async () => {
    const host = show('username', setup());
    type(host.querySelector<HTMLInputElement>('#uname')!, 'juniper.oak');
    await wait(CHECK_DELAY_MS - 50);
    expect(checks()).toEqual([]);
    await wait(100);
    expect(checks()).toEqual([{ url: '/v1/register/name-check', body: { loginName: 'juniper.oak' } }]);
    const line = byPart(host, 'name-status');
    expect(line?.textContent).toBe('juniper.oak is available');
    expect(line?.getAttribute('data-tone')).toBe('escrow');
  });

  it('only the name typed last is checked (no request per keystroke)', async () => {
    const host = show('username', setup());
    const input = host.querySelector<HTMLInputElement>('#uname')!;
    for (const v of ['junip', 'junipe', 'juniper', 'juniper.o', 'juniper.oak']) {
      type(input, v);
      await wait(100);
    }
    await wait(CHECK_DELAY_MS);
    expect(checks().map((c) => c.body)).toEqual([{ loginName: 'juniper.oak' }]);
  });

  it('a name of the wrong shape is never sent', async () => {
    const host = show('username', setup());
    type(host.querySelector<HTMLInputElement>('#uname')!, 'abc');
    await wait(CHECK_DELAY_MS * 2);
    type(host.querySelector<HTMLInputElement>('#uname')!, 'has space!');
    await wait(CHECK_DELAY_MS * 2);
    expect(checks()).toEqual([]);
    expect(byPart(host, 'name-status')).toBeNull();
  });

  it('a taken name says so and Continue stays on the step', async () => {
    const api = setup();
    const host = show('username', api);
    type(host.querySelector<HTMLInputElement>('#uname')!, 'taken.name');
    await wait(CHECK_DELAY_MS + 10);
    expect(byPart(host, 'name-status')?.textContent).toBe('taken.name is taken. Try another.');
    expect(byPart(host, 'name-status')?.getAttribute('data-tone')).toBe('danger');
    fire(byPart(host, 'names-continue')!, new MouseEvent('click', { bubbles: true }));
    expect(byPart(host, 'names-error')?.textContent).toBe('That username is taken. Pick another.');
    expect(api.go).not.toHaveBeenCalled();
  });

  it('when the check is paced or X2F is busy, the line is neutral and Continue still works (register checks again)', async () => {
    for (const reply of [json(429, { error: 'slow-down', retryAfterSeconds: 30 }), json(503, { error: 'busy', retryAfterSeconds: 6 })]) {
      answer = async () => reply;
      const api = setup();
      const host = show('username', api);
      type(host.querySelector<HTMLInputElement>('#uname')!, 'lumen.k');
      await wait(CHECK_DELAY_MS + 10);
      expect(byPart(host, 'name-status')?.textContent).toBe("We'll check it when you finish.");
      expect(byPart(host, 'name-status')?.getAttribute('data-tone')).toBe('neutral');
      fire(byPart(host, 'names-continue')!, new MouseEvent('click', { bubbles: true }));
      expect(api.go).toHaveBeenCalledWith('display-name');
    }
  });

  it('an answer for a name no longer in the box is ignored', async () => {
    let release!: (r: Response) => void;
    answer = (name) => (name === 'first.name' ? new Promise((r) => (release = r)) : Promise.resolve(json(200, { available: true })));
    const host = show('username', setup());
    const input = host.querySelector<HTMLInputElement>('#uname')!;
    type(input, 'first.name');
    await wait(CHECK_DELAY_MS + 10);
    type(input, 'second.name');
    await wait(CHECK_DELAY_MS + 10);
    expect(byPart(host, 'name-status')?.textContent).toBe('second.name is available');
    release(json(200, { available: false }));
    await wait(10);
    expect(byPart(host, 'name-status')?.textContent).toBe('second.name is available');
  });

  it('Continue keeps the private username and goes to the display name step', async () => {
    const api = setup();
    const host = show('username', api);
    type(host.querySelector<HTMLInputElement>('#uname')!, 'Juniper.Oak');
    await wait(CHECK_DELAY_MS + 10);
    fire(byPart(host, 'names-continue')!, new MouseEvent('click', { bubbles: true }));
    expect(api.update).toHaveBeenCalledWith({ loginName: 'Juniper.Oak', challenge: null });
    expect(api.go).toHaveBeenCalledWith('display-name');
  });

  it('a name of the wrong shape cannot continue', () => {
    const api = setup();
    const host = show('username', api);
    type(host.querySelector<HTMLInputElement>('#uname')!, 'abc');
    fire(byPart(host, 'names-continue')!, new MouseEvent('click', { bubbles: true }));
    expect(byPart(host, 'names-error')?.textContent).toBe('Your username needs 5 to 20 characters.');
    expect(api.go).not.toHaveBeenCalled();
  });
});

describe('the display name step', () => {
  it('previews what traders see and saves the public name', () => {
    const api = setup({ loginName: 'juniper.oak' });
    const host = show('display', api);
    expect(host.querySelectorAll('input').length).toBe(1);
    type(host.querySelector<HTMLInputElement>('#display-name')!, 'Lumen.K');
    expect(byPart(host, 'name-preview')?.textContent).toBe('Traders will see Lumen.K');
    fire(byPart(host, 'display-continue')!, new MouseEvent('click', { bubbles: true }));
    expect(api.update).toHaveBeenCalledWith({ displayName: 'Lumen.K', challenge: null });
    expect(api.go).toHaveBeenCalledWith('login');
  });

  it('must differ from the private username, ignoring case', () => {
    const api = setup({ loginName: 'juniper.oak' });
    const host = show('display', api);
    type(host.querySelector<HTMLInputElement>('#display-name')!, 'Juniper.Oak');
    fire(byPart(host, 'display-continue')!, new MouseEvent('click', { bubbles: true }));
    expect(byPart(host, 'display-error')?.textContent).toBe('Your display name must be different from your username.');
    expect(api.go).not.toHaveBeenCalled();
  });

  it('refuses reserved words and wrong shapes in the board words', () => {
    const api = setup({ loginName: 'juniper.oak' });
    const host = show('display', api);
    type(host.querySelector<HTMLInputElement>('#display-name')!, 'x2f-support');
    fire(byPart(host, 'display-continue')!, new MouseEvent('click', { bubbles: true }));
    expect(byPart(host, 'display-error')?.textContent).toBe('That display name is kept for X2F. Pick another.');
    type(host.querySelector<HTMLInputElement>('#display-name')!, 'ab');
    fire(byPart(host, 'display-continue')!, new MouseEvent('click', { bubbles: true }));
    expect(byPart(host, 'display-error')?.textContent).toBe('Your display name needs 5 to 20 characters.');
  });

  it('makes no availability request (display names are checked when the account is made)', () => {
    const host = show('display', setup({ loginName: 'juniper.oak' }));
    type(host.querySelector<HTMLInputElement>('#display-name')!, 'Lumen.K');
    expect(checks()).toEqual([]);
  });
});
