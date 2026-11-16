// @vitest-environment happy-dom
// Owner decision, 16 Nov 2026 (to-lead.log 17:38): the authenticator app (TOTP) is the password
// login's second factor, so Settings offers it only on an account with a password, and the
// password cannot be removed while the authenticator app is on (the API answers 409
// `totp-needs-password` and `password-has-totp`). It reverses signup round 3 behaviour 1.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Methods } from '../src/screens/settings/Methods.js';
import { PASSWORD_HAS_TOTP_MESSAGE, TOTP_NEEDS_PASSWORD_MESSAGE } from '../src/ui/cantDoCodes.js';
import { fire, render } from './render.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const entry = (type: string) => ({ type, id: ['password', 'totp', 'recovery-codes'].includes(type) ? type : `${type}-1`, label: '', createdAt: null, lastUsedAt: null });
let methods: ReturnType<typeof entry>[] = [];
const seen: string[] = [];

beforeEach(() => {
  seen.length = 0;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    seen.push(`${init.method ?? 'GET'} ${url}`);
    if (url === '/v1/account/methods') return json(200, methods);
    return json(500, { error: 'internal' });
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
const click = (el: Element | null) => fire(el!, new MouseEvent('click', { bubbles: true }));

async function shown(types: string[]) {
  methods = types.map(entry);
  const { host } = render(<Methods prove={async () => 'tok'} />);
  await flush();
  return host;
}

describe('Settings: the authenticator app goes with a password (owner, 16 Nov 2026)', () => {
  it('without a password there is no "Add an authenticator app"', async () => {
    const host = await shown(['pgp', 'passkey']);
    expect(host.querySelector('[data-add="password"]')).not.toBeNull();
    expect(host.querySelector('[data-add="totp"]')).toBeNull();
  });

  it('with a password it is offered', async () => {
    const host = await shown(['pgp', 'password']);
    expect(host.querySelector('[data-add="totp"]')).not.toBeNull();
  });

  it('removing the password while the authenticator app is on is refused here, before any confirm or call', async () => {
    const host = await shown(['pgp', 'password', 'totp']);
    click(host.querySelector('[data-method="password"] [data-part="remove"]'));
    await flush();
    expect(host.textContent).toContain(PASSWORD_HAS_TOTP_MESSAGE);
    expect(seen.filter((s) => s.startsWith('DELETE'))).toEqual([]);
  });

  it('the refusal words are short and say what to do', () => {
    expect(PASSWORD_HAS_TOTP_MESSAGE).toMatch(/authenticator app/);
    expect(TOTP_NEEDS_PASSWORD_MESSAGE).toMatch(/password/);
  });
});
