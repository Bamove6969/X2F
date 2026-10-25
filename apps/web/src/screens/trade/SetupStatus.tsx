/**
 * SetupStatus (Task 22): escrow setup progress for both traders, the keep-open bar, the escrow
 * check words once the escrow is ready, and the danger state when the security check fails
 * (plan Task 22; P3-C1: both apps show the same four words, so a swapped participant shows up).
 */
import { useState } from 'react';
import { ApiCallError } from '../../api/client.js';
import { postTradeEvent, publicName, type TradeView } from '../../api/trade.js';
import { Button } from '../../ui/Button.js';
import { EscrowDots } from '../../ui/EscrowDots.js';
import { Icon } from '../../ui/icons.js';
import { StatusChip } from '../../ui/StatusChip.js';
import type { TradeEscrow } from './seams.js';
import type { TradeScreenProps } from './TradeRoom.js';

/** The other trader's public name, rendered exactly as set (Global Constraints). */
export function Name({ view }: { view: TradeView }) {
  return <span data-username="">{publicName(view.counterparty)}</span>;
}

/** "Escrow check: four words. They match on <counterparty>'s screen." and the words. */
export function EscrowCheck({ view, words }: { view: TradeView; words: readonly string[] }) {
  return (
    <section className="x2f-escrow-check" aria-label="Escrow check" data-escrow-check="">
      <p className="x2f-escrow-check__lead">
        Escrow check: four words. They match on <Name view={view} />
        's screen.
      </p>
      <ol className="x2f-escrow-check__words">
        {words.map((w, i) => (
          <li key={i} className="x2f-mono">
            {w}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Progress while the escrow is set up (state `setup`), or until this device has the check words. */
export function SetupStatus({ view, escrow }: { view: TradeView; escrow: TradeEscrow }) {
  const ready = escrow.checkWords !== null;
  return (
    <section className="x2f-setup" aria-label="Escrow setup" data-setup-status="">
      {ready ? null : (
        <div className="x2f-setup__row">
          <StatusChip tone="caution" icon="shield-clock" label="Setting up escrow" />
          <EscrowDots filled={[false, false, false]} tone="caution" />
        </div>
      )}
      {escrow.keepOpen || !ready ? (
        <p className="x2f-keep-open" role="status" data-keep-open="">
          <Icon name="info" size={16} /> Keep this page open until the escrow is ready.
        </p>
      ) : null}
      {escrow.error !== null && escrow.retryable ? (
        <div className="x2f-setup__retry" role="alert">
          <p>Escrow setup stopped. Check your connection and try again.</p>
          <Button variant="secondary" onClick={() => escrow.retry()}>
            Try again
          </Button>
        </div>
      ) : null}
      {escrow.checkWords ? <EscrowCheck view={view} words={escrow.checkWords} /> : null}
    </section>
  );
}

/**
 * The room's screen whenever the escrow reports an integrity failure (TradeRoom: it replaces
 * every slot, so no address, QR code or wallet link can show). Cancel ends the trade where one
 * side can: the buyer at any time before payment (`buyer-cancel`), the seller by proposing a
 * cancel once funding has started.
 */
export function IntegrityFailed({ view, refresh }: TradeScreenProps) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canCancel = view.role === 'buyer' ? ['setup', 'funding'].includes(view.state) : view.state === 'funding' && view.cancelProposedBy === null;
  const cancel = async () => {
    setBusy(true);
    setErr(null);
    try {
      await postTradeEvent(view.code, { type: view.role === 'buyer' ? 'buyer-cancel' : 'propose-cancel' });
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiCallError && e.status === 409 ? "This trade can't be cancelled from here any more." : "Couldn't cancel. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="x2f-trade-body" data-integrity-failed="">
      <StatusChip tone="danger" icon="alert" label="Security check failed" />
      <h1 className="x2f-trade-title">Security check failed. Don't fund this trade.</h1>
      <p className="x2f-trade-lead">
        The escrow details on this device don't match the ones X2F signed, so this trade stops here.
      </p>
      {canCancel ? (
        <Button variant="primary" disabled={busy} onClick={() => void cancel()}>
          Cancel
        </Button>
      ) : null}
      {err ? <p role="alert">{err}</p> : null}
    </section>
  );
}
