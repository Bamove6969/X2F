// DisputeRoom (Plan 3 Task 27), board design/x2f-app/DisputeRoom.dc.html: the trade room while a
// dispute is open. The "In dispute" chip is rose (Global Constraints: rose = disputes; the board
// draws it amber). The moderator's join banner and name come only from server records
// (GET /v1/trades/:code/dispute), never from a chat message. The chat itself is Task 20's
// TradeChatPanel (it shows the spec 6.6 notice; moderator lines get ModeratorTag's badge) under the
// server's system cards, and the unblurred-proof request is Plan 5's (seams.tsx).
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { TradeChatPanel } from '../../chat/ChatPanel.js';
import { Countdown } from '../../ui/Countdown.js';
import { Icon } from '../../ui/icons.js';
import { StatusChip } from '../../ui/StatusChip.js';
import { TradeHeader } from '../../ui/TradeHeader.js';
import type { DisputeTrade, DisputeView } from './api.js';
import { TradeTitle } from './DisputeOpen.js';
import { DisputeIcon } from './icons.js';
import { dayTime, repliedIn, xmrInText } from './rules.js';
import { DisputeSystemCards, systemCardsFor, tradeProofs, UnblurredRequest } from './seams.js';
import './dispute.css';

/**
 * The board's "Replied in 38 min", on Plan 4 Task 10's view. Before anyone replies: "First reply due
 * by … · You're number N in the queue" (Task 15). The ruling's timing is the hourglass below, not
 * this line: traders never see the 48-hour hard deadline (owner Q38, 6 Nov: start with the 24 hours
 * only; the 48-hour part is decided later, OWNER-Q).
 */
function DeadlineLine({ dispute }: { dispute: DisputeView }) {
  const replied = repliedIn(dispute);
  if (replied === null && dispute.replyDueAt) {
    return (
      <span className="dispute-deadline">
        First reply due by <span className="dispute-ink">{dayTime(new Date(dispute.replyDueAt))}</span>
        {dispute.queuePosition ? <> · You're number {dispute.queuePosition} in the queue</> : null}
      </span>
    );
  }
  const first = replied !== null ? `Replied in ${replied}` : 'A moderator usually replies within 4 hours'; // COPY-UNSIGNED (from DisputeOpen)
  return <span className="dispute-deadline">{first}.</span>;
}

/**
 * Owner Q38 (6 Nov): once a dispute is filed, an hourglass counts down from 24 hours: the most it
 * takes before a moderator steps in, and it is usually much quicker. It counts to Task 10's `goalAt`
 * (opened + 24 h) on the server clock and stays until the ruling. Past the 24 hours it reads as
 * empty and says a moderator steps in as soon as they can; it never shows the 48-hour deadline.
 * COPY-UNSIGNED and DESIGNER-REVIEW: design words it (owner: "get design toward that").
 */
export function DisputeHourglass({ dispute, now, serverClock }: { dispute: DisputeView; now: Date; serverClock: () => Date }) {
  if (dispute.ruling !== null || !dispute.goalAt) return null;
  const goal = new Date(dispute.goalAt);
  const over = now.getTime() >= goal.getTime();
  return (
    <div className="dispute-hourglass" data-part="hourglass" data-state={over ? 'over' : 'running'}>
      <DisputeIcon name={over ? 'hourglassEmpty' : 'hourglass'} size={28} stroke={1.5} />
      <span className="dispute-stack">
        {over ? (
          <>
            <span className="dispute-strong">Taking longer than usual</span>
            <span className="dispute-muted">A moderator will step in as soon as they can.</span>
          </>
        ) : (
          <>
            <span className="dispute-strong">
              <Countdown deadline={goal} serverClock={serverClock} format="minutes" /> at most
            </span>
            <span className="dispute-muted">That's the longest before a moderator steps in. It's usually much quicker.</span>
          </>
        )}
      </span>
    </div>
  );
}

export function DisputeRoom({
  trade,
  methodName,
  dispute,
  serverClock,
  chat,
  unblurred,
  backTo,
}: {
  trade: DisputeTrade;
  methodName: string;
  dispute: DisputeView;
  serverClock: () => Date;
  /** The chat (Task 20's TradeChatPanel by default; tests pass their own). */
  chat?: ReactNode;
  /** Plan 5's unblurred-proof request card (nothing until then). */
  unblurred?: ReactNode;
  /** The header's back link: the trade room by default (the room's own slot passes the list instead). */
  backTo?: string;
}) {
  const now = serverClock();
  const proofs = tradeProofs(trade);
  const ruling = `/trade/${encodeURIComponent(trade.code)}/dispute`;
  return (
    <div className="dispute-screen">
      <TradeHeader title={<TradeTitle trade={trade} />} code={trade.code} method={{ name: methodName, whatItIs: trade.whatItIs }} backTo={backTo ?? `/trade/${encodeURIComponent(trade.code)}`} />
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
        <DeadlineLine dispute={dispute} />
        <DisputeHourglass dispute={dispute} now={now} serverClock={serverClock} />
      </section>

      <div className="dispute-main dispute-main--room">
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

        {dispute.moderator === null ? (
          // The side that did not open the dispute never saw DisputeOpen's notice (COPY-UNSIGNED).
          <p className="dispute-chat-notice">A dispute is open. A moderator can read this whole chat, including messages from before the trade.</p>
        ) : null}

        <DisputeSystemCards trade={trade} dispute={dispute} systemCards={systemCardsFor(trade, dispute)} />
        {chat ?? <TradeChatPanel code={trade.code} name={trade.counterparty} dispute={{ moderator: dispute.moderator?.name ?? null }} />}
        {unblurred ?? <UnblurredRequest trade={trade} dispute={dispute} />}
      </div>
    </div>
  );
}
