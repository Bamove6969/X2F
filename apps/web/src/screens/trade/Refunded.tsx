/**
 * The buyer's refunded trade (board Refunded.dc.html, variants buyer-cancelled, time-ran-out and
 * moderator; Plan 3 Task 27's RefundedSlot, moved here from dispute/DisputeSlot.tsx and filled out
 * from the board, design review 1 Nov 2026 shot 48). The escrow went back to the seller; the screen
 * says why (a chip, the headline and lead), what happened when ("What happened": the timeline from
 * the trade's own times, the trade amount, and "Charged to you: Nothing" while the buyer never
 * marked paid), and, while the buyer may still dispute the refund (48 hours after it, owner
 * 2026-10-29; never after a cancel, owner 2026-10-29 question 4), the board's dispute card.
 *
 * The rules are Task 27's, unchanged: `disputeEntry` decides whether a dispute can still be opened,
 * `refundReason` words every kind of refund except the board's "time ran out", and a buyer's
 * cancel reads "Cancelling" until the seller confirms the XMR is back (Task 39). The seller is named
 * as the board does (design session 2 Nov: "satoshi_ghost", not "the seller"): every "the seller"
 * in these sentences and in refundReason's is shown as their public name (`withName`).
 * Lines not on the board are COPY-UNSIGNED.
 */
import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router';
import { formatFiat, formatXmr, TIMERS } from '@x2f/trade';
import { methodOf, type TradeView } from '../../api/trade.js';
import { formatDate } from '../../ui/dates.js';
import { KeyValues, type KeyValue } from '../../ui/KeyValues.js';
import { Icon } from '../../ui/icons.js';
import { StatusChip, type Tone } from '../../ui/StatusChip.js';
import { TradeHeader } from '../../ui/TradeHeader.js';
import { When } from '../../ui/When.js';
import type { IconName } from '../../ui/icons.js';
import { tradeFromView } from '../dispute/api.js';
import { TradeTitle } from '../dispute/DisputeOpen.js';
import { disputeEntry, refundReason } from '../dispute/rules.js';
import { registerTradeScreen, type TradeScreenProps } from './TradeRoom.js';

const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;

interface Story {
  chip: { tone: Tone; icon: IconName; label: string };
  title: string;
  lead: string;
  /** The dispute card's question, when a dispute can still be opened. */
  disputeTitle: string;
}

/** A sentence with every "the seller" shown as the seller's public name, marked as a username. */
export function withName(text: string, name: string): ReactNode {
  const parts = text.split(/\b[Tt]he seller\b/);
  return parts.map((p, i) => (
    <Fragment key={i}>
      {i > 0 ? <span data-username="">{name}</span> : null}
      {p}
    </Fragment>
  ));
}

/** "1.250000 XMR (about $412.50)". */
function amountWords(view: TradeView): string {
  return `${formatXmr(BigInt(view.amountAtomic))} XMR (about ${formatFiat(BigInt(view.fiatCents), view.lockedRate.currency)})`;
}

