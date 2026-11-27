// @vitest-environment happy-dom
// Adding a payout wallet opens the confirm exactly once (Task 30, X-4): withConfirm asks `prove`
// once for the add-wallet action, and ConfirmSheet is the one dialog that answers it.
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthApiError, walletAction, withConfirm, type ConfirmAction } from '@x2f/auth-client';
import { ConfirmSheet } from '../src/screens/auth/ConfirmSheet.js';
import { fire, render } from './render.js';

const ADDRESS = `4${'A'.repeat(88)}end999`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('adding a wallet', () => {
  it('asks for confirm-it’s-you exactly once, for this address, then retries with the token', async () => {
    const action = await walletAction(ADDRESS);
    const run = vi.fn(async (token?: string) => {
      if (token === undefined) throw new AuthApiError(403, 'confirm-required', { action: 'add-wallet' });
      return { id: 'w1' };
    });
    const prove = vi.fn(async (_a: ConfirmAction) => 'tok');
    await expect(withConfirm(action, run, prove)).resolves.toEqual({ id: 'w1' });
    expect(prove).toHaveBeenCalledTimes(1);
    expect(prove).toHaveBeenCalledWith({ kind: 'add-wallet', addressHash: action.addressHash, addressEnd: 'end999' });
    expect(run).toHaveBeenLastCalledWith('tok');
  });

  it('ConfirmSheet is one dialog, says the wallet works at once, and offers only keys (owner, 26 Nov 2026)', async () => {
    const action = await walletAction(ADDRESS);
    const rule = { firstWallet: false, strongMethods: ['pgp'] };
    const fetchMock = vi.fn(async (url: string) =>
      new Response(JSON.stringify(url === '/v1/wallets/rule' ? rule : { challengeId: 'c1', encryptedMessage: 'MSG' }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<ConfirmSheet action={action} methods={['pgp', 'totp']} onToken={() => undefined} onCancel={() => undefined} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.querySelector('[data-part="action"]')?.textContent).toContain('end999');
    expect(document.querySelector('[data-part="wallet-wait"]')?.textContent).toBe('Confirm with your PGP key and this wallet works at once.');
    expect(document.querySelector('[data-method="password"]')).toBeNull();
    expect(document.querySelector('#confirm-totp')).toBeNull();
    fire(document.querySelector('[data-method="pgp"]')!, new MouseEvent('click', { bubbles: true }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(fetchMock.mock.calls.some((c) => c[0] === '/v1/confirm/pgp/start')).toBe(true);
    expect(document.querySelector('[data-part="pgp-message"]')?.textContent).toBe('MSG');
  });
});
