// @vitest-environment happy-dom
// Task 30 fix round: the wallet note driven by
// GET /v1/wallets/rule (M2), one confirm at a time (M3), and alert labels (M1).
import { act, useEffect } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { walletAction, walletsAction, type ConfirmAction, type WalletRule } from '@x2f/auth-client';
import { ConfirmSheet, useConfirm, walletWaitNote } from '../src/screens/auth/ConfirmSheet.js';
import { authApi } from '../src/screens/auth/authApi.js';
import { Alerts, alertWords } from '../src/screens/settings/Alerts.js';
import { render } from './render.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const flush = () => act(async () => new Promise<void>((r) => setTimeout(r, 0)));


const rule = (o: Partial<WalletRule> = {}): WalletRule => ({ firstWallet: false, strongMethods: [], ...o });

describe('wallet-wait note (rule from GET /v1/wallets/rule)', () => {
  it('the first wallet never waits, whatever the method', () => {
    expect(walletWaitNote(rule({ firstWallet: true }), false)).toBe('This is your first payout wallet, so it works at once however you confirm.');
  });

  it('a strong method names itself; with none, confirming works at once all the same', () => {
    expect(walletWaitNote(rule({ strongMethods: ['passkey'] }), false)).toBe('Confirm with your passkey and this wallet works at once.');
    expect(walletWaitNote(rule({ strongMethods: ['security-key', 'pgp'] }), true)).toBe(
      'Confirm with your security key or PGP key and these wallets work at once.',
    );
    expect(walletWaitNote(rule(), true)).toBe("Confirm it's you and these wallets work at once.");
  });

  it('ConfirmSheet reads the rule for add-wallet and add-wallets', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      new Response(JSON.stringify(url === '/v1/wallets/rule' ? rule({ firstWallet: true }) : {}), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const batch = await walletsAction([`4${'A'.repeat(88)}aaa111`, `4${'B'.repeat(88)}bbb222`]);
    render(<ConfirmSheet action={batch} methods={['passkey']} onToken={() => undefined} onCancel={() => undefined} />);
    await flush();
    expect(document.querySelector('[data-part="action"]')?.textContent).toContain('add 2 payout wallets');
    expect(document.querySelector('[data-part="wallet-wait"]')?.textContent).toContain('first payout wallet');
    expect(fetchMock.mock.calls.map((c) => c[0])).toContain('/v1/wallets/rule');
  });
});

describe('one confirm at a time', () => {
  it('a second prove while one is open is refused; the open one still completes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ methods: ['password'] }), { status: 200, headers: { 'content-type': 'application/json' } })),
    );
    let prove: ((a: ConfirmAction) => Promise<string>) | null = null;
    function Harness() {
      const c = useConfirm();
      useEffect(() => {
        prove = c.prove;
      });
      return <>{c.confirmUi}</>;
    }
    render(<Harness />);
    const first = prove!({ kind: 'new-recovery-codes' });
    await flush();
    const second = prove!(await walletAction(`4${'C'.repeat(88)}ccc333`));
    await expect(second).rejects.toThrow('confirm busy');
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.querySelector('[data-part="action"]')?.textContent).toContain('make new recovery codes');
    // The open confirm is still live: closing it settles the first promise.
    (document.querySelector('[aria-label="Close"]') as HTMLButtonElement).click();
    await expect(first).rejects.toThrow('confirm cancelled');
  });
});

describe('alert labels', () => {
  it('names every kind the server sends, in plain words', () => {
    for (const k of ['new-login', 'recovery-login', 'recovery-hold-cancelled', 'login-locked', 'login-method-added', 'login-method-removed', 'sessions-ended', 'wallet-added', 'wallet-removed', 'device-key-added', 'login-approval', 'login-blocked', 'logged-out-by-new-device', 'one-device-set', 'hold-started', 'hold-ended']) {
      const w = alertWords(k);
      expect(w, k).not.toMatch(/[a-z]-[a-z]/);
      expect(w, k).not.toBe('Security alert');
    }
  });

  it('never shows an unknown kind raw', () => {
    expect(alertWords('payout-wait-off-scheduled')).toBe('Security alert');
  });

  it('member={true} hides the alerts list card and skips loading alerts (order #2 M3)', () => {
    const listSpy = vi.spyOn(authApi, 'listAlerts');
    const { host } = render(
      <MemoryRouter>
        <Alerts member={true} />
      </MemoryRouter>,
    );
    expect(host.querySelector('[data-part="alerts"]')).toBeNull();
    expect(listSpy).not.toHaveBeenCalled();
    listSpy.mockRestore();
  });
});
