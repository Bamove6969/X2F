/**
 * Setup step 5 (board SetupWallet; spec 6.1 step 5, 6.4): the first payout wallet. A plain list of
 * well-known Monero wallets, then one address field (owner demo notes 12 Nov #32 and 16 Nov #96: the
 * wallet names are a recommendation, not buttons that do something; "use your favourite and enter in
 * an address from that wallet"). The wallet is saved under the app `other` ("your wallet"): nothing
 * on this screen picks an app any more. The address checks are unchanged. This is the first-wallet path (Plan 2 R12; spec 6.3 "Wallet
 * rules refined", owner 2026-10-24): it goes with no confirm token while the account's sign-up
 * window is open, and the account's first wallet never waits, whenever it is added. Should the
 * server still ask for a confirm (someone coming back after the window), the confirm sheet asks;
 * the wallet still works at once. Owner demo note #161 (23 Nov) saw that sheet: his sign-up had run
 * past the window's 30 minutes (ONBOARDING_MS, from when the account was made), so the server asked,
 * as its rule says; inside the window nothing asks. Once the API has saved the wallet, the screen
 * shows a big green "Valid Monero address" check (like "Key verified") and Continue to Welcome.
 *
 * Owner demo note #219 (25 Nov 2026): Finish setup is disabled until the address has a Monero
 * address's shape (ADDRESS_RE); once the person has left the field with something else in it, the
 * shape sentence says why. The network and checksum stay the API's to check (its refusals below).
 *
 * The app names and the neutral first label ("Wallet 1") come from Task 29's address book
 * (wallets-model.ts).
 *
 * Owner demo note #226 (25 Nov 2026): "Make sure there is an option to name the wallet when they
 * enter it in ... Traders want to know where each wallet is going". An optional name field under the
 * address: left empty, the wallet keeps the neutral first label (spec 6.3 "Labels"); a name the
 * person types overrides it. It follows the API's own rule (`cleanWalletLabel`, @x2f/accounts, the
 * add's and the rename's), and, being optional, it holds Finish setup back (note #219) only when
 * something typed there breaks that rule. It can be renamed later in Settings → Your wallets.
 */
import { useState } from 'react';
import { WALLET_LABEL_MAX, cleanWalletLabel, isStaged, walletsAction, withConfirm, type WalletApp, type WalletDraft } from '@x2f/auth-client';
import { Button } from '../../ui/Button.js';
import { Icon } from '../../ui/icons.js';
import { ConfirmOpenProvider, isConfirmAbort, useConfirm } from '../auth/ConfirmSheet.js';
import { authApi } from '../auth/authApi.js';
import { SetupFrame, SetupIntro, useSetup } from './kit.js';
import { errorCode } from './register.js';
import { APP_LABELS, EDGE_TIP, WALLET_APPS, nextWalletName } from '../wallets-model.js';
import { recordStagedAddress, recordTypedAddress } from '../walletRecord.js';
import { ADD_SWAPPED } from '../walletsCopy.js';

/**
 * The first wallet's default name: neutral, never where the money comes from (spec 6.3, "Labels").
 * Since owner demo note #226 a name the person types overrides it (`setupWalletLabel`).
 */
export const FIRST_WALLET_LABEL = nextWalletName(0);

/**
 * Owner demo note #226: the label the first wallet is saved under. An empty (or all-space) field is
 * the neutral default; anything else must pass the API's rule (`cleanWalletLabel`), else null (then
 * Finish setup stays disabled and the field says why).
 */
export function setupWalletLabel(typed: string): string | null {
  return typed.trim() === '' ? FIRST_WALLET_LABEL : cleanWalletLabel(typed);
}

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
  /**
   * Owner demo note #161 (23 Nov): once the first wallet is saved, a big green check like "Key
   * verified". Truthful about what was checked: the API's validator (apps/api/src/wallets/address.ts,
   * monero-ts) checks the network, the keys and the checksum. That proves the address is a real
   * Monero address with no typo, not that it is this person's own wallet, so it never says so.
   */
  // Owner demo note #162 (23 Nov), his words: "Your first payout wallet has been added. You're all
  // set—happy trading!" The app's copy has no "!" (tools/copy-lint.ts), so the last part is two
  // plain sentences.
  savedTitle: 'Your first payout wallet has been added.',
  savedBody: "You're all set. Happy trading.",
  verified: 'Valid Monero address',
  verifiedHelp: 'X2F checked it: a real Monero address for this network, with a matching checksum, so nothing was mistyped.',
  verifiedEnd: (end: string) => `Your payouts go to the address ending ${end}. Check that it matches the one in your wallet.`,
  // Owner demo note #226 (25 Nov): the optional wallet name. COPY-UNSIGNED (note #226)
  nameField: 'Wallet name (optional)',
  namePlaceholder: 'e.g. Cake Wallet savings',
  nameHelp: 'Left empty, it is saved as Wallet 1. You can rename it later in Settings.',
  nameInvalid: 'Use 1 to 40 characters, with no hidden or control characters.',
} as const;

/**
 * A Monero address: 95 base58 characters (standard or subaddress) or 106 (integrated). The server
 * checks the network and refuses an integrated one with `address-integrated`, which has its own
 * sentence below (review M7); Task 29's Wallets screen leaves the shape to the server the same way.
 */
const ADDRESS_RE = /^(?:[1-9A-HJ-NP-Za-km-z]{95}|[1-9A-HJ-NP-Za-km-z]{106})$/;

/** The shape sentence (was the error on Finish setup; since owner demo note #219, help under the field). */
export const ADDRESS_SHAPE = "That doesn't look like a Monero address. Copy the whole receive address from your wallet.";

