// @vitest-environment happy-dom
// Task 30 fix round: the password-login rules mirror (I1), the wallet-wait note driven by
// GET /v1/wallets/rule (M2), one confirm at a time (M3), and alert labels (M1).
import { act, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthApiError, walletAction, walletsAction, type ApiErrorCode, type ConfirmAction, type WalletRule } from '@x2f/auth-client';
import { ApiCallError } from '../src/api/client.js';
import { ConfirmSheet, useConfirm, walletWaitNote } from '../src/screens/auth/ConfirmSheet.js';
import { loginFailure, shouldSendAway } from '../src/screens/auth/loginRules.js';
import { alertWords } from '../src/screens/settings/Alerts.js';
import { render } from './render.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const flush = () => act(async () => new Promise<void>((r) => setTimeout(r, 0)));

// The typed client's error, as `createAuthApi` builds it from a refused response.
const refused = (status: number, code: string, extra: Record<string, unknown> = {}) => new AuthApiError(status, code as ApiErrorCode, extra);

describe('password-login rules (FU-A, through the typed client)', () => {
  it('sends away only on credentials-invalid with the server count at 10 or more', () => {
    expect(shouldSendAway(refused(401, 'credentials-invalid', { misses: 10 }))).toBe(true);
    expect(shouldSendAway(refused(401, 'credentials-invalid', { misses: 9 }))).toBe(false);
    expect(shouldSendAway(refused(401, 'credentials-invalid'))).toBe(false);
    expect(shouldSendAway(refused(503, 'busy', { misses: 50 }))).toBe(false);
    expect(shouldSendAway(refused(429, 'slow-down', { misses: 50 }))).toBe(false);
    expect(shouldSendAway(new ApiCallError(401, 'credentials-invalid', { misses: 10 }))).toBe(false); // not a login error
    expect(shouldSendAway(new TypeError('network'))).toBe(false);
  });

  it('a mismatch reads the one sentence; an outage reads as a neutral retry and too many tries as a wait, never as a mismatch', () => {
    expect(loginFailure(refused(401, 'credentials-invalid', { misses: 1 }))).toBe("That login name and password don't match");
    for (const e of [refused(503, 'busy'), refused(500, 'internal'), new TypeError('Failed to fetch')]) {
      expect(loginFailure(e)).toBe('X2F could not check that just now. Try again in a moment.');
    }
    // Re-review item 3: a 429 says how long to wait (still not a miss).
    expect(loginFailure(refused(429, 'slow-down', { retryAfterSeconds: 5 }))).toBe('Too many tries. Try again in 1 minute.');
  });
});

const rule = (o: Partial<WalletRule> = {}): WalletRule => ({ firstWallet: false, strongMethods: [], password: 'waits', waitHours: 24, ...o });

describe('wallet-wait note (rule from GET /v1/wallets/rule)', () => {
  it('the first wallet never waits, whatever the method', () => {
    expect(walletWaitNote(rule({ firstWallet: true }), false)).toBe('This is your first payout wallet, so it works at once however you confirm.');
  });

  it('a strong method works at once; confirming with the password instead still waits', () => {
    expect(walletWaitNote(rule({ strongMethods: ['passkey'], password: 'waits' }), false)).toBe(
      'Confirm with your passkey and this wallet works at once. Confirming with your password instead means a 24-hour wait.',
    );
    expect(walletWaitNote(rule({ strongMethods: ['security-key', 'pgp'], password: 'none' }), true)).toBe(
      'Confirm with your security key or PGP key and these wallets work at once.',
    );
  });

  it('password only: the wait, shared by a batch, and how to skip it', () => {
    expect(walletWaitNote(rule(), true)).toBe(
      'You only have a password, so these wallets will work 24 hours after you add them, all on one shared wait. Add a passkey, security key or PGP key first to skip the wait.',
    );
  });

  it('ConfirmSheet reads the rule for add-wallet and add-wallets', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      new Response(JSON.stringify(url === '/v1/wallets/rule' ? rule({ firstWallet: true }) : {}), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const batch = await walletsAction([`4${'A'.repeat(88)}aaa111`, `4${'B'.repeat(88)}bbb222`]);
    render(<ConfirmSheet action={batch} methods={['password']} onToken={() => undefined} onCancel={() => undefined} />);
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
    for (const k of ['new-login', 'recovery-login', 'recovery-hold-cancelled', 'login-locked', 'login-method-added', 'login-method-removed', 'sessions-ended', 'wallet-added', 'wallet-removed', 'device-key-added', 'login-approval', 'login-blocked', 'logged-out-by-new-device', 'one-device-set', 'cooling-off-started', 'cooling-off-ended']) {
      const w = alertWords(k);
      expect(w, k).not.toMatch(/[a-z]-[a-z]/);
      expect(w, k).not.toBe('Security alert');
    }
  });

  it('never shows an unknown kind raw', () => {
    expect(alertWords('payout-wait-off-scheduled')).toBe('Security alert');
  });
});
