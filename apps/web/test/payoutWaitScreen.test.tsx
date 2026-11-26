// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi } from '../src/screens/auth/authApi.js';
import { PayoutWait } from '../src/screens/settings/PayoutWait.js';
import { render } from './render.js';

const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });

describe('PayoutWait settings panel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders title, explanation body, and instant removal note', async () => {
    vi.spyOn(authApi, 'getWalletRule').mockResolvedValue({
      strongMethods: ['passkey'],
      waitHours: 24,
    } as any);

    const { host } = render(<PayoutWait />);
    await flush();

    const section = host.querySelector('section[data-part="payout-wait"]');
    expect(section).not.toBeNull();
    expect(section?.getAttribute('aria-labelledby')).toBe('payout-wait-h');

    const heading = host.querySelector('h2#payout-wait-h');
    expect(heading?.textContent).toBe('New payout wallets');

    const body = host.querySelector('.x2f-sheet__body');
    expect(body?.textContent).toContain('Adding a payout wallet always asks you to confirm it\'s you');
    expect(body?.textContent).toContain('Your first payout wallet never waits');

    expect(host.textContent).toContain('Removing a wallet is instant and never waits, but it always sends you an alert.');
  });

  it('renders nudge when account has no strong authentication methods', async () => {
    vi.spyOn(authApi, 'getWalletRule').mockResolvedValue({
      strongMethods: [],
      waitHours: 24,
    } as any);

    const { host } = render(<PayoutWait />);
    await flush();

    const nudge = host.querySelector('[data-part="nudge"]');
    expect(nudge).not.toBeNull();
    expect(nudge?.textContent).toContain('You have no strong method yet. Add a passkey, security key or PGP key above');
  });

  it('does not render nudge when account has strong authentication methods', async () => {
    vi.spyOn(authApi, 'getWalletRule').mockResolvedValue({
      strongMethods: ['security-key', 'pgp'],
      waitHours: 24,
    } as any);

    const { host } = render(<PayoutWait />);
    await flush();

    const nudge = host.querySelector('[data-part="nudge"]');
    expect(nudge).toBeNull();
  });

  it('renders gracefully if getWalletRule rejects', async () => {
    vi.spyOn(authApi, 'getWalletRule').mockRejectedValue(new Error('Network error'));

    const { host } = render(<PayoutWait />);
    await flush();

    expect(host.querySelector('h2#payout-wait-h')?.textContent).toBe('New payout wallets');
    expect(host.querySelector('[data-part="nudge"]')).toBeNull();
  });
});
