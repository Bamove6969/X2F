// DisputeRuling (Plan 3 Task 27), board design/x2f-app/DisputeRuling.dc.html: the moderator's
// ruling card (outcome, the destination ending for the side it pays, reason, evidence used), the
// appeal window with its countdown, and the appeal form. Everything comes from the server's ruling
// record (Plan 4 writes it). Co-signing the moderator-built payout is gated by rulingAllowsCosign.
// The board has no orange action until the appeal form holds 10 characters, so "Send appeal" is
// this screen's only data-primary and the default state has none (lead question in the report).
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../../ui/Button.js';
import { Countdown } from '../../ui/Countdown.js';
import { Icon } from '../../ui/icons.js';
import { Notice } from '../../ui/Notice.js';
import { TradeHeader } from '../../ui/TradeHeader.js';
import type { DisputeTrade, DisputeView } from './api.js';
import { TradeTitle } from './DisputeOpen.js';
import { DisputeIcon } from './icons.js';
import { ModeratorTag } from './ModeratorTag.js';
import { APPEAL_MIN, APPEAL_WINDOW_H, appealSentText, dayTime, feeOwedLine, isTxHex, overturnLien, rulingCopy, rulingFinal, utcDateTime } from './rules.js';
import './dispute.css';

function AppealSection({
  dispute,
  me,
  other,
  serverClock,
  onAppeal,
  quiet = false,
}: {
  dispute: DisputeView;
  me: 'buyer' | 'seller';
  other: string;
  serverClock: () => Date;
  onAppeal: (why: string) => Promise<void>;
  /** Design 7 Nov: while the proof of a payment the ruling orders is due, that is the screen's one primary. */
  quiet?: boolean;
}) {
  const [writing, setWriting] = useState(false);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const whyId = useId();
  const r = dispute.ruling!;
  const now = serverClock();

  if (dispute.appeal !== null) {
    return (
      <section aria-label="Appeal" className="dispute-appeal">
        <span className="dispute-appeal-sent">
          <Icon name="clock" size={16} stroke={2} />
          {appealSentText(dispute, me, other)}
        </span>
      </section>
    );
  }
  // Only a ruled dispute can be appealed (the server refuses the rest as wrong-state).
  if (r.appealUntil === null || dispute.status !== 'ruled') {
    return (
      <section aria-label="Appeal" className="dispute-appeal">
        <p className="dispute-muted">This ruling is final. {/* COPY-UNSIGNED */}</p>
      </section>
    );
  }
  const until = new Date(r.appealUntil);
  if (rulingFinal(dispute, now)) {
    return (
      <section aria-label="Appeal" className="dispute-appeal">
        <h2 className="dispute-strong-16">Appeal window</h2>
        <p className="dispute-muted">The appeal window closed on {dayTime(until)}. {/* COPY-UNSIGNED */}</p>
      </section>
    );
  }
  const ready = why.trim().length >= APPEAL_MIN;
  const send = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onAppeal(why);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  return (
    <section aria-label="Appeal" className="dispute-appeal">
      <div className="dispute-row-between">
        <h2 className="dispute-strong-16">Appeal window</h2>
        <span className="dispute-window-open">
          <Icon name="clock" size={14} stroke={1.75} />
          Open · <Countdown deadline={until} serverClock={serverClock} format="minutes" /> left
        </span>
      </div>
      <p className="dispute-muted">
        Either of you can appeal until {dayTime(until)} ({dispute.appealWindowH ?? APPEAL_WINDOW_H} h). An appeal goes to a senior moderator or the owner who hasn't seen this case.
        {overturnLien(r.outcome, me, other)}
        {/* The owner's rule: one appeal only, binding. COPY-UNSIGNED */}
        {' There is one appeal per dispute, and its decision is final.'}
      </p>
      {writing ? (
        <div className="dispute-stack-8">
          <label htmlFor={whyId} className="dispute-strong-15">
            Why should it be looked at again?
          </label>
          <textarea
            id={whyId}
            rows={3}
            value={why}
            maxLength={1000}
            onChange={(e) => setWhy(e.target.value)}
            placeholder="What the moderator missed, and any new evidence"
            className="dispute-textarea dispute-textarea--ground"
          />
          <div className="dispute-two">
            <Button variant="secondary" onClick={() => { setWriting(false); setWhy(''); }}>
              Cancel
            </Button>
            <Button variant={quiet ? 'secondary' : 'primary'} disabled={!ready || busy} onClick={() => void send()}>
              Send appeal
            </Button>
          </div>
          {error !== null ? (
            <p className="dispute-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setWriting(true)}>
          Appeal this ruling
        </Button>
      )}
    </section>
  );
}

/**
 * The after-refund `seller-sends-xmr` proof (Plan 4 Task 15, A6/A8): the transaction ID and its
 * transaction key, 64 hex characters each, so a moderator can check the payment. Shown only with a
 * handler: no API route takes it yet (NEEDS_TASK_12_TX_PROOF). COPY-UNSIGNED; DESIGNER-REVIEW (no board).
 */
function TxProofForm({ onTxProof }: { onTxProof: (txHash: string, txKey: string) => Promise<void> }) {
  const [hash, setHash] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hashId = useId();
  const keyId = useId();
  const h = hash.trim().toLowerCase();
  const k = key.trim().toLowerCase();
  const ready = isTxHex(h) && isTxHex(k);
  const send = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onTxProof(h, k);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  if (sent) {
    return (
      <Notice tone="plain" icon="check" live="status" data-part="tx-proof-sent">
        Proof sent. A moderator will check the payment.
      </Notice>
    );
  }
  return (
    <section aria-label="Transfer proof" className="dispute-stack-8">
      <h2 className="dispute-strong-15">Prove you sent it</h2>
      <p className="dispute-muted">Your wallet shows the transaction ID and the transaction key once the XMR is sent.</p>
      <label htmlFor={hashId} className="dispute-field-label">
        Transaction ID
      </label>
      <input id={hashId} value={hash} onChange={(e) => setHash(e.target.value)} autoComplete="off" spellCheck={false} className="dispute-input-mono" />
      <label htmlFor={keyId} className="dispute-field-label">
        Transaction key
      </label>
      <input id={keyId} value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} className="dispute-input-mono" />
      <Button variant="primary" disabled={!ready || busy} onClick={() => void send()}>
        Send proof
      </Button>
      {error !== null ? (
        <p className="dispute-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export function DisputeRuling({
  trade,
  methodName,
  dispute,
  serverClock,
  onAppeal,
  onTxProof,
}: {
  trade: DisputeTrade;
  methodName: string;
  dispute: DisputeView;
  serverClock: () => Date;
  onAppeal: (why: string) => Promise<void>;
  /** The seller's proof of a `seller-sends-xmr` payment; none until the API takes it (NEEDS_TASK_12_TX_PROOF). */
  onTxProof?: (txHash: string, txKey: string) => Promise<void>;
}) {
  const r = dispute.ruling;
  if (r === null) throw new Error('DisputeRuling needs a ruling');
  const now = serverClock();
  const copy = rulingCopy(dispute, trade.role, trade.counterparty, trade.amountAtomic, now, trade.poster);
  const chat = `/trade/${encodeURIComponent(trade.code)}/dispute?view=chat`;
  // The ruling orders the seller to send the XMR and the proof form is wired: Send proof is the primary.
  const proofDue = r.outcome === 'seller-sends-xmr' && trade.role === 'seller' && onTxProof !== undefined;
  return (
    <div className="dispute-screen">
      <TradeHeader
        title={<TradeTitle trade={trade} />}
        code={trade.code}
        method={{ name: methodName, whatItIs: trade.whatItIs }}
        backTo={chat}
        action={
          <Link to={chat} className="dispute-header-link">
            Chat
          </Link>
        }
      />
      <div className="dispute-main">
        <section aria-label="Ruling" className="dispute-ruling">
          <div className="dispute-row-between wrap">
            <ModeratorTag from="mod" inDispute={trade.dispute !== null} moderator={r.moderatorName} />
            <span className="dispute-muted-sm">
              <span className="dispute-mod-name">{r.moderatorName}</span> · {dayTime(new Date(r.ruledAt))}
            </span>
          </div>
          <div className="dispute-stack-6">
            <span className="dispute-outcome">{copy.label}</span>
            <h1 className="dispute-title">{copy.title}</h1>
            {copy.destination !== null ? (
              <span className="dispute-muted-14">
                {/* Review I1 (NEEDS_PLAN_4_RULING_PAYOUT, rules.ts): where the XMR goes, not the board's
                    "Sent to …", until the API reports the payout executed. COPY-UNSIGNED */}
                Goes to {copy.destination.app ?? 'your wallet' /* COPY-UNSIGNED */}, address ending <span className="dispute-mono">…{copy.destination.end}</span>
                .
              </span>
            ) : null}
            {r.outcome === 'seller-sends-xmr' && dispute.complyBy ? (
              <span className="dispute-muted-14">
                {/* COPY-UNSIGNED */}
                {trade.role === 'seller' ? 'Send it by ' : `${trade.counterparty} has until `}
                <span className="dispute-ink dispute-mono">{utcDateTime(new Date(dispute.complyBy))}</span>
                {trade.role === 'seller' ? '.' : ' to send it.'}
              </span>
            ) : null}
          </div>
          <div className="dispute-stack-6">
            <h2 className="dispute-strong-15">Reason</h2>
            <p className="dispute-body">{r.reason}</p>
          </div>
          {r.evidence.length > 0 ? (
            <div className="dispute-stack-8">
              <h2 className="dispute-strong-15">Evidence used</h2>
              <ul className="dispute-evidence-list">
                {r.evidence.map((e, i) => (
                  <li key={i}>
                    <DisputeIcon name={/chat/i.test(e) ? 'chat' : 'doc'} size={16} />
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
        {dispute.feeOwedAtomic ? (
          // Revision 2026-10-29c: only the side the server says owes the fee gets this line (Task 12's fees_owed).
          <Notice tone="caution" live="off" data-part="fee-owed">
            {feeOwedLine(dispute.feeOwedAtomic)}
          </Notice>
        ) : null}
        {proofDue ? <TxProofForm onTxProof={onTxProof!} /> : null}
        <AppealSection dispute={dispute} me={trade.role} other={trade.counterparty} serverClock={serverClock} onAppeal={onAppeal} quiet={proofDue} />
        <p className="dispute-footnote">{copy.footer}</p>
      </div>
    </div>
  );
}
