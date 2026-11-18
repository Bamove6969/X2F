// Task 27's trade-room slots (Plan 3 Task 22's slot interface, screens/trade/TradeRoom.tsx):
// - both traders in `disputed`: DisputeRoom, or DisputeRuling once there is a ruling;
// (The buyer in `refunded`, with the 48-hour "Open a dispute", moved to screens/trade/Refunded.tsx.)
// The room owns the trade view, its live re-reads (useTradeLive, POLL_MS) and the escrow; these
// screens never fetch the trade or start the escrow. The disputed slot reads only
// GET /v1/trades/:code/dispute, again whenever the room hands it a fresh view. A Plan 4 mod-built
// co-sign runs through the room's `escrow` handle and rulingAllowsCosign (NEEDS_PLAN_4_MOD_COSIGN).
import { useEffect, useState } from 'react';
import { methodOf } from '../../api/trade.js';
import { registerTradeScreen, type TradeScreenProps } from '../trade/TradeRoom.js';
import { fetchDispute, proofRefusalText, refusalText, sendAppeal, sendPaymentProof, tradeFromView, type DisputeView } from './api.js';
import { DisputeRoom } from './DisputeRoom.js';
import { DisputeRuling, sameAmount } from './DisputeRuling.js';
import { DoNotPay, mustNotPay } from './DoNotPay.js';
import { disputeScreenFor } from './DisputeScreen.js';
import './dispute.css';

/** Where a slot's back link goes: the trader's own list (the room is the trade's page). */
const listFor = (role: 'buyer' | 'seller'): string => (role === 'buyer' ? '/buy' : '/sell');

/** A disputed trade in the room. `undefined` while the first dispute read is on its way. */
export function DisputeSlot({ code, view, escrow, refresh, serverClock }: TradeScreenProps) {
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
        // Plan 4 Task 12 (A6): the seller's payment proof. Where and how much come ONLY from the
        // attested terms the room's escrow verified on this device (`restitution`), never the API,
        // and only when that amount equals the trade amount the server checks against (review B1).
        payTo={escrow.restitution != null && sameAmount(escrow.restitution.amountAtomic, trade.amountAtomic) ? escrow.restitution : null}
        onTxProof={async (txHash, txKey) => {
          let sent;
          try {
            sent = await sendPaymentProof(code, txHash, txKey);
          } catch (err) {
            throw new Error(proofRefusalText(err));
          }
          await refresh();
          return sent;
        }}
      />
    );
  }
  // A disputed trade is never offered the open form (disputeScreenFor); 'open' cannot happen here.
  const shown = screen.kind === 'room' ? screen.dispute : null;
  if (shown === null) return null;
  const room = <DisputeRoom trade={trade} methodName={methodName} dispute={shown} serverClock={serverClock} backTo={listFor(trade.role)} />;
  // Owner p11-16 (design ea2a9ca8): a dispute before "I've paid": the payer's "I've paid" paused, with the alert sheet.
  if (!mustNotPay(view)) return room;
  return (
    <>
      {room}
      <DoNotPay view={view} />

    </>
  );
}

registerTradeScreen({ owner: 'Task 27', role: 'any', states: ['disputed'], screen: DisputeSlot });
