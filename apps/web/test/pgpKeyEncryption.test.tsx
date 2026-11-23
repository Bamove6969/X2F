// @vitest-environment happy-dom
// Owner demo note #144 (23 Nov 2026, /setup/pgp-key and Settings, Add a PGP key): a key that cannot
// receive the login code is refused with plain words, on the device and from the server alike; an
// email address in a User ID gets a heads-up that never blocks. Real generated keys.
import { describe, expect, it } from 'vitest';
import * as openpgp from 'openpgp';
import { act } from 'react';
import { AuthApiError, inspectPublicKey } from '@x2f/auth-client';
import { KeyEmailNote } from '../src/screens/setup/PgpKey.js';
import { AddPgpKey } from '../src/screens/settings/Methods.js';
import { KEY_ENCRYPTION_INACTIVE, KEY_ENCRYPTION_UNUSABLE, KEY_SIGN_ONLY, refusalText } from '../src/screens/auth/refusals.js';
import { fire, render } from './render.js';

const HEADS_UP = 'Heads up: Your public key contains an email address, which will be visible in the key metadata.';
const now = new Date(Date.now() + 3_600_000);

const make = async (o: Omit<Parameters<typeof openpgp.generateKey>[0], 'format'>) =>
  (await openpgp.generateKey({ ...o, format: 'armored' })).publicKey;
const signOnly = () => make({ type: 'ecc', curve: 'ed25519Legacy', userIDs: [{ name: 'T' }], subkeys: [] });
const expiredSubkey = () =>
  make({ type: 'ecc', curve: 'ed25519Legacy', userIDs: [{ name: 'T' }], date: new Date(Date.now() - 2 * 86_400_000), subkeys: [{ keyExpirationTime: 86_400 }] });
const withEmail = () => make({ type: 'ecc', curve: 'ed25519Legacy', userIDs: [{ name: 'Alice', email: 'alice@example.com' }] });

function paste(el: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value);
  fire(el, new Event('input', { bubbles: true }));
}

/** Waits for the on-device check (async) to show. */
async function settle(host: HTMLElement, selector: string) {
  for (let i = 0; i < 200 && host.querySelector(selector) === null; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

describe('the server refusal and the device check say the same plain words', () => {
  it('key-no-encryption and key-encryption-inactive map to plain copy', () => {
    expect(refusalText(new AuthApiError(400, 'key-no-encryption', { detail: 'x' }), 'fallback')).toBe(KEY_SIGN_ONLY);
    expect(refusalText(new AuthApiError(400, 'key-encryption-inactive'), 'fallback')).toBe(KEY_ENCRYPTION_INACTIVE);
    expect(refusalText(new AuthApiError(400, 'key-encryption-unusable'), 'fallback')).toBe(KEY_ENCRYPTION_UNUSABLE);
  });

  it("the device check's sentences are the web's", async () => {
    expect(await inspectPublicKey(await signOnly(), now)).toMatchObject({ ok: false, reason: 'key-no-encryption', detail: KEY_SIGN_ONLY });
    expect(await inspectPublicKey(await expiredSubkey(), now)).toMatchObject({ ok: false, reason: 'key-encryption-inactive', detail: KEY_ENCRYPTION_INACTIVE });
  });
});

describe('KeyEmailNote', () => {
  it('shows the heads-up only for an accepted key with an email address', async () => {
    const ok = await inspectPublicKey(await withEmail(), now);
    expect(ok).toMatchObject({ ok: true, hasEmail: true });
    expect(render(<KeyEmailNote check={ok} />).host.textContent).toBe(HEADS_UP);
    expect(render(<KeyEmailNote check={ok.ok ? { ...ok, hasEmail: false } : ok} />).host.textContent).toBe('');
    expect(render(<KeyEmailNote check={null} />).host.textContent).toBe('');
  });
});

describe('Settings, Add a PGP key: the check as the key is pasted', () => {
  const mount = () => render(<AddPgpKey prove={async () => 'token'} onDone={() => undefined} onCancel={() => undefined} />);
  const addButton = (host: HTMLElement) => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Add key')!;

  it('a sign-only key is refused at once and Add key stays off', async () => {
    const { host } = mount();
    paste(host.querySelector('textarea')!, await signOnly());
    await settle(host, '[data-part="key-refused"]');
    expect(host.querySelector('[data-part="key-refused"]')!.textContent).toBe(KEY_SIGN_ONLY);
    expect(addButton(host).disabled).toBe(true);
  });

  it('a new paste clears the last result at once, and Add key waits for the new check (review 3)', async () => {
    const { host } = mount();
    const box = host.querySelector('textarea')!;
    paste(box, await withEmail());
    await settle(host, '[data-part="key-email-note"]');
    expect(addButton(host).disabled).toBe(false);
    paste(box, await signOnly());
    // Straight after the change: no stale note, no stale result, and Add key is off while checking.
    expect(host.querySelector('[data-part="key-email-note"]')).toBeNull();
    expect(host.querySelector('[data-part="key-refused"]')).toBeNull();
    expect(addButton(host).disabled).toBe(true);
    await settle(host, '[data-part="key-refused"]');
    expect(host.querySelector('[data-part="key-refused"]')!.textContent).toBe(KEY_SIGN_ONLY);
  });

  it('a key with an email address shows the heads-up and can still be added', async () => {
    const { host } = mount();
    paste(host.querySelector('textarea')!, await withEmail());
    await settle(host, '[data-part="key-email-note"]');
    expect(host.querySelector('[data-part="key-email-note"]')!.textContent).toBe(HEADS_UP);
    expect(host.querySelector('[data-part="key-refused"]')).toBeNull();
    expect(addButton(host).disabled).toBe(false);
  });
});
