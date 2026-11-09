/**
 * "Cancelling is final" (board CancelRequest.dc.html on wip/design-brief, rule (c); owner G56 and
 * g67, 7 Nov): the one warning before the buyer's own cancel. The buyer may cancel after the
 * escrow is funded until they tap "I've paid", never after (then only a dispute); this sheet is
 * the confirm step BuyerPay's quiet "Cancel trade" opens. "Keep trading" (the safe action) has
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

/** The XMR the escrow holds, all of which goes back to the seller; the trade amount if unreadable. */
function heldXmr(view: Pick<TradeView, 'receivedAtomic' | 'amountAtomic'>): string {
  for (const s of [view.receivedAtomic, view.amountAtomic]) {
    if (/^[1-9][0-9]*$/.test(s)) return formatXmr(BigInt(s));
  }
  return formatXmr(0n);
}

export function CancelFinalSheet({
  open,
  view,
  busy,
  onKeep,
  onCancel,
}: {
  open: boolean;
  view: Pick<TradeView, 'counterparty' | 'receivedAtomic' | 'amountAtomic'>;
  busy: boolean;
  onKeep(): void;
  onCancel(): void;
}) {
  const textId = useId();
  const seller = publicName(view.counterparty);
  return (
    <Sheet open={open} title="Cancelling is final" describedBy={textId} initialFocus="[data-safe]" onClose={onKeep}>
      <div className="x2f-sheet__body x2f-warn" data-sheet="cancel-final">
        <p id={textId} className="x2f-warn__text">
          The {heldXmr(view)} XMR goes back to <span data-username="">{seller}</span> and this trade closes. Don't send any money after you
          cancel. If you've already paid, don't cancel: tap I've paid instead.
        </p>
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
