/**
 * Payout-wallet wait (Task 30, spec §6.3, owner 2026-10-23). The old opt-in "make new payout
 * addresses wait 24 hours" toggle is gone. The rule is now by method: adding a payout wallet
 * always needs confirm-it's-you; confirmed with a strong method (PGP key, passkey, security key)
 * the wallet can be paid out to at once, while a password or an authenticator code makes it wait 24
 * hours. This panel explains that and nudges toward a strong method when the account has none, so
 * there is no wait to add later. Removing a wallet needs no confirm but always raises an alert.
 * Refined 2026-10-24: the first wallet never waits, and a batch added together shares one wait.
 */
import { useEffect, useState } from 'react';
import type { WalletRule } from '@x2f/auth-client';
import { authApi } from '../auth/authApi.js';

export function PayoutWait() {
  const [rule, setRule] = useState<WalletRule | null>(null);

  useEffect(() => {
    let live = true;
    authApi.getWalletRule().then(
      (r) => {
        if (live) setRule(r);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);

  return (
    <section className="x2f-card" data-part="payout-wait" aria-labelledby="payout-wait-h">
      <h2 className="x2f-card__title" id="payout-wait-h">
        New payout wallets
      </h2>
      <p className="x2f-sheet__body">
        Adding a payout wallet always asks you to confirm it's you. Confirm with your PGP key, passkey or security key and the wallet can be
        paid out to straight away. Confirm with a password or an authenticator code and it waits 24 hours first, even if you also have a
        strong method: what counts is the one you use. Your first payout wallet never waits, and wallets you add together share one wait.
      </p>
      {rule !== null && rule.strongMethods.length === 0 ? (
        <p className="x2f-note" data-part="nudge">
          You have no strong method yet. Add a passkey, security key or PGP key above so new payout wallets never have to wait.
        </p>
      ) : null}
      <p className="x2f-note">Removing a wallet is instant and never waits, but it always sends you an alert.</p>
    </section>
  );
}
