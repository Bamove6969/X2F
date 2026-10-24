import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ApiCallError, api, safeReturnTo } from '../api/client.js';
import { Button } from '../ui/Button.js';
import { Icon } from '../ui/icons.js';
import { useConfirmSheet } from './ConfirmSheet.stub.js';
import {
  APP_LABELS,
  WALLET_APPS,
  appPromptName,
  walletStatus,
  type WalletApp,
  type WalletView,
} from './wallets-model.js';
import './Wallets.css';

/** The last six characters of an address, as the API's `addressEnd` shows it. */
function addressTail(address: string): string {
  return `…${address.slice(-6)}`;
}

function addError(e: unknown): string {
  if (e instanceof ApiCallError) {
    if (e.code === 'address-invalid') return "That doesn't look like a Monero address on this network.";
    if (e.code === 'address-integrated') return 'Use a plain address, not an integrated address.';
    if (e.code === 'wallet-exists') return 'That wallet is already linked.';
    if (e.code === 'trading-hold' || e.code === 'trading-paused') return 'Adding wallets is paused right now. Try again later.';
  }
  return 'That could not be saved. Check the address and try again.';
}

// ---------------------------------------------------------------------------------------------
// Open escrow keys, read from escrowStore's IndexedDB (Task 12, apps/web/src/escrow/store.ts).
//
// TRIPWIRE / TODO(Task 12 merge): escrowStore is built on a different branch. The documented
// interface (plan 3, "Task 12") is: IndexedDB database `x2f-escrow`, one record per open trade
// keyed by its trade code, in a store separate from `x2f-escrow-secrets`; both records are deleted
// when the trade closes. This reader depends only on that contract and on a `x2f:escrow-changed`
// window event the store should dispatch on add/remove (we also re-read on focus/visibility). At
// merge, confirm the store's object-store name and that its keys are the trade codes, and that it
// fires `x2f:escrow-changed`; drop this note once wired.
// ---------------------------------------------------------------------------------------------
const ESCROW_DB = 'x2f-escrow';
const SECRETS_STORE = 'x2f-escrow-secrets';

function readOpenEscrowCodes(): Promise<string[]> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve([]);
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(ESCROW_DB);
    } catch {
      resolve([]);
      return;
    }
    // Opening a database that does not exist yet would create it; abort so we never race the
    // store's own schema. An aborted open surfaces as `onerror` (treated as "no open trades").
    req.onupgradeneeded = () => {
      try {
        req.transaction?.abort();
      } catch {
        /* ignore */
      }
    };
    req.onblocked = () => resolve([]);
    req.onerror = () => resolve([]);
    req.onsuccess = () => {
      const db = req.result;
      try {
        const names = [...db.objectStoreNames].filter((n) => n !== SECRETS_STORE);
        if (names.length === 0) {
          db.close();
          resolve([]);
          return;
        }
        const store = names[0] as string;
        const tx = db.transaction(store, 'readonly');
        const keys = tx.objectStore(store).getAllKeys();
        keys.onsuccess = () => {
          const codes = [...keys.result].map((k) => String(k)).sort();
          db.close();
          resolve(codes);
        };
        keys.onerror = () => {
          db.close();
          resolve([]);
        };
      } catch {
        try {
          db.close();
        } catch {
          /* ignore */
        }
        resolve([]);
      }
    };
  });
}

