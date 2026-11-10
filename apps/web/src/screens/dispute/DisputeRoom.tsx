// DisputeRoom (Plan 3 Task 27), board design/x2f-app/DisputeRoom.dc.html: the trade room while a
// dispute is open. The "In dispute" chip is rose (Global Constraints: rose = disputes; the board
// draws it amber). The moderator's join banner and name come only from server records
// (GET /v1/trades/:code/dispute), never from a chat message. The chat itself is Task 20's
// TradeChatPanel (it shows the spec 6.6 notice; moderator lines get ModeratorTag's badge) under the
// server's system cards, and the unblurred-proof request is Plan 5's (seams.tsx).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { TradeChatPanel } from '../../chat/ChatPanel.js';
import { formatXmr } from '@x2f/trade';
import { Icon } from '../../ui/icons.js';
import { StatusChip } from '../../ui/StatusChip.js';
import { TradeHeader } from '../../ui/TradeHeader.js';
import type { DisputeTrade, DisputeView } from './api.js';
import { TradeTitle } from './DisputeOpen.js';
import { DisputeIcon } from './icons.js';
import { HOURGLASS_LINE, repliedIn } from './rules.js';
import { DisputeSystemCards, systemCardsFor, tradeProofs, UnblurredRequest } from './seams.js';
import './dispute.css';

/**
 * The board's "Replied in 38 min", on Plan 4 Task 10's view. While the hourglass runs it is the one
 * deadline on the screen (design 7 Nov: "First reply due by" competed with it), so before anyone
 * replies this line shows nothing. Traders never see the 48-hour hard deadline (owner Q38).
 */
function DeadlineLine({ dispute, hourglass }: { dispute: DisputeView; hourglass: boolean }) {
  const replied = repliedIn(dispute);
  if (replied !== null) return <span className="dispute-deadline">Replied in {replied}.</span>;
  if (hourglass) return null;
  return <span className="dispute-deadline">{HOURGLASS_LINE}</span>;
}

/**
 * Whether the hourglass shows: a dispute with Task 10's 24-hour goal, no ruling yet and no moderator
 * yet (lead review 7 Nov; board v119: once one joins, "Replied in …" replaces it).
 */
const hourglassShows = (d: DisputeView): boolean => d.ruling === null && d.moderator === null && Boolean(d.goalAt);

/** "23 h 12 min" split into numbers and units, so the numbers can be the big mono digits. */
function heroParts(msLeft: number): { n: string; u: string }[] {
  const min = Math.max(0, Math.ceil(msLeft / 60_000));
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return [{ n: String(m), u: 'min' }];
  return m === 0 ? [{ n: String(h), u: 'h' }] : [{ n: String(h), u: 'h' }, { n: String(m), u: 'min' }];
}

/** The hourglass countdown, read from the server clock every second (as `Countdown`). */
function HeroCountdown({ deadline, serverClock }: { deadline: Date; serverClock: () => Date }) {
  const end = deadline.getTime();
  const clock = useRef(serverClock);
  clock.current = serverClock;
  const [ms, setMs] = useState(() => end - serverClock().getTime());
  useEffect(() => {
    const tick = () => setMs(end - clock.current().getTime());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [end]);
  return (
    <span className="dispute-hero__time" role="timer" data-mask="clock">
      {heroParts(ms).map((p, i) => (
        <span key={p.u}>
          {i > 0 ? ' ' : null}
          <span className="dispute-hero__num">{p.n}</span> <span className="dispute-hero__unit">{p.u}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * Owner Q38 (6 Nov), board DisputeRoom v119 (`moderator=waiting`): once a dispute is filed the
 * hero's one big number is an hourglass counting down from 24 hours to Task 10's `goalAt`, "Until a
 * moderator steps in", with the place in the queue as a meta line under it. Past the 24 hours it
 * reads as empty and says a moderator steps in as soon as they can; never the 48-hour deadline.
 * COPY-UNSIGNED (design's words).
 */
export function DisputeHourglass({ dispute, now, serverClock }: { dispute: DisputeView; now: Date; serverClock: () => Date }) {
  if (!hourglassShows(dispute)) return null;
  const goal = new Date(dispute.goalAt!);
  const over = now.getTime() >= goal.getTime();
  return (
    <div className="dispute-hourglass" data-part="hourglass" data-state={over ? 'over' : 'running'}>
      {over ? (
        <>
          <DisputeIcon name="hourglassEmpty" size={24} stroke={1.5} />
          <span className="dispute-stack">
            <span className="dispute-strong">Taking longer than usual</span>
            <span className="dispute-muted">A moderator will step in as soon as they can.</span>
          </span>
        </>
      ) : (
        <span className="dispute-stack">
          <span className="dispute-hero__label">Until a moderator steps in</span>
          <span className="dispute-hero__row">
            <DisputeIcon name="hourglass" size={24} stroke={1.5} />
            <HeroCountdown deadline={goal} serverClock={serverClock} />
          </span>
          <span className="dispute-hero__line">{HOURGLASS_LINE}</span>
        </span>
      )}
      {dispute.moderator === null && dispute.queuePosition ? (
        <span className="dispute-hero__meta">You're number {dispute.queuePosition} in the queue</span>
      ) : null}
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
        </div>
        <DisputeHourglass dispute={dispute} now={now} serverClock={serverClock} />
        {/* Not after a refund, nor on a system escalation (late funds after a release: nothing is locked). */}
        {dispute.afterRefund || dispute.openedBy === 'system' ? null : (
          // Board v119: the amount is the hero's inner block, six decimals.
          <div className="dispute-hero__amount" data-part="escrow-amount">
            <span className="dispute-hero__amount-label">
              <DisputeIcon name="lock" size={14} stroke={1.75} /> Locked in escrow
            </span>
            <span className="dispute-hero__xmr">{formatXmr(BigInt(trade.amountAtomic))} XMR</span>
          </div>
        )}
        <DeadlineLine dispute={dispute} hourglass={hourglassShows(dispute)} />
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
              {/* D-069 (build spec j31b): the board's "She may ask ...", with "They" as the line above. COPY-UNSIGNED */}
              <span className="dispute-cooperate" data-part="cooperate">
                They may ask either of you questions. Please answer them here: if someone doesn't help, the ruling can go against them.
              </span>
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
