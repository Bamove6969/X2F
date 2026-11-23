// @vitest-environment happy-dom
// Owner demo note #94 (16 Nov 2026): a security key is tested right after it is added, in Settings
// → Security too (Methods). The ceremonies are stubbed (addWebAuthnKeyWithId, testWebAuthnKey);
// the real test against the API is packages/auth-client/test/keyTest.test.ts.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Methods } from '../src/screens/settings/Methods.js';
import { KEY_TEST_COPY, keyTestErrorText } from '../src/screens/auth/KeyTest.js';
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

beforeEach(() => {
  staged = undefined;
  tested.length = 0;
  testResult = async () => undefined;
  vi.stubGlobal('fetch', async (url: string) => {
    if (url === '/v1/account/methods') return json(200, [{ type: 'pgp', id: 'pgp-1', label: '', createdAt: null, lastUsedAt: null }]);
    return json(500, { error: 'internal' });
  });
});
afterEach(() => vi.unstubAllGlobals());

const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
const click = (el: Element | null) => fire(el!, new MouseEvent('click', { bubbles: true }));

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
    click(host.querySelector('[data-add="security-key"]'));
    await flush();
    const added = host.querySelector('[data-part="key-just-added"]')!;
    expect(added.textContent).toContain('Security key added.');
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
    click(host.querySelector('[data-add="security-key"]'));
    await flush();
    click(host.querySelector('[data-part="key-test-run"]'));
    await flush();
    const r = host.querySelector('[data-part="key-test-result"]')!;
    expect(r.getAttribute('data-result')).toBe('fail');
    expect(r.getAttribute('role')).toBe('alert');
    expect(r.textContent).toMatch(/didn't respond/);
  });

  it('a passkey, or a staged security key, is not offered the test', async () => {
    let host = await shown();
    click(host.querySelector('[data-add="passkey"]'));
    await flush();
    expect(host.querySelector('[data-part="key-test"]')).toBeNull();
    staged = { status: 'staged', changeId: 'c1' };
    host = await shown();
    click(host.querySelector('[data-add="security-key"]'));
    await flush();
    expect(host.querySelector('[data-part="key-test"]')).toBeNull();
  });

  it('the words for each failure', async () => {
    const { KeyTestError } = await import('@x2f/auth-client');
    expect(keyTestErrorText(new KeyTestError('other-key'))).toBe(KEY_TEST_COPY.otherKey);
    expect(keyTestErrorText(new KeyTestError('not-listed'))).toBe(KEY_TEST_COPY.notListed);
    expect(keyTestErrorText(new Error('?'))).toBe(KEY_TEST_COPY.failed);
  });
});