/** Why the XMR went back, as the board's chip, headline and lead. */
export function refundStory(view: TradeView): Story {
  const trade = tradeFromView(view);
  const amount = amountWords(view);
  // A buyer's cancel is official only once the seller confirms the XMR is back (owner 2026-10-29).
  const cancelling = view.settling === 'buyer-cancel' && trade.dispute === null && view.cancelConfirmedAt === null && view.paidAt === null;
  // A cancel's refund that landed after "I've paid" is not "You cancelled": the buyer paid and keeps the dispute (review I1).
  const paidThenRefunded = trade.dispute === null && view.paidAt !== null && (view.settling === 'buyer-cancel' || view.settling === 'mutual-cancel');
  const paidQuestion = 'Did you pay and not get your XMR?'; // COPY-UNSIGNED
  if (paidThenRefunded) {
    return {
      chip: { tone: 'muted', icon: 'undo', label: 'Refunded' },
      title: 'The XMR went back to the seller after you paid',
      // COPY-UNSIGNED
      lead: 'A cancel refund reached the seller after you marked this trade as paid. If you paid and did not get your XMR, open a dispute.',
      disputeTitle: paidQuestion,
    };
  }
  if (cancelling) {
    return {
      chip: { tone: 'caution', icon: 'clock', label: 'Cancelling' },
      title: 'Cancelling: returning the XMR to the seller',
      // COPY-UNSIGNED
      lead: 'You cancelled, so all the XMR is going back to the seller. The trade is cancelled once the seller confirms it has arrived.',
      disputeTitle: paidQuestion,
    };
  }
  if (trade.dispute === null && view.settling === 'auto-refund') {
    return {
      chip: { tone: 'muted', icon: 'undo', label: 'Payment time ran out' },
      title: 'Payment time ran out',
      // The board's lead, with "in time" for "within the 90 minutes" (an extension makes it longer).
      lead: `You didn't tap I've paid in time, so the seller cancelled. Everything in escrow, ${amount}, went back to the seller.`,
      disputeTitle: 'Did you send the money anyway?',
    };
  }
  const r = refundReason(view.settling, trade.dispute);
  const chip: Story['chip'] =
    trade.dispute !== null
      ? { tone: 'muted', icon: 'undo', label: 'Dispute decided' }
      : view.settling === 'mutual-cancel'
        ? { tone: 'muted', icon: 'undo', label: 'Cancelled together' }
        : view.settling === 'buyer-cancel'
          ? { tone: 'muted', icon: 'undo', label: 'Cancelled' } // COPY-UNSIGNED
          : view.settling === 'lapse-refund'
            ? { tone: 'muted', icon: 'undo', label: 'Funding time ran out' } // COPY-UNSIGNED
            : { tone: 'muted', icon: 'undo', label: 'Refunded' };
  return { chip, title: r.title, lead: r.text, disputeTitle: paidQuestion };
}

/** The "What happened" rows, from the times the trade view carries (a time it lacks is left out). */
export function refundTimeline(view: TradeView): { key: string; at: string }[] {
  const rows: { key: string; at: string | null }[] = [];
  const plus = (iso: string | null, ms: number) => (iso === null ? null : new Date(Date.parse(iso) + ms).toISOString());
  if (view.dispute !== null) {
    // COPY-UNSIGNED (the moderator variant's "You opened a dispute").
    rows.push({ key: view.dispute.by === 'buyer' ? 'You opened a dispute' : view.dispute.by === 'seller' ? 'The seller opened a dispute' : 'A dispute was opened', at: view.dispute.at });
  } else if (view.settling === 'auto-refund') {
    rows.push({ key: 'Time to pay ended', at: view.payBy });
    rows.push({ key: 'The seller cancelled', at: view.finalAlertAt });
    rows.push({ key: 'Your final alert ended', at: plus(view.finalAlertAt, TIMERS.finalAlertMin * MIN_MS) });
  } else if (view.settling === 'lapse-refund') {
    rows.push({ key: 'Funding time ended', at: view.fundBy }); // COPY-UNSIGNED
  }
  if (view.state === 'refunded' && view.closedAt !== null) rows.push({ key: 'Refund sent to the seller', at: view.closedAt });
  if (view.cancelConfirmedAt !== null) rows.push({ key: 'The seller confirmed it arrived', at: view.cancelConfirmedAt }); // COPY-UNSIGNED
  return rows.filter((r): r is { key: string; at: string } => r.at !== null && Number.isFinite(Date.parse(r.at)));
}

