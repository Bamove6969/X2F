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

  it('ConfirmSheet is one dialog, explains the wallet wait, and returns the password-confirm token', async () => {
    const action = await walletAction(ADDRESS);
    const rule = { firstWallet: false, strongMethods: [], password: 'waits', waitHours: 24 };
    const fetchMock = vi.fn(async (url: string) =>
      new Response(JSON.stringify(url === '/v1/wallets/rule' ? rule : { confirmToken: 't1' }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onToken = vi.fn();
    render(<ConfirmSheet action={action} methods={['password']} onToken={onToken} onCancel={() => undefined} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.querySelector('[data-part="action"]')?.textContent).toContain('end999');
    expect(document.querySelector('[data-part="wallet-wait"]')?.textContent).toContain('will work 24 hours after you add it');

    const input = document.querySelector<HTMLInputElement>('#confirm-password')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setValue.call(input, 'Correct-Horse-9!');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const confirm = [...document.querySelectorAll('[data-method="password"] button')].find((b) => b.textContent === 'Confirm')!;
    fire(confirm, new MouseEvent('click', { bubbles: true }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(onToken).toHaveBeenCalledWith('t1');
    const [url, init] = fetchMock.mock.calls.find((c) => c[0] === '/v1/confirm/password') as unknown as [string, RequestInit];
    expect(url).toBe('/v1/confirm/password');
    expect(JSON.parse(init.body as string)).toEqual({ password: 'Correct-Horse-9!', action });
  });
});
