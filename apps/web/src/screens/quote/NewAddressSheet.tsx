import { useEffect, useId, useState } from 'react';
import { AuthApiError, WALLET_LABEL_MAX, isStaged, walletAction, withConfirm, type Staged, type Wallet, type WalletRule } from '@x2f/auth-client';
import { ApiCallError, api } from '../../api/client.js';
import { Button } from '../../ui/Button.js';
import { ChoiceGroup } from '../../ui/Choice.js';
import { Sheet } from '../../ui/Sheet.js';
import { formatDateTime } from '../../ui/dates.js';
import { isConfirmAbort, useConfirm } from '../auth/ConfirmSheet.js';
import { StagedNote } from '../settings/HoldChanges.js';
import { addError } from '../Wallets.js';
import { ruleNote } from '../wallets-model.js';
import { recordStagedAddress, recordTypedAddress } from '../walletRecord.js';
import { DEFAULT_NEW_NAME, NEW_ADDRESS as C } from './addressCopy.js';

// Owner demo note #6 (16 Nov 2026; docs/trade-wallet-note6.md): a highly secure account (owner 17 Nov) adds a payout address
// right on the quote, named, for this trade only or for future trades too. It is the same add as
// Settings → Your wallets (`POST /v1/wallets`, one confirm-it's-you bound to the exact address, R17),
// so the API alone decides what happens: usable at once (picked for this trade), waiting 24 hours
// (confirmed with a password), or staged as a waiting change (a username-and-password login, hold
// model v3). The quote offers this sheet to a highly secure account alone; the API never trusts that.
// The device never trusts the API's echo either: the wallet handed back must carry the exact address
// typed here, else nothing is picked (lead, 17 Nov: the API never swaps an address the device did not show).

const LABEL_MAX = WALLET_LABEL_MAX;

export type NewAddressResult = { kind: 'usable'; wallet: Wallet } | { kind: 'waits'; wallet: Wallet } | { kind: 'staged' };

export function NewAddressSheet({ onClose, onDone }: { onClose: () => void; onDone: (r: NewAddressResult) => void }) {
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const [oneTime, setOneTime] = useState<'one-time' | 'saved'>('one-time');
  const [rule, setRule] = useState<WalletRule | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [after, setAfter] = useState<{ kind: 'waits'; when: string } | { kind: 'staged' } | null>(null);
  const { prove, confirmUi } = useConfirm();
  const keepId = useId();

  useEffect(() => {
    void api<WalletRule>('/v1/wallets/rule').then(setRule, () => setRule(null));
  }, []);

  const trimmed = address.trim();

  async function save() {
    if (trimmed === '' || saving) return;
    setSaving(true);
    setError(null);
    const draft = { app: 'other' as const, label: label.trim() || DEFAULT_NEW_NAME, address: trimmed, oneTime: oneTime === 'one-time' };
    const post = async (confirmToken?: string): Promise<Wallet | Staged> => {
      try {
        return await api<Wallet | Staged>('/v1/wallets', { method: 'POST', body: confirmToken === undefined ? draft : { ...draft, confirmToken } });
      } catch (e) {
        // withConfirm reads auth-client's error; api() throws the shell's.
        if (e instanceof ApiCallError && e.code === 'confirm-required') throw new AuthApiError(e.status, 'confirm-required', e.extra);
        throw e;
      }
    };
    try {
      const result = await withConfirm(await walletAction(trimmed), post, prove);
      if (isStaged(result)) {
        // Re-verify O3: no id yet, so the address typed is recorded by itself; a look-alike listed
        // once the change is applied is then refused like any other (walletRecord.ts).
        recordStagedAddress(trimmed);
        setAfter({ kind: 'staged' });
        onDone({ kind: 'staged' });
        return;
      }
      // Review 17 Nov M4: this device keeps the address typed here for the id the API gave it, so the
      // quote, the accepted sheet and Your wallets refuse any later list naming another (walletRecord.ts).
      recordTypedAddress(result.id, trimmed);
      // The address must be the one typed on this device: an API answer naming another address is
      // never picked for the trade or shown as saved (the take would pay whatever the wallet row holds,
      // and the device would record that as its own address).
      if (result.address !== trimmed) {
        setError(C.mismatch);
        return;
      }
      if (result.usable) {
        onDone({ kind: 'usable', wallet: result });
        return;
      }
      setAfter({ kind: 'waits', when: formatDateTime(result.usableFrom) });
      onDone({ kind: 'waits', wallet: result });
    } catch (e) {
      if (!isConfirmAbort(e)) setError(addError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Sheet open title={C.title} onClose={onClose}>
        {after === null ? (
          <div className="x2f-quote__new-address" data-part="new-address">
            <label className="x2f-wallets__field" htmlFor="new-address-label">
              {C.name}
              <input
                id="new-address-label"
                className="x2f-wallets__input x2f-wallets__input--text"
                type="text"
                autoComplete="off"
                maxLength={LABEL_MAX}
                placeholder={DEFAULT_NEW_NAME}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <span className="x2f-wallets__confirm-note">{C.nameHint}</span>
            <label className="x2f-wallets__field" htmlFor="new-address-address">
              {C.address}
              <input
                id="new-address-address"
                className="x2f-wallets__input"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="4… or 8…"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </label>
            <span id={keepId} className="x2f-quote__label">
              {C.keepLegend}
            </span>
            <ChoiceGroup
              look="card"
              labelledBy={keepId}
              part="new-address-keep"
              value={oneTime}
              onChange={setOneTime}
              options={[
                { value: 'one-time', label: C.oneTime, note: C.oneTimeNote },
                { value: 'saved', label: C.saved, note: C.savedNote },
              ]}
            />
            <span className="x2f-wallets__confirm-note">{ruleNote(rule)}</span>
            {error !== null ? (
              <p className="x2f-wallets__error" role="alert">
                {error}
              </p>
            ) : null}
            <Button variant="primary" onClick={() => void save()} disabled={trimmed === '' || saving}>
              {C.save}
            </Button>
          </div>
        ) : after.kind === 'staged' ? (
          <StagedNote part="new-address-staged" />
        ) : (
          <p className="x2f-sheet__body" role="status" data-part="new-address-waits">
            {C.waits(after.when)}
          </p>
        )}
      </Sheet>
      {confirmUi}
    </>
  );
}
