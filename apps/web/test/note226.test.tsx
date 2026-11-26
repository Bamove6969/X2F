// @vitest-environment happy-dom
// Owner demo note #226 (25 Nov 2026): "Make sure there is an option to name the wallet when they
// enter it in and an option to change it rename the wallet in settings later. Traders want to know
// where each wallet is going". The optional name on the sign-up wallet step, the Rename sheet in
// Settings → Your wallets, and the name on the Welcome checklist.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanWalletLabel } from '@x2f/auth-client';
import { INITIAL, SetupContext, type SetupApi } from '../src/screens/setup/kit.js';
import { FIRST_WALLET_LABEL, WALLET_COPY, Wallet, setupWalletLabel } from '../src/screens/setup/Wallet.js';
import { walletName } from '../src/screens/setup/Welcome.js';
import { RenameSheet, renameReady } from '../src/screens/WalletRename.js';
import { RENAME, WALLET_NAME_HELP } from '../src/screens/walletsCopy.js';
import { forgetTypedAddresses } from '../src/screens/walletRecord.js';
import { fire, render } from './render.js';

const TYPED = `4${'C'.repeat(88)}AAAAA1`;

let calls: { url: string; method: string; body: string }[];
let reply: (url: string, method: string, body: string) => Response;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  localStorage.clear();
  forgetTypedAddresses();
  calls = [];
  reply = (url, method, body) => {
    if (url === '/v1/wallets' && method === 'POST') {
      const b = JSON.parse(body) as { wallets: { app: string; label: string; address: string }[] };
      return json(201, b.wallets.map((w, i) => ({ ...w, id: `w-${i}`, addressEnd: w.address.slice(-6), usableFrom: '2026-11-25T00:00:00.000Z', usable: true })));
    }
    if (/^\/v1\/wallets\/[^/]+\/label$/.test(url) && method === 'PUT') return new Response(null, { status: 204 });
    return json(404, { error: 'not-found' });
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? init.body : '';
      calls.push({ url, method, body });
      return reply(url, method, body);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
function type(sel: string, value: string): void {
  const input = document.querySelector<HTMLInputElement>(sel)!;
  act(() => {
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function settle(ready: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!ready() && Date.now() < deadline) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function setup(): SetupApi {
  return { state: { ...INITIAL, registered: true }, update: vi.fn(), returnTo: '/sell', go: vi.fn(), path: (s) => `/setup/${s}` };
}

function showSetup(): void {
  render(
    <MemoryRouter>
      <SetupContext.Provider value={setup()}>
        <Wallet />
      </SetupContext.Provider>
    </MemoryRouter>,
  );
}

const finishButton = () => document.querySelector<HTMLButtonElement>('[data-part="wallet-finish"]')!;
const posted = () => calls.filter((c) => c.method === 'POST' && c.url === '/v1/wallets').map((c) => (JSON.parse(c.body) as { wallets: { label: string }[] }).wallets.map((w) => w.label));

describe('the sign-up wallet step: an optional name (note #226)', () => {
  it('the rule is the API\'s: empty is the neutral "Wallet 1", a typed name is trimmed, a bad one is null', () => {
    expect(FIRST_WALLET_LABEL).toBe('Wallet 1');
    expect(setupWalletLabel('')).toBe('Wallet 1');
    expect(setupWalletLabel('   ')).toBe('Wallet 1');
    expect(setupWalletLabel('  Cake Wallet savings ')).toBe('Cake Wallet savings');
    expect(setupWalletLabel('x'.repeat(41))).toBeNull();
    expect(setupWalletLabel('a‮b')).toBeNull();
    expect(setupWalletLabel('a​b')).toBeNull();
    expect(cleanWalletLabel('🙂'.repeat(40))).toBe('🙂'.repeat(40));
  });

  it('shows the field with the owner\'s wording, and keeps the earlier copy notes on the screen', () => {
    showSetup();
    const input = document.querySelector<HTMLInputElement>('#wallet-name')!;
    expect(input.closest('label')!.textContent).toContain('Wallet name (optional)');
    expect(input.placeholder).toBe('e.g. Cake Wallet savings');
    expect(input.maxLength).toBe(40);
    expect(WALLET_COPY.nameField).toBe('Wallet name (optional)');
    // Owner notes #156-#160 stay as they were.
    expect(document.body.textContent).toContain(WALLET_COPY.field);
    expect(document.querySelector('[data-part="first-wallet-rule"]')!.textContent).toContain('This is your first payout wallet, so it works right away.');
    expect(document.querySelector('[data-part="address-reuse"]')!.textContent).toContain('Monero addresses never expire.');
  });

  it('left empty, Finish setup depends on the address alone and the wallet is saved as "Wallet 1"', async () => {
    showSetup();
    expect(finishButton().disabled).toBe(true);
    type('#xmr-payout', TYPED);
    expect(finishButton().disabled).toBe(false);
    fire(finishButton(), new MouseEvent('click', { bubbles: true }));
    await settle(() => posted().length > 0);
    expect(posted()).toEqual([['Wallet 1']]);
  });

  it('a typed name is saved (trimmed) instead of the default', async () => {
    showSetup();
    type('#xmr-payout', TYPED);
    type('#wallet-name', '  Cake Wallet savings  ');
    fire(finishButton(), new MouseEvent('click', { bubbles: true }));
    await settle(() => posted().length > 0);
    expect(posted()).toEqual([['Cake Wallet savings']]);
  });

  it('an invalid name holds Finish setup back and says why; fixing it lets it go (note #219)', () => {
    showSetup();
    type('#xmr-payout', TYPED);
    type('#wallet-name', 'a‮b');
    expect(finishButton().disabled).toBe(true);
    expect(document.querySelector('[data-part="wallet-name-invalid"]')!.textContent).toBe(WALLET_NAME_HELP.characters);
    expect(document.querySelector('#wallet-name')!.getAttribute('aria-invalid')).toBe('true');
    type('#wallet-name', 'Savings');
    expect(finishButton().disabled).toBe(false);
    expect(document.querySelector('[data-part="wallet-name-invalid"]')).toBeNull();
  });
});

const WALLET = {
  id: 'w-1', app: 'other' as const, label: 'Wallet 1', address: TYPED, addressEnd: 'AAAAA1', usableFrom: '2026-11-25T00:00:00.000Z', usable: true, isDefault: true,
};

describe('the Rename sheet in Settings → Your wallets (note #226)', () => {
  it('Save is ready only for an allowed name that differs from the current one', () => {
    expect(renameReady('Wallet 1', 'Wallet 1')).toBe(false);
    expect(renameReady('  Wallet 1 ', 'Wallet 1')).toBe(false);
    expect(renameReady('', 'Wallet 1')).toBe(false);
    expect(renameReady('x'.repeat(41), 'Wallet 1')).toBe(false);
    expect(renameReady('a\u0007b', 'Wallet 1')).toBe(false);
    expect(renameReady('Savings', 'Wallet 1')).toBe(true);
  });

  it('starts on the current name with Save disabled, sends only the trimmed label, and reports it back', async () => {
    const onRenamed = vi.fn();
    render(<RenameSheet wallet={WALLET} onClose={vi.fn()} onRenamed={onRenamed} />);
    const input = document.querySelector<HTMLInputElement>('#wallet-rename')!;
    const save = () => document.querySelector<HTMLButtonElement>('[data-part="wallet-rename-save"]')!;
    expect(input.value).toBe('Wallet 1');
    expect(save().disabled).toBe(true);
    expect(save().textContent).toBe(RENAME.save);
    type('#wallet-rename', 'a‮b');
    expect(save().disabled).toBe(true);
    expect(document.querySelector('[data-part="wallet-rename-invalid"]')!.textContent).toBe(WALLET_NAME_HELP.characters);
    type('#wallet-rename', '  Going to savings ');
    expect(save().disabled).toBe(false);
    fire(save(), new MouseEvent('click', { bubbles: true }));
    await settle(() => onRenamed.mock.calls.length > 0);
    expect(onRenamed).toHaveBeenCalledWith('Going to savings');
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([['PUT', '/v1/wallets/w-1/label', JSON.stringify({ label: 'Going to savings' })]]);
  });

  it('a wallet gone meanwhile (404) says so in the sheet and reports nothing', async () => {
    reply = () => json(404, { error: 'not-found' });
    const onRenamed = vi.fn();
    render(<RenameSheet wallet={WALLET} onClose={vi.fn()} onRenamed={onRenamed} />);
    type('#wallet-rename', 'Savings');
    fire(document.querySelector('[data-part="wallet-rename-save"]')!, new MouseEvent('click', { bubbles: true }));
    await settle(() => document.querySelector('[data-part="wallet-rename-error"]') !== null);
    expect(document.querySelector('[data-part="wallet-rename-error"]')!.textContent).toBe(RENAME.gone);
    expect(onRenamed).not.toHaveBeenCalled();
  });
});

describe('the Welcome checklist shows the name (note #226)', () => {
  it('a wallet saved as Other goes by its name; one in a named app gets the app after the name', () => {
    expect(walletName({ app: 'other', label: 'Cake Wallet savings' })).toEqual({ name: 'Cake Wallet savings', app: null });
    expect(walletName({ app: 'other', label: '' })).toEqual({ name: 'Other', app: null });
    expect(walletName({ app: 'cake', label: 'Savings' })).toEqual({ name: 'Savings', app: 'Cake Wallet' });
    expect(walletName({ app: 'cake', label: '' })).toEqual({ name: 'Cake Wallet', app: null });
  });
});

describe('security review of wip/lead-note-226 (Medium 1 and 2): spoofing names', () => {
  it('the setup field says why a spoofing name is refused, and holds Finish setup back', () => {
    showSetup();
    type('#xmr-payout', TYPED);
    for (const [typed, why] of [
      ['Savings …Rk3Fz1', 'separator'], ['Main · Cake', 'separator'], ['Default', 'status'], ['Ready', 'status'], ['Rk3Fz1', 'address'], ['S\u0430vings', 'characters'],
    ] as const) {
      type('#wallet-name', typed);
      expect(finishButton().disabled, typed).toBe(true);
      expect(document.querySelector('[data-part="wallet-name-invalid"]')!.textContent, typed).toBe(WALLET_NAME_HELP[why]);
    }
    type('#wallet-name', 'Spending 2');
    expect(finishButton().disabled).toBe(false);
  });

  it('the rename sheet keeps Save disabled for a spoofing name and says why', () => {
    render(<RenameSheet wallet={WALLET} onClose={vi.fn()} onRenamed={vi.fn()} />);
    const save = () => document.querySelector<HTMLButtonElement>('[data-part="wallet-rename-save"]')!;
    for (const [typed, why] of [['Wallet 1 · Default', 'separator'], ['Usable', 'status'], ['abc123x', 'address']] as const) {
      type('#wallet-rename', typed);
      expect(save().disabled, typed).toBe(true);
      expect(document.querySelector('[data-part="wallet-rename-invalid"]')!.textContent).toBe(WALLET_NAME_HELP[why]);
    }
  });

  it('429 slow-down says the day is used up', async () => {
    render(<RenameSheet wallet={WALLET} onClose={vi.fn()} onRenamed={vi.fn()} />);
    type('#wallet-rename', 'Savings');
    reply = () => json(429, { error: 'slow-down', retryAfterSeconds: 3600 });
    fire(document.querySelector('[data-part="wallet-rename-save"]')!, new MouseEvent('click', { bubbles: true }));
    await settle(() => document.querySelector('[data-part="wallet-rename-error"]') !== null);
    expect(document.querySelector('[data-part="wallet-rename-error"]')!.textContent).toBe(RENAME.capped);
  });
});

describe('verification review of wip/lead-note-226: a name may not spell the end of an address on the screen', () => {
  it('setup: the end of the address typed (any case, spaced) holds Finish setup back', () => {
    showSetup();
    type('#xmr-payout', TYPED);
    for (const typed of ['Savings aaaaa1', 'AAAAA', 'aa-aaa']) {
      type('#wallet-name', typed);
      expect(finishButton().disabled, typed).toBe(true);
      expect(document.querySelector('[data-part="wallet-name-invalid"]')!.textContent).toBe(WALLET_NAME_HELP.address);
    }
    expect(setupWalletLabel('Savings aaaaa1', TYPED)).toBeNull();
    expect(setupWalletLabel('Savings aaaaa1')).toBe('Savings aaaaa1');
  });

  it('rename: the end of any listed address, and its fullwidth form, keep Save disabled', () => {
    const other = `4${'9'.repeat(88)}kfzxqm`;
    render(<RenameSheet wallet={WALLET} addresses={[TYPED, other]} onClose={vi.fn()} onRenamed={vi.fn()} />);
    const save = () => document.querySelector<HTMLButtonElement>('[data-part="wallet-rename-save"]')!;
    for (const typed of ['Savings kfzxqm', 'ｋｆｚｘｑ', 'AAAAA1']) {
      type('#wallet-rename', typed);
      expect(save().disabled, typed).toBe(true);
    }
    type('#wallet-rename', 'Monero main');
    expect(save().disabled).toBe(false);
    expect(renameReady('Savings kfzxqm', 'Wallet 1', [other])).toBe(false);
    expect(renameReady('Savings kfzxqm', 'Wallet 1')).toBe(true);
  });
});
