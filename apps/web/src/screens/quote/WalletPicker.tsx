import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import type { SecurityRating } from '@x2f/auth-client';
import { addressEnd } from '../../ui/addressEnd.js';
import { APP_LABELS, takeableWallets, type WalletApp } from '../wallets-model.js';
import { ONE_TIME_TAG } from '../walletsCopy.js';
import { ADDRESS_TIP, DEFAULT_TAG, NEW_ADDRESS, addressRuleText } from './addressCopy.js';
import type { PickWallet } from './api.js';
import './quote.css';

// "Which wallet gets paid?" on the BuyQuote board (and the seller's funding and refund wallet on
// SellQuote). Only usable wallets can be picked (spec 6.3, 6.4); nothing is picked until the person
// picks (OD-11: no default payout wallet, always ask). "Add another wallet" goes to Add a wallet,
// which asks the person to confirm it's them (X-4), and comes back here.
// The app names and the usable filter come from the wallets screen's model (Task 29), so the
// picker and Your wallets name and filter wallets the same way.
// Owner demo note #6 (16 Nov 2026): the owner's question (`question`) and the rule for this account's
// rating (`rating`, from the API's GET /v1/account/me) sit under the legend. A highly secure account (owner 17 Nov) gets
// "Add a new address" on the quote itself (`onAddNew`, the new-address sheet); any other account keeps
// the link to Settings → Your wallets. A one-time wallet says so.
// Owner, 17 Nov 2026: the rating has three levels and only `high` gets the inline add; `weak` and
// `medium` get a "?" (AddressTip) that explains why and links to the two ways forward. The default
// wallet (the API's `isDefault`) is marked; the quote picks it first.

/**
 * The "?" for weak and medium accounts: a real button (tap, click, Enter or Space; never hover-only)
 * that shows and hides the explanation below it (aria-expanded, aria-controls). Escape closes it and
 * gives focus back to the "?".
 */
function AddressTip({ rating, settingsHref }: { rating: 'weak' | 'medium'; settingsHref: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !open) return;
    e.stopPropagation();
    setOpen(false);
    button.current?.focus();
  };
  return (
    <span className="x2f-quote__tip" onKeyDown={onKey}>
      <button
        ref={button}
        type="button"
        className="x2f-quote__tip-button"
        data-part="address-tip"
        aria-label={ADDRESS_TIP.label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">?</span>
      </button>
      {open ? (
        <span id={panelId} className="x2f-quote__tip-panel" data-part="address-tip-panel">
          <span>{ADDRESS_TIP.body(rating)}</span>
          <span>
            {ADDRESS_TIP.settings}{' '}
            <Link to={settingsHref} className="x2f-link">
              {ADDRESS_TIP.settingsLink}
            </Link>
          </span>
          <span>
            {ADDRESS_TIP.stronger}{' '}
            <Link to="/settings/security" className="x2f-link">
              {ADDRESS_TIP.strongerLink}
            </Link>
          </span>
        </span>
      ) : null}
    </span>
  );
}

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
  rating,
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
  /** Owner note #6: the account's rating from the API; null when not known (an older API build). */
  rating?: SecurityRating | null;
  /** Owner note #6: opens the new-address sheet; given for a highly secure account only (owner 17 Nov). */
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
          <span className="x2f-quote__muted-sm">{addressRuleText(rating ?? null)}</span>
          {rating === 'weak' || rating === 'medium' ? <AddressTip rating={rating} settingsHref={addHref} /> : null}
        </div>
      ) : null}
      {usable.map((w) => {
        const name = walletName(w);
        const app = appLabel(w.app);
        return (
          <label key={w.id} className="x2f-quote__wallet" data-on={picked === w.id ? '' : undefined}>
            <input type="radio" name="wallet" value={w.id} checked={picked === w.id} onChange={() => onPick(w.id)} />
            <span className="x2f-quote__wallet-text">
              <span className="x2f-quote__wallet-name">{name}</span>
              <span className="x2f-quote__muted-sm">
                <span className="x2f-quote__mono">…{addressEnd(w.address)}</span>
                {app !== undefined && app !== name ? ` · ${app}` : ''}
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
