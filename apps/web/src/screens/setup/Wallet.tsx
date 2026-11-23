/**
 * Setup step 5 (board SetupWallet; spec 6.1 step 5, 6.4): the first payout wallet. A plain list of
 * well-known Monero wallets, then one address field (owner demo notes 12 Nov #32 and 16 Nov #96: the
 * wallet names are a recommendation, not buttons that do something; "use your favourite and enter in
 * an address from that wallet"). The wallet is saved under the app `other` ("your wallet"): nothing
 * on this screen picks an app any more. The address checks are unchanged. This is the first-wallet path (Plan 2 R12; spec 6.3 "Wallet
 * rules refined", owner 2026-10-24): it goes with no confirm token while the account's sign-up
 * window is open, and the account's first wallet never waits, whenever it is added. Should the
 * server still ask for a confirm (someone coming back after the window), the confirm sheet asks;
 * the wallet still works at once.
 *
 * The app names and the neutral first label ("Wallet 1") come from Task 29's address book
 * (wallets-model.ts).
 */
import { useState } from 'react';
import { isStaged, walletsAction, withConfirm, type WalletApp, type WalletDraft } from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { ConfirmOpenProvider, isConfirmAbort, useConfirm } from '../auth/ConfirmSheet.js';
import { authApi } from '../auth/authApi.js';
import { SetupFrame, SetupIntro, useSetup } from './kit.js';
import { errorCode } from './register.js';
import { APP_LABELS, EDGE_TIP, WALLET_APPS, nextWalletName } from '../wallets-model.js';
import { recordStagedAddress, recordTypedAddress } from '../walletRecord.js';
import { ADD_SWAPPED } from '../walletsCopy.js';

/** The first wallet's name: neutral, never where the money comes from (spec 6.3, "Labels"). */
const FIRST_WALLET_LABEL = nextWalletName(0);

/** No app is picked on this screen (owner #96): the wallet is "your wallet". */
const APP: WalletApp = 'other';

/** The recommendation list: the address book's apps in its order, without Other (owner #96: "and many more"). */
export const SUGGESTED_WALLETS: readonly string[] = WALLET_APPS.filter((a) => a !== 'other').map((a) => APP_LABELS[a]);

/** The words on this screen (owner demo notes 12 Nov #32, 16 Nov #96, from his wording). COPY-UNSIGNED */
export const WALLET_COPY = {
  intro: 'Any Monero wallet works. X2F never holds your coins.',
  listTitle: 'Well-known Monero wallets',
  more: 'and many more.',
  /** Shown to everyone now no app is picked: wallets-model.ts EDGE_TIP (Edge's real setting, owner #96). */
  edgeTip: `Using Edge? ${EDGE_TIP}`,
  // Owner demo note #156 (23 Nov); the heading above already asks "Where should we send your XMR?".
  field: 'Enter your receiving wallet address below.',
} as const;

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
  const app = APP;
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        <SetupIntro title="Where should we send your XMR?">{WALLET_COPY.intro}</SetupIntro>
        {/* A recommendation, not a choice (owner #96): plain text, nothing here can be clicked. */}
        <section className="x2f-start__suggest" data-part="wallet-list" aria-labelledby="wallet-list-title">
          <h2 className="x2f-start__suggest-title" id="wallet-list-title">
            {WALLET_COPY.listTitle}
          </h2>
          <ul className="x2f-start__suggest-list">
            {SUGGESTED_WALLETS.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <p className="x2f-start__suggest-more">{WALLET_COPY.more}</p>
        </section>
        <p className="x2f-start__tip" data-part="edge-tip">
          {WALLET_COPY.edgeTip}
        </p>
        {/* Browser fill-in (owner #96, Edge): the id, name and autocomplete keep Edge/Chrome's address
            and form autofill and the common password managers from offering anything here. */}
        <label className="x2f-field x2f-label" htmlFor="xmr-payout">
          {WALLET_COPY.field}
          <input
            className="x2f-input x2f-start__mono"
            id="xmr-payout"
            name="xmr-payout"
            type="text"
            inputMode="text"
            placeholder="4… or 8…"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            data-1p-ignore=""
            data-lpignore="true"
            data-bwignore=""
            data-form-type="other"
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
