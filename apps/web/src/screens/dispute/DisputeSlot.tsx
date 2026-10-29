// Task 27's trade-room slots (Plan 3 Task 22's slot interface, screens/trade/TradeRoom.tsx):
// - both traders in `disputed`: DisputeRoom, or DisputeRuling once there is a ruling;
// - the buyer in `refunded`: the refund's status with the 90-day "Open a dispute" (spec 2.3).
// The room owns the trade view, its live re-reads (useTradeLive, POLL_MS) and the escrow; these
// screens never fetch the trade or start the escrow. The disputed slot reads only
// GET /v1/trades/:code/dispute, again whenever the room hands it a fresh view. A Plan 4 mod-built
// co-sign runs through the room's `escrow` handle and rulingAllowsCosign (NEEDS_PLAN_4_MOD_COSIGN).
import { useEffect, useState } from 'react';
import { formatXmr } from '@x2f/trade';
import { methodOf } from '../../api/trade.js';
import { StatusChip } from '../../ui/StatusChip.js';
import { TradeHeader } from '../../ui/TradeHeader.js';
import { registerTradeScreen, type TradeScreenProps } from '../trade/TradeRoom.js';
import { fetchDispute, refusalText, sendAppeal, tradeFromView, type DisputeView } from './api.js';
import { DisputeEntry } from './DisputeEntry.js';
import { DisputeIcon } from './icons.js';
import { TradeTitle } from './DisputeOpen.js';
import { DisputeRoom } from './DisputeRoom.js';
import { DisputeRuling } from './DisputeRuling.js';
import { disputeScreenFor } from './DisputeScreen.js';
import { disputeEntry, paidBeforeCancel, refundReason } from './rules.js';
import './dispute.css';

/** Where a slot's back link goes: the trader's own list (the room is the trade's page). */
const listFor = (role: 'buyer' | 'seller'): string => (role === 'buyer' ? '/buy' : '/sell');

/** A disputed trade in the room. `undefined` while the first dispute read is on its way. */
export function DisputeSlot({ code, view, refresh, serverClock }: TradeScreenProps) {
  const [dispute, setDispute] = useState<DisputeView | null | undefined>(undefined);
  // Re-read the dispute whenever the room re-reads the trade (live event, POLL_MS, refresh()):
  // a moderator's join and ruling have no live event of their own yet (Plan 4).
  useEffect(() => {
    const ac = new AbortController();
    fetchDispute(code, ac.signal).then(
      (d) => setDispute(d),
      // A failed re-read keeps the last dispute on screen; a failed first read shows the room
      // from the trade itself (disputeScreenFor), never the open form.
      () => {
        if (!ac.signal.aborted) setDispute((cur) => (cur === undefined ? null : cur));
      },
    );
    return () => ac.abort();
  }, [code, view]);

  if (dispute === undefined) return <div className="dispute-screen" aria-busy="true" />;
  const trade = tradeFromView(view);
  const methodName = methodOf(view).name;
  const screen = disputeScreenFor(trade, dispute, false);
  if (screen.kind === 'ruling') {
    return (
      <DisputeRuling
        trade={trade}
        methodName={methodName}
        dispute={screen.dispute}
        serverClock={serverClock}
        onAppeal={async (why) => {
          try {
            setDispute(await sendAppeal(code, why));
          } catch (err) {
            throw new Error(refusalText(err));
          }
          await refresh();
        }}
      />
    );
  }
  // A disputed trade is never offered the open form (disputeScreenFor); 'open' cannot happen here.
  const shown = screen.kind === 'room' ? screen.dispute : null;
  if (shown === null) return null;
  return <DisputeRoom trade={trade} methodName={methodName} dispute={shown} serverClock={serverClock} backTo={listFor(trade.role)} />;
}

/**
 * The buyer's refunded trade: the escrow went back to the seller, with the reason for this refund
 * (refundReason: the buyer cancelled, the payment time ran out and the seller cancelled, a dispute
 * decision, both cancelled, the funding time ran out). Within 90 days of the refund the buyer may
 * still open a dispute (spec 2.3, "dispute after refund"); after one was opened, the way to it.
 * After a cancel (the buyer's or a mutual one) the dispute part is the Refunded board's "Did you
 * pay before you cancelled? Open a dispute." (Revision 2026-10-29b; board Refunded.dc.html on
 * wip/design-brief). The rest is COPY-UNSIGNED (until the Refunded board is merged).
 */
export function RefundedSlot({ view, serverClock }: TradeScreenProps) {
  const trade = tradeFromView(view);
  const method = methodOf(view);
  const now = serverClock();
  // A buyer's cancel is official only once the seller confirms the XMR is back (owner 2026-10-29).
  const cancelling = view.settling === 'buyer-cancel' && trade.dispute === null && view.cancelConfirmedAt === null;
  const reason = cancelling
    ? {
        title: 'Cancelling: returning the XMR to the seller',
        // COPY-UNSIGNED
        text: 'You cancelled, so all the XMR is going back to the seller. The trade is cancelled once the seller confirms it has arrived.',
      }
    : refundReason(view.settling, trade.dispute);
  const entry = disputeEntry(trade, now);
  return (
    <div className="dispute-screen">
      <TradeHeader title={<TradeTitle trade={trade} />} code={trade.code} method={{ name: method.name, whatItIs: trade.whatItIs }} backTo="/buy" />
      <div className="dispute-main">
        <section className="dispute-stack-4" aria-label="Trade status">
          {cancelling ? <StatusChip tone="caution" icon="clock" label="Cancelling" /> : <StatusChip tone="escrow" icon="check" label="Refunded" />}
          <h1 className="dispute-title">{reason.title}</h1>
          <p className="dispute-lead">{reason.text}</p>
          {entry.kind === 'open' && !paidBeforeCancel(view.settling, trade.dispute) ? (
            <p className="dispute-lead">If you paid the seller and did not get your XMR, you can still open a dispute for 90 days after the refund.</p>
          ) : null}
          {entry.kind === 'open' && paidBeforeCancel(view.settling, trade.dispute) ? null : <DisputeEntry trade={trade} now={now} />}
        </section>
        {entry.kind === 'open' && paidBeforeCancel(view.settling, trade.dispute) ? (
          <section className="dispute-paid-first" aria-labelledby="rf-dispute" data-paid-before-cancel="">
            <h2 id="rf-dispute" className="dispute-paid-first__title">
              <DisputeIcon name="shield" size={20} />
              Did you pay before you cancelled?
            </h2>
            <p className="dispute-paid-first__text">
              {/* The board names the seller; this screen calls them "the seller" (refundReason, owner 2026-10-29). */}
              Open a dispute and add your payment proof. If the money reached the seller, a moderator makes them send you the {formatXmr(BigInt(trade.amountAtomic))} XMR as agreed.
            </p>
            <DisputeEntry trade={trade} now={now} />
          </section>
        ) : null}
      </div>
    </div>
  );
}

registerTradeScreen({ owner: 'Task 27', role: 'any', states: ['disputed'], screen: DisputeSlot });
registerTradeScreen({ owner: 'Task 27', role: 'buyer', states: ['refunded'], screen: RefundedSlot });
