// @vitest-environment happy-dom
// Owner ruling of 9 Nov 2026 on the recovery code, on the web side, against a stubbed API:
// S-111 (p11-36): after a code is used the person is told it is burned and to get a new one in
// Security settings. (S-110, the password change form, went with passwords on 26 Nov 2026.)
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupLogin } from '../src/screens/auth/BackupLogin.js';
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
    answer = (url) => (url === '/v1/login/backup' ? json(200, { status: 'ok' }) : json(500, { error: 'internal' }));
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
