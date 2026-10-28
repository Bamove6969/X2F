// @vitest-environment happy-dom
// Task 29: the Your wallets screen against a stubbed API (FU-B's wallet routes, Task 30's confirm).
import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { walletsAction, type WalletRule } from '@x2f/auth-client';
import { CONFIRM_INVALID_WALLETS, RECOVERY_SESSION_WALLETS, Wallets } from '../src/screens/Wallets.js';
import type { WalletView } from '../src/screens/wallets-model.js';
import { fire, render } from './render.js';

const address = (seed: string, end: string) => `4${seed.repeat(95).slice(0, 88)}${end}`;
const ADDR_C = address('C', 'AAAAA1');

const READY: WalletView = {
  id: 'w-ready',
  app: 'cake',
  label: 'Savings',
  address: address('A', 'Rk3Fz1'),
  addressEnd: 'Rk3Fz1',
  usableFrom: '2026-10-20T00:00:00.000Z',
  usable: true,
};

const RULE_PASSWORD_ONLY: WalletRule = { firstWallet: false, strongMethods: [], password: 'waits', waitHours: 24 };
const RULE_FIRST: WalletRule = { firstWallet: true, strongMethods: [], password: 'immediate', waitHours: 24 };

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | undefined;
}

interface Stub {
  wallets: WalletView[];
  rule: WalletRule;
  /** Answers POST /v1/wallets; `n` counts from 1. */
  onPost: (body: Record<string, unknown>, n: number) => { status: number; json: unknown };
  calls: Call[];
}

let stub: Stub;

