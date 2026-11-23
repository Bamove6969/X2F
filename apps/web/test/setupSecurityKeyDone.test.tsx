// @vitest-environment happy-dom
// Owner, 16 Nov 2026 (demo): adding a security key worked, but the screen went straight on to the
// next step, so he could not tell it was set up. Like his 13 Nov note for the authenticator app
// ("it should turn green and say you have successfully setup..."): /setup/security-key now turns
// green, shows a security key, says it was added with the name the key was given, and waits for
// Continue. The ceremony itself is stubbed (addWebAuthnKeyWithId).
// Owner demo note #94 (16 Nov): "it should even have you test it after adding it": the added
// screen offers "Test this key now" (testWebAuthnKey, stubbed here; its real run against the API is
// packages/auth-client/test/keyTest.test.ts) and shows the result inline.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL, SetupContext, type SetupApi } from '../src/screens/setup/kit.js';
import { KeyStep } from '../src/screens/setup/MoreMethods.js';
import { fire, render } from './render.js';

const added: { kind: string; o: { label?: string } }[] = [];
let result: () => Promise<unknown> = async () => undefined;
const tested: string[] = [];
let testResult: () => Promise<void> = async () => undefined;
vi.mock('@x2f/auth-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@x2f/auth-client')>()),
  addWebAuthnKeyWithId: async (_api: unknown, kind: string, o: { label?: string }) => {
    added.push({ kind, o });
    return { staged: await result(), credentialId: 'CRED-NEW' };
  },
  testWebAuthnKey: async (_api: unknown, credentialId: string) => {
    tested.push(credentialId);
    return testResult();
  },
}));

beforeEach(() => {
  added.length = 0;
  tested.length = 0;
  result = async () => undefined;
  testResult = async () => undefined;
});
afterEach(() => vi.unstubAllGlobals());

const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
const byPart = (host: ParentNode, part: string) => host.querySelector<HTMLElement>(`[data-part="${part}"]`);
const click = (el: Element | null) => fire(el!, new MouseEvent('click', { bubbles: true }));
function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  fire(input, new Event('input', { bubbles: true }));
}

function setup(): SetupApi {
  return {
    state: { ...INITIAL, terms: { version: 'v1', signature: { kind: 'typed', name: 'AK' } }, displayName: 'lumen.k', loginName: 'lumen-login-7', registered: true, methods: ['pgp', 'security-key'], done: ['pgp'] },
    update: vi.fn(),
    returnTo: '/sell',
    go: vi.fn(),
    path: (s) => `/setup/${s}`,
  };
}

function show(api: SetupApi) {
  return render(
    <MemoryRouter>
      <SetupContext.Provider value={api}>
        <KeyStep kind="security-key" />
      </SetupContext.Provider>
    </MemoryRouter>,
  ).host;
}

