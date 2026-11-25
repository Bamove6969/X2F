// @vitest-environment happy-dom
// Owner demo note #94 (16 Nov 2026): a security key is tested right after it is added, in Settings
// → Security too (Methods). The ceremonies are stubbed (addWebAuthnKeyWithId, testWebAuthnKey);
// the real test against the API is packages/auth-client/test/keyTest.test.ts.
// Owner 25 Nov security-key report: the key added is first acknowledged ("Security key saved") and
// named (PUT /v1/account/webauthn/label); the name then shows in the list, and the test follows.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Methods } from '../src/screens/settings/Methods.js';
import { KEY_TEST_COPY, keyTestErrorText } from '../src/screens/auth/KeyTest.js';
import { KEY_TEST_RECOVERY } from '../src/ui/cantDoCodes.js';
import { fire, render } from './render.js';

let staged: unknown = undefined;
const tested: string[] = [];
let testResult: () => Promise<void> = async () => undefined;
vi.mock('@x2f/auth-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@x2f/auth-client')>()),
  addWebAuthnKeyWithId: async (_api: unknown, kind: string) => ({ staged, credentialId: `CRED-${kind}` }),
  testWebAuthnKey: async (_api: unknown, credentialId: string) => {
    tested.push(credentialId);
    return testResult();
  },
}));

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

type Entry = { type: string; id: string; label: string; createdAt: null; lastUsedAt: null };
let list: Entry[] = [];
const renames: unknown[] = [];

beforeEach(() => {
  staged = undefined;
  tested.length = 0;
  renames.length = 0;
  testResult = async () => undefined;
  list = [{ type: 'pgp', id: 'pgp-1', label: '', createdAt: null, lastUsedAt: null }];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url === '/v1/account/methods') return json(200, list);
    if (url === '/v1/account/webauthn/label' && init?.method === 'PUT') {
      const b = JSON.parse(String(init.body)) as { credentialId: string; label: string };
      renames.push(b);
      list = list.map((m) => (m.id === b.credentialId ? { ...m, label: b.label } : m));
      return json(200, { label: b.label });
    }
    return json(500, { error: 'internal' });
  });
});

/** The add stub's key, as the list then shows it (the server's default label until named). */
function listed(kind: string) {
  list = [...list, { type: kind, id: `CRED-${kind}`, label: kind === 'passkey' ? 'Passkey' : 'Security key', createdAt: null, lastUsedAt: null }];
}
afterEach(() => vi.unstubAllGlobals());

const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
const click = (el: Element | null) => fire(el!, new MouseEvent('click', { bubbles: true }));
function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  fire(input, new Event('input', { bubbles: true }));
}
/** Adds a `kind` key and saves the suggested name. */
async function addAndName(host: HTMLElement, kind: 'security-key' | 'passkey') {
  listed(kind);
  click(host.querySelector(`[data-add="${kind}"]`));
  await flush();
  click(host.querySelector('[data-part="key-name-save"]'));
  await flush();
}

async function shown() {
  const { host } = render(
    <MemoryRouter>
      <Methods prove={async () => 'tok'} />
    </MemoryRouter>,
  );
  await flush();
  return host;
}

describe('note #94 in Settings: test a security key right after adding it', () => {
  it('after "Add a security key" it offers the test, runs it on that key and shows the result inline', async () => {
    const host = await shown();
    expect(host.querySelector('[data-part="key-test"]')).toBeNull();
    listed('security-key');
    click(host.querySelector('[data-add="security-key"]'));
    await flush();
    const added = host.querySelector('[data-part="key-just-added"]')!;
    expect(added.querySelector('[data-part="key-saved"]')!.textContent).toBe('Security key saved');
    // Named first: "Security key 1", the account's first; the test comes once it is named.
    const input = added.querySelector<HTMLInputElement>('[data-part="key-name-input"]')!;
    expect(input.value).toBe('Security key 1');
    expect(added.querySelector('[data-part="key-test-run"]')).toBeNull();
    type(input, ' Work  YubiKey ');
    click(added.querySelector('[data-part="key-name-save"]'));
    await flush();
    expect(renames).toEqual([{ credentialId: 'CRED-security-key', label: 'Work YubiKey' }]);
    expect(added.querySelector('[data-part="key-name"]')!.textContent).toContain('Work YubiKey');
    // The list shows the name.
    const rows = [...host.querySelectorAll('[data-method="security-key"] .x2f-list__label')].map((e) => e.textContent);
    expect(rows).toEqual(['Work YubiKey']);
    click(added.querySelector('[data-part="key-test-run"]'));
    await flush();
    expect(tested).toEqual(['CRED-security-key']);
    expect(added.querySelector('[data-part="key-test-result"]')!.getAttribute('data-result')).toBe('ok');
    expect(added.querySelector('[data-part="key-test-result"]')!.textContent).toBe(KEY_TEST_COPY.passed);
  });

  it('a failed test says why, inline', async () => {
    testResult = async () => {
      throw Object.assign(new Error('x'), { name: 'NotAllowedError', code: 'ERROR_CEREMONY_ABORTED' });
    };
    const host = await shown();
    await addAndName(host, 'security-key');
    click(host.querySelector('[data-part="key-test-run"]'));
    await flush();
    const r = host.querySelector('[data-part="key-test-result"]')!;
    expect(r.getAttribute('data-result')).toBe('fail');
    expect(r.getAttribute('role')).toBe('alert');
    expect(r.textContent).toMatch(/didn't respond/);
  });

  it('a passkey is saved and named too, with no test; a staged security key is neither named nor tested', async () => {
    let host = await shown();
    await addAndName(host, 'passkey');
    expect(host.querySelector('[data-part="key-saved"]')!.textContent).toBe('Passkey saved');
    expect(renames).toEqual([{ credentialId: 'CRED-passkey', label: 'Passkey 1' }]);
    expect(host.querySelector('[data-part="key-test"]')).toBeNull();
    // Done closes it.
    click(host.querySelector('[data-part="key-continue"]'));
    expect(host.querySelector('[data-part="key-just-added"]')).toBeNull();
    staged = { status: 'staged', changeId: 'c1' };
    host = await shown();
    click(host.querySelector('[data-add="security-key"]'));
    await flush();
    expect(host.querySelector('[data-part="key-test"]')).toBeNull();
    expect(host.querySelector('[data-part="key-name-input"]')).toBeNull();
  });

  it('the words for each failure', async () => {
    const { KeyTestError } = await import('@x2f/auth-client');
    expect(keyTestErrorText(new KeyTestError('other-key'))).toBe(KEY_TEST_COPY.otherKey);
    expect(keyTestErrorText(new KeyTestError('not-listed'))).toBe(KEY_TEST_COPY.notListed);
    expect(keyTestErrorText(new Error('?'))).toBe(KEY_TEST_COPY.failed);
    // Review L1: a backup (recovery) session cannot run the test: said plainly.
    const { AuthApiError } = await import('@x2f/auth-client');
    expect(keyTestErrorText(new AuthApiError(403, 'recovery-session'))).toBe(KEY_TEST_RECOVERY);
  });
});
