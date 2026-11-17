// @vitest-environment happy-dom
// Review 17 Nov 2026 M4, follow-up: the first payout wallet added during setup (Setup step 5) keeps
// the address typed on this device under the id the API gave it (walletRecord.ts), as the Settings
// add does, and refuses an answer naming another address.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL, SetupContext, type SetupApi } from '../src/screens/setup/kit.js';
import { Wallet } from '../src/screens/setup/Wallet.js';
import { forgetTypedAddresses, matchesRecord, typedAddressOf } from '../src/screens/walletRecord.js';
import { fire, render } from './render.js';

const address = (seed: string, end: string) => `4${seed.repeat(95).slice(0, 88)}${end}`;
const TYPED = address('C', 'AAAAA1');
const OTHER = address('X', 'OTHER9');

let answer: (body: { wallets: { app: string; label: string; address: string }[] }) => unknown;
let calls: { url: string; method: string; body: string }[];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  localStorage.clear();
  forgetTypedAddresses();
  calls = [];
  answer = (b) => b.wallets.map((w, i) => ({ ...w, id: `w-first-${i}`, addressEnd: w.address.slice(-6), usableFrom: '2026-10-24T00:00:00.000Z', usable: true }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? init.body : '';
      calls.push({ url, method, body });
      if (url === '/v1/wallets' && method === 'POST') return json(201, answer(JSON.parse(body) as Parameters<typeof answer>[0]));
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
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** Settles until `ready()` holds, for at most 2 s (the address hash resolves off the timer queue). */
async function until(ready: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!ready() && Date.now() < deadline) await settle();
}

async function finish(api: SetupApi, typed: string, answered: () => boolean): Promise<void> {
  render(
    <MemoryRouter>
      <SetupContext.Provider value={api}>
        <Wallet />
      </SetupContext.Provider>
    </MemoryRouter>,
  );
  const input = document.querySelector<HTMLInputElement>('#addr')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setValue.call(input, typed);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  fire(document.querySelector('[data-part="wallet-finish"]')!, new MouseEvent('click', { bubbles: true }));
  await until(answered);
}

describe('the first wallet in setup records the address typed on this device (review 17 Nov M4)', () => {
  it('records the typed address under the id the API gave it, and goes on to Welcome', async () => {
    const api = setup();
    await finish(api, `  ${TYPED} `, () => vi.mocked(api.go).mock.calls.length > 0);
    expect(typedAddressOf('w-first-0')).toBe(TYPED);
    expect(api.go).toHaveBeenCalledWith('welcome');
    // Never sent anywhere: the only request carrying the address is the add itself.
    expect(calls.filter((c) => c.body.includes(TYPED) || c.url.includes(TYPED)).map((c) => `${c.method} ${c.url}`)).toEqual(['POST /v1/wallets']);
  });

  it('an answer naming another address is refused: no Welcome, not shown as saved, and the typed address stays recorded for that id', async () => {
    answer = (b) => b.wallets.map((w, i) => ({ ...w, address: OTHER, id: `w-first-${i}`, addressEnd: 'OTHER9', usableFrom: '2026-10-24T00:00:00.000Z', usable: true }));
    const api = setup();
    await finish(api, TYPED, () => document.querySelector('[data-part="wallet-error"]') !== null);
    expect(document.querySelector('[data-part="wallet-error"]')!.textContent).toContain('different address');
    expect(api.go).not.toHaveBeenCalled();
    expect(api.update).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('OTHER9');
    expect(typedAddressOf('w-first-0')).toBe(TYPED);
  });

  it('re-verify N1 (O3): a first wallet staged for review (202) is recorded by address, so a look-alike under any id does not match', async () => {
    answer = () => ({ status: 'staged', changeId: 'c-1' });
    const api = setup();
    await finish(api, TYPED, () => vi.mocked(api.go).mock.calls.length > 0);
    expect(api.go).toHaveBeenCalledWith('welcome');
    expect(matchesRecord({ id: 'w-evil', address: address('Z', 'AAAAA1') })).toBe(false);
    expect(matchesRecord({ id: 'w-later', address: TYPED })).toBe(true);
  });
});