describe('owner 16 Nov: a security key that was added says so before going on', () => {
  it('turns green with a security key picture and the key\'s name, and moves on only on Continue', async () => {
    const api = setup();
    const host = show(api);
    expect(byPart(host, 'key-done')).toBeNull();
    type(host.querySelector<HTMLInputElement>('#key-name')!, '  Blue YubiKey  ');
    click(byPart(host, 'key-add'));
    await flush();

    expect(added).toEqual([{ kind: 'security-key', o: { label: 'Blue YubiKey' } }]);
    const done = byPart(host, 'key-done')!;
    expect(done).not.toBeNull();
    expect(done.getAttribute('data-tone')).toBe('escrow');
    expect(byPart(done, 'key-picture')).not.toBeNull();
    expect(done.textContent).toContain('Security key added');
    expect(byPart(done, 'key-name')!.textContent).toBe('Blue YubiKey');
    // The add button and "Set up later" are gone; nothing moved on yet.
    expect(byPart(host, 'key-add')).toBeNull();
    expect(byPart(host, 'method-later')).toBeNull();
    expect(api.go).not.toHaveBeenCalled();
    expect(api.update).not.toHaveBeenCalled();

    click(byPart(host, 'key-continue'));
    expect(api.update).toHaveBeenCalledWith({ done: ['pgp', 'security-key'] });
    expect(api.go).toHaveBeenCalledTimes(1);
  });

  it('a key left unnamed shows the name the server gives it, "Security key"', async () => {
    const api = setup();
    const host = show(api);
    click(byPart(host, 'key-add'));
    await flush();
    expect(added).toEqual([{ kind: 'security-key', o: {} }]);
    expect(byPart(byPart(host, 'key-done')!, 'key-name')!.textContent).toBe('Security key');
    expect(api.go).not.toHaveBeenCalled();
  });

  it('a failed add shows why and no success', async () => {
    result = async () => {
      throw Object.assign(new Error('x'), { name: 'SecurityError', code: 'ERROR_INVALID_RP_ID' });
    };
    const api = setup();
    const host = show(api);
    click(byPart(host, 'key-add'));
    await flush();
    expect(byPart(host, 'key-done')).toBeNull();
    expect(host.querySelector('[role="alert"]')!.textContent).toMatch(/this page's address/);
  });
});

describe('owner note #94: test the security key right after adding it', () => {
  async function addedScreen() {
    const api = setup();
    const host = show(api);
    click(byPart(host, 'key-add'));
    await flush();
    return { api, host, done: byPart(host, 'key-done')! };
  }

  it('offers "Test this key now", tests exactly the key just added, and says it works', async () => {
    let pass!: () => void;
    testResult = () => new Promise<void>((r) => (pass = r));
    const { api, done } = await addedScreen();
    const run = byPart(done, 'key-test-run')!;
    expect(run.textContent).toBe('Test this key now');
    expect(byPart(done, 'key-test-result')).toBeNull();
    click(run);
    await flush();
    expect(tested).toEqual(['CRED-NEW']);
    expect(byPart(done, 'key-test-result')!.getAttribute('data-result')).toBe('waiting');
    expect((byPart(done, 'key-test-run') as HTMLButtonElement).disabled).toBe(true);
    pass();
    await flush();
    const ok = byPart(done, 'key-test-result')!;
    expect(ok.getAttribute('data-result')).toBe('ok');
    expect(ok.getAttribute('role')).toBe('status');
    expect(ok.textContent).toBe('Your security key works. It answered and X2F checked its answer.');
    expect(byPart(done, 'key-test-run')!.textContent).toBe('Test it again');
    // Testing changes nothing about the step: Continue still moves on.
    expect(api.go).not.toHaveBeenCalled();
    click(byPart(done, 'key-continue'));
    expect(api.go).toHaveBeenCalledTimes(1);
  });

  it('shows why a test did not pass, inline, and lets it run again', async () => {
    const { KeyTestError } = await import('@x2f/auth-client');
    testResult = async () => {
      throw new KeyTestError('other-key');
    };
    const { done } = await addedScreen();
    click(byPart(done, 'key-test-run'));
    await flush();
    let r = byPart(done, 'key-test-result')!;
    expect(r.getAttribute('data-result')).toBe('fail');
    expect(r.getAttribute('role')).toBe('alert');
    expect(r.textContent).toBe('A different key answered. Test again with the key you just added.');

    // No tap in time (the browser's NotAllowedError): the key error words.
    testResult = async () => {
      throw Object.assign(new Error('x'), { name: 'NotAllowedError', code: 'ERROR_CEREMONY_ABORTED' });
    };
    click(byPart(done, 'key-test-run'));
    await flush();
    r = byPart(done, 'key-test-result')!;
    expect(r.textContent).toMatch(/didn't respond/);

    // The server's check failed (401 webauthn-failed).
    testResult = async () => {
      throw Object.assign(new Error('webauthn-failed'), { code: 'webauthn-failed', status: 401 });
    };
    click(byPart(done, 'key-test-run'));
    await flush();
    expect(byPart(done, 'key-test-result')!.textContent).toBe("The key's answer couldn't be checked. Try again, or use a different key.");
    expect(tested).toEqual(['CRED-NEW', 'CRED-NEW', 'CRED-NEW']);
  });

  it('a staged key (hold model v3) is not offered a test: it is not a login method yet', async () => {
    result = async () => ({ status: 'staged', changeId: 'c1' });
    const api = setup();
    const host = show(api);
    click(byPart(host, 'key-add'));
    await flush();
    expect(byPart(host, 'key-test-run')).toBeNull();
  });
});