/** The trade codes of the escrow keys currently on this device, refreshed when the store changes. */
function useOpenEscrowKeys(): string[] {
  const [codes, setCodes] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    const refresh = () => {
      void readOpenEscrowCodes().then((next) => {
        if (live) setCodes(next);
      });
    };
    refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('x2f:escrow-changed', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      window.removeEventListener('x2f:escrow-changed', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return codes;
}

function WalletRow({ w, onRemove }: { w: WalletView; onRemove: (w: WalletView) => void }) {
  const status = walletStatus(w);
  return (
    <li className="x2f-wallet-row">
      <span className="x2f-wallet-row__icon" aria-hidden="true">
        <Icon name="wallet" size={18} />
      </span>
      <span className="x2f-wallet-row__text">
        <span className="x2f-wallet-row__name">{w.label}</span>
        <span className="x2f-wallet-row__addr">
          <span>{w.addressEnd}</span>
        </span>
      </span>
      <span className="x2f-wallet-row__status">
        <span className="x2f-wallet-row__word" data-tone={status.tone}>
          {status.label}
        </span>
        {!w.usable ? (
          <span className="x2f-wallet-row__note">Until {new Date(w.usableFrom).toLocaleDateString()}</span>
        ) : null}
      </span>
      <button type="button" className="x2f-icon-button" aria-label={`Remove ${w.label}`} onClick={() => onRemove(w)}>
        <Icon name="close" size={20} />
      </button>
    </li>
  );
}

export function Wallets() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const addMode = params.get('add') === '1';
  const returnTo = safeReturnTo(params.get('returnTo'));

  const [wallets, setWallets] = useState<WalletView[] | null>(null);
  const [app, setApp] = useState<WalletApp>('cake');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const codes = useOpenEscrowKeys();
  const { prove, element: confirmSheet } = useConfirmSheet();
  const addressInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    void api<WalletView[]>('/v1/wallets').then(
      (list) => setWallets(list),
      () => setWallets([]),
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (addMode) addressInput.current?.focus();
  }, [addMode]);

  const trimmed = address.trim();

  async function save() {
    if (trimmed === '' || saving) return;
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = { app, label: APP_LABELS[app], address: trimmed };
    try {
      let saved: WalletView;
      try {
        saved = await api<WalletView>('/v1/wallets', { method: 'POST', body });
      } catch (e) {
        // A later wallet needs confirm-it's-you; the first wallet (no-wallet path) does not.
        if (e instanceof ApiCallError && e.code === 'confirm-required') {
          const token = await prove({ kind: 'add-wallet', addressEnd: addressTail(trimmed) });
          saved = await api<WalletView>('/v1/wallets', { method: 'POST', body: { ...body, confirmToken: token } });
        } else {
          throw e;
        }
      }
      if (addMode) {
        navigate(returnTo);
        return;
      }
      setWallets((prev) => [...(prev ?? []), saved]);
      setAddress('');
    } catch (e) {
      if (!(e instanceof Error && e.message === 'confirm-cancelled')) setError(addError(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(w: WalletView) {
    setError(null);
    try {
      // Removal cannot redirect money, so it needs no confirm; the API always saves an alert.
      await api(`/v1/wallets/${w.id}`, { method: 'DELETE' });
      setWallets((prev) => (prev ?? []).filter((x) => x.id !== w.id));
    } catch (e) {
      setError(addError(e));
    }
  }

  const keyCount = codes.length;

  return (
    <div className="x2f-wallets" data-screen="wallets">
      <header className="x2f-wallets__head">
        <button type="button" className="x2f-icon-button" aria-label="Back" onClick={() => navigate(returnTo)}>
          <Icon name="chevron-left" size={24} />
        </button>
        <h1 className="x2f-wallets__title">Your wallets</h1>
      </header>

      <main className="x2f-wallets__main">
        <p className="x2f-wallets__intro">
          X2F never holds your coins. Link the Monero wallets you already use: you get paid to them and fund trades
          from them.
        </p>

        {wallets && wallets.length > 0 ? (
          <section className="x2f-wallets__section" aria-label="Linked wallets">
            <h2 className="x2f-wallets__section-label">Linked wallets</h2>
            <ul className="x2f-wallets__list">
              {wallets.map((w) => (
                <WalletRow key={w.id} w={w} onRemove={remove} />
              ))}
            </ul>
          </section>
        ) : null}

        <section className="x2f-wallets__add" aria-label="Add a wallet">
          <div className="x2f-wallets__add-head">
            <h2 className="x2f-wallets__add-title">Add a wallet</h2>
            <span className="x2f-wallets__add-hint">Which app is it in?</span>
          </div>
          <div role="radiogroup" aria-label="Wallet app" className="x2f-wallets__apps">
            {WALLET_APPS.map((code) => (
              <button
                key={code}
                type="button"
                role="radio"
                aria-checked={app === code}
                className="x2f-app-chip"
                onClick={() => setApp(code)}
              >
                {APP_LABELS[code]}
              </button>
            ))}
          </div>
          {app === 'edge' ? (
            <p className="x2f-wallets__tip">
              For best privacy, turn on Full Sync in Edge's Monero settings. Otherwise Edge's servers can see payments
              coming in.
            </p>
          ) : null}
          <label className="x2f-wallets__field" htmlFor="wallet-address">
            Receive address from {appPromptName(app)}
            <span className="x2f-wallets__input-row">
              <input
                id="wallet-address"
                ref={addressInput}
                className="x2f-wallets__input"
                type="text"
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="4… or 8…"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
              <button type="button" className="x2f-wallets__scan" aria-label="Scan address QR code">
                <Icon name="plus-circle" size={20} />
              </button>
            </span>
          </label>
          {/* Spec 6.3 "Wallet rules refined" (2026-10-24): the first wallet never waits. "Has had one"
              is not in GET /v1/wallets, so an account that removed every wallet sees the first-wallet
              note; TODO(Task 28/30): read that, and the account's own login methods, from me(). */}
          <span className="x2f-wallets__confirm-note">
            {wallets !== null && wallets.length === 0
              ? 'Your first wallet works at once.'
              : "Saving asks you to confirm it's you. Confirm with a PGP key, passkey or security key and the wallet works at once; with a password or authenticator code it waits 24 hours before it can be paid."}
          </span>
          {error ? (
            <p className="x2f-wallets__error" role="alert">
              {error}
            </p>
          ) : null}
        </section>

        {keyCount > 0 ? (
          <section className="x2f-wallets__escrow" aria-label="Escrow keys">
            <span className="x2f-wallets__escrow-icon" aria-hidden="true">
              <Icon name="shield" size={18} />
            </span>
            <span className="x2f-wallets__escrow-text">
              <strong>
                {keyCount} escrow {keyCount === 1 ? 'key' : 'keys'} on this device
              </strong>{' '}
              for {keyCount === 1 ? 'trade' : 'trades'} {codes.join(', ')}. It holds no coins. It stays on this device
              and is deleted when the trade closes.
            </span>
          </section>
        ) : null}
      </main>

      <footer className="x2f-wallets__foot">
        <Button variant="primary" onClick={save} disabled={trimmed === '' || saving}>
          Save wallet
        </Button>
      </footer>

      {confirmSheet}
    </div>
  );
}
