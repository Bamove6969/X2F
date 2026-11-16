// @vitest-environment happy-dom
// Owner, 16 Nov 2026 (demo): adding a security key worked, but the screen went straight on to the
// next step, so he could not tell it was set up. Like his 13 Nov note for the authenticator app
// ("it should turn green and say you have successfully setup..."): /setup/security-key now turns
// green, shows a security key, says it was added with the name the key was given, and waits for
// Continue. The ceremony itself is stubbed (addWebAuthnKey).
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL, SetupContext, type SetupApi } from '../src/screens/setup/kit.js';
import { KeyStep } from '../src/screens/setup/MoreMethods.js';
import { fire, render } from './render.js';

const added: { kind: string; o: { label?: string } }[] = [];
let result: () => Promise<unknown> = async () => undefined;
vi.mock('@x2f/auth-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@x2f/auth-client')>()),
  addWebAuthnKey: async (_api: unknown, kind: string, o: { label?: string }) => {
    added.push({ kind, o });
    return result();
  },
}));

beforeEach(() => {
  added.length = 0;
  result = async () => undefined;
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
