// @vitest-environment happy-dom
// The backup login is a recovery code only (design build gaps Job 1; board Login-Backup: "Your
// recovery code is your only backup"). No authenticator (TOTP) choice: that stays a normal login
// step with a password. Against a stubbed API.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupLogin } from '../src/screens/auth/BackupLogin.js';
import { fire, render } from './render.js';

let calls: { url: string; body: unknown }[];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url: input, body });
    if (input === '/v1/login/backup') return json(401, { error: 'credentials-invalid' });
    return json(500, { error: 'internal' });
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

describe('BackupLogin', () => {
  it('offers a recovery code only: no authenticator choice, no type switch', () => {
    const { host } = render(<MemoryRouter><BackupLogin /></MemoryRouter>);
    expect(host.querySelector('[data-kind="totp"]')).toBeNull();
    expect(host.querySelector('[aria-label="Backup type"]')).toBeNull();
    expect(host.textContent).not.toMatch(/authenticator/i);
    expect(host.querySelector('label[for="backup-code"]')?.textContent).toBe('A recovery code');
    expect(host.querySelector('#backup-code')?.getAttribute('autocomplete')).toBe('off');
  });

  it('sends kind recovery-code with the username and code', async () => {
    const { host } = render(<MemoryRouter><BackupLogin /></MemoryRouter>);
    type(host.querySelector<HTMLInputElement>('#backup-login-name')!, 'nightowl');
    type(host.querySelector<HTMLInputElement>('#backup-code')!, 'ABCD-EFGH-JKMN-PQRT');
    fire(host.querySelector('[data-part="backup-login"]')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(calls.find((c) => c.url === '/v1/login/backup')?.body).toEqual({
      loginName: 'nightowl', kind: 'recovery-code', code: 'ABCD-EFGH-JKMN-PQRT', deviceLabel: expect.any(String),
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("That login name and backup code don't match.");
  });
});
