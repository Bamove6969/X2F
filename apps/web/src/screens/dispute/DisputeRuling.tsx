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
import { TradeHeader } from '../../ui/TradeHeader.js';
import type { DisputeTrade, DisputeView } from './api.js';
import { TradeTitle } from './DisputeOpen.js';
import { DisputeIcon } from './icons.js';
import { ModeratorTag } from './ModeratorTag.js';
import { APPEAL_MIN, APPEAL_WINDOW_H, appealSentText, dayTime, overturnLien, rulingCopy, rulingFinal } from './rules.js';
import './dispute.css';

function AppealSection({
  dispute,
  me,
  other,
  serverClock,
  onAppeal,
}: {
  dispute: DisputeView;
  me: 'buyer' | 'seller';
  other: string;
  serverClock: () => Date;
  onAppeal: (why: string) => Promise<void>;
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
        Either of you can appeal until {dayTime(until)} ({APPEAL_WINDOW_H} h). An appeal goes to a senior moderator or the owner who hasn't seen this case.
        {overturnLien(r.outcome, me, other)}
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
            <Button variant="primary" disabled={!ready || busy} onClick={() => void send()}>
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

export function DisputeRuling({
  trade,
  methodName,
  dispute,
  serverClock,
  onAppeal,
}: {
  trade: DisputeTrade;
  methodName: string;
  dispute: DisputeView;
  serverClock: () => Date;
  onAppeal: (why: string) => Promise<void>;
}) {
  const r = dispute.ruling;
  if (r === null) throw new Error('DisputeRuling needs a ruling');
  const now = serverClock();
  const copy = rulingCopy(dispute, trade.role, trade.counterparty, trade.amountAtomic, now);
  const chat = `/trade/${encodeURIComponent(trade.code)}/dispute?view=chat`;
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
        <AppealSection dispute={dispute} me={trade.role} other={trade.counterparty} serverClock={serverClock} onAppeal={onAppeal} />
        <p className="dispute-footnote">{copy.footer}</p>
      </div>
    </div>
  );
}
