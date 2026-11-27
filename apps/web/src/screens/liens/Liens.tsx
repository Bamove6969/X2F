/**
 * Settings → What you owe (lien recovery, owner 16 Nov 2026, docs/lien-recovery.md): the debtor's
 * notice (owed, paid back so far, still to pay, the current rate) and, for a lien owed to this
 * account, the totals only (review M4, provisional owner answer Q4: never the debtor's purchases)
 * and the wallet recoveries go to (Q2): this device signs "pay my recoveries to this wallet" with
 * its own identity from the disputed trade (the escrow worker), and nothing is paid until it has.
 * Figures come from the API only; nothing here moves money. DESIGN: not drawn; COPY-UNSIGNED
 * (liensCopy.ts). The buyer's quote shows each purchase's recovery before the take (Quote.tsx).
 */
import { formatXmrExact } from '@x2f/trade';
import { useEffect, useState } from 'react';
import { ApiCallError } from '../../api/client.js';
import { escrowClient } from '../../escrow/useEscrow.js';
import { useSession } from '../../session/useSession.js';
import { addressEnd } from '../../ui/addressEnd.js';
import { fetchWallets, type PickWallet } from '../quote/api.js';
import { confirmPaid, fetchLiens, setRecoveryAddress, type MyLiens, type OwedToMe } from './liensApi.js';
import { LIENS_COPY as C, deadlineText, pctOf } from './liensCopy.js';
import '../screens.css';

export const LIENS_PATH = '/settings/liens';

const xmr = (a: bigint) => `${formatXmrExact(a)} XMR`;

export function Liens() {
  const session = useSession();
  const signedIn = session.status === 'signed-in';
  const [data, setData] = useState<MyLiens | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!signedIn) return;
    const ac = new AbortController();
    fetchLiens(ac.signal).then(setData, () => {
      if (!ac.signal.aborted) setFailed(true);
    });
    return () => ac.abort();
  }, [signedIn, reload]);

  return (
    <main className="screen">
      <h1>{C.title}</h1>
      {failed && <p role="alert">{C.loadFailed}</p>}
      {data !== null && data.owes.length === 0 && data.owedTo.length === 0 && <p>{C.none}</p>}
      {data?.owes.map((l) => (
        <section key={l.id} aria-label={C.title} data-lien={l.id}>
          {/* Owner 26 Nov 2026: 7 days to pay the agreed way (the deadline, the method, who confirms). */}
          {l.grace?.paidOffPlatform === true ? (
            <p data-part="grace">{C.gracePaidDebtor}</p>
          ) : l.grace?.mode === 'grace' ? (
            <p data-part="grace">{l.grace.lapsed ? C.graceOwesLapsed(l.grace.method) : C.graceOwes(l.grace.method, deadlineText(l.grace.graceUntil))}</p>
          ) : (
            <p>{C.owesIntro(pctOf(l.rateBps))}</p>
          )}
          {l.status === 'suspended' && <p>{C.suspended}</p>}
          <dl>
            <dt>{C.owed}</dt>
            <dd>{xmr(l.amountAtomic)}</dd>
            <dt>{C.recovered}</dt>
            <dd>{xmr(l.recoveredAtomic)}</dd>
            <dt>{C.remaining}</dt>
            <dd>{xmr(l.remainingAtomic)}</dd>
            <dt>{C.rate}</dt>
            <dd>{pctOf(l.rateBps)}</dd>
          </dl>
          <p>{C.sellNote}</p>
          <p>{C.fromTrade(l.fromCode)}</p>
        </section>
      ))}
      {data !== null && data.owedTo.length > 0 && (
        <section aria-label={C.owedToTitle}>
          <h2>{C.owedToTitle}</h2>
          <p>{C.owedToIntro}</p>
          {data.owedTo.map((l) => (
            <div key={l.id} data-lien={l.id}>
              <dl>
                <dt>{C.owed}</dt>
                <dd>{xmr(l.amountAtomic)}</dd>
                <dt>{C.received}</dt>
                <dd>{xmr(l.recoveredAtomic)}</dd>
                <dt>{C.remaining}</dt>
                <dd>{xmr(l.remainingAtomic)}</dd>
              </dl>
              {l.grace?.paidOffPlatform === true ? (
                <p data-part="grace">{C.gracePaid}</p>
              ) : l.status === 'repaid' ? (
                <p>{C.repaid}</p>
              ) : l.grace?.mode === 'grace' ? (
                <GraceOwedTo lien={l} onPaid={() => setReload((n) => n + 1)} />
              ) : (
                <RecoveryAddress lien={l} onSet={() => setReload((n) => n + 1)} />
              )}
            </div>
          ))}
        </section>
      )}
    </main>
  );
}

