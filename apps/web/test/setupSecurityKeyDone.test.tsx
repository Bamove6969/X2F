// @vitest-environment happy-dom
// Owner, 16 Nov 2026 (demo): adding a security key worked, but the screen went straight on to the
// next step, so he could not tell it was set up. Like his 13 Nov note for the authenticator app
// ("it should turn green and say you have successfully setup..."): /setup/security-key now turns
// green, shows a security key, says it was added with the name the key was given, and waits for
// Continue. The ceremony itself is stubbed (addWebAuthnKeyWithId).
// Owner demo note #94 (16 Nov): "it should even have you test it after adding it": the added
// screen offers "Test this key now" (testWebAuthnKey, stubbed here; its real run against the API is
// packages/auth-client/test/keyTest.test.ts) and shows the result inline.
// Owner 25 Nov security-key report ("some sort of acknowledgement of it saved, and I name it"):
// while the browser's sheet is open the step says to enter the PIN and touch the key; the key is
// then "Security key saved", named (default "Security key N", PUT /v1/account/webauthn/label) and
// only then tested and continued. The first method of sign-up gets the same (FirstKeySaved).
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL, SetupContext, type SetupApi } from '../src/screens/setup/kit.js';
import { FirstKeySaved, KeyStep } from '../src/screens/setup/MoreMethods.js';
import { fire, render } from './render.js';

const added: { kind: string; o: { label?: string } }[] = [];
let result: () => Promise<unknown> = async () => undefined;
let gate: Promise<void> = Promise.resolve();
const tested: string[] = [];
let testResult: () => Promise<void> = async () => undefined;
vi.mock('@x2f/auth-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@x2f/auth-client')>()),
  addWebAuthnKeyWithId: async (_api: unknown, kind: string, o: { label?: string }) => {
    added.push({ kind, o });
    await gate;
    return { staged: await result(), credentialId: 'CRED-NEW' };
  },
  testWebAuthnKey: async (_api: unknown, credentialId: string) => {
    tested.push(credentialId);
    return testResult();
  },
}));

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const renames: { credentialId: string; label: string }[] = [];
let renameStatus = 200;

beforeEach(() => {
  added.length = 0;
  tested.length = 0;
  renames.length = 0;
  renameStatus = 200;
  gate = Promise.resolve();
  result = async () => undefined;
  testResult = async () => undefined;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url === '/v1/account/methods') {
      return json(200, [
        { type: 'pgp', id: 'p1', label: '', createdAt: null, lastUsedAt: null },
        { type: 'security-key', id: 'k1', label: 'Security key', createdAt: null, lastUsedAt: null },
      ]);
    }
    if (url === '/v1/account/webauthn/label' && init?.method === 'PUT') {
      const b = JSON.parse(String(init.body)) as { credentialId: string; label: string };
      renames.push(b);
      if (renameStatus === 409) return json(400, { error: 'key-name-invalid', reason: 'taken' });
      return renameStatus === 200 ? json(200, { label: b.label }) : json(renameStatus, { error: 'internal' });
    }
    return json(500, { error: 'internal' });
  });
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
    state: { ...INITIAL, terms: { version: 'v1' }, displayName: 'lumen.k', loginName: 'lumen-login-7', registered: true, methods: ['pgp', 'security-key'], done: ['pgp'] },
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

/** Adds the key (the stubbed ceremony) and waits for the saved screen. */
async function addKey(host: HTMLElement) {
  click(byPart(host, 'key-add'));
  await flush();
  return byPart(host, 'key-done');
}
async function saveName(host: HTMLElement, name?: string) {
  if (name !== undefined) type(byPart(host, 'key-name-input') as HTMLInputElement, name);
  click(byPart(host, 'key-name-save'));
  await flush();
}

