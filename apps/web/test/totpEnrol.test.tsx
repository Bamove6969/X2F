// @vitest-environment happy-dom
// Signup round 3 (owner's demo notes, 13 Nov 2026), against a stubbed API:
// - Behaviour 4: after the 6-digit code verifies, a green success state before moving on.
// - Behaviour 5: an otpauth:// link for an authenticator or password manager on the same phone,
//   and the secret kept copyable, grouped, with a copy button. The secret is never sent anywhere.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Totp } from '../src/screens/settings/Totp.js';
import { fire, render } from './render.js';

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const URI = `otpauth://totp/X2F:lumen.k?secret=${SECRET}&issuer=X2F`;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let finish: () => Response;
const seen: { url: string; body: string }[] = [];

beforeEach(() => {
  seen.length = 0;
  finish = () => json(200, { ok: true });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    seen.push({ url, body: typeof init.body === 'string' ? init.body : '' });
    if (url === '/v1/account/totp/start') return json(200, { challengeId: 't1', otpauthUri: URI, secret: SECRET });
    if (url === '/v1/account/totp/finish') return finish();
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
const byPart = (host: ParentNode, part: string) => host.querySelector<HTMLElement>(`[data-part="${part}"]`);
const click = (el: Element | null) => fire(el!, new MouseEvent('click', { bubbles: true }));
function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  fire(input, new Event('input', { bubbles: true }));
}

async function started(write = vi.fn(async () => undefined), onDone = vi.fn()) {
  const { host } = render(<Totp prove={async () => 'tok'} onDone={onDone} onCancel={() => undefined} write={write} />);
  click(byPart(host, 'totp-start'));
  await flush();
  return { host, write, onDone };
}

describe('authenticator enrolment (signup round 3)', () => {
  it('offers the otpauth link for an authenticator or password manager on this phone', async () => {
    const { host } = await started();
    const link = byPart(host, 'totp-link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(URI);
    expect(link.textContent).toBe('Add to your authenticator or password manager');
  });

  it('keeps the secret copyable: grouped on screen, copied whole by the copy button', async () => {
    const { host, write } = await started();
    const secret = byPart(host, 'totp-secret')!;
    // Grouped visually in fours; the text itself has no spaces, so a selection copies cleanly.
    expect(secret.textContent).toBe(SECRET);
    expect(secret.querySelectorAll('[data-part="secret-group"]')).toHaveLength(8);
    click(byPart(host, 'totp-copy'));
    await flush();
    expect(write).toHaveBeenCalledWith(SECRET);
    expect(byPart(host, 'totp-copy')!.textContent).toBe('Copied');
    // The secret only ever came from the server; nothing sends it back.
    expect(seen.filter((s) => s.body.includes(SECRET) || s.url.includes(SECRET))).toEqual([]);
  });

  it('a verified code shows the green success state, and moves on only on Continue', async () => {
    const { host, onDone } = await started();
    type(host.querySelector<HTMLInputElement>('#totp-code')!, '123456');
    click(byPart(host, 'totp-finish'));
    await flush();
    const ok = byPart(host, 'totp-success')!;
    expect(ok.textContent).toContain('You have successfully set up your one-time password.');
    expect(ok.getAttribute('role')).toBe('status');
    expect(byPart(host, 'totp-secret')).toBeNull();
    expect(onDone).not.toHaveBeenCalled();
    click(byPart(host, 'totp-continue'));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0]![0]).toBeUndefined();
  });

  it('a staged enrolment (it waits 24 hours) is handed on at once, with no success claim', async () => {
    finish = () => json(202, { status: 'staged', changeId: 'c1' });
    const { host, onDone } = await started();
    type(host.querySelector<HTMLInputElement>('#totp-code')!, '123456');
    click(byPart(host, 'totp-finish'));
    await flush();
    expect(byPart(host, 'totp-success')).toBeNull();
    expect(onDone).toHaveBeenCalledWith({ status: 'staged', changeId: 'c1' });
  });
});
