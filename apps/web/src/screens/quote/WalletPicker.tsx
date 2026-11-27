import { Link } from 'react-router';
import { addressEnd } from '../../ui/addressEnd.js';
import { APP_LABELS, takeableWallets, type WalletApp } from '../wallets-model.js';
import { ONE_TIME_TAG } from '../walletsCopy.js';
import { DEFAULT_TAG, NEW_ADDRESS, addressRuleText } from './addressCopy.js';
import type { PickWallet } from './api.js';
import './quote.css';

// "Which wallet gets paid?" on the BuyQuote board (and the seller's funding and refund wallet on
// SellQuote). Only usable wallets can be picked (spec 6.3, 6.4). The quote picks the default wallet
// first (owner 17 Nov 2026, overriding OD-11), else nothing until the person picks; the picked wallet's
// name and address ending are always on screen before Trade. "Add another wallet" goes to Add a wallet,
// which asks the person to confirm it's them (X-4), and comes back here.
// The app names and the usable filter come from the wallets screen's model (Task 29), so the
// picker and Your wallets name and filter wallets the same way.
// Owner demo note #6 (16 Nov 2026): the owner's question (`question`) and the rule for adding a
// new address sit under the legend. The account's owner gets "Add a new address" on the quote itself
// (`onAddNew`, the new-address sheet); a team member keeps the link to Settings → Your wallets.
// Owner, 27 Nov 2026: there is no security rating any more (every trader account holds two kinds of
// login method, one a key), so no "?" tip and no rated words. A one-time wallet says so. The default
// wallet (the API's `isDefault`) is marked; the quote picks it first.

/** The app's name for an app code from the API, or undefined for a code this build does not know. */
function appLabel(app: string): string | undefined {
  return Object.hasOwn(APP_LABELS, app) ? APP_LABELS[app as WalletApp] : undefined;
}

/** The name a wallet goes by: its own label, else its app's name. */
export function walletName(w: PickWallet): string {
  return w.label.trim() !== '' ? w.label : (appLabel(w.app) ?? 'Wallet');
}

export function WalletPicker({
  legend,
  wallets,
  picked,
  onPick,
  addHref,
  question,
  onAddNew,
}: {
  legend: string;
  /** Every open wallet; waiting ones are counted, never offered. */
  wallets: PickWallet[];
  picked: string | null;
  onPick: (id: string) => void;
  addHref: string;
  /** Owner note #6: the question above the list (COPY-UNSIGNED, addressCopy.ts). */
  question?: string;
  /** Owner note #6: opens the new-address sheet; given to the account's owner, never a team member. */
  onAddNew?: () => void;
}) {
  const usable = takeableWallets(wallets);
  const waiting = wallets.length - usable.length;
  return (
    <fieldset className="x2f-quote__wallets">
      <legend className="x2f-quote__label">{legend}</legend>
      {question !== undefined ? (
        <div className="x2f-quote__address-rule" data-part="address-rule">
          <span className="x2f-quote__address-question">{question}</span>
          <span className="x2f-quote__muted-sm">{addressRuleText(onAddNew !== undefined)}</span>
        </div>
      ) : null}
      {usable.map((w) => {
        const name = walletName(w);
        const app = appLabel(w.app);
        return (
          <label key={w.id} className="x2f-quote__wallet" data-on={picked === w.id ? '' : undefined}>
            <input type="radio" name="wallet" value={w.id} checked={picked === w.id} onChange={() => onPick(w.id)} />
            <span className="x2f-quote__wallet-text">
              {/* Security review of wip/lead-note-226 (Medium 1): the name isolated in its own element; the
                  real address end and app each in theirs, so a name can never run into them. */}
              <bdi className="x2f-quote__wallet-name" data-part="wallet-name">{name}</bdi>
              <span className="x2f-quote__muted-sm">
                <span className="x2f-quote__mono" data-part="wallet-end">…{addressEnd(w.address)}</span>
                {app !== undefined && app !== name ? <span data-part="wallet-app">{` · ${app}`}</span> : null}
                {w.oneTime === true ? ` · ${ONE_TIME_TAG}` : ''}
                {w.isDefault ? ` · ${DEFAULT_TAG}` : ''}
              </span>
            </span>
          </label>
        );
      })}
      {waiting > 0 ? (
        <span className="x2f-quote__muted-sm">
          {waiting === 1 ? '1 more wallet is still waiting and cannot be picked yet.' : `${waiting} more wallets are still waiting and cannot be picked yet.`}{/* not-a-refusal: explains the payout-wallet wait */}
        </span>
      ) : null}
      {onAddNew !== undefined ? (
        <button type="button" className="x2f-quote__add x2f-quote__add--button" data-part="add-new-address" onClick={onAddNew}>
          {NEW_ADDRESS.open}
        </button>
      ) : (
        <Link to={addHref} className="x2f-quote__add">
          Add another wallet
        </Link>
      )}
    </fieldset>
  );
}