/**
 * Owner decision 26 Nov 2026 (5:43 PM): the person owed signs off that they were paid the agreed way
 * before the 7 days are up (or after; until a moderator switches the lien to collecting). Only this
 * account's own session can; it ends the lien. A confirm step first, since it cannot be undone.
 */
export function GraceOwedTo({ lien, onPaid }: { lien: OwedToMe; onPaid: () => void }) {
  const g = lien.grace!;
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const yes = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await confirmPaid(lien.id);
      onPaid();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-part="grace">
      <p>{g.lapsed ? C.graceOwedToLapsed(g.method) : C.graceOwedTo(g.method, deadlineText(g.graceUntil))}</p>
      {asking ? (
        <>
          <p>{C.graceConfirmCheck}</p>
          <button type="button" disabled={busy} onClick={() => void yes()}>
            {C.graceConfirmYes}
          </button>
          <button type="button" disabled={busy} onClick={() => setAsking(false)}>
            {C.graceConfirmNo}
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setAsking(true)}>
          {C.graceConfirm}
        </button>
      )}
      {failed && <p role="alert">{C.addressFailed}</p>}
    </div>
  );
}

/**
 * Q2 (provisional owner answer, 17 Nov 2026): where recoveries on a lien owed to this account go.
 * The escrow worker signs the statement with this device's identity in the disputed trade; a device
 * without that trade's record cannot, and says which device can.
 */
export function RecoveryAddress({ lien, onSet }: { lien: OwedToMe; onSet: () => void }) {
  const [open, setOpen] = useState(!lien.recoveryAddressSet);
  const [wallets, setWallets] = useState<PickWallet[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    fetchWallets(ac.signal).then(
      (all) => setWallets(all.filter((w) => w.usable)),
      () => {
        if (!ac.signal.aborted) setNote(C.addressFailed);
      },
    );
    return () => ac.abort();
  }, [open]);

  const use = async () => {
    const w = wallets?.find((x) => x.id === picked);
    if (!w) return;
    setBusy(true);
    setNote(null);
    try {
      const signed = await escrowClient().signRecoveryAddress?.(lien.fromCode, w.address, new Date().toISOString());
      if (!signed) {
        setNote(C.addressNoRecord(lien.fromCode));
        return;
      }
      await setRecoveryAddress(lien.id, signed);
      setOpen(false);
      onSet();
    } catch (e) {
      setNote(e instanceof ApiCallError && e.code === 'recovery-address-refused' ? C.addressTaken : C.addressFailed);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <p data-part="recovery-address">
        {C.addressSet}{' '}
        <button type="button" onClick={() => setOpen(true)}>
          {C.addressChange}
        </button>
      </p>
    );
  }
  return (
    <div data-part="recovery-address">
      <p>{C.addressNeeded}</p>
      {wallets !== null && (
        <fieldset>
          <legend>{C.addressPick}</legend>
          {wallets.map((w) => (
            <label key={w.id}>
              <input type="radio" name={`recovery-${lien.id}`} value={w.id} checked={picked === w.id} onChange={() => setPicked(w.id)} />
              {/* Cut from the address the device signs, never the API's addressEnd (re-review B1-new, Task 19 gap 2). */}
              {w.label} …{addressEnd(w.address)}
            </label>
          ))}
        </fieldset>
      )}
      {note !== null && <p role="alert">{note}</p>}
      <button type="button" disabled={picked === null || busy} onClick={() => void use()}>
        {C.addressUse}
      </button>
    </div>
  );
}
