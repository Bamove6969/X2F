/**
 * "Cancelling is final" (board CancelRequest.dc.html on wip/design-brief, rule (c); owner G56 and
 * g67, 7 Nov): the one warning before the buyer's own cancel. The buyer may cancel after the
 * escrow is funded until they tap "I've paid", never after (then only a dispute); this sheet is
 * the confirm step BuyerPay's quiet "Cancel trade" opens, and the buyer's wait for funding's (before
 * anything is in the escrow it says nothing needs to go back). "Keep trading" (the safe action) has
 * focus; the danger-confirm "Cancel trade" goes on to `buyer-cancel`.
 *
 * Board wording, unsigned (the owner's P4 wording page has not signed it off yet).
 */
import { useId } from 'react';
import { formatXmr } from '@x2f/trade';
import { Button } from '../../ui/Button.js';
import { Sheet } from '../../ui/Sheet.js';
import { publicName, type TradeView } from './payTypes.js';
import './warn.css';

/**
 * The trade amount (board CancelRequest side=buyer step=buyer-confirms: "The 1.250000 XMR goes
 * back"), never what the escrow holds: a seller-poster's escrow also holds their 1% fee, a number
 * the buyer has never seen, and an unexplained amount makes a final warning look wrong (design
 * proto review P2, 8 Nov). All of the escrow still goes back; only the words name the trade.
 */
function tradeXmr(view: Pick<TradeView, 'amountAtomic'>): string {
  return formatXmr(/^[0-9]{1,30}$/.test(view.amountAtomic) ? BigInt(view.amountAtomic) : 0n);
}

export function CancelFinalSheet({
  open,
  view,
  busy,
  onKeep,
  onCancel,
}: {
  open: boolean;
  view: Pick<TradeView, 'counterparty' | 'amountAtomic' | 'receivedAtomic'>;
  busy: boolean;
  onKeep(): void;
  onCancel(): void;
}) {
  const textId = useId();
  const seller = publicName(view.counterparty);
  return (
    <Sheet open={open} title="Cancelling is final" describedBy={textId} initialFocus="[data-safe]" onClose={onKeep}>
      <div className="x2f-sheet__body x2f-warn" data-sheet="cancel-final">
        {view.receivedAtomic === '0' ? (
          // Waiting for funding, nothing in the escrow yet (design proto review P1). COPY-UNSIGNED.
          <p id={textId} className="x2f-warn__text">
            <span data-username="">{seller}</span> hasn't funded the escrow yet, so nothing needs to go back. This trade closes. Don't send any money.
          </p>
        ) : (
          <p id={textId} className="x2f-warn__text">
            The {tradeXmr(view)} XMR goes back to <span data-username="">{seller}</span> and this trade closes. Don't send any money after you
            cancel. If you've already paid, don't cancel: tap I've paid instead.
          </p>
        )}
        <div className="x2f-warn__actions">
          <Button variant="danger-outline" disabled={busy} onClick={onCancel}>
            Cancel trade
          </Button>
          <Button variant="secondary" data-safe="" onClick={onKeep}>
            Keep trading
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
