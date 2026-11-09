// @vitest-environment happy-dom
// Owner 1 Nov 2026 (register S-014; lead job J-09): the password screen has a live strength meter
// in words, and only "Strong" (the server's rule: 10+ characters with upper and lower case, a
// number and a symbol, not on the leaked list) can be set. Against a stubbed API.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL, SetupContext, type SetupApi, type SetupState } from '../src/screens/setup/kit.js';
import { Password, passwordStrength } from '../src/screens/setup/Password.js';
import { fire, render } from './render.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let route: (url: string, init: RequestInit) => Promise<Response>;

beforeEach(() => {
  route = async (url) => {
    if (url === '/v1/register/password') return json(400, { error: 'password-leaked' });
    return json(500, { error: 'internal' });
  };
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    return route(input, init);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });

const byPart = (host: ParentNode, part: string) => host.querySelector<HTMLElement>(`[data-part="${part}"]`);
const click = (el: Element | null) => fire(el!, new MouseEvent('click', { bubbles: true }));

function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  set.call(input, value);
  fire(input, new Event('input', { bubbles: true }));
}

function setup(state: Partial<SetupState> = {}): SetupApi {
  return {
    state: { ...INITIAL, terms: 'v1', displayName: 'Lumen.K', loginName: 'juniper.oak', ...state },
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

describe('S-014: the password strength meter', () => {
  it('words the strength of what is typed so far: Weak, Medium, Strong; nothing before typing', () => {
    expect(passwordStrength('', false)).toBeNull();
    expect(passwordStrength('abc', false)).toBe('weak');
    expect(passwordStrength('abcdefghijkl', false)).toBe('weak');
    // 4 of the 5 rules: no number.
    expect(passwordStrength('Correct-Horse', false)).toBe('medium');
    // 3 of the 5 rules: too short and no symbol.
    expect(passwordStrength('Horse9', false)).toBe('medium');
    expect(passwordStrength('Correct-Horse-9', false)).toBe('strong');
    // A password on the leaked list is weak, whatever it looks like.
    expect(passwordStrength('Correct-Horse-9', true)).toBe('weak');
    expect(passwordStrength(`Aa1!${'x'.repeat(300)}`, false)).not.toBe('strong');
  });

  it('updates live as the person types, and only Strong (typed twice) can be set', () => {
    const host = show(<Password />, setup());
    const pw = host.querySelector<HTMLInputElement>('#pw')!;
    const again = host.querySelector<HTMLInputElement>('#pw2')!;
    expect(byPart(host, 'password-meter')).toBeNull();
    type(pw, 'horse');
    const meter = byPart(host, 'password-meter')!;
    expect(meter.getAttribute('role')).toBe('status');
    expect(meter.textContent).toBe('Strength: Weak');
    expect(meter.getAttribute('data-level')).toBe('weak');
    type(pw, 'Correct-Horse');
    type(again, 'Correct-Horse');
    expect(byPart(host, 'password-meter')!.textContent).toBe('Strength: Medium');
    expect(byPart(host, 'password-set')!.hasAttribute('disabled')).toBe(true);
    type(pw, 'Correct-Horse-9');
    expect(byPart(host, 'password-meter')!.textContent).toBe('Strength: Strong');
    expect(byPart(host, 'password-set')!.hasAttribute('disabled')).toBe(true);
    type(again, 'Correct-Horse-9');
    expect(byPart(host, 'password-set')!.hasAttribute('disabled')).toBe(false);
  });

  it('a password the server finds on the leaked list drops to Weak until it changes', async () => {
    const host = show(<Password />, setup());
    type(host.querySelector<HTMLInputElement>('#pw')!, 'Correct-Horse-9');
    type(host.querySelector<HTMLInputElement>('#pw2')!, 'Correct-Horse-9');
    click(byPart(host, 'password-set'));
    await flush();
    expect(byPart(host, 'password-meter')!.textContent).toBe('Strength: Weak');
    expect(byPart(host, 'password-set')!.hasAttribute('disabled')).toBe(true);
    type(host.querySelector<HTMLInputElement>('#pw')!, 'Correct-Horse-10');
    expect(byPart(host, 'password-meter')!.textContent).toBe('Strength: Strong');
  });
});

