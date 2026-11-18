/**
 * Setup step 5 (board SetupWallet; spec 6.1 step 5, 6.4): the first payout wallet. Pick the app,
 * paste a receive address from it. This is the first-wallet path (Plan 2 R12; spec 6.3 "Wallet
 * rules refined", owner 2026-10-24): it goes with no confirm token while the account's sign-up
 * window is open, and the account's first wallet never waits, whenever it is added. Should the
 * server still ask for a confirm (someone coming back after the window), the confirm sheet asks;
 * the wallet still works at once.
 *
 * The app names, the "your wallet" wording for Other and the neutral first label ("Wallet 1") come
 * from Task 29's address book (wallets-model.ts).
 */
import { useState } from 'react';
import { isStaged, walletsAction, withConfirm, type WalletApp, type WalletDraft } from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { ConfirmOpenProvider, isConfirmAbort, useConfirm } from '../auth/ConfirmSheet.js';
import { authApi } from '../auth/authApi.js';
import { SetupFrame, SetupIntro, radioProps, useSetup } from './kit.js';
import { errorCode } from './register.js';
import { APP_LABELS, WALLET_APPS, appPromptName, nextWalletName } from '../wallets-model.js';
import { recordStagedAddress, recordTypedAddress } from '../walletRecord.js';
import { ADD_SWAPPED } from '../walletsCopy.js';

/** The first wallet's name: neutral, never where the money comes from (spec 6.3, "Labels"). */
const FIRST_WALLET_LABEL = nextWalletName(0);

/**
 * A Monero address: 95 base58 characters (standard or subaddress) or 106 (integrated). The server
 * checks the network and refuses an integrated one with `address-integrated`, which has its own
 * sentence below (review M7); Task 29's Wallets screen leaves the shape to the server the same way.
 */
const ADDRESS_RE = /^(?:[1-9A-HJ-NP-Za-km-z]{95}|[1-9A-HJ-NP-Za-km-z]{106})$/;

const ERRORS: Record<string, string> = {
  'address-invalid': "That isn't a Monero address for this network. Copy it again from your wallet.",
  'address-integrated': 'That is an integrated address. Paste a normal receive address from your wallet.',
};

export function Wallet() {
  const { update, go } = useSetup();
  const { prove, confirmUi, open } = useConfirm();
  const [app, setApp] = useState<WalletApp>('cake');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const appName = appPromptName(app);

  const finish = async () => {
    const trimmed = address.trim();
    if (trimmed === '') {
      setError('Paste a receive address from your wallet first.');
      return;
    }
    if (!ADDRESS_RE.test(trimmed)) {
      setError("That doesn't look like a Monero address. Copy the whole receive address from your wallet.");
      return;
    }
    setBusy(true);
    setError(null);
    const draft: WalletDraft = { app, label: FIRST_WALLET_LABEL, address: trimmed };
    try {
      const action = await walletsAction([trimmed]);
      const result = await withConfirm(
        action,
        (t) => authApi.addWallets({ wallets: [draft], ...(t !== undefined ? { confirmToken: t } : {}) }),
        prove,
      );
      // Hold model v3: after the sign-up window a username-and-password login adds no wallet at once
      // (202 staged): it is a draft, reviewed and submitted under Account changes.
      const list = isStaged(result) ? undefined : result;
      // Re-verify O3: a staged add has no id yet, so the address typed is recorded by itself (walletRecord.ts).
      if (list === undefined) recordStagedAddress(trimmed);
      const added = list?.[0];
      // Review 17 Nov M4: this device keeps the address typed under the id the API gave it
      // (walletRecord.ts), as Settings → Your wallets does, so the quote, the accepted sheet and the
      // list refuse a later answer naming another. An answer naming another is not taken as saved.
      if (added !== undefined) {
        recordTypedAddress(added.id, trimmed);
        if (list!.length !== 1 || added.address !== trimmed) {
          setError(ADD_SWAPPED);
          return;
        }
      }
      update({ wallet: { app, addressEnd: added?.addressEnd ?? trimmed.slice(-4) } });
      go('welcome');
    } catch (e) {
      const code = errorCode(e);
      if (code === 'wallet-exists') {
        go('welcome');
        return;
      }
      if (isConfirmAbort(e)) return;
      setError(code !== null && Object.hasOwn(ERRORS, code) ? ERRORS[code]! : 'X2F could not save that wallet just now. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmOpenProvider value={open}>
      <SetupFrame
        screen="setup-wallet"
        step={5}
        footer={
          <Button variant={open ? 'secondary' : 'primary'} disabled={busy} onClick={() => void finish()} data-part="wallet-finish">
            Finish setup
          </Button>
        }
      >
        <SetupIntro title="Where should we send your XMR?">Choose the wallet you want to be paid to. X2F never holds your coins.</SetupIntro>
        <div className="x2f-start__chips" role="radiogroup" aria-label="Wallet app">
          {WALLET_APPS.map((a, i) => (
            <button key={a} type="button" {...radioProps(WALLET_APPS, app, setApp, i)} className="x2f-start__chip" data-app={a}>
              {APP_LABELS[a]}
            </button>
          ))}
        </div>
        {app === 'edge' ? (
          <p className="x2f-start__tip" data-part="edge-tip">
            For best privacy, turn on Full Sync in Edge's Monero settings. Otherwise Edge's servers can see payments coming in.
          </p>
        ) : null}
        <label className="x2f-field x2f-label" htmlFor="addr">
          Receive address from {appName}
          <input
            className="x2f-input x2f-start__mono"
            id="addr"
            type="text"
            placeholder="4… or 8…"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </label>
        {error !== null ? (
          <p className="x2f-error" role="alert" data-part="wallet-error">
            {error}
          </p>
        ) : null}
        <p className="x2f-start__help" data-part="first-wallet-rule">
          This is your first payout wallet, so it works at once. Wallets you add later ask you to confirm it's you, and X2F always shows an alert when
          one is added.
        </p>
        <p className="x2f-start__small">
          Monero addresses never expire, so reusing one will never make you miss a payout. For extra privacy, you can paste a fresh address from your
          wallet for each trade.
        </p>
        {confirmUi}
      </SetupFrame>
    </ConfirmOpenProvider>
  );
}
