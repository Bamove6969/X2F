// @vitest-environment happy-dom
// Task 29: the Your wallets screen against a stubbed API (FU-B's wallet routes, Task 30's confirm).
import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { walletsAction, type WalletRule } from '@x2f/auth-client';
import { CONFIRM_INVALID_WALLETS, RECOVERY_SESSION_WALLETS, Wallets } from '../src/screens/Wallets.js';
import type { WalletView } from '../src/screens/wallets-model.js';
import { KEEP_FOR, RENAME } from '../src/screens/walletsCopy.js';
import { NEW_ADDRESS } from '../src/screens/quote/addressCopy.js';
import { forgetTypedAddresses, recordTypedAddress, typedAddressOf } from '../src/screens/walletRecord.js';
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
  /** Owner p5-7: a removal from a username-and-password login answers 202 staged. */
  removeStaged?: boolean;
  /** Review 17 Nov (b) B1: PUT default answers this (default 204). */
  defaultAnswer?: { status: number; json: unknown };
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
  localStorage.clear();
  forgetTypedAddresses();
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
      if (url.startsWith('/v1/wallets/') && url.endsWith('/default') && method === 'PUT') return json(stub.defaultAnswer?.status ?? 204, stub.defaultAnswer?.json ?? null);
      // Owner demo note #226: renaming a wallet.
      if (url.startsWith('/v1/wallets/') && url.endsWith('/label') && method === 'PUT') return json(204, null);
      if (url.startsWith('/v1/wallets/') && method === 'DELETE') return json(stub.removeStaged ? 202 : 204, { status: 'staged', changeId: 'c-1' });
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

/**
 * Settles until `ready()` holds, for at most 2 s. Saving hashes the addresses with
 * crypto.subtle.digest, which resolves from Node's thread pool rather than after a fixed number of
 * timer ticks, so under load one settle() could end before the screen answered.
 */
async function until(ready: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!ready() && Date.now() < deadline) await settle();
}