const ERRORS: Record<string, string> = {
  'address-invalid': "That isn't a Monero address for this network. Copy it again from your wallet.",
  'address-integrated': 'That is an integrated address. Paste a normal receive address from your wallet.',
};

export function Wallet() {
  const { update, go } = useSetup();
  const { prove, confirmUi, open } = useConfirm();
  const app = APP;
  const [address, setAddress] = useState('');
  // Owner demo note #226: the optional name (empty: the neutral "Wallet 1").
  const [name, setName] = useState('');
  const label = setupWalletLabel(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Owner #161: the end of the wallet the API saved, once it has; the screen then shows the green check.
  const [saved, setSaved] = useState<string | null>(null);
  // Owner demo note #219: Finish setup waits for an address of the right shape.
  const [left, setLeft] = useState(false);
  const shaped = ADDRESS_RE.test(address.trim());
  const misshapen = !shaped && address.trim() !== '' && left;

  const finish = async () => {
    const trimmed = address.trim();
    if (!ADDRESS_RE.test(trimmed) || label === null) return;
    setBusy(true);
    setError(null);
    const draft: WalletDraft = { app, label, address: trimmed };
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
      update({ wallet: { app, addressEnd: added?.addressEnd ?? trimmed.slice(-6) } });
      // Owner #161: a wallet the API saved gets its green check before Welcome. A staged add (202) is
      // not saved yet, so it goes on to Welcome as before, with no check.
      if (added !== undefined) {
        // Owner #163: the ending shown is the real end of the address typed here (the answer was
        // checked above to name exactly that address), never a value from anywhere else.
        setSaved(trimmed.slice(-6));
        return;
      }
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

  if (saved !== null) {
    return (
      <SetupFrame
        screen="setup-wallet"
        step={5}
        footer={
          <Button variant="primary" onClick={() => go('welcome')} data-part="wallet-continue">
            Continue
          </Button>
        }
      >
        <SetupIntro title={WALLET_COPY.savedTitle}>{WALLET_COPY.savedBody}</SetupIntro>
        <section className="x2f-start__verified" aria-label={WALLET_COPY.verified}>
          {/* Owner demo note #161 (23 Nov): lit up green like "Key verified" (#148). COPY-UNSIGNED */}
          <div className="x2f-start__verified-big" data-part="address-verified" role="status">
            <Icon name="check" size={96} stroke={2.5} />
            <p className="x2f-start__verified-word">{WALLET_COPY.verified}</p>
          </div>
          <p className="x2f-start__help">{WALLET_COPY.verifiedHelp}</p>
          <p className="x2f-start__help" data-part="address-end">
            {WALLET_COPY.verifiedEnd(saved)}
          </p>
        </section>
      </SetupFrame>
    );
  }

  return (
    <ConfirmOpenProvider value={open}>
      <SetupFrame
        screen="setup-wallet"
        step={5}
        footer={
          <Button variant={open ? 'secondary' : 'primary'} disabled={busy || !shaped || label === null} onClick={() => void finish()} data-part="wallet-finish">
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
            aria-describedby={misshapen ? 'xmr-payout-shape' : undefined}
            aria-invalid={misshapen ? true : undefined}
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              setError(null);
            }}
            onBlur={() => setLeft(true)}
          />
        </label>
        <div aria-live="polite">
          {misshapen ? (
            <p className="x2f-start__help" id="xmr-payout-shape" data-part="wallet-shape">
              {ADDRESS_SHAPE}
            </p>
          ) : null}
        </div>
        {/* Owner demo note #226: an optional name; it overrides the neutral "Wallet 1". */}
        <label className="x2f-field x2f-label" htmlFor="wallet-name">
          {WALLET_COPY.nameField}
          <input
            className="x2f-input"
            id="wallet-name"
            name="wallet-name"
            type="text"
            placeholder={WALLET_COPY.namePlaceholder}
            maxLength={WALLET_LABEL_MAX}
            autoComplete="off"
            data-1p-ignore=""
            data-lpignore="true"
            data-bwignore=""
            data-form-type="other"
            data-part="wallet-name"
            aria-describedby={label === null ? 'wallet-name-invalid' : 'wallet-name-help'}
            aria-invalid={label === null ? true : undefined}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
          />
        </label>
        <div aria-live="polite">
          {label === null ? (
            <p className="x2f-start__help" id="wallet-name-invalid" data-part="wallet-name-invalid">
              {WALLET_COPY.nameInvalid}
            </p>
          ) : (
            <p className="x2f-start__help" id="wallet-name-help" data-part="wallet-name-help">
              {WALLET_COPY.nameHelp}
            </p>
          )}
        </div>
        {error !== null ? (
          <p className="x2f-error" role="alert" data-part="wallet-error">
            {error}
          </p>
        ) : null}
        <p className="x2f-start__help" data-part="first-wallet-rule">
          {/* Owner demo notes #157 and #158 (23 Nov), his words. */}
          This is your first payout wallet, so it works right away. Adding future wallets will require verification via your security method. You
          can also configure X2F to alert you whenever a new wallet is added.
        </p>
        {/* Owner demo note #160 (23 Nov): his words (dash made a full stop), in a different, noticeable colour. */}
        <p className="x2f-start__small x2f-start__small--heads-up" data-part="address-reuse">
          Monero addresses never expire. Reusing one will never lose a payout. For stronger privacy, generate and paste a fresh subaddress for each
          trade.
        </p>
        {confirmUi}
      </SetupFrame>
    </ConfirmOpenProvider>
  );
}
