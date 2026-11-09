/**
 * The buyer's refunded trade (board Refunded.dc.html, variants buyer-cancelled, time-ran-out and
 * moderator; Plan 3 Task 27's RefundedSlot, moved here from dispute/DisputeSlot.tsx and filled out
 * from the board, design review 1 Nov 2026 shot 48). The escrow went back to the seller; the screen
 * says why (the hero: a chip and key mark, the headline and lead, the trade amount and "X2F fee:
 * None"), what happened when ("What happened": the timeline from the trade's own times), and, while the buyer may still
 * dispute the refund (48 hours after it, owner 2026-10-29; never after a cancel, owner 2026-10-29
 * question 4), the board's dispute card. The frame is the trade room's own (.x2f-pay).
 *
 * The rules are Task 27's, unchanged: `disputeEntry` decides whether a dispute can still be opened,
 * the reasons are `refundReason`'s (dispute/rules.ts, the dispute page keeps using it), and a
 * buyer's cancel reads "Cancelling" until the seller confirms the XMR is back (Task 39). The seller
 * is "the seller", never named, on refund and cancel results (owner 2026-10-29; lead 8 Nov: the
 * owner's rule beats the design session of 2 Nov). Lines not on the board are COPY-UNSIGNED.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { formatFiat, formatXmr, TIMERS } from '@x2f/trade';
import { methodOf, type TradeView } from '../../api/trade.js';
import { Xmr } from '../../ui/Amount.js';
import { KeyMark } from '../../ui/EscrowDots.js';
import { formatDate } from '../../ui/dates.js';
import { Icon } from '../../ui/icons.js';
import { StatusChip, type Tone } from '../../ui/StatusChip.js';
import { TradeHeader } from '../../ui/TradeHeader.js';
import { When } from '../../ui/When.js';
import type { IconName } from '../../ui/icons.js';
import { tradeFromView } from '../dispute/api.js';
import { TradeTitle } from '../dispute/DisputeOpen.js';
import { disputeEntry } from '../dispute/rules.js';
import './pay.css';
import { registerTradeScreen, type TradeScreenProps } from './TradeRoom.js';

const HOUR_MS = 3_600_000;

interface Story {
  chip: { tone: Tone; icon: IconName; label: string };
  title: ReactNode;
  lead: ReactNode;
  /** The dispute card's question, when a dispute can still be opened. */
  disputeTitle: string;
}

/** "the seller", never their name, on refund and cancel results (owner 2026-10-29; lead 8 Nov). */
const N = 'the seller';

/**
 * Why the XMR went back, as the board's chip, headline and lead. `disputeOpen` adds the lead's
 * last sentence that points at the dispute card below.
 */
