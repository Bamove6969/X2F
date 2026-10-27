import { Link } from 'react-router';
import type { PickWallet } from './api.js';
import './quote.css';

// "Which wallet gets paid?" on the BuyQuote board (and the seller's funding and refund wallet on
// SellQuote). Only usable wallets can be picked (spec 6.3, 6.4); nothing is picked until the person
// picks (OD-11: no default payout wallet, always ask). "Add another wallet" goes to Add a wallet,
// which asks the person to confirm it's them (X-4), and comes back here.
//
// TODO(Task 29 merge): APP_NAMES and the usable filter mirror wallets-model.ts (APP_LABELS,
// takeableWallets) on wip/t3-p3-task29; use those once it is on the line (a tripwire says when).

const APP_NAMES: Record<string, string> = {
  cake: 'Cake Wallet',
  edge: 'Edge',
  feather: 'Feather',
  monerujo: 'Monerujo',
  stack: 'Stack',
  'monero-gui-cli': 'Monero GUI',
  'ledger-trezor': 'Ledger or Trezor',
  other: 'Other',
};

/** The name a wallet goes by: its own label, else its app's name. */
export function walletName(w: PickWallet): string {
  return w.label.trim() !== '' ? w.label : (APP_NAMES[w.app] ?? 'Wallet');
}

export function WalletPicker({
  legend,
  wallets,
  picked,
  onPick,
  addHref,
}: {
  legend: string;
  /** Every open wallet; waiting ones are counted, never offered. */
  wallets: PickWallet[];
  picked: string | null;
  onPick: (id: string) => void;
  addHref: string;
}) {
  const usable = wallets.filter((w) => w.usable);
  const waiting = wallets.length - usable.length;
  return (
    <fieldset className="x2f-quote__wallets">
      <legend className="x2f-quote__label">{legend}</legend>
      {usable.map((w) => {
        const name = walletName(w);
        const app = APP_NAMES[w.app];
        return (
          <label key={w.id} className="x2f-quote__wallet" data-on={picked === w.id ? '' : undefined}>
            <input type="radio" name="wallet" value={w.id} checked={picked === w.id} onChange={() => onPick(w.id)} />
            <span className="x2f-quote__wallet-text">
              <span className="x2f-quote__wallet-name">{name}</span>
              <span className="x2f-quote__muted-sm">
                <span className="x2f-quote__mono">…{w.addressEnd}</span>
                {app !== undefined && app !== name ? ` · ${app}` : ''}
              </span>
            </span>
          </label>
        );
      })}
      {waiting > 0 ? (
        <span className="x2f-quote__muted-sm">
          {waiting === 1 ? '1 more wallet is still waiting and cannot be picked yet.' : `${waiting} more wallets are still waiting and cannot be picked yet.`}
        </span>
      ) : null}
      <Link to={addHref} className="x2f-quote__add">
        Add another wallet
      </Link>
    </fieldset>
  );
}
