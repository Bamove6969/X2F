// DisputeOpen (Plan 3 Task 27), board design/x2f-app/DisputeOpen.dc.html. The trader picks what
// went wrong and tells the moderator; the screen says plainly that a moderator will read the whole
// chat. Before the state machine allows a dispute (the buyer, until the trade's wait after marking paid)
// it explains when and sends nothing. Evidence goes through Plan 5's on-device pipeline
// (seams.tsx); until then nothing can be picked.
import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from '../../ui/Button.js';
import { Icon } from '../../ui/icons.js';
import { Notice } from '../../ui/Notice.js';
import { TradeHeader } from '../../ui/TradeHeader.js';
import type { DisputeTrade, Reason } from './api.js';
import { DisputeIcon } from './icons.js';
import { disputeEntry, HOURGLASS_LINE, NOTE_MAX, reasonsFor, xmrInText } from './rules.js';
import { EvidenceUpload, tradeProofs } from './seams.js';
import './dispute.css';

export function TradeTitle({ trade }: { trade: DisputeTrade }) {
  return (
    <>
      {trade.role === 'buyer' ? 'Buying from ' : 'Selling to '}
      <span data-username="">{trade.counterparty}</span>
    </>
  );
}

export function DisputeOpen({
  trade,
  methodName,
  now,
  onOpen,
  evidence,
}: {
  trade: DisputeTrade;
  methodName: string;
  /** The server clock. */
  now: () => Date;
  onOpen: (reason: Reason, note: string) => Promise<void>;
  /** Plan 5's "Add more evidence" (seams.tsx). */
  evidence?: ReactNode;
}) {
  const [reason, setReason] = useState<Reason>('paid');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteId = useId();
  const at = now();
  const entry = disputeEntry(trade, at);
  const allowed = entry.kind === 'open';
  const back = `/trade/${encodeURIComponent(trade.code)}`;
  // The buyer may dispute from the trade's wait after marking paid (owner 2026-11-07 F9), often before the
  // seller's confirm window ends: the flag says it ran out only once it has.
  const timedOut =
    trade.state === 'paid' && trade.role === 'buyer' && allowed && trade.confirmBy !== null && at.getTime() >= Date.parse(trade.confirmBy);
  const afterRefund = trade.state === 'refunded';
  const proofs = tradeProofs(trade);

  const submit = async () => {
    if (!allowed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onOpen(reason, note);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="dispute-screen">
      <TradeHeader title={<TradeTitle trade={trade} />} code={trade.code} method={{ name: methodName, whatItIs: trade.whatItIs }} backTo={back} />
      <div className="dispute-main">
        {timedOut ? (
          <span className="dispute-flag" data-tone="caution">
            <Icon name="clock" size={16} />
            Seller's time to confirm ran out
          </span>
        ) : null}

        <section className="dispute-stack-4">
          <h1 className="dispute-title">Open a dispute</h1>
          <p className="dispute-lead">
            {afterRefund
              ? 'A moderator looks at what happened and decides what the seller must do. The escrow was already refunded.' /* COPY-UNSIGNED */
              : `A moderator looks at what happened and decides where the ${xmrInText(trade.amountAtomic)} XMR goes. It stays locked in escrow until then.`}
          </p>
        </section>

        {/* Owner Q20 (2026-11-03): talk to the other trader first, then accept or dispute. A nudge,
            never a block. COPY-UNSIGNED; DESIGNER-REVIEW (no board: the kit's Notice, plain). */}
        <Notice tone="plain" icon="info" live="off" title={`Talk to ${trade.counterparty} first`} data-part="talk-first">
          Most problems are sorted out in the trade chat. Tell them what went wrong and give them a chance to put it right. If you still
          don't agree, open a dispute.
          {/* Design 7 Nov P3: the link on its own line, a 44px tertiary link. */}
          <Link to={back} className="dispute-tertiary-link">
            Go to the chat
          </Link>
        </Notice>

        {entry.kind === 'wait' ? (
          <p className="dispute-wait" role="status">
            <Icon name="clock" size={18} />
            <span>{entry.text}</span>
          </p>
        ) : null}

        <fieldset className="dispute-reasons" disabled={!allowed}>
          <legend>What went wrong?</legend>
          {reasonsFor(trade.role).map(([id, label]) => (
            <label key={id} className="dispute-reason" data-on={reason === id ? 'true' : 'false'}>
              <input type="radio" name="reason" value={id} checked={reason === id} onChange={() => setReason(id)} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>

        <div className="dispute-stack-6">
          <label htmlFor={noteId} className="dispute-strong-16">
            Tell the moderator what happened
          </label>
          <textarea
            id={noteId}
            rows={4}
            value={note}
            maxLength={NOTE_MAX}
            disabled={!allowed}
            onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
            placeholder={trade.role === 'buyer' ? 'When you paid, from which account, and anything the seller said' : 'What you checked, and anything the buyer said' /* COPY-UNSIGNED */}
            className="dispute-textarea"
          />
          <span className="dispute-muted-sm">
            {note.length} / {NOTE_MAX}
          </span>
        </div>

        <section aria-label="Evidence" className="dispute-stack-8">
          <h2 className="dispute-strong-16">Evidence</h2>
          {proofs.map((p) => (
            <div key={p.label} className="dispute-proof">
              <span className="dispute-proof__thumb" aria-hidden="true" />
              <span className="dispute-stack grow">
                <span className="dispute-strong">{p.label}</span>
                <span className="dispute-muted-sm">Already in this trade, blurred</span>
              </span>
              <span className="dispute-included">
                <Icon name="check" size={14} stroke={2} />
                Included
              </span>
            </div>
          ))}
          {evidence ?? <EvidenceUpload />}
        </section>

        <section aria-label="Who sees this" className="dispute-notice">
          <DisputeIcon name="eye" size={20} />
          <span className="dispute-stack-4">
            <span className="dispute-strong">A moderator will read this trade's chat to decide</span>
            <span className="dispute-muted">
              That includes your messages from before the trade started. They may also ask you for an unblurred copy of your proof. {HOURGLASS_LINE}
            </span>
          </span>
        </section>
        {error !== null ? (
          <p className="dispute-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <footer className="dispute-footer">
        <Button variant="primary" disabled={!allowed || busy} onClick={() => void submit()}>
          Open dispute
        </Button>
        <Link to={back} className="dispute-back">
          Not now, back to the trade
        </Link>
      </footer>
    </div>
  );
}
