/**
 * The buyer's warning before paying (Plan 3 Task 38, owner wording 2026-10-29; board
 * Warn-IvePaid.dc.html on wip/design-brief): "Before you pay / Wait until the XMR is fully in
 * escrow", the owner's two sentences, the confirmations bar while the escrow still confirms, then
 * I'll wait or I've already paid.
 *
 * BuyerPay opens it when the pay screen opens while the escrow is still confirming (Revision
 * 2026-10-29b) and before the "I've paid" sheet. Once the buyer goes past it (I've already paid)
 * it is not shown again for that trade on this device, across reloads (`warned`, warned.ts; lead default
 * 2026-10-29: "once per trade"). I'll wait only closes it, so it comes back the next time.
 */
import { useId, type CSSProperties } from 'react';
import { Button } from '../../ui/Button.js';
import { Sheet } from '../../ui/Sheet.js';
import type { EscrowChip } from './payModel.js';
import './warn.css';

/** The owner's words (2026-10-29), verbatim. */
export const PAY_WARNING_LEAD =
  "We strongly recommend that you do not send payment until all confirmations are complete and you've received confirmation that the XMR is fully in escrow.";
export const PAY_WARNING_WHY =
  "The way our system is designed, we can help you get back the XMR you were trading for if anyone tries to scam you, but recovering a payment you've sent is much harder and sometimes impossible.";

export function PayWarning({ open, bar, onWait, onPaid }: { open: boolean; bar: EscrowChip['bar']; onWait(): void; onPaid(): void }) {
  const textId = useId();
  return (
    <Sheet open={open} eyebrow="Before you pay" title="Wait until the XMR is fully in escrow" describedBy={textId} initialFocus="[data-safe]" onClose={onWait}>
      <div className="x2f-sheet__body x2f-warn" data-warning="pay">
        <div id={textId} className="x2f-warn">
          <p className="x2f-warn__text">{PAY_WARNING_LEAD}</p>
          <p className="x2f-warn__text x2f-warn__text--muted">{PAY_WARNING_WHY}</p>
        </div>
        {bar ? <WarnBar bar={bar} /> : null}
        <div className="x2f-warn__actions">
          <Button variant="primary" data-safe="" onClick={onWait}>
            I'll wait
          </Button>
          <Button variant="secondary" onClick={onPaid}>
            I've already paid
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

/** The board's "Escrow confirmations 3 of 10 · about 14 min" bar inside the warning. */
function WarnBar({ bar }: { bar: NonNullable<EscrowChip['bar']> }) {
  return (
    <div className="x2f-warn__bar">
      <div className="x2f-warn__bar-head">
        <span>Escrow confirmations</span>
        <span>
          <span className="x2f-warn__mono">
            {bar.confirmations} of {bar.of}
          </span>{' '}
          · about {bar.etaMin} min
        </span>
      </div>
      <span role="progressbar" aria-label="Escrow confirmations" aria-valuemin={0} aria-valuemax={bar.of} aria-valuenow={bar.confirmations} className="x2f-warn__track">
        <span className="x2f-warn__fill" style={{ '--x2f-fill': `${(100 * bar.confirmations) / bar.of}%` } as CSSProperties} />
      </span>
    </div>
  );
}
