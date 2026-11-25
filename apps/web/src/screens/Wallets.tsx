import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AuthApiError, WALLET_LABEL_MAX, isStaged, walletsAction, withConfirm, type Staged } from '@x2f/auth-client';
import { ApiCallError, api, safeReturnTo } from '../api/client.js';
import { Button } from '../ui/Button.js';
import { CantDoThat } from '../ui/CantDoThat.js';
import { CANT_DO_TITLE, RECOVERY_SESSION_WALLETS, isCantDoCode, holdChangesCantDoText, walletsCantDoText, type CantDoCode } from '../ui/cantDoCodes.js';
import { Icon } from '../ui/icons.js';
import { Sheet } from '../ui/Sheet.js';
import { formatDateTime } from '../ui/dates.js';
import { ConfirmOpenProvider, isConfirmAbort, useConfirm, usePrimaryVariant } from './auth/ConfirmSheet.js';
import { refusalText } from './auth/refusals.js';
import { StagedNote, changesCapOf, reportChangesCap } from './settings/HoldChanges.js';
import {
  APP_LABELS,
  MAX_WALLET_BATCH,
  WALLET_APPS,
  appPromptName,
  EDGE_TIP,
  nameSuggestions,
  nextWalletName,
  ruleLines,
  ruleNote,
  walletStatus,
  type WalletApp,
  type WalletDraft,
  type WalletRule,
  type WalletView,
} from './wallets-model.js';
import './Wallets.css';
import { OwnerOnly } from './settings/OwnerOnly.js';
import { ChoiceGroup } from '../ui/Choice.js';
import { ADD_SWAPPED, DEFAULT_TAG, IN_USE_NOTE, IN_USE_WORD, KEEP_FOR, MAKE_DEFAULT, MAKE_DEFAULT_FAILED, NOT_MATCHING, ONE_TIME_TAG, RENAME, walletNameHelp } from './walletsCopy.js';
import { RenameSheet } from './WalletRename.js';
import { matchesRecord, recordStagedAddress, recordTypedAddress } from './walletRecord.js';

/** An address already in the list (was the error on Save; live since owner demo note #219). */
export const ADDRESS_REPEATED = 'That address is already in your list.';

// The wallet routes (FU-B: GET /v1/wallets/rule, POST /v1/wallets { wallets }) are called through
// api(), so the shell's terms-required and no-wallet redirects keep working; the shapes are
// @x2f/auth-client's. Adding goes through `withConfirm(walletsAction(addresses), ...)` with Task 30's
// ConfirmSheet, so the one confirm token is bound to the exact list in order (spec 6.4, R17).

/** Owner demo note #226: the API's own wallet-name rule (@x2f/accounts `cleanWalletLabel`). */
const LABEL_MAX = WALLET_LABEL_MAX;

/** "6 Nov 2026, 15:00 UTC" (ui/dates.ts, the one date format). */
const when = (iso: string): string => formatDateTime(iso);

/** 403 `recovery-session`: a backup login cannot change where coins are paid (Plan 2; in the refusal text map). */
export { RECOVERY_SESSION_WALLETS };
/** 403 `confirm-invalid`: the confirm ran out (or was used) before the save went through. */
export const CONFIRM_INVALID_WALLETS = 'Your confirmation ran out before the wallets were saved. Save again and confirm once more.';

/** CantDoThat's title when adding wallets is refused by a rule (Plan 5 Task 21; in the refusal text map). */
export const WALLETS_CANT_TITLE = CANT_DO_TITLE.wallets;

/** The refusal code when the add was refused by a rule (shown in CantDoThat), else null. */
function addCantDo(e: unknown): CantDoCode | null {
  return (e instanceof ApiCallError || e instanceof AuthApiError) && isCantDoCode(e.code) ? e.code : null;
}

const ADD_FAILED = 'That could not be saved. Check the addresses and try again.';