let where = '';
let how = '';
function Where() {
  const loc = useLocation();
  where = loc.pathname + loc.search;
  how = useNavigationType();
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

/** Taps Save wallet and waits until the screen has answered. */
async function save(answered: () => boolean): Promise<void> {
  await click('Save wallet');
  await until(answered);
}

const confirmShown = () => dialog("Confirm it's you") !== null;

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
    await save(confirmShown);

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

  it('owner p5-7: a removal staged (202) keeps the wallet listed and says it is a draft to submit', async () => {
    stub.removeStaged = true;
    await mount();
    await click(`Remove ${READY.label}`);
    expect(stub.calls.some((c) => c.method === 'DELETE' && c.url === `/v1/wallets/${READY.id}`)).toBe(true);
    expect(document.querySelector('[data-part="staged-note"]')).not.toBeNull();
    expect(button(`Remove ${READY.label}`)).toBeTruthy();
  });

  it('a removal that applies (204) takes the wallet off the list', async () => {
    await mount();
    await click(`Remove ${READY.label}`);
    expect(() => button(`Remove ${READY.label}`)).toThrow();
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
      await save(confirmShown);
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
      await save(() => where === '/buy');
      expect(where).toBe('/buy');
      // Replaced, so the browser's Back does not reopen Add a wallet (round 2, M4).
      expect(how).toBe('REPLACE');
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
    await save(confirmShown);
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
      return document.querySelector('[data-part="cant-do-message"], [role="alert"]')?.textContent ?? '';
    }

    it('a backup-login session is told it cannot add wallets, not to check the addresses', async () => {
      stub.onPost = () => ({ status: 403, json: { error: 'recovery-session' } });
      await mount();
      await startAdding();
      type('#wallet-address', ADDR_C);
      await save(() => alertText() !== '');
      expect(alertText()).toBe(RECOVERY_SESSION_WALLETS);
    });

    it('a confirm that ran out before the save asks to save and confirm again', async () => {
      stub.onPost = (_b, n) =>
        n === 1 ? { status: 403, json: { error: 'confirm-required', action: 'add-wallets' } } : { status: 403, json: { error: 'confirm-invalid' } };
      await mount();
      await startAdding();
      type('#wallet-address', ADDR_C);
      await save(confirmShown);
      type('#confirm-password', 'Correct-Horse-9!');
      await click('Confirm', dialog("Confirm it's you")!.querySelector('[data-method="password"]')!);
      expect(alertText()).toBe(CONFIRM_INVALID_WALLETS);
    });

    it("Task 30's refusalText words a wait after too many tries", async () => {
      stub.onPost = () => ({ status: 429, json: { error: 'slow-down', retryAfterSeconds: 120 } });
      await mount();
      await startAdding();
      type('#wallet-address', ADDR_C);
      await save(() => alertText() !== '');
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

// Owner demo note #219 (25 Nov 2026): an address already in the list dims Save and Add another,
// and says so under the field as it is typed (it was an error on Save).
describe('note #219: an address already in the list', () => {
  it('disables Save wallet and Add another, says why under the field, and sends nothing', async () => {
    await mount();
    await startAdding();
    expect(button('Save wallet').disabled).toBe(true);
    type('#wallet-address', READY.address);
    expect(button('Save wallet').disabled).toBe(true);
    expect(button('Add another').disabled).toBe(true);
    const said = document.querySelector('[data-part="wallet-repeated"]');
    expect(said?.textContent).toBe('That address is already in your list.');
    expect(document.querySelector('#wallet-address')!.getAttribute('aria-describedby')).toBe('wallet-address-repeated');
    expect(button('Save wallet').getAttribute('aria-describedby')).toBe('wallet-address-repeated');
    await click('Save wallet');
    expect(stub.calls.filter((c) => c.url === '/v1/wallets' && c.method === 'POST')).toEqual([]);
    type('#wallet-address', ADDR_C);
    expect(document.querySelector('[data-part="wallet-repeated"]')).toBeNull();
    expect(button('Save wallet').disabled).toBe(false);
    expect(button('Add another').disabled).toBe(false);
  });
});

describe('one trade only or future trades (owner demo note #6)', () => {
  function pickKeep(value: 'saved' | 'one-time'): void {
    const input = document.querySelector<HTMLInputElement>(`[data-part="wallet-keep-for"] input[value="${value}"]`);
    if (!input) throw new Error(`no keep-for choice ${value}`);
    fire(input, new MouseEvent('click', { bubbles: true }));
  }

  it('saves for future trades by default (no oneTime sent), and sends oneTime: true for one trade only', async () => {
    stub.rule = RULE_FIRST;
    stub.wallets = [];
    stub.onPost = (body) => ({ status: 201, json: created(body, '2026-10-24T00:00:00.000Z', true) });
    await mount();
    await startAdding();
    expect(document.querySelector<HTMLInputElement>('[data-part="wallet-keep-for"] input[value="saved"]')!.checked).toBe(true);
    type('#wallet-address', ADDR_C);
    await save(() => stub.calls.some((c) => c.method === 'POST'));
    const first = stub.calls.find((c) => c.method === 'POST')!;
    expect((first.body!.wallets as Array<Record<string, unknown>>)[0]).not.toHaveProperty('oneTime');

    stub.calls.length = 0;
    await startAdding();
    pickKeep('one-time');
    await settle();
    type('#wallet-address', address('D', 'BBBBB2'));
    await save(() => stub.calls.some((c) => c.method === 'POST'));
    const second = stub.calls.find((c) => c.method === 'POST')!;
    expect((second.body!.wallets as Array<Record<string, unknown>>)[0]).toMatchObject({ oneTime: true });
  });

  // Review 17 Nov (b) M1: a one-time wallet a trade in setup is using is shown, and can be removed.
  it('shows a one-time wallet in use by a trade, with its trade code, and lets the person remove it', async () => {
    const used: WalletView = { ...READY, id: 'w-used', label: 'Trade cash', oneTime: true, usable: false, inUseByTrade: 'ABCD-EFGH-JKLM-NPQR' };
    stub.wallets = [READY, used];
    await mount();
    const rows = [...document.querySelectorAll<HTMLElement>('.x2f-wallet-row')];
    expect(rows[1]!.querySelector('[data-part="in-use"]')!.textContent).toContain('ABCD-EFGH-JKLM-NPQR');
    expect(rows[1]!.textContent).toContain('In use');
    expect(rows[1]!.querySelector('[data-part="make-default"]')).toBeNull();
    await click('Remove Trade cash');
    expect(stub.calls.some((c) => c.method === 'DELETE' && c.url === '/v1/wallets/w-used')).toBe(true);
  });

  it('marks a one-time wallet in the list', async () => {
    stub.wallets = [READY, { ...READY, id: 'w-once', label: 'Trade cash', oneTime: true }];
    await mount();
    const rows = [...document.querySelectorAll('.x2f-wallet-row')];
    expect(rows.map((r) => r.querySelector('[data-part="one-time"]') !== null)).toEqual([false, true]);
    expect(rows[1]!.textContent).toContain('One trade only');
  });
});

describe('the default payout wallet in Your wallets (owner, 17 Nov 2026)', () => {
  it('marks the default, offers Make default on the other saved wallets only, and saves the choice', async () => {
    const other: WalletView = { ...READY, id: 'w-other', label: 'Spending', address: address('B', 'Mm2Kq9'), addressEnd: 'Mm2Kq9', isDefault: false };
    const once: WalletView = { ...READY, id: 'w-once', label: 'Trade cash', address: address('E', 'Pp7Lx3'), addressEnd: 'Pp7Lx3', oneTime: true, isDefault: false };
    stub.wallets = [{ ...READY, isDefault: true }, other, once];
    await mount();
    const rows = [...document.querySelectorAll<HTMLElement>('.x2f-wallet-row')];
    expect(rows.map((r) => r.querySelector('[data-part="default"]') !== null)).toEqual([true, false, false]);
    expect(rows.map((r) => [...r.querySelectorAll('button')].some((b) => b.textContent === 'Make default'))).toEqual([false, true, false]);
    // The server's answer is the truth: the list is read again after the choice.
    stub.wallets = [{ ...READY, isDefault: false }, { ...other, isDefault: true }, once];
    fire([...rows[1]!.querySelectorAll('button')].find((b) => b.textContent === 'Make default')!, new MouseEvent('click', { bubbles: true }));
    await until(() => document.querySelectorAll('.x2f-wallet-row')[1]?.querySelector('[data-part="default"]') != null);
    expect(stub.calls.some((c) => c.method === 'PUT' && c.url === '/v1/wallets/w-other/default')).toBe(true);
    const after = [...document.querySelectorAll<HTMLElement>('.x2f-wallet-row')];
    expect(after.map((r) => r.querySelector('[data-part="default"]') !== null)).toEqual([false, true, false]);
  });
  // Review of wip/third-trade-wallet 17 Nov (b), B1.
  it('offers no Make default on a wallet still waiting', async () => {
    const waiting: WalletView = { ...READY, id: 'w-wait', label: 'New', address: address('F', 'Qq1Zz9'), addressEnd: 'Qq1Zz9', usable: false, usableFrom: '2099-01-01T00:00:00.000Z', isDefault: false };
    stub.wallets = [{ ...READY, isDefault: true }, waiting];
    await mount();
    const rows = [...document.querySelectorAll<HTMLElement>('.x2f-wallet-row')];
    expect(rows.map((r) => r.querySelector('[data-part="make-default"]') !== null)).toEqual([false, false]);
  });

  it('a 409 wallet-not-ready says the wallet is still waiting', async () => {
    const other: WalletView = { ...READY, id: 'w-other', label: 'Spending', address: address('B', 'Mm2Kq9'), addressEnd: 'Mm2Kq9', isDefault: false };
    stub.wallets = [{ ...READY, isDefault: true }, other];
    stub.defaultAnswer = { status: 409, json: { error: 'wallet-not-ready' } };
    await mount();
    fire(document.querySelectorAll<HTMLElement>('[data-part="make-default"]')[0]!, new MouseEvent('click', { bubbles: true }));
    await until(() => (document.body.textContent ?? '').includes('still waiting. You can make it the default'));
  });
});

describe('the add records the address typed on this device, and refuses an answer naming another (review 17 Nov M4)', () => {
  it('records each typed address under the id the API gave it', async () => {
    stub.rule = RULE_FIRST;
    stub.wallets = [];
    stub.onPost = (body) => ({ status: 201, json: created(body, '2026-10-24T00:00:00.000Z', false) });
    await mount();
    await startAdding();
    type('#wallet-address', ADDR_C);
    await save(() => document.querySelector('.x2f-wallet-row') !== null);
    expect(typedAddressOf('w-new-0')).toBe(ADDR_C);
    expect(document.querySelector('.x2f-wallet-row')!.textContent).toContain(ADDR_C.slice(-6));
    // Never sent anywhere: the only request carrying the address is the add itself.
    expect(stub.calls.filter((c) => JSON.stringify(c).includes(ADDR_C)).map((c) => `${c.method} ${c.url}`)).toEqual(['POST /v1/wallets']);
  });

  it('an answer naming another address is refused: not shown as saved, and the typed address stays recorded for that id', async () => {
    const OTHER = address('X', 'OTHER9');
    stub.rule = RULE_FIRST;
    stub.wallets = [];
    stub.onPost = (body) => ({ status: 201, json: created(body, '2026-10-24T00:00:00.000Z', true).map((w) => ({ ...w, address: OTHER, addressEnd: 'OTHER9' })) });
    await mount();
    await startAdding();
    type('#wallet-address', ADDR_C);
    await save(() => document.querySelector('[role="alert"]') !== null);
    expect([...document.querySelectorAll('[role="alert"]')].some((a) => a.textContent?.includes('different address'))).toBe(true);
    expect(document.body.textContent).not.toContain('OTHER9');
    expect(typedAddressOf('w-new-0')).toBe(ADDR_C);
  });
});

describe('the list marks a wallet whose address differs from the one typed on this device (review 17 Nov M4)', () => {
  it('a row naming another address than this device recorded says it does not match, and offers no Make default', async () => {
    const other: WalletView = { ...READY, id: 'w-other', label: 'Spending', address: address('B', 'Mm2Kq9'), addressEnd: 'Mm2Kq9', isDefault: false };
    const swappedRow: WalletView = { ...READY, id: 'w-swapped', label: 'New', address: address('X', 'OTHER9'), addressEnd: 'OTHER9', isDefault: false };
    recordTypedAddress('w-swapped', ADDR_C);
    // A matching record changes nothing.
    recordTypedAddress('w-other', other.address);
    stub.wallets = [{ ...READY, isDefault: true }, other, swappedRow];
    await mount();
    const rows = [...document.querySelectorAll<HTMLElement>('.x2f-wallet-row')];
    expect(rows.map((r) => r.querySelector('[data-part="not-matching"]') !== null)).toEqual([false, false, true]);
    expect(rows[2]!.querySelector('[data-part="not-matching"]')!.textContent).toContain('does not match');
    expect(rows.map((r) => [...r.querySelectorAll('button')].some((b) => b.textContent === 'Make default'))).toEqual([false, true, false]);
  });
});

describe('a new id whose address ends like one typed on this device is marked too (re-verify 17 Nov N1)', () => {
  it('a look-alike row (same last 6, another address, another id) says it does not match and offers no Make default', async () => {
    recordTypedAddress('w-mine', ADDR_C);
    const other: WalletView = { ...READY, id: 'w-other', label: 'Spending', address: address('B', 'Mm2Kq9'), addressEnd: 'Mm2Kq9', isDefault: false };
    const lookalike: WalletView = { ...READY, id: 'w-evil', label: 'New', address: address('Z', 'AAAAA1'), addressEnd: 'AAAAA1', isDefault: false };
    stub.wallets = [{ ...READY, isDefault: true }, other, lookalike];
    await mount();
    const rows = [...document.querySelectorAll<HTMLElement>('.x2f-wallet-row')];
    expect(rows.map((r) => r.querySelector('[data-part="not-matching"]') !== null)).toEqual([false, false, true]);
    expect(rows.map((r) => [...r.querySelectorAll('button')].some((b) => b.textContent === 'Make default'))).toEqual([false, true, false]);
  });

  it('O3: an add staged for review (202) records the typed address, so a look-alike listed later is marked', async () => {
    stub.onPost = () => ({ status: 202, json: { status: 'staged', changeId: 'c-1' } });
    await mount();
    await startAdding();
    type('#wallet-address', ADDR_C);
    await save(() => document.querySelector('[data-part="staged-note"]') !== null || confirmShown());
    if (confirmShown()) {
      type('#confirm-password', 'Correct-Horse-9!');
      await click('Confirm', dialog("Confirm it's you")!.querySelector('[data-method="password"]')!);
      await until(() => document.querySelector('[data-part="staged-note"]') !== null);
    }
    expect(document.querySelector('[data-part="staged-note"]')).not.toBeNull();
    document.body.innerHTML = '';
    const lookalike: WalletView = { ...READY, id: 'w-evil', label: 'New', address: address('Z', 'AAAAA1'), addressEnd: 'AAAAA1', isDefault: false };
    stub.wallets = [{ ...READY, isDefault: true }, lookalike];
    await mount();
    const rows = [...document.querySelectorAll<HTMLElement>('.x2f-wallet-row')];
    expect(rows.map((r) => r.querySelector('[data-part="not-matching"]') !== null)).toEqual([false, true]);
  });
});

describe('Make default only on a wallet that works now (review 17 Nov M1)', () => {
  it('a waiting wallet offers no Make default (the API refuses it, 409 wallet-not-ready)', async () => {
    const waiting: WalletView = { ...READY, id: 'w-wait', label: 'New', address: address('W', 'Ww1Ww1'), addressEnd: 'Ww1Ww1', usable: false, usableFrom: '2099-01-01T00:00:00.000Z', isDefault: false };
    const other: WalletView = { ...READY, id: 'w-other', label: 'Spending', address: address('B', 'Mm2Kq9'), addressEnd: 'Mm2Kq9', isDefault: false };
    stub.wallets = [{ ...READY, isDefault: true }, other, waiting];
    await mount();
    const rows = [...document.querySelectorAll<HTMLElement>('.x2f-wallet-row')];
    expect(rows.map((r) => [...r.querySelectorAll('button')].some((b) => b.textContent === 'Make default'))).toEqual([false, true, false]);
  });
});

describe('the one-time copy says only what the restore does (review 17 Nov M3)', () => {
  it('a one-time wallet comes back only if the trade is cancelled while it is still being set up', () => {
    for (const note of [KEEP_FOR.oneTimeNote, NEW_ADDRESS.oneTimeNote]) {
      expect(note).toContain('cancelled while it is still being set up');
      expect(note).not.toContain('before any XMR is sent');
    }
  });
});

describe('renaming a wallet (owner demo note #226)', () => {
  const IN_USE: WalletView = { ...READY, id: 'w-used', label: 'Once', address: address('U', 'USED01'), addressEnd: 'USED01', usable: false, oneTime: true, inUseByTrade: 'AAAA-BBBB-CCCC-DDDD' };

  it('every open row has a Rename action (a wallet a trade used up has none)', async () => {
    stub.wallets = [READY, IN_USE];
    await mount();
    const rows = [...document.querySelectorAll('.x2f-wallet-row')];
    expect(rows[0]!.querySelector('[data-part="rename"]')!.textContent).toBe(RENAME.action);
    expect(rows[0]!.querySelector('[data-part="rename"]')!.getAttribute('aria-label')).toBe('Rename Savings');
    expect(rows[1]!.querySelector('[data-part="rename"]')).toBeNull();
  });

  it('opens a sheet on the current name; Save waits for a valid change; the row shows the new name, address and default unchanged', async () => {
    stub.wallets = [{ ...READY, isDefault: true }];
    await mount();
    fire(document.querySelector('[data-part="rename"]')!, new MouseEvent('click', { bubbles: true }));
    await settle();
    const input = document.querySelector<HTMLInputElement>('#wallet-rename')!;
    const save = () => document.querySelector<HTMLButtonElement>('[data-part="wallet-rename-save"]')!;
    expect(input.value).toBe('Savings');
    expect(save().disabled).toBe(true);
    // One primary per state: the footer's Add a wallet steps down under the sheet.
    expect(document.querySelectorAll('[data-primary]')).toHaveLength(1);
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setValue.call(input, 'Rent money');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(save().disabled).toBe(false);
    fire(save(), new MouseEvent('click', { bubbles: true }));
    await until(() => document.querySelector('#wallet-rename') === null);
    expect(stub.calls.filter((c) => c.method === 'PUT').map((c) => [c.url, c.body])).toEqual([['/v1/wallets/w-ready/label', { label: 'Rent money' }]]);
    const row = document.querySelector('.x2f-wallet-row')!;
    expect(row.querySelector('.x2f-wallet-row__name')!.textContent).toBe('Rent money');
    expect(row.querySelector('.x2f-wallet-row__addr')!.textContent).toContain('Rk3Fz1');
    expect(row.querySelector('[data-part="default"]')).not.toBeNull();
  });
});
