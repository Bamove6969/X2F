// @vitest-environment happy-dom
// Owner demo note #161 (23 Nov, /setup/wallet): the first wallet added in sign-up goes with no
// confirm-it's-you (the API's sign-up window rule, apps/api/src/wallets/routes.ts walletConfirm), and
// once saved the screen lights up green like "Key verified": a valid Monero address (network and
// checksum checked), never a claim that the address is proven to be this person's. COPY-UNSIGNED.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { walletsAction } from '@x2f/auth-client';
import { ConfirmSheet } from '../src/screens/auth/ConfirmSheet.js';
import { checklist } from '../src/screens/setup/Welcome.js';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL, SetupContext, type SetupApi } from '../src/screens/setup/kit.js';
import { WALLET_COPY, Wallet } from '../src/screens/setup/Wallet.js';
import { forgetTypedAddresses } from '../src/screens/walletRecord.js';
import { fire, render } from './render.js';

const ADDRESS = `4${'7'.repeat(88)}Qk3Fz9`;

let calls: { url: string; method: string; body: string }[];
let answer: () => Response;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  localStorage.clear();
  forgetTypedAddresses();
  calls = [];
  answer = () =>
    json(201, [{ id: 'w1', app: 'other', label: 'Wallet 1', address: ADDRESS, addressEnd: 'Qk3Fz9', usableFrom: '2026-11-23T00:00:00.000Z', usable: true }]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : '' });
      if (url === '/v1/wallets' && method === 'POST') return answer();
      if (url === '/v1/account/me') return json(200, { methods: ['pgp'] });
      return json(404, { error: 'not-found' });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup(): SetupApi {
  return { state: { ...INITIAL, registered: true }, update: vi.fn(), returnTo: '/sell', go: vi.fn(), path: (s) => `/setup/${s}` };
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function submit(api: SetupApi, ready: () => boolean): Promise<void> {
  render(
    <MemoryRouter>
      <SetupContext.Provider value={api}>
        <Wallet />
      </SetupContext.Provider>
    </MemoryRouter>,
  );
  const input = document.querySelector<HTMLInputElement>('#xmr-payout')!;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    set.call(input, ADDRESS);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  fire(document.querySelector('[data-part="wallet-finish"]')!, new MouseEvent('click', { bubbles: true }));
  const deadline = Date.now() + 2000;
  while (!ready() && Date.now() < deadline) await settle();
}

const text0 = () => document.body.textContent ?? '';
const verified = () => document.querySelector('[data-part="address-verified"]');

describe('owner #161: the first wallet in sign-up', () => {
  it('is sent once with no confirm token, opens no confirm sheet, and shows the green "Valid Monero address" check', async () => {
    const api = setup();
    await submit(api, () => verified() !== null);
    // One add, no token, nothing asked of the person.
    const adds = calls.filter((c) => c.url === '/v1/wallets' && c.method === 'POST');
    expect(adds).toHaveLength(1);
    expect(JSON.parse(adds[0]!.body)).toEqual({ wallets: [{ app: 'other', label: 'Wallet 1', address: ADDRESS }] });
    expect(calls.some((c) => c.url.startsWith('/v1/confirm'))).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    // The check, styled like "Key verified" (the green .x2f-start__verified-big).
    const big = verified()!;
    expect(big.classList.contains('x2f-start__verified-big')).toBe(true);
    expect(big.querySelector('svg')).not.toBeNull();
    expect(big.querySelector('.x2f-start__verified-word')!.textContent).toBe('Valid Monero address');
    // Owner #162, his words (the "!" made a full stop: copy-lint).
    expect(document.querySelector('h1')!.textContent).toBe('Your first payout wallet has been added.');
    expect(text0()).toContain("You're all set. Happy trading.");
    expect(WALLET_COPY.savedBody).toBe("You're all set. Happy trading.");
    expect(document.querySelector('[data-part="address-end"]')!.textContent).toContain('Qk3Fz9');
    // Truthful: format and checksum, never ownership.
    const text = document.body.textContent!;
    expect(text).toContain('checksum');
    expect(text).not.toMatch(/\b(yours|you own|ownership|proven|authenticated)\b/i);
    // The form is gone: only Continue.
    expect(document.querySelector('#xmr-payout')).toBeNull();
    expect([...document.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Continue']);
    expect(api.go).not.toHaveBeenCalled();

    fire(document.querySelector('[data-part="wallet-continue"]')!, new MouseEvent('click', { bubbles: true }));
    expect(api.go).toHaveBeenCalledWith('welcome');
  });

  it('a staged add (202, not saved yet) shows no check and goes on to Welcome as before', async () => {
    answer = () => json(202, { status: 'staged', changeId: 'c-1' });
    const api = setup();
    await submit(api, () => vi.mocked(api.go).mock.calls.length > 0);
    expect(api.go).toHaveBeenCalledWith('welcome');
    expect(verified()).toBeNull();
  });

  it('a refused address shows its error and no check', async () => {
    answer = () => json(400, { error: 'address-invalid' });
    const api = setup();
    await submit(api, () => document.querySelector('[data-part="wallet-error"]') !== null);
    expect(document.querySelector('[data-part="wallet-error"]')!.textContent).toContain("isn't a Monero address");
    expect(verified()).toBeNull();
    expect(api.go).not.toHaveBeenCalled();
  });

  it('when the API still asks (outside the sign-up window) the confirm sheet opens, and no check shows yet', async () => {
    answer = () => json(403, { error: 'confirm-required', action: 'add-wallets' });
    const api = setup();
    await submit(api, () => document.querySelector('[role="dialog"]') !== null);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(verified()).toBeNull();
    expect(api.go).not.toHaveBeenCalled();
  });
});

describe('owner #163: the ending shown is the real end of the address typed', () => {
  it('the green check names the last characters of exactly the typed address, and so does the Welcome checklist', async () => {
    const typed = `8${'B'.repeat(88)}rT5mWq`;
    answer = () => json(201, [{ id: 'w9', app: 'other', label: 'Wallet 1', address: typed, addressEnd: typed.slice(-6), usableFrom: '2026-11-23T00:00:00.000Z', usable: true }]);
    const api = setup();
    render(
      <MemoryRouter>
        <SetupContext.Provider value={api}>
          <Wallet />
        </SetupContext.Provider>
      </MemoryRouter>,
    );
    const input = document.querySelector<HTMLInputElement>('#xmr-payout')!;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      set.call(input, ` ${typed} `);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    fire(document.querySelector('[data-part="wallet-finish"]')!, new MouseEvent('click', { bubbles: true }));
    const deadline = Date.now() + 2000;
    while (verified() === null && Date.now() < deadline) await settle();
    const shown = document.querySelector('[data-part="address-end"]')!.textContent!;
    const end = /ending (\S+)\./.exec(shown)![1]!;
    expect(end).toBe(typed.slice(-6));
    expect(end.endsWith(typed.slice(-4))).toBe(true);
    expect(shown).not.toContain('k3Fz');
    expect(api.update).toHaveBeenCalledWith({ wallet: { app: 'other', addressEnd: typed.slice(-6) } });

    // Welcome's "Wallet 1 …xxxx" comes from the saved wallet the API lists, so it is that address's end too.
    const c = checklist({ methods: ['pgp'] }, [{ id: 'w9', app: 'other', label: 'Wallet 1', address: typed, addressEnd: typed.slice(-6), usableFrom: '2026-11-23T00:00:00.000Z', usable: true, oneTime: false, isDefault: true, inUseByTrade: null }] as never, { registered: true, method: 'pgp', backup: 'recovery-codes' });
    expect(c.wallet).toEqual({ name: 'Wallet 1', app: null, end: typed.slice(-6) });
    expect(c.wallet!.end.endsWith(typed.slice(-4))).toBe(true);
  });
});

describe('owner #164: the wallet sheet note is bigger and in ink', () => {
  it('the wait note in the wallet confirm sheet carries the bigger style, and that style is 17 px in ink', async () => {
    vi.stubGlobal('fetch', async () => json(200, { firstWallet: true, strongMethods: ['pgp'], password: 'none', waitHours: 24 }));
    render(<ConfirmSheet action={await walletsAction([ADDRESS])} methods={['pgp']} onToken={() => undefined} onCancel={() => undefined} />);
    for (let i = 0; i < 5 && document.querySelector('[data-part="wallet-wait"]') === null; i++) await settle();
    const note = document.querySelector('[data-part="wallet-wait"]')!;
    expect(note.classList.contains('x2f-note--wallet')).toBe(true);
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/screens/screens.css'), 'utf8');
    const rule = /\.x2f-note\.x2f-note--wallet\s*\{([^}]*)\}/.exec(css)![1]!;
    expect(rule).toMatch(/font-size:\s*17px/);
    expect(rule).toMatch(/color:\s*var\(--x2f-ink\)/);
  });
});
