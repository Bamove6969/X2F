// @vitest-environment happy-dom
// Owner rulings of 9 Nov 2026 on the recovery code, on the web side, against a stubbed API:
// - S-110 (p11-35): the password change form takes the recovery code (optional); with it the change
//   applies at once.
// - S-111 (p11-36): after a code is used the person is told it is burned and to get a new one in
//   Security settings (after a backup login, and after the password change that used it).
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupLogin } from '../src/screens/auth/BackupLogin.js';
import { AddPassword } from '../src/screens/settings/Methods.js';
import { BURNED_CODE_COPY } from '../src/screens/settings/recoveryCopy.js';
import { fire, render } from './render.js';

let calls: { url: string; method: string; body: unknown }[];
let answer: (url: string, body: Record<string, unknown> | undefined) => Response;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  calls = [];
  answer = () => json(500, { error: 'internal' });
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url: input, method: init.method ?? 'GET', body });
    return answer(input, body);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });

function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  set.call(input, value);
  fire(input, new Event('input', { bubbles: true }));
}

const click = (el: Element) => fire(el, new MouseEvent('click', { bubbles: true }));

describe('S-111: a used recovery code is burned', () => {
  it('after a backup login the screen says the code is burned and where to get a new one', async () => {
    answer = (url) => (url === '/v1/login/backup' ? json(200, { status: 'ok', level: 'recovery', holdUntil: '2026-11-13T12:00:00.000Z' }) : json(500, { error: 'internal' }));
    const { host } = render(<MemoryRouter><BackupLogin /></MemoryRouter>);
    type(host.querySelector<HTMLInputElement>('#backup-login-name')!, 'nightowl');
    type(host.querySelector<HTMLInputElement>('#backup-code')!, 'ABCD-EFGH-JKMN-PQRT');
    click(host.querySelector('[data-part="backup-login"]')!);
    await settle();
    const notice = host.querySelector('[data-part="code-burned"]');
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain(BURNED_CODE_COPY.title);
    expect(notice!.textContent).toContain(BURNED_CODE_COPY.body);
  });
});

describe('S-110: the password change form takes the recovery code', () => {
  const prove = async () => 'confirm-token';

  it('with a code: sends it, and on success says the code is burned before closing', async () => {
    answer = (url, body) => {
      if (url !== '/v1/account/password') return json(500, { error: 'internal' });
      if (body?.confirmToken === undefined) return json(403, { error: 'confirm-required', action: 'set-password' });
      return json(200, { ok: true, recoveryCodeBurned: true });
    };
    const onDone = vi.fn();
    const { host } = render(<AddPassword prove={prove} onDone={onDone} onCancel={() => undefined} />);
    expect(host.querySelector('label[for="password-recovery-code"]')?.textContent).toBe(BURNED_CODE_COPY.passwordCodeLabel);
    type(host.querySelector<HTMLInputElement>('#new-password')!, 'Another-Horse-8');
    type(host.querySelector<HTMLInputElement>('#password-recovery-code')!, ' ABCD-EFGH-JKMN-PQRT ');
    click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Save')!);
    await settle();
    const put = calls.filter((c) => c.url === '/v1/account/password').at(-1)!;
    expect(put.method).toBe('PUT');
    expect(put.body).toEqual({ password: 'Another-Horse-8', recoveryCode: 'ABCD-EFGH-JKMN-PQRT', confirmToken: 'confirm-token' });
    expect(host.querySelector('[data-part="code-burned"]')?.textContent).toContain(BURNED_CODE_COPY.body);
    expect(onDone).not.toHaveBeenCalled();
    click(host.querySelector('[data-part="code-burned-done"]')!);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('without a code: sends none and closes as before', async () => {
    answer = (url) => (url === '/v1/account/password' ? json(200, { ok: true }) : json(500, { error: 'internal' }));
    const onDone = vi.fn();
    const { host } = render(<AddPassword prove={prove} onDone={onDone} onCancel={() => undefined} />);
    type(host.querySelector<HTMLInputElement>('#new-password')!, 'Another-Horse-8');
    click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Save')!);
    await settle();
    expect(calls.find((c) => c.url === '/v1/account/password')?.body).toEqual({ password: 'Another-Horse-8' });
    expect(host.querySelector('[data-part="code-burned"]')).toBeNull();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('a wrong code reads as a code mismatch', async () => {
    answer = (url) => (url === '/v1/account/password' ? json(401, { error: 'credentials-invalid' }) : json(500, { error: 'internal' }));
    const { host } = render(<AddPassword prove={prove} onDone={() => undefined} onCancel={() => undefined} />);
    type(host.querySelector<HTMLInputElement>('#new-password')!, 'Another-Horse-8');
    type(host.querySelector<HTMLInputElement>('#password-recovery-code')!, 'ABCD-EFGH-JKMN-PQRT');
    click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Save')!);
    await settle();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(BURNED_CODE_COPY.passwordCodeWrong);
  });
});
