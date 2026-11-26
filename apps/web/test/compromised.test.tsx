// @vitest-environment happy-dom
// "My account has been compromised" (owner D-059; J-14 ported; board Compromised): form, confirm,
// frozen, against a stubbed POST /v1/tickets/compromised in the shape of
// apps/api/src/tickets/compromisedRoutes.ts.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMPROMISED_COPY, COMPROMISED_METHOD_LABEL, Compromised } from '../src/screens/auth/Compromised.js';
import { isFrontDoor } from '../src/session/frontDoor.js';
import { CANT_DO_TITLE } from '../src/ui/cantDoCodes.js';
import { fire, render } from './render.js';

let calls: { url: string; method: string; body: unknown }[];
let answer: () => [number, unknown];

beforeEach(() => {
  calls = [];
  answer = () => [202, { number: 1042, moderatorUrl: 'https://matrix.to/#/@mods:example.org' }];
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    calls.push({ url: input, method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
    const [s, b] = answer();
    return new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => vi.unstubAllGlobals());

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const click = (el: Element) => fire(el, new MouseEvent('click', { bubbles: true }));
const tick = (host: HTMLElement, part: string) => click(host.querySelector(`[data-part="${part}"] input[type="checkbox"]`)!);
const part = (host: HTMLElement, p: string) => host.querySelector<HTMLElement>(`[data-part="${p}"]`);

function mount() {
  return render(
    <MemoryRouter>
      <Compromised />
    </MemoryRouter>,
  ).host;
}

describe('"My account has been compromised" (D-059)', () => {
  it('is on the front door at /login/compromised', () => {
    expect(isFrontDoor('/login/compromised')).toBe(true);
    expect(isFrontDoor('/login/compromised/x')).toBe(false);
  });

  it('asks for the username, method kinds only (never a secret field) and an optional comment', () => {
    const host = mount();
    expect(host.querySelectorAll('input[type="password"]')).toHaveLength(0);
    expect(host.querySelectorAll('input:not([type="checkbox"])')).toHaveLength(1);
    const rows = [...host.querySelectorAll('[data-part="compromised-methods"] .x2f-check-row__title')].map((e) => e.textContent);
    expect(rows).toEqual([...Object.values(COMPROMISED_METHOD_LABEL), COMPROMISED_COPY.none]);
  });

  it('needs a username and at least one tick ("None of these" counts) before it goes on (lead default)', () => {
    const host = mount();
    const send = part(host, 'compromised-send') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(part(host, 'compromised-hint')!.textContent).toBe(COMPROMISED_COPY.needName);
    type(host.querySelector('input')!, 'mira.k');
    expect(part(host, 'compromised-hint')!.textContent).toBe(COMPROMISED_COPY.needTick);
    tick(host, 'have-none');
    expect(send.disabled).toBe(false);
    // "None of these" and a method exclude each other.
    tick(host, 'have-pgp');
    expect((host.querySelector('[data-part="have-none"] input') as HTMLInputElement).checked).toBe(false);
    tick(host, 'have-none');
    expect((host.querySelector('[data-part="have-pgp"] input') as HTMLInputElement).checked).toBe(false);
  });

  it('confirms first, then sends kinds only, in the API order, and shows CT-<number> and the moderator link', async () => {
    const host = mount();
    type(host.querySelector('input')!, '  mira.k  ');
    tick(host, 'have-recovery-code');
    tick(host, 'have-password');
    type(host.querySelector('textarea')!, ' They took my phone. ');
    click(part(host, 'compromised-send')!);
    expect(calls).toEqual([]);
    expect(host.querySelector('h1')!.textContent).toBe(COMPROMISED_COPY.confirmTitle('mira.k'));
    expect(part(host, 'compromised-told')!.textContent).toContain('Password, Recovery code');
    // Go back keeps what was typed.
    click(part(host, 'compromised-edit')!);
    expect(host.querySelector('input')!.value).toBe('  mira.k  ');
    click(part(host, 'compromised-send')!);
    click(part(host, 'compromised-freeze')!);
    await settle();
    expect(calls).toEqual([
      { url: '/v1/tickets/compromised', method: 'POST', body: { loginName: 'mira.k', methodsLeft: ['password', 'recovery-code'], comment: 'They took my phone.' } },
    ]);
    expect(part(host, 'compromised-frozen')!.textContent).toBe(COMPROMISED_COPY.frozenTitle('mira.k'));
    expect(part(host, 'compromised-ticket')!.textContent).toContain('CT-1042');
    expect(part(host, 'compromised-contact')!.querySelector('a')!.getAttribute('href')).toBe('https://matrix.to/#/@mods:example.org');
    // Never a list of the account's trades (lead default): the answer is the same for any name.
    expect(host.textContent).not.toMatch(/paused trades? ·|Selling|Buying/);
  });

  it('with no moderator contact set, says the address is still to come', async () => {
    answer = () => [202, { number: 1001, moderatorUrl: null }];
    const host = mount();
    type(host.querySelector('input')!, 'x');
    tick(host, 'have-none');
    click(part(host, 'compromised-send')!);
    click(part(host, 'compromised-freeze')!);
    await settle();
    expect(calls[0]!.body).toEqual({ loginName: 'x', methodsLeft: [], comment: '' });
    expect(part(host, 'compromised-contact')!.querySelector('a')).toBeNull();
    expect(part(host, 'compromised-contact')!.textContent).toContain(COMPROMISED_COPY.noContact);
  });

  it('a busy form or the daily cap is a CantDoThat; anything else is a fault, and the step stays', async () => {
    answer = () => [429, { error: 'slow-down', retryAfterSeconds: 120 }];
    const host = mount();
    type(host.querySelector('input')!, 'x');
    tick(host, 'have-none');
    click(part(host, 'compromised-send')!);
    click(part(host, 'compromised-freeze')!);
    await settle();
    const dialog = document.querySelector('[data-part="cant-do-that"]')!;
    expect(dialog.getAttribute('data-from')).toBe('slow-down');
    expect(document.body.textContent).toContain(CANT_DO_TITLE.compromised);
    expect(dialog.textContent).toContain('Try again in 2 minutes');
    click([...dialog.querySelectorAll('button')].find((b) => b.textContent === 'OK')!);
    answer = () => [500, { error: 'internal' }];
    click(part(host, 'compromised-freeze')!);
    await settle();
    expect(part(host, 'compromised-failed')!.textContent).toBe(COMPROMISED_COPY.failed);
    expect(part(host, 'compromised-frozen')).toBeNull();
  });
});
