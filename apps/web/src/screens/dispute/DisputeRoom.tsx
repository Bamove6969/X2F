// DisputeRoom (Plan 3 Task 27), board design/x2f-app/DisputeRoom.dc.html: the trade room while a
// dispute is open. The "In dispute" chip is rose (Global Constraints: rose = disputes; the board
// draws it amber). The moderator's join banner and name come only from server records
// (GET /v1/trades/:code/dispute), never from a chat message. The chat itself is Task 20's and the
// unblurred-proof request is Plan 5's (seams.tsx).
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon } from '../../ui/icons.js';
import { StatusChip } from '../../ui/StatusChip.js';
import { TradeHeader } from '../../ui/TradeHeader.js';
import type { DisputeTrade, DisputeView } from './api.js';
import { TradeTitle } from './DisputeOpen.js';
import { DisputeIcon } from './icons.js';
import { dayTime, inTime, repliedIn, xmrInText } from './rules.js';
import { FallbackChat, systemCardsFor, tradeProofs, UnblurredRequest } from './seams.js';
import './dispute.css';

/** "Replied in 38 min · ruling due by Fri 16 Oct, 10:14 (in 23 h)" (board), or the waiting form. */
function DeadlineLine({ dispute, now }: { dispute: DisputeView; now: Date }) {
  const replied = repliedIn(dispute);
  const first = replied !== null ? `Replied in ${replied}` : 'A moderator usually replies within 4 hours'; // COPY-UNSIGNED (from DisputeOpen)
  if (dispute.dueAt === null) return <span className="dispute-deadline">{first}.</span>;
  const due = new Date(dispute.dueAt);
  return (
    <span className="dispute-deadline">
      {first} · ruling due by <span className="dispute-ink">{dayTime(due)}</span> ({inTime(due.getTime() - now.getTime())})
    </span>
  );
}

export function DisputeRoom({
  trade,
  methodName,
  dispute,
  serverClock,
  chat,
  unblurred,
}: {
  trade: DisputeTrade;
  methodName: string;
  dispute: DisputeView;
  serverClock: () => Date;
  /** Task 20's ChatPanel (seams.tsx FallbackChat until then). */
  chat?: ReactNode;
  /** Plan 5's unblurred-proof request card (nothing until then). */
  unblurred?: ReactNode;
}) {
  const now = serverClock();
  const proofs = tradeProofs(trade);
  const ruling = `/trade/${encodeURIComponent(trade.code)}/dispute`;
  return (
    <div className="dispute-screen">
      <TradeHeader title={<TradeTitle trade={trade} />} code={trade.code} method={{ name: methodName, whatItIs: trade.whatItIs }} backTo={`/trade/${encodeURIComponent(trade.code)}`} />
      <section className="dispute-status" aria-label="Dispute status">
        <div className="dispute-chips">
          <StatusChip tone="danger" icon="clock" label="In dispute" />
          {dispute.afterRefund ? null : (
            <span className="x2f-chip" data-tone="escrow">
              <DisputeIcon name="lock" size={14} stroke={1.75} />
              {xmrInText(trade.amountAtomic)} XMR locked in escrow
            </span>
          )}
        </div>
        <DeadlineLine dispute={dispute} now={now} />
      </section>

      <main className="dispute-main dispute-main--room">
        {dispute.moderator !== null ? (
          <section aria-label="Moderator joined" className="dispute-joined">
            <Icon name="shield" size={22} stroke={1.75} />
            <span className="dispute-stack">
              <span className="dispute-strong">
                Moderator <span className="dispute-mod-name">{dispute.moderator.name}</span> joined this dispute
              </span>
              <span className="dispute-muted">They can read this whole chat, including messages from before the trade. Moderators only ever contact you here.</span>
            </span>
          </section>
        ) : null}

        {dispute.ruling !== null ? (
          <Link to={ruling} className="dispute-see-ruling">
            See the moderator's ruling {/* COPY-UNSIGNED */}
          </Link>
        ) : null}

        <section aria-label="Evidence" className="dispute-stack-8">
          <h2 className="dispute-eyebrow">Evidence in this dispute</h2>
          <div className="dispute-evidence-chips">
            {proofs.map((p) => (
              <span key={p.label} className="dispute-evidence-chip">
                <DisputeIcon name="doc" size={14} />
                Your {p.label}
              </span>
            ))}
            <span className="dispute-evidence-chip">
              <DisputeIcon name="chat" size={14} />
              Trade chat
            </span>
          </div>
        </section>

        <p className="dispute-chat-notice">Chats are encrypted. If a dispute is opened, a moderator can read this conversation.</p>
        {dispute.moderator === null ? (
          // The side that did not open the dispute never saw DisputeOpen's notice (COPY-UNSIGNED).
          <p className="dispute-chat-notice">A dispute is open. A moderator can read this whole chat, including messages from before the trade.</p>
        ) : null}

        {chat ?? <FallbackChat trade={trade} dispute={dispute} systemCards={systemCardsFor(trade, dispute)} />}
        {unblurred ?? <UnblurredRequest trade={trade} dispute={dispute} />}
      </main>
    </div>
  );
}
