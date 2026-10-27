// @vitest-environment happy-dom
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { AcceptedSheet, type AcceptedWallet } from '../src/screens/AcceptedSheet.js';
import { fire, render } from './render.js';

// Fixtures (test-only): an accepted event and the poster's wallets as GET /v1/wallets returns them.
const EVENT = { type: 'accepted' as const, code: 'X2F-7KQ4-M9TD', by: 'mira.K_77' };
const WALLETS: AcceptedWallet[] = [
  { id: 'w1', app: 'cake', label: 'Cake main', addressEnd: 'a1b2c3', usable: true },
  { id: 'w2', app: 'feather', label: 'Feather', addressEnd: 'd4e5f6', usable: true },
  { id: 'w3', app: 'edge', label: 'New Edge', addressEnd: '778899', usable: false },
];

const flush = () => act(async () => undefined);
const sheet = () => document.querySelector('[role="dialog"]') as HTMLElement;
const button = (text: string) =>
  [...sheet().querySelectorAll<HTMLElement>('button, a')].find((b) => b.textContent === text) as HTMLElement;

describe('AcceptedSheet', () => {
  it('names the taker by display name exactly as set, and lists only usable wallets', async () => {
    render(<AcceptedSheet event={EVENT} loadWallets={async () => WALLETS} submit={async () => undefined} onDone={() => undefined} onClose={() => undefined} />);
    await flush();
    expect(sheet().querySelector('h2')!.textContent).toBe('mira.K_77 accepted your offer');
    const options = [...sheet().querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
    expect(options.map((o) => o.value)).toEqual(['w1', 'w2']);
    expect(sheet().textContent).toContain('Cake main');
    expect(sheet().textContent).not.toContain('New Edge');
    expect(sheet().querySelectorAll('[data-primary]')).toHaveLength(1);
  });

  it('pre-selects no wallet (OD-11, no default payout wallet): Use this wallet is disabled until a radio is chosen', async () => {
    render(<AcceptedSheet event={EVENT} loadWallets={async () => WALLETS} submit={async () => undefined} onDone={() => undefined} onClose={() => undefined} />);
    await flush();
    const options = [...sheet().querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
    expect(options.map((o) => o.checked)).toEqual([false, false]);
    expect((button('Use this wallet') as HTMLButtonElement).disabled).toBe(true);
    fire(options[0]!, new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(options[0]!.checked).toBe(true);
    expect((button('Use this wallet') as HTMLButtonElement).disabled).toBe(false);
  });

  it('posts the picked wallet for this trade and moves on to Setting up escrow', async () => {
    const posted: Array<[string, string]> = [];
    const done: string[] = [];
    render(
      <AcceptedSheet
        event={EVENT}
        loadWallets={async () => WALLETS}
        submit={async (code, walletId) => void posted.push([code, walletId])}
        onDone={(code) => done.push(code)}
        onClose={() => undefined}
      />,
    );
    await flush();
    const second = sheet().querySelector('input[value="w2"]') as HTMLInputElement;
    fire(second, new MouseEvent('click', { bubbles: true }));
    await act(async () => {
      button('Use this wallet').click();
    });
    await flush();
    expect(posted).toEqual([['X2F-7KQ4-M9TD', 'w2']]);
    expect(sheet().textContent).toContain('Setting up escrow');
    expect(done).toEqual(['X2F-7KQ4-M9TD']);
  });

  it('offers Add a wallet, returning to this trade, when no wallet is usable', async () => {
    render(
      <AcceptedSheet event={EVENT} loadWallets={async () => [WALLETS[2]!]} submit={async () => undefined} onDone={() => undefined} onClose={() => undefined} />,
    );
    await flush();
    const add = button('Add a wallet');
    expect(add.getAttribute('href')).toBe('/wallets?add=1&returnTo=%2Ftrade%2FX2F-7KQ4-M9TD');
    expect(add.hasAttribute('data-primary')).toBe(true);
    expect(sheet().querySelectorAll('[data-primary]')).toHaveLength(1);
    expect(sheet().querySelector('input[type="radio"]')).toBeNull();
  });

  it('shows a refusal and lets the poster try again', async () => {
    let tries = 0;
    render(
      <AcceptedSheet
        event={EVENT}
        loadWallets={async () => WALLETS}
        submit={async () => {
          tries++;
          if (tries === 1) throw new Error('wrong-state');
        }}
        onDone={() => undefined}
        onClose={() => undefined}
      />,
    );
    await flush();
    fire(sheet().querySelector('input[value="w1"]') as HTMLInputElement, new MouseEvent('click', { bubbles: true }));
    await act(async () => {
      button('Use this wallet').click();
    });
    await flush();
    expect(sheet().querySelector('[role="alert"]')!.textContent).toBe('That did not work. Try again.');
    await act(async () => {
      button('Use this wallet').click();
    });
    await flush();
    expect(tries).toBe(2);
    expect(sheet().textContent).toContain('Setting up escrow');
  });
});
