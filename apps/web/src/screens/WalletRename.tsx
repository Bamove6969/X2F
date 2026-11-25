/**
 * Owner demo note #226 (25 Nov 2026): "an option to change it rename the wallet in settings later.
 * Traders want to know where each wallet is going". The small sheet behind a wallet row's Rename
 * action in Settings → Your wallets: one name field, Save disabled until the name is allowed
 * (`cleanWalletLabel`, the API's own rule for the add and the rename) and differs from the current
 * one. It calls `PUT /v1/wallets/:id/label` through `api()` like the screen's other wallet writes, so
 * the shell's redirects keep working. Renaming changes the name only, so there is no confirm.
 */
import { useState } from 'react';
import { WALLET_LABEL_MAX, cleanWalletLabel } from '@x2f/auth-client';
import { ApiCallError, api } from '../api/client.js';
import { Button } from '../ui/Button.js';
import { Sheet } from '../ui/Sheet.js';
import { refusalText } from './auth/refusals.js';
import { isCantDoCode, walletRenameCantDoText, type CantDoCode } from '../ui/cantDoCodes.js';
import type { WalletView } from './wallets-model.js';
import { RENAME, walletNameHelp } from './walletsCopy.js';

/** Whether the name typed may be saved over `current`: allowed by the rule, and a change. */
export function renameReady(raw: string, current: string): boolean {
  const clean = cleanWalletLabel(raw);
  return clean !== null && clean !== current;
}

export function RenameSheet({
  wallet,
  onClose,
  onRenamed,
  onRefused,
}: {
  wallet: WalletView;
  onClose: () => void;
  onRenamed: (label: string) => void;
  /** A refusal by a rule (403 `weak-session`, security review Medium 2): the screen shows it in CantDoThat. */
  onRefused: (r: { code: CantDoCode; text: string }) => void;
}) {
  const [name, setName] = useState(wallet.label);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = cleanWalletLabel(name);
  // Said only for something typed that the rule refuses (an empty field just keeps Save disabled).
  const help = walletNameHelp(name);
  const invalid = help !== null;
  const ready = renameReady(name, wallet.label);

  async function save() {
    if (!ready || saving || clean === null) return;
    setSaving(true);
    setError(null);
    try {
      await api<unknown>(`/v1/wallets/${encodeURIComponent(wallet.id)}/label`, { method: 'PUT', body: { label: clean } });
      onRenamed(clean);
    } catch (e) {
      const code = e instanceof ApiCallError ? e.code : null;
      const refused = isCantDoCode(code) ? walletRenameCantDoText(code) : null;
      if (refused !== null && isCantDoCode(code)) onRefused({ code, text: refused });
      else if (code === 'not-found') setError(RENAME.gone);
      else if (code === 'bad-request') setError(walletNameHelp(name) ?? RENAME.failed);
      else if (code === 'slow-down') setError(RENAME.capped);
      else setError(refusalText(e, RENAME.failed));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open title={RENAME.title} onClose={onClose} initialFocus="#wallet-rename">
      <div className="x2f-wallets__rename" data-part="wallet-rename">
        <label className="x2f-wallets__field" htmlFor="wallet-rename">
          {RENAME.field}
          <input
            id="wallet-rename"
            className="x2f-wallets__input x2f-wallets__input--text"
            type="text"
            autoComplete="off"
            maxLength={WALLET_LABEL_MAX}
            aria-invalid={invalid ? true : undefined}
            aria-describedby={invalid ? 'wallet-rename-invalid' : 'wallet-rename-help'}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
            }}
          />
        </label>
        <span aria-live="polite">
          {invalid ? (
            <span className="x2f-wallets__error" id="wallet-rename-invalid" data-part="wallet-rename-invalid">
              {help}
            </span>
          ) : null}
        </span>
        <span className="x2f-wallets__confirm-note" id="wallet-rename-help">
          {RENAME.help}
        </span>
        {error !== null ? (
          <p className="x2f-wallets__error" role="alert" data-part="wallet-rename-error">
            {error}
          </p>
        ) : null}
        <Button variant="primary" disabled={!ready || saving} onClick={() => void save()} data-part="wallet-rename-save">
          {RENAME.save}
        </Button>
        <Button variant="quiet" onClick={onClose}>
          {RENAME.cancel}
        </Button>
      </div>
    </Sheet>
  );
}