export function RefundedSlot({ view, serverClock }: TradeScreenProps) {
  const trade = tradeFromView(view);
  const method = methodOf(view);
  const story = refundStory(view);
  const name = trade.counterparty;
  const entry = disputeEntry(trade, serverClock());
  const timeline = refundTimeline(view);
  // One day for every row: the day goes in the card's head and each row shows its time (the board).
  const days = new Set(timeline.map((r) => formatDate(r.at)));
  const oneDay = days.size === 1 ? [...days][0]! : null;
  const facts: KeyValue[] = [
    ...timeline.map((r) => ({ key: r.key, label: withName(r.key, name), value: <When at={r.at} form={oneDay !== null ? 'time' : 'date-time'} /> })),
    {
      key: 'Trade amount',
      value: `${formatXmr(BigInt(view.amountAtomic))} XMR · ${formatFiat(BigInt(view.fiatCents), view.lockedRate.currency)}`,
      rule: timeline.length > 0,
    },
    // Only while the buyer never marked paid: after that their own payment may have left (COPY-UNSIGNED rule, board wording).
    ...(view.paidAt === null ? [{ key: 'Charged to you', value: 'Nothing' }] : []),
  ];
  const closed = view.closedAt === null ? NaN : Date.parse(view.closedAt);
  const disputeHref = `/trade/${encodeURIComponent(trade.code)}/dispute`;

  return (
    <div className="x2f-page" data-screen-part="refunded">
      <TradeHeader title={<TradeTitle trade={trade} />} code={trade.code} method={{ name: method.name, whatItIs: trade.whatItIs }} backTo="/buy" />
      <div className="x2f-page__main">
        <div>
          <StatusChip tone={story.chip.tone} icon={story.chip.icon} label={story.chip.label} />
        </div>
        <section className="x2f-stack" aria-label="Trade status">
          <h1 className="x2f-h2">{withName(story.title, name)}</h1>
          <p className="x2f-lead">{withName(story.lead, name)}</p>
        </section>
        <section className="x2f-panel" aria-labelledby="refunded-what">
          {/* "What happened · 29 Oct 2026", the day in mono, when every row is on it (design session 2 Nov). */}
          <h2 className="x2f-section-title" id="refunded-what">
            What happened
            {oneDay !== null ? (
              <>
                {' · '}
                <span className="x2f-when">{oneDay}</span>
              </>
            ) : null}
          </h2>
          <KeyValues rows={facts} part="refunded-facts" />
        </section>
        {entry.kind === 'open' ? (
          <section className="x2f-panel" data-outline="" aria-labelledby="refunded-dispute" data-part="refunded-dispute">
            <h2 className="x2f-panel__title" id="refunded-dispute">
              <Icon name="shield" size={20} />
              {story.disputeTitle}
            </h2>
            <p className="x2f-fine">
              Open a dispute and add your payment proof. If the money reached <span data-username="">{name}</span>, a moderator makes them send you the{' '}
              {formatXmr(BigInt(view.amountAtomic))} XMR as agreed.
            </p>
            {Number.isFinite(closed) ? (
              <p className="x2f-fine" data-dispute-window="">
                {/* COPY-UNSIGNED: the window is the owner's (48 hours after the refund). */}
                You can open one for 48 hours after the refund, until <When at={closed + TIMERS.disputeAfterRefundHours * HOUR_MS} />.
              </p>
            ) : null}
            {/* A secondary way on (design session 2 Nov): the danger text button with a chevron; Find another offer stays the primary. */}
            <Link className="x2f-button x2f-button--danger" to={disputeHref} data-part="refunded-open-dispute">
              Open a dispute
              <Icon name="chevron-right" size={18} />
            </Link>
          </section>
        ) : entry.kind === 'opened' ? (
          <section className="x2f-panel" data-outline="" aria-label="The dispute">
            {/* COPY-UNSIGNED (Task 27's link) */}
            <Link className="x2f-button x2f-button--secondary" to={disputeHref}>
              Go to the dispute
            </Link>
          </section>
        ) : null}
      </div>
      <footer className="x2f-page__footer">
        <Link className="x2f-button x2f-button--primary" to="/buy" data-primary="">
          Find another offer
        </Link>
      </footer>
    </div>
  );
}

registerTradeScreen({ owner: 'Task 27', role: 'buyer', states: ['refunded'], screen: RefundedSlot });