describe('owner 25 Nov: a security key that was saved says so, is named, and waits for Continue', () => {
  it('says to enter the PIN and touch the key while the browser asks; no name is asked before the tap', async () => {
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    const api = setup();
    const host = show(api);
    expect(host.querySelector('#key-name')).toBeNull();
    expect(byPart(host, 'key-name-input')).toBeNull();
    click(byPart(host, 'key-add'));
    await flush();
    const waiting = byPart(host, 'key-waiting')!;
    expect(waiting.getAttribute('role')).toBe('status');
    expect(waiting.textContent).toMatch(/^Enter your key's PIN, then touch your key\./);
    expect((byPart(host, 'key-add') as HTMLButtonElement).disabled).toBe(true);
    release();
    await flush();
    expect(byPart(host, 'key-waiting')).toBeNull();
    expect(added).toEqual([{ kind: 'security-key', o: {} }]);
  });

  it('"Security key saved", then the name (default "Security key N"), stored, shown; Continue moves on', async () => {
    const api = setup();
    const host = show(api);
    const done = (await addKey(host))!;
    expect(done.getAttribute('data-tone')).toBe('escrow');
    expect(byPart(done, 'key-picture')).not.toBeNull();
    expect(byPart(done, 'key-saved')!.textContent).toBe('Security key saved');
    expect(byPart(done, 'key-saved')!.getAttribute('role')).toBe('status');
    // The account's one security key (the list counts the new one): "Security key 1".
    expect((byPart(done, 'key-name-input') as HTMLInputElement).value).toBe('Security key 1');
    // Nothing goes on, and no test is offered, before the name is saved.
    expect(byPart(host, 'key-add')).toBeNull();
    expect(byPart(host, 'method-later')).toBeNull();
    expect(byPart(done, 'key-continue')).toBeNull();
    expect(byPart(done, 'key-test-run')).toBeNull();

    await saveName(host, '  Blue   YubiKey  ');
    expect(renames).toEqual([{ credentialId: 'CRED-NEW', label: 'Blue YubiKey' }]);
    expect(byPart(done, 'key-name')!.textContent).toContain('Blue YubiKey');
    expect(byPart(done, 'key-name-input')).toBeNull();
    expect(api.go).not.toHaveBeenCalled();
    expect(api.update).not.toHaveBeenCalled();

    click(byPart(done, 'key-continue'));
    expect(api.update).toHaveBeenCalledWith({ done: ['pgp', 'security-key'] });
    expect(api.go).toHaveBeenCalledTimes(1);
  });

  it('a name outside 1 to 32 characters or with other characters says why and is not sent', async () => {
    const host = show(setup());
    await addKey(host);
    for (const [name, text] of [
      ['   ', 'Give it a name.'],
      ['x'.repeat(33), 'Use 32 characters or fewer.'],
      ['key<1>', /^Use letters, numbers, spaces and/],
    ] as const) {
      await saveName(host, name);
      const p = byPart(host, 'key-name-problem')!;
      expect(p.getAttribute('role')).toBe('alert');
      if (typeof text === 'string') expect(p.textContent).toBe(text);
      else expect(p.textContent).toMatch(text);
    }
    expect(renames).toEqual([]);
    expect(byPart(host, 'key-continue')).toBeNull();
  });

  it("a name another of the account's keys has says so (the API's 'taken'), and can be changed", async () => {
    renameStatus = 409;
    const host = show(setup());
    await addKey(host);
    await saveName(host, 'Security key');
    expect(byPart(host, 'key-name-problem')!.textContent).toBe('Another of your keys has that name. Pick a different one.');
    expect(byPart(host, 'key-continue')).toBeNull();
    renameStatus = 200;
    await saveName(host, 'Blue');
    expect(byPart(host, 'key-name')!.textContent).toContain('Blue');
  });

  it('a name that could not be saved says so and still lets the person continue', async () => {
    renameStatus = 500;
    const api = setup();
    const host = show(api);
    await addKey(host);
    await saveName(host);
    expect(renames).toEqual([{ credentialId: 'CRED-NEW', label: 'Security key 1' }]);
    expect(byPart(host, 'key-name-failed')!.textContent).toMatch(/^The name was not saved/);
    click(byPart(host, 'key-continue'));
    expect(api.go).toHaveBeenCalledTimes(1);
  });

  it('a failed add shows why and no success', async () => {
    result = async () => {
      throw Object.assign(new Error('x'), { name: 'SecurityError', code: 'ERROR_INVALID_RP_ID' });
    };
    const host = show(setup());
    click(byPart(host, 'key-add'));
    await flush();
    expect(byPart(host, 'key-done')).toBeNull();
    expect(host.querySelector('[role="alert"]')!.textContent).toMatch(/this page's address/);
  });

  it('cancelled or timed out, already registered, no PIN, unsupported: each says so', async () => {
    const cases: [object, RegExp][] = [
      [{ name: 'NotAllowedError', code: 'ERROR_CEREMONY_ABORTED' }, /cancelled or timed out/],
      [{ name: 'InvalidStateError', code: 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' }, /already on your account/],
      [{ name: 'ConstraintError', code: 'ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT' }, /needs a PIN/],
      [{ code: 'webauthn-failed', status: 401, reason: 'needs-pin' }, /needs a PIN/],
      [{ name: 'NotSupportedError', code: 'ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG' }, /different security key/],
    ];
    for (const [err, text] of cases) {
      result = async () => {
        throw Object.assign(new Error('x'), err);
      };
      const host = show(setup());
      click(byPart(host, 'key-add'));
      await flush();
      expect(byPart(host, 'key-error')!.textContent).toMatch(text);
      expect(byPart(host, 'key-done')).toBeNull();
    }
  });
});

describe('owner note #94: test the security key right after adding it', () => {
  async function addedScreen() {
    const api = setup();
    const host = show(api);
    await addKey(host);
    await saveName(host);
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
    expect(byPart(host, 'key-name-input')).toBeNull();
    expect(renames).toEqual([]);
  });
});

describe('owner 25 Nov: the key the account was made with is acknowledged and named too', () => {
  it('FirstKeySaved: "Security key saved", "Security key 1", stored; Continue clears it and goes on', async () => {
    const api = { ...setup(), state: { ...setup().state, methods: ['security-key', 'password'] as never, done: ['security-key'] as never, keySaved: { kind: 'security-key' as const, credentialId: 'CRED-FIRST' } } };
    const host = render(
      <MemoryRouter>
        <SetupContext.Provider value={api}>
          <FirstKeySaved />
        </SetupContext.Provider>
      </MemoryRouter>,
    ).host;
    expect(host.querySelector('h1')!.textContent).toBe('Name your security key');
    expect(byPart(host, 'key-saved')!.textContent).toBe('Security key saved');
    expect((byPart(host, 'key-name-input') as HTMLInputElement).value).toBe('Security key 1');
    await saveName(host, 'Titan');
    expect(renames).toEqual([{ credentialId: 'CRED-FIRST', label: 'Titan' }]);
    click(byPart(host, 'key-continue'));
    expect(api.update).toHaveBeenCalledWith({ keySaved: null });
    expect(api.go).toHaveBeenCalledWith('password', { replace: true });
  });

  it('a passkey made first is "Passkey saved", "Passkey 1", with no key test', async () => {
    const api = { ...setup(), state: { ...setup().state, methods: ['passkey'] as never, done: ['passkey'] as never, keySaved: { kind: 'passkey' as const, credentialId: 'CRED-PK' } } };
    const host = render(
      <MemoryRouter>
        <SetupContext.Provider value={api}>
          <FirstKeySaved />
        </SetupContext.Provider>
      </MemoryRouter>,
    ).host;
    expect(byPart(host, 'key-saved')!.textContent).toBe('Passkey saved');
    expect((byPart(host, 'key-name-input') as HTMLInputElement).value).toBe('Passkey 1');
    await saveName(host);
    expect(byPart(host, 'key-test-run')).toBeNull();
    click(byPart(host, 'key-continue'));
    expect(api.go).toHaveBeenCalledWith('backup', { replace: true });
  });
});