function json(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** The server's answer to a batch: every wallet in it shares one `usableFrom` (FU-B). */
function created(body: Record<string, unknown>, usableFrom: string, usable: boolean): WalletView[] {
  const list = body.wallets as { app: WalletView['app']; label: string; address: string }[];
  return list.map((w, i) => ({ ...w, id: `w-new-${i}`, addressEnd: w.address.slice(-6), usableFrom, usable }));
}

beforeEach(() => {
  stub = {
    wallets: [READY],
    rule: RULE_PASSWORD_ONLY,
    onPost: () => ({ status: 500, json: { error: 'internal' } }),
    calls: [],
  };
  let posts = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
      stub.calls.push({ url, method, body });
      if (url === '/v1/wallets' && method === 'GET') return json(200, stub.wallets);
      if (url === '/v1/wallets' && method === 'POST') {
        const a = stub.onPost(body ?? {}, ++posts);
        return json(a.status, a.json);
      }
      if (url === '/v1/wallets/rule') return json(200, stub.rule);
      if (url === '/v1/account/me') return json(200, { methods: ['password'] });
      if (url === '/v1/confirm/password') return json(200, { confirmToken: 'tok-1' });
      return json(404, { error: 'not-found' });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

let where = '';
function Where() {
  const loc = useLocation();
  where = loc.pathname + loc.search;
  return null;
}

async function mount(path = '/wallets'): Promise<void> {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>
        <Route path="/wallets" element={<Wallets />} />
        <Route path="*" element={<main data-screen="elsewhere" />} />
      </Routes>
    </MemoryRouter>,
  );
  await settle();
}

function button(name: string, within: ParentNode = document): HTMLButtonElement {
  const b = [...within.querySelectorAll('button')].find((x) => x.textContent === name || x.getAttribute('aria-label') === name);
  if (!b) throw new Error(`no button "${name}"`);
  return b;
}

async function click(name: string, within: ParentNode = document): Promise<void> {
  fire(button(name, within), new MouseEvent('click', { bubbles: true }));
  await settle();
}

function type(selector: string, value: string): void {
  const input = document.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`no input ${selector}`);
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function dialog(title: string): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find((d) => d.textContent?.includes(title)) ?? null;
}

/** Opens Add a wallet from the list and gets past the rule popup. */
async function startAdding(): Promise<void> {
  await click('Add a wallet');
  await click('Continue', dialog('Before you add a wallet')!);
}

describe('Your wallets', () => {
  it("adds through Task 30's ConfirmSheet, with a token bound to the exact list", async () => {
    stub.onPost = (body, n) =>
      n === 1
        ? { status: 403, json: { error: 'confirm-required', action: 'add-wallets' } }
        : { status: 201, json: created(body, '2026-10-24T00:00:00.000Z', true) };
    await mount();
    await startAdding();
    type('#wallet-address', ADDR_C);
    await click('Save wallet');

    const sheet = dialog("Confirm it's you");
    expect(sheet).not.toBeNull();
    type('#confirm-password', 'Correct-Horse-9!');
    await click('Confirm', sheet!.querySelector('[data-method="password"]')!);

    const confirm = stub.calls.find((c) => c.url === '/v1/confirm/password');
    expect(confirm?.body?.action).toEqual(await walletsAction([ADDR_C]));
    const posts = stub.calls.filter((c) => c.url === '/v1/wallets' && c.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[0]!.body).not.toHaveProperty('confirmToken');
    expect(posts[1]!.body).toMatchObject({ wallets: [{ address: ADDR_C }], confirmToken: 'tok-1' });
    expect(dialog("Confirm it's you")).toBeNull();
  });

  describe('?add=1 (sent here by a 409 no-wallet)', () => {
    it('stays and shows the wait when a saved wallet waits; Back goes to returnTo (review item 1)', async () => {
      stub.wallets = [];
      stub.onPost = (body, n) =>
        n === 1
          ? { status: 403, json: { error: 'confirm-required', action: 'add-wallets' } }
          : { status: 201, json: created(body, '2099-01-01T12:00:00.000Z', false) };
      await mount('/wallets?add=1&returnTo=%2Fbuy');
      await click('Continue', dialog('Before you add a wallet')!);
      type('#wallet-address', ADDR_C);
      await click('Save wallet');
      type('#confirm-password', 'Correct-Horse-9!');
      await click('Confirm', dialog("Confirm it's you")!.querySelector('[data-method="password"]')!);

      // Not bounced back to the take (which would answer no-wallet again and loop).
      expect(where).toBe('/wallets?add=1&returnTo=%2Fbuy');
      expect(document.querySelector('[role="status"]')?.textContent).toContain('Your new wallet can be paid from');
      expect(document.querySelector('.x2f-wallet-row')?.textContent).toContain('Waiting');
      expect(dialog('Before you add a wallet')).toBeNull();
      await click('Back');
      expect(where).toBe('/buy');
    });

    it('returns to returnTo at once when every saved wallet is usable', async () => {
      stub.wallets = [];
      stub.rule = RULE_FIRST;
      stub.onPost = (body) => ({ status: 201, json: created(body, '2026-10-24T00:00:00.000Z', true) });
      await mount('/wallets?add=1&returnTo=%2Fbuy');
      await click('Continue', dialog('Before you add a wallet')!);
      type('#wallet-address', ADDR_C);
      await click('Save wallet');
      expect(where).toBe('/buy');
    });
  });

  it('shows exactly one primary action: the footer steps down under the rule popup and the confirm sheet (review item 2)', async () => {
    stub.onPost = () => ({ status: 403, json: { error: 'confirm-required', action: 'add-wallets' } });
    const primaries = () => [...document.querySelectorAll('[data-primary]')].map((b) => b.textContent);
    await mount();
    expect(primaries()).toEqual(['Add a wallet']);

    await click('Add a wallet');
    expect(primaries()).toEqual(['Continue']);
    await click('Continue', dialog('Before you add a wallet')!);
    expect(primaries()).toEqual(['Save wallet']);

    type('#wallet-address', ADDR_C);
    await click('Save wallet');
    expect(dialog("Confirm it's you")).not.toBeNull();
    expect(primaries()).toEqual(['Confirm']);
  });

  it('offers no QR scan button until a scanner exists (review item 7)', async () => {
    await mount();
    await startAdding();
    expect(document.querySelector('#wallet-address')).not.toBeNull();
    expect(document.querySelector('[aria-label="Scan address QR code"]')).toBeNull();
  });

  describe('refusals say what to do (round 2, M1)', () => {
    function alertText(): string {
      return document.querySelector('[role="alert"]')?.textContent ?? '';
    }

    it('a backup-login session is told it cannot add wallets, not to check the addresses', async () => {
      stub.onPost = () => ({ status: 403, json: { error: 'recovery-session' } });
      await mount();
      await startAdding();
      type('#wallet-address', ADDR_C);
      await click('Save wallet');
      expect(alertText()).toBe(RECOVERY_SESSION_WALLETS);
    });

    it('a confirm that ran out before the save asks to save and confirm again', async () => {
      stub.onPost = (_b, n) =>
        n === 1 ? { status: 403, json: { error: 'confirm-required', action: 'add-wallets' } } : { status: 403, json: { error: 'confirm-invalid' } };
      await mount();
      await startAdding();
      type('#wallet-address', ADDR_C);
      await click('Save wallet');
      type('#confirm-password', 'Correct-Horse-9!');
      await click('Confirm', dialog("Confirm it's you")!.querySelector('[data-method="password"]')!);
      expect(alertText()).toBe(CONFIRM_INVALID_WALLETS);
    });

    it("Task 30's refusalText words a wait after too many tries", async () => {
      stub.onPost = () => ({ status: 429, json: { error: 'slow-down', retryAfterSeconds: 120 } });
      await mount();
      await startAdding();
      type('#wallet-address', ADDR_C);
      await click('Save wallet');
      expect(alertText()).toBe('Too many tries. Try again in 2 minutes.');
    });
  });

  it('?add=1 with only waiting wallets shows the wait instead of the rule popup (round 2, M2)', async () => {
    stub.wallets = [{ ...READY, id: 'w-wait', usable: false, usableFrom: '2099-01-01T12:00:00.000Z' }];
    await mount('/wallets?add=1&returnTo=%2Fbuy');
    expect(dialog('Before you add a wallet')).toBeNull();
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Your wallet can be paid from');
    expect(document.querySelector('.x2f-wallet-row')?.textContent).toContain('Waiting');
  });

  it('?add=1 with no wallets still opens the rule popup', async () => {
    stub.wallets = [];
    await mount('/wallets?add=1&returnTo=%2Fbuy');
    expect(dialog('Before you add a wallet')).not.toBeNull();
  });
});