export function refundStory(view: TradeView, disputeOpen: boolean): Story {
  const trade = tradeFromView(view);
  // A buyer's cancel is official only once the seller confirms the XMR is back (owner 2026-10-29).
  const cancelling = view.settling === 'buyer-cancel' && trade.dispute === null && view.cancelConfirmedAt === null && view.paidAt === null;
  // A cancel's refund that landed after "I've paid" is not "You cancelled": the buyer paid and keeps the dispute (review I1).
  const paidThenRefunded = trade.dispute === null && view.paidAt !== null && (view.settling === 'buyer-cancel' || view.settling === 'mutual-cancel');
  const paidQuestion = 'Did you pay and not get your XMR?'; // COPY-UNSIGNED
  const muted = (label: string): Story['chip'] => ({ tone: 'muted', icon: 'undo', label });
  if (paidThenRefunded) {
    return {
      chip: muted('Refunded'),
      title: <>The XMR went back to {N} after you paid</>,
      // COPY-UNSIGNED
      lead: <>A cancel refund reached {N} after you marked this trade as paid. If you paid and did not get your XMR, open a dispute.</>,
      disputeTitle: paidQuestion,
    };
  }
  if (cancelling) {
    return {
      chip: { tone: 'caution', icon: 'clock', label: 'Cancelling' },
      title: <>Cancelling: returning the XMR to {N}</>,
      // COPY-UNSIGNED
      lead: <>You cancelled, so all the XMR is going back to {N}. The trade is cancelled once {N} confirms it has arrived.</>,
      disputeTitle: paidQuestion,
    };
  }
  if (trade.dispute !== null) {
    return {
      chip: muted('Dispute decided'),
      title: 'Refunded by the dispute decision',
      lead: <>A moderator decided this trade's dispute and the XMR went back to {N}. The ruling and its reasons are on the dispute page.</>,
      disputeTitle: paidQuestion,
    };
  }
  switch (view.settling) {
    case 'auto-refund':
      return {
        chip: muted('Payment time ran out'),
        title: 'Payment time ran out',
        // The owner's wording (Plan 3 Revision 2026-10-29, Decision 7; review M2), then the design
        // session's ending (2 Nov). COPY-UNSIGNED
        lead: (
          <>
            Payment time ran out, {N} cancelled; everything in escrow went back to the original owner. X2F took nothing from you.
            {disputeOpen ? ' If you already sent the payment, open a dispute below.' : null}
          </>
        ),
        disputeTitle: 'Did you send the money anyway?',
      };
    case 'buyer-cancel':
      // Board Refunded variant=buyer-cancelled: a neutral CANCELLED chip, never "Refunded" (trade-rules-p1).
      // Board Refunded variant=buyer-cancelled. The trade amount, as on every other screen (not the
      // escrow with a seller-poster's 1% fee in it). COPY-UNSIGNED (the board's words).
      return {
        chip: { tone: 'neutral', icon: 'check', label: 'Cancelled' },
        title: 'You cancelled this trade',
        lead: `All ${formatXmr(BigInt(view.amountAtomic))} XMR (about ${formatFiat(BigInt(view.fiatCents), view.lockedRate.currency)}) went back to the seller. X2F took nothing from you.`,
        disputeTitle: paidQuestion,
      };
    case 'mutual-cancel':
      return { chip: muted('Cancelled together'), title: 'You both cancelled this trade', lead: <>You and {N} agreed to cancel, so all the XMR went back to {N}.</>, disputeTitle: paidQuestion };
    case 'lapse-refund':
      // COPY-UNSIGNED
      return { chip: muted('Funding time ran out'), title: 'The funding time ran out', lead: <>The escrow wasn't fully funded in time, so all the XMR went back to {N}.</>, disputeTitle: paidQuestion };
    default:
      return { chip: muted('Refunded'), title: 'Refunded', lead: <>The XMR went back to {N}.</>, disputeTitle: paidQuestion };
  }
}

/** The "What happened" rows, from the times the trade view carries (a time it lacks is left out). */
export function refundTimeline(view: TradeView): { key: string; label: ReactNode; at: string }[] {
  const rows: { key: string; label: ReactNode; at: string | null }[] = [];
  if (view.dispute !== null) {
    // COPY-UNSIGNED (the moderator variant's "You opened a dispute").
    const by = view.dispute.by;
    rows.push({ key: 'opened', label: by === 'buyer' ? 'You opened a dispute' : by === 'seller' ? 'The seller opened a dispute' : 'A dispute was opened', at: view.dispute.at });
  } else if (view.settling === 'auto-refund') {
    // No final alert any more: the seller's cancel refunds at once (owner 8 Nov p6-1; lead review
    // 2026-11-08 R-I4). The view carries no time for the cancel itself, so that row is left out.
    rows.push({ key: 'pay-ended', label: 'Time to pay ended', at: view.payBy });
  } else if (view.settling === 'lapse-refund') {
    rows.push({ key: 'fund-ended', label: 'Funding time ended', at: view.fundBy }); // COPY-UNSIGNED
  }
  if (view.state === 'refunded' && view.closedAt !== null) rows.push({ key: 'refund-sent', label: <>Refund sent to {N}</>, at: view.closedAt });
  if (view.cancelConfirmedAt !== null) rows.push({ key: 'confirmed', label: 'The seller confirmed it arrived', at: view.cancelConfirmedAt }); // COPY-UNSIGNED
  return rows.filter((r): r is { key: string; label: ReactNode; at: string } => r.at !== null && Number.isFinite(Date.parse(r.at)));
}

export function RefundedSlot({ view, serverClock }: TradeScreenProps) {
  const trade = tradeFromView(view);
  const method = methodOf(view);
  const entry = disputeEntry(trade, serverClock());
  const story = refundStory(view, entry.kind === 'open');
  const timeline = refundTimeline(view);
  // One day for every row: the day goes in the card's head and each row shows its time (the board).
  const days = new Set(timeline.map((r) => formatDate(r.at)));
  const oneDay = days.size === 1 ? [...days][0]! : null;
  // The hero's tone (design review P1-7): ink-muted for a finished refund, the moderator's after a
  // dispute decided it, caution while a cancel is still being returned.
  const tone = trade.dispute !== null ? 'mod' : story.chip.tone === 'caution' ? 'caution' : 'muted';
  const closed = view.closedAt === null ? NaN : Date.parse(view.closedAt);
  const disputeHref = `/trade/${encodeURIComponent(trade.code)}/dispute`;

  return (
    <div className="x2f-pay" data-layout="phone" data-screen-part="refunded">
      {/* "Back to trades", as the board's back control says (design review P2-18). */}
      <TradeHeader title={<TradeTitle trade={trade} />} code={trade.code} method={{ name: method.name, whatItIs: trade.whatItIs }} backTo="/trades" />
      <div className="x2f-pay__main">
        {/* The board's hero (standard 11; design review P1-7): chip and key mark, the h1 and lead, then
            the trade amount and X2F's fee in a raised box. */}
        <section className="x2f-hero" data-tone={tone} data-kind="outcome" aria-labelledby="refunded-title" data-part="refunded-hero">
          <div className="x2f-hero__head">
            <StatusChip tone={story.chip.tone} look="tint" icon={story.chip.icon} label={story.chip.label} />
            <KeyMark className="x2f-hero__mark" />
          </div>
          <div className="x2f-hero__text">
            <h1 className="x2f-hero__title" id="refunded-title">
              {story.title}
            </h1>
            <p className="x2f-hero__lead">{story.lead}</p>
          </div>
          <dl className="x2f-hero__facts" data-part="refunded-amount">
            <div className="x2f-hero__amount">
              <dt className="x2f-hero__label">Trade amount</dt>
              <dd>
                <Xmr value={formatXmr(BigInt(view.amountAtomic))} ink /> <span className="x2f-hero__fiat">{formatFiat(BigInt(view.fiatCents), view.lockedRate.currency)}</span>
              </dd>
            </div>
            <div className="x2f-hero__fee">
              {/* The design session's row (2 Nov; was "Charged to you: Nothing"): a refund never carries X2F's fee. COPY-UNSIGNED */}
              <dt>X2F fee</dt>
              <dd className="x2f-num">None</dd>
            </div>
          </dl>
        </section>
        {/* "What happened" as the board's timeline (design review P2-20): a dot per row joined by a
            line, the last dot filled in the hero's tone and its row at 600; the day on the right of
            the heading when every row is on it (design session 2 Nov). */}
        <section className="x2f-outcome-card" aria-labelledby="refunded-what" data-part="refunded-what">
          <div className="x2f-outcome-card__head">
            <h2 className="x2f-section-title" id="refunded-what">
              What happened
            </h2>
            {oneDay !== null ? (
              <span className="x2f-outcome-card__day" data-part="refunded-day">
                {oneDay}
              </span>
            ) : null}
          </div>
          <ol className="x2f-steps-line" data-tone={tone} data-part="refunded-facts">
            {timeline.map((r) => (
              <li key={r.key} data-key={r.key}>
                <span className="x2f-steps-line__mark" aria-hidden="true" />
                <span className="x2f-steps-line__text">
                  <span>{r.label}</span> <When at={r.at} form={oneDay !== null ? 'time' : 'date-time'} />
                </span>
              </li>
            ))}
          </ol>
        </section>
        {entry.kind === 'open' ? (
          <section className="x2f-panel" data-tone="outline" aria-labelledby="refunded-dispute" data-part="refunded-dispute">
            <h2 className="x2f-panel__title" id="refunded-dispute">
              <Icon name="shield" size={20} />
              {story.disputeTitle}
            </h2>
            <p className="x2f-fine">
              {/* COPY-UNSIGNED: design's wording (7 Nov), owner still to sign (lead review 2026-11-06 m3). */}
              Open a dispute and add your payment proof. If the money reached the seller, a moderator can rule that they owe you the{' '}
              {/* not-a-refusal: explains what a ruling means for the other trader; nothing is refused to this user */}
              <Xmr value={formatXmr(BigInt(view.amountAtomic))} ink />. Until they pay it back, they can't trade.
            </p>
            {Number.isFinite(closed) ? (
              <p className="x2f-fine" data-dispute-window="">
                {/* COPY-UNSIGNED: the window is the owner's (48 hours after the refund). */}
                You can open one for 48 hours after the refund, until <When at={closed + TIMERS.disputeAfterRefundHours * HOUR_MS} />.
              </p>
            ) : null}
            {/* A secondary way on (design session 2 Nov): the danger text button with a chevron; Find another offer stays the primary. */}
            <Link className="x2f-button x2f-button--danger" to={disputeHref} data-part="refunded-open-dispute">
              Open dispute
              <Icon name="chevron-right" size={18} />
            </Link>
          </section>
        ) : entry.kind === 'opened' ? (
          <section className="x2f-panel" data-tone="outline" aria-label="The dispute">
            {/* COPY-UNSIGNED (Task 27's link) */}
            <Link className="x2f-button x2f-button--secondary" to={disputeHref}>
              Go to the dispute
            </Link>
          </section>
        ) : null}
      </div>
      <footer className="x2f-pay__footer">
        <Link className="x2f-button x2f-button--primary" to="/buy" data-primary="">
          Find another offer
        </Link>
        {/* The board's tertiary link under the primary (design review P2-19). */}
        <Link className="x2f-button x2f-button--tertiary" to="/trades" data-part="refunded-trades">
          Back to my trades
        </Link>
      </footer>
    </div>
  );
}

registerTradeScreen({ owner: 'Task 27', role: 'buyer', states: ['refunded'], screen: RefundedSlot });
