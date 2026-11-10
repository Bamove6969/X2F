/**
 * "Cancelling is likely final" (board CancelRequest.dc.html on wip/design-brief, rule (c); owner G56
 * and g67, 7 Nov; build spec j31a section 3, owner p5-2 / T-049, 9 Nov: "likely" final, and the body
 * names no one): the one warning before the buyer's own cancel. The buyer may cancel after the
 * escrow is funded until they tap "I've paid", never after (then only a dispute); this sheet is
 * the confirm step BuyerPay's quiet "Cancel trade" opens, and the buyer's wait for funding's. Two
 * variants (design final call 10 Nov 2026): with coins held, the escrow-held version names what comes
 * back ("The 1.250000 XMR in escrow is returned and this trade closes."); before anything is in the
 * escrow (setup or funding, nothing received), the unfunded line "Nothing is in escrow yet, so nothing
 * needs refunding." and no figure. "Keep trading" (the safe action) has focus; the danger-confirm
 * "Cancel trade" goes on to `buyer-cancel`.
 *
 * Board wording, COPY-UNSIGNED (the owner signs it on the wording pages); the unfunded line is
 * design's (10 Nov), COPY-UNSIGNED too.
 */
import { useId } from 'react';
import { formatXmr } from '@x2f/trade';
import { Button } from '../../ui/Button.js';
import { Sheet } from '../../ui/Sheet.js';
import type { TradeView } from './payTypes.js';
import './warn.css';

type SheetView = Pick<TradeView, 'state' | 'receivedAtomic' | 'amountAtomic'>;

/** The XMR the escrow holds, all of which is returned; the trade amount if unreadable. */
function heldXmr(view: SheetView): string {
  for (const s of [view.receivedAtomic, view.amountAtomic]) {
    if (/^[1-9][0-9]*$/.test(s)) return formatXmr(BigInt(s));
  }
  return formatXmr(0n);
}

/** Nothing is held yet: the trade is still being set up or funded and no coins have been seen. */
export function nothingHeld(view: SheetView): boolean {
  return (view.state === 'setup' || view.state === 'funding') && !/^[1-9][0-9]*$/.test(view.receivedAtomic);
}

export function CancelFinalSheet({
  open,
  view,
  busy,
  onKeep,
  onCancel,
}: {
  open: boolean;
  view: SheetView;
  busy: boolean;
  onKeep(): void;
  onCancel(): void;
}) {
  const textId = useId();
  return (
    <Sheet open={open} title="Cancelling is likely final" describedBy={textId} initialFocus="[data-safe]" onClose={onKeep}>
      <div className="x2f-sheet__body x2f-warn" data-sheet="cancel-final">
        <p id={textId} className="x2f-warn__text">
          {nothingHeld(view) ? (
            <>Nothing is in escrow yet, so nothing needs refunding. </>
          ) : (
            <>
              The <span className="x2f-mono">{heldXmr(view)}</span> <strong className="x2f-warn__xmr">XMR</strong> in escrow is returned and this trade closes.{' '}
            </>
          )}
          Be sure before you cancel. Don't send any money after you cancel. Already paid? Don't cancel: tap <strong>I've paid</strong> instead.
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