/** The add's error line (shared with the quote's new-address sheet, owner note #6). */
export function addError(e: unknown): string {
  if (e instanceof ApiCallError || e instanceof AuthApiError) {
    if (e.code === 'address-invalid') return "One of those doesn't look like a Monero address on this network.";
    if (e.code === 'address-integrated') return 'Use a plain address, not an integrated address.';
    if (e.code === 'wallet-exists') return 'One of those wallets is already linked.';
    if (e.code === 'confirm-invalid') return CONFIRM_INVALID_WALLETS;
  }
  // Task 30's wording for a held backup session, a wait after too many tries, and the rest.
  return refusalText(e, ADD_FAILED);
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
// 10 Nov 2026 (J-23 follow-up): the object-store name is confirmed as `trades` (escrow/store.ts
// TRADES, keys are the trade codes; tested in escrow-store.test.ts). The event is still open.
// ---------------------------------------------------------------------------------------------
const ESCROW_DB = 'x2f-escrow';
const TRADES_STORE = 'trades';

/**
 * Exported for tests (`idb` defaults to the browser's). Lead 10 Nov: the short-lived connection also
 * closes itself on `versionchange`, so this read never stalls another tab's upgrade or delete.
 */
export function readOpenEscrowCodes(idb: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB): Promise<string[]> {
  return new Promise((resolve) => {
    if (idb === undefined) {
      resolve([]);
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = idb.open(ESCROW_DB);
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
      db.onversionchange = () => db.close();
      try {
        // The trade records' store by name (escrow/store.ts TRADES). The first store that is not
        // the secrets one is `keys` (names sort), whose one key is the wrap key's id, not a trade.
        if (!db.objectStoreNames.contains(TRADES_STORE)) {
          db.close();
          resolve([]);
          return;
        }
        const store = TRADES_STORE;
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

function WalletRow({
  w,
  onRemove,
  onMakeDefault,
  onRename,
}: {
  w: WalletView;
  onRemove: (w: WalletView) => void;
  onMakeDefault: (w: WalletView) => void;
  onRename: (w: WalletView) => void;
}) {
  // Review 17 Nov (b) M1: a one-time wallet a trade in setup is using; it can still be removed.
  const inUse = typeof w.inUseByTrade === 'string' ? w.inUseByTrade : null;
  const status = inUse !== null ? { label: IN_USE_WORD, tone: 'waiting' as const } : walletStatus(w);
  // Review 17 Nov M4: a row naming another address than the one typed on this device for that id
  // (walletRecord.ts) is marked, and is never offered as the default the trade screen picks first.
  const matches = matchesRecord(w);
  return (
    <li className="x2f-wallet-row">
      <span className="x2f-wallet-row__icon" aria-hidden="true">
        <Icon name="wallet" size={18} />
      </span>
      <span className="x2f-wallet-row__text">
        {/* Security review of wip/lead-note-226 (Medium 1): the name is isolated in its own element,
            apart from the address end and tags below it, so it can never run into them. */}
        <bdi className="x2f-wallet-row__name" data-part="wallet-name">{w.label}</bdi>
        <span className="x2f-wallet-row__addr">
          <span>…{w.addressEnd}</span>
          {w.oneTime === true ? <span data-part="one-time"> · {ONE_TIME_TAG}</span> : null}
          {w.isDefault === true ? <span data-part="default"> · {DEFAULT_TAG}</span> : null}
        </span>
        {matches ? null : (
          <span className="x2f-wallet-row__note" data-part="not-matching">
            {NOT_MATCHING}
          </span>
        )}
        {/* Owner, 17 Nov 2026: any saved wallet may be the default the trade screen picks first, once it
            works (review 17 Nov M1: the API refuses a waiting wallet, 409 wallet-not-ready). */}
        {w.isDefault !== true && w.oneTime !== true && w.usable && matches ? (
          <button type="button" className="x2f-link x2f-wallet-row__default" data-part="make-default" onClick={() => onMakeDefault(w)}>
            {MAKE_DEFAULT}
          </button>
        ) : null}
        {/* Owner demo note #226: any open wallet can be renamed (a wallet a trade used up is not open). */}
        {inUse === null ? (
          <button
            type="button"
            className="x2f-link x2f-wallet-row__default"
            data-part="rename"
            aria-label={RENAME.actionLabel(w.label)}
            onClick={() => onRename(w)}
          >
            {RENAME.action}
          </button>
        ) : null}
      </span>
      <span className="x2f-wallet-row__status">
        <span className="x2f-wallet-row__word" data-tone={status.tone}>
          {status.label}
        </span>
        {inUse !== null ? (
          <span className="x2f-wallet-row__note" data-part="in-use">{IN_USE_NOTE(inUse)}</span>
        ) : w.usable ? null : (
          <span className="x2f-wallet-row__note">Until {when(w.usableFrom)}</span>
        )}
      </span>
      <button type="button" className="x2f-icon-button" aria-label={`Remove ${w.label}`} onClick={() => onRemove(w)}>
        <Icon name="close" size={20} />
      </button>
    </li>
  );
}

/** The popup that explains, for this account, what adding wallets will do (owner, 2026-10-24). */
function RulePopup({ rule, onContinue, onClose }: { rule: WalletRule | null; onContinue: () => void; onClose: () => void }) {
  const lines = rule ? ruleLines(rule) : [ruleNote(null)];
  const passwordOnly = rule !== null && !rule.firstWallet && rule.strongMethods.length === 0 && rule.password === 'waits';
  return (
    <Sheet open title="Before you add a wallet" onClose={onClose}>
      {lines.map((line) => (
        <p key={line} className="x2f-sheet__body">
          {line}
        </p>
      ))}
      {passwordOnly ? (
        <Link className="x2f-link" to="/settings/security">
          Add a login method
        </Link>
      ) : null}
      <Button variant="primary" onClick={onContinue}>
        Continue
      </Button>
    </Sheet>
  );
}

/**
 * The footer's one action. It is the screen's primary only while nothing is open over it: under the
 * rule popup or the confirm sheet it steps down to secondary, so there is one primary per state
 * (Task 30's convention, Task 15's parity check).
 */
function WalletsFoot({
  adding,
  count,
  saving,
  blocked,
  onSave,
  onAdd,
  blockedBy,
}: {
  adding: boolean;
  count: number;
  saving: boolean;
  /** Owner demo note #219: the address in the form is already in the list (said under the field). */
  blocked: boolean;
  /** The id of the sentence that says why Save is blocked (the repeated address, or the name: note #226). */
  blockedBy?: string | undefined;
  onSave: () => void;
  onAdd: () => void;
}) {
  const variant = usePrimaryVariant();
  return (
    <footer className="x2f-wallets__foot">
      {adding ? (
        <Button variant={variant} onClick={onSave} disabled={count === 0 || saving || blocked} {...(blocked && blockedBy !== undefined ? { 'aria-describedby': blockedBy } : {})}>
          {count > 1 ? `Save ${count} wallets` : 'Save wallet'}
        </Button>
      ) : (
        <Button variant={variant} onClick={onAdd}>
          Add a wallet
        </Button>
      )}
    </footer>
  );
}

/** Plan 2 Task 18: the account owner's screen; a team member gets the owner-only refusal. */
export function Wallets() {
  return (
    <OwnerOnly screen="wallets">
      <WalletsScreen />
    </OwnerOnly>
  );
}

function WalletsScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const addMode = params.get('add') === '1';
  const returnTo = safeReturnTo(params.get('returnTo'));

  const [wallets, setWallets] = useState<WalletView[] | null>(null);
  const [rule, setRule] = useState<WalletRule | null>(null);
  // In add mode the rule popup opens once the list is in (see the effect below), not before.
  const [popup, setPopup] = useState(false);
  const [adding, setAdding] = useState(false);
  const [app, setApp] = useState<WalletApp>('cake');
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  // Owner demo note #6: each new wallet is for future trades (the default) or for one trade only.
  const [keepFor, setKeepFor] = useState<'saved' | 'one-time'>('saved');
  const [batch, setBatch] = useState<WalletDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cantDo, setCantDo] = useState<{ code: CantDoCode; text: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [staged, setStaged] = useState(false);
  // Owner demo note #226: the wallet whose Rename sheet is open.
  const [renaming, setRenaming] = useState<WalletView | null>(null);

  const codes = useOpenEscrowKeys();
  const { prove, confirmUi, open: confirmOpen } = useConfirm();
  const addressInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    void api<WalletView[]>('/v1/wallets').then(
      (list) => setWallets(list),
      () => setWallets([]),
    );
    void api<WalletRule>('/v1/wallets/rule').then(
      (r) => setRule(r),
      () => setRule(null),
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Sent here by a 409 no-wallet (?add=1): open the rule popup, unless every wallet is linked but
  // still waiting. Then the person already added one and only has to wait, so say until when.
  const arrived = useRef(false);
  useEffect(() => {
    if (!addMode || wallets === null || arrived.current) return;
    arrived.current = true;
    const open = wallets.filter((w) => typeof w.inUseByTrade !== 'string');
    if (open.length > 0 && open.every((w) => !w.usable)) {
      const first = open.map((w) => w.usableFrom).sort()[0] as string;
      setNotice(`Your ${open.length === 1 ? 'wallet' : 'wallets'} can be paid from ${when(first)}.`);
    } else {
      setPopup(true);
    }
  }, [addMode, wallets]);

  useEffect(() => {
    if (adding) addressInput.current?.focus();
  }, [adding]);

  const trimmed = address.trim();
  const known = (wallets?.length ?? 0) + batch.length;
  const count = batch.length + (trimmed === '' ? 0 : 1);

  /** The wallet in the form, with the next neutral name when the name is left empty. */
  function current(): WalletDraft {
    return { app, label: label.trim() || nextWalletName(known), address: trimmed, ...(keepFor === 'one-time' ? { oneTime: true } : {}) };
  }

  function duplicate(addr: string): boolean {
    return batch.some((d) => d.address === addr) || (wallets ?? []).some((w) => w.address === addr);
  }

  // Owner demo note #219 (25 Nov 2026): an address already in the list disables Save and Add
  // another, and the sentence that a click used to show is said under the field as it is typed.
  const repeated = trimmed !== '' && duplicate(trimmed);
  // Owner demo note #226, security review Medium 1: a typed name the API's rule refuses blocks Save
  // and Add another, and says why under the field (left empty, the next neutral name is used).
  // Verification review: nor the end of any address listed, in the batch or typed.
  const nameHelp = walletNameHelp(label, [...(wallets ?? []).map((w) => w.address), ...batch.map((d) => d.address), ...(trimmed === '' ? [] : [trimmed])]);
  const blocked = repeated || nameHelp !== null;

  function addAnother() {
    if (trimmed === '' || blocked || batch.length + 1 >= MAX_WALLET_BATCH) return;
    setError(null);
    setBatch((b) => [...b, current()]);
    setLabel('');
    setAddress('');
    addressInput.current?.focus();
  }

  async function save() {
    if (count === 0 || saving || blocked) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    setStaged(false);
    const drafts = trimmed === '' ? batch : [...batch, current()];
    // After the first wallet, adding needs confirm-it's-you: one confirm for the whole batch.
    const post = async (confirmToken?: string): Promise<WalletView[] | Staged> => {
      try {
        return await api<WalletView[] | Staged>('/v1/wallets', {
          method: 'POST',
          body: confirmToken === undefined ? { wallets: drafts } : { wallets: drafts, confirmToken },
        });
      } catch (e) {
        // withConfirm reads auth-client's error; api() throws the shell's.
        if (e instanceof ApiCallError && e.code === 'confirm-required') throw new AuthApiError(e.status, 'confirm-required', e.extra);
        throw e;
      }
    };
    try {
      const action = await walletsAction(drafts.map((d) => d.address));
      const result: WalletView[] | Staged = await withConfirm(action, post, prove);
      // Hold model v3: added from a username-and-password login (a PGP key login is strong, owner
      // Q81), the wallets are a draft to review and submit (202 staged): nothing is listed yet.
      if (isStaged(result)) {
        // Re-verify O3: no ids yet, so each address typed is recorded by itself (walletRecord.ts).
        for (const d of drafts) recordStagedAddress(d.address);
        setBatch([]);
        setLabel('');
        setAddress('');
        setAdding(false);
        setStaged(true);
        return;
      }
      const saved = result;
      // Review 17 Nov M4: this device keeps the address typed for each id the API gave (walletRecord.ts),
      // so the quote and the accepted sheet refuse any later list naming another. The answer itself
      // must carry exactly the addresses typed, in order: one naming another is not shown as saved.
      saved.forEach((w, i) => {
        const typed = drafts[i]?.address;
        if (typed !== undefined) recordTypedAddress(w.id, typed);
      });
      if (saved.length !== drafts.length || saved.some((w, i) => w.address !== drafts[i]!.address)) {
        setError(ADD_SWAPPED);
        return;
      }
      // Sent here by a 409 no-wallet: go back only when every new wallet can be paid now. A wallet
      // that waits would send the take straight back here (no-wallet again), so the screen stays,
      // shows the wait, and Back returns to returnTo.
      if (addMode && saved.every((w) => w.usable)) {
        navigate(returnTo, { replace: true });
        return;
      }
      setWallets((prev) => [...(prev ?? []), ...saved]);
      setBatch([]);
      setLabel('');
      setAddress('');
      setAdding(false);
      // The whole batch shares one clock (FU-B), so one line covers it.
      const waiting = saved.find((w) => !w.usable);
      if (waiting) {
        setNotice(
          saved.length === 1
            ? `Your new wallet can be paid from ${when(waiting.usableFrom)}.`
            : `Your ${saved.length} new wallets can be paid from ${when(waiting.usableFrom)}: one wait for all of them.`,
        );
      }
      void api<WalletRule>('/v1/wallets/rule').then(setRule, () => setRule(null));
    } catch (e) {
      if (!isConfirmAbort(e)) {
        const code = addCantDo(e);
        const cap = changesCapOf(e);
        if (code !== null) setCantDo({ code, text: cap !== null ? holdChangesCantDoText(cap.max) : (walletsCantDoText(code) ?? refusalText(e, ADD_FAILED)) });
        else setError(addError(e));
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove(w: WalletView) {
    setError(null);
    try {
      // Removal cannot redirect money, so it needs no confirm; the API always saves an alert.
      const r = await api<unknown>(`/v1/wallets/${encodeURIComponent(w.id)}`, { method: 'DELETE' });
      // Owner p5-7: from a username-and-password login the removal is a draft that waits 24 h once
      // submitted; the wallet stays listed and usable until then.
      if (isStaged(r)) {
        setStaged(true);
        return;
      }
      setWallets((prev) => (prev ?? []).filter((x) => x.id !== w.id));
    } catch (e) {
      if (reportChangesCap(e)) return;
      setError('That wallet could not be removed. Try again.');
    }
  }

  /** Owner, 17 Nov 2026: the default payout wallet. The list is read again: the API marks the default. */
  async function makeDefault(w: WalletView) {
    setError(null);
    try {
      await api<unknown>(`/v1/wallets/${encodeURIComponent(w.id)}/default`, { method: 'PUT', body: {} });
      void api<WalletView[]>('/v1/wallets').then(setWallets, () => undefined);
    } catch {
      setError(MAKE_DEFAULT_FAILED);
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

        {notice ? (
          <p className="x2f-wallets__notice" role="status">
            {notice}
          </p>
        ) : null}
        {staged ? <StagedNote /> : null}

        {wallets && wallets.length > 0 ? (
          <section className="x2f-wallets__section" aria-label="Linked wallets">
            <h2 className="x2f-wallets__section-label">Linked wallets</h2>
            <ul className="x2f-wallets__list">
              {wallets.map((w) => (
                <WalletRow key={w.id} w={w} onRemove={remove} onMakeDefault={(x) => void makeDefault(x)} onRename={(x) => {
                  setError(null);
                  setRenaming(x);
                }} />
              ))}
            </ul>
          </section>
        ) : null}

        {adding ? (
          <section className="x2f-wallets__add" aria-label="Add a wallet">
            <div className="x2f-wallets__add-head">
              <h2 className="x2f-wallets__add-title">Add a wallet</h2>
              <span className="x2f-wallets__add-hint">Which app is it in?</span>
            </div>

            {batch.length > 0 ? (
              <ul className="x2f-wallets__batch" aria-label="Wallets to save">
                {batch.map((d) => (
                  <li key={d.address} className="x2f-wallets__batch-item">
                    <span>
                      {d.label} · {APP_LABELS[d.app]} · <span className="x2f-wallets__mono">…{d.address.slice(-6)}</span>
                      {d.oneTime === true ? ` · ${ONE_TIME_TAG}` : ''}
                    </span>
                    <button
                      type="button"
                      className="x2f-icon-button"
                      aria-label={`Take ${d.label} out of this batch`}
                      onClick={() => setBatch((b) => b.filter((x) => x.address !== d.address))}
                    >
                      <Icon name="close" size={18} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

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
              <p className="x2f-wallets__tip">{EDGE_TIP}</p>
            ) : null}

            <label className="x2f-wallets__field" htmlFor="wallet-label">
              Name
              <input
                id="wallet-label"
                className="x2f-wallets__input x2f-wallets__input--text"
                type="text"
                autoComplete="off"
                maxLength={LABEL_MAX}
                placeholder={nextWalletName(known)}
                aria-describedby={nameHelp !== null ? 'wallet-label-help' : undefined}
                aria-invalid={nameHelp !== null ? true : undefined}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <span aria-live="polite">
              {nameHelp !== null ? (
                <span className="x2f-wallets__error" id="wallet-label-help" data-part="wallet-label-help">
                  {nameHelp}
                </span>
              ) : null}
            </span>
            <div className="x2f-wallets__apps" aria-label="Suggested names">
              {nameSuggestions(known).map((name) => (
                <button key={name} type="button" className="x2f-app-chip" onClick={() => setLabel(name)}>
                  {name}
                </button>
              ))}
            </div>
            <span className="x2f-wallets__confirm-note">
              X2F stores this name. Keep it neutral, and never write where the money came from.
            </span>

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
                  aria-describedby={repeated ? 'wallet-address-repeated' : undefined}
                  aria-invalid={repeated ? true : undefined}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
                {/* The board's "Scan address QR code" button comes back with a scanner; a button that does nothing is not shown. */}
              </span>
            </label>
            <span aria-live="polite">
              {repeated ? (
                <span className="x2f-wallets__error" id="wallet-address-repeated" data-part="wallet-repeated">
                  {ADDRESS_REPEATED}
                </span>
              ) : null}
            </span>
            <span className="x2f-wallets__confirm-note">
              For extra privacy, paste a fresh address from your wallet for each trade.
            </span>

            <span id="wallet-keep-for" className="x2f-wallets__field">
              {KEEP_FOR.legend}
            </span>
            <ChoiceGroup
              look="card"
              labelledBy="wallet-keep-for"
              part="wallet-keep-for"
              value={keepFor}
              onChange={setKeepFor}
              options={[
                { value: 'saved', label: KEEP_FOR.saved, note: KEEP_FOR.savedNote },
                { value: 'one-time', label: KEEP_FOR.oneTime, note: KEEP_FOR.oneTimeNote },
              ]}
            />

            <Button
              variant="secondary"
              onClick={addAnother}
              disabled={trimmed === '' || blocked || batch.length + 1 >= MAX_WALLET_BATCH}
            >
              Add another
            </Button>
            <span className="x2f-wallets__confirm-note">{ruleNote(rule)}</span>
            {error ? (
              <p className="x2f-wallets__error" role="alert">
                {error}
              </p>
            ) : null}
          </section>
        ) : null}

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
        {!adding && error ? (
          <p className="x2f-wallets__error" role="alert">
            {error}
          </p>
        ) : null}
        {cantDo !== null ? (
          <CantDoThat
            title={WALLETS_CANT_TITLE}
            body={cantDo.text}
            from={cantDo.code}
            onClose={() => {
              // Closed, the reason stays on the screen as a plain line.
              setError(cantDo.text);
              setCantDo(null);
            }}
          />
        ) : null}
      </main>

      <ConfirmOpenProvider value={confirmOpen || popup || renaming !== null}>
        <WalletsFoot adding={adding} count={count} saving={saving} blocked={blocked} blockedBy={repeated ? 'wallet-address-repeated' : nameHelp !== null ? 'wallet-label-help' : undefined} onSave={() => void save()} onAdd={() => setPopup(true)} />
      </ConfirmOpenProvider>

      {popup ? (
        <RulePopup
          rule={rule}
          onClose={() => setPopup(false)}
          onContinue={() => {
            setPopup(false);
            setAdding(true);
          }}
        />
      ) : null}
      {renaming !== null ? (
        <RenameSheet
          wallet={renaming}
          addresses={(wallets ?? []).map((w) => w.address)}
          onClose={() => setRenaming(null)}
          onRefused={(r) => {
            setRenaming(null);
            setCantDo(r);
          }}
          onRenamed={(label) => {
            const id = renaming.id;
            setWallets((prev) => (prev ?? []).map((x) => (x.id === id ? { ...x, label } : x)));
            setRenaming(null);
          }}
        />
      ) : null}
      {confirmUi}
    </div>
  );
}
