/**
 * Owner p11-16 (8 Nov): a dispute opened before "I've paid" "will immediately grey out the ability
 * for the other trader to click payment sent and also warn them with a pop-up". The API already
 * refuses "I've paid" on a disputed trade (the machine's mark-paid is wrong-state outside
 * `secured`); this is what the buyer sees: the button, greyed out, and the pop-up, which opens at
 * once and can be closed (the greyed button and its line stay).
 *
 * COPY-UNSIGNED: the owner's words as the draft ("Do not send funds via any payment method to ...
 * as dispute had been triggered and moderator has been summoned"); design writes the final copy.
 */
import { useId, useState } from 'react';
import type { TradeView } from '../../api/trade.js';
import { Button } from '../../ui/Button.js';
import { Sheet } from '../../ui/Sheet.js';

/** The buyer, on a trade the other side (or X2F) took to a dispute before the buyer tapped "I've paid". */
export function mustNotPay(view: Pick<TradeView, 'role' | 'state' | 'paidAt' | 'dispute'>): boolean {
  return view.role === 'buyer' && view.state === 'disputed' && view.paidAt === null && view.dispute !== null && view.dispute.by !== 'buyer';
}

export const DO_NOT_PAY = {
  title: 'Do not send any money',
  body: 'Do not send funds by any payment method to the seller: a dispute has been opened on this trade and a moderator has been called in.',
  locked: "I've paid is off while the dispute is open.",
  close: 'I understand',
} as const;

export function DoNotPay() {
  const [open, setOpen] = useState(true);
  const id = useId();
  return (
    <section className="dispute-stack-4" aria-label="Payment" data-do-not-pay="">
      <Button variant="secondary" disabled aria-describedby={id}>
        I've paid
      </Button>
      <p id={id} className="dispute-lead">
        {DO_NOT_PAY.locked} {DO_NOT_PAY.body}
      </p>
      <Sheet open={open} title={DO_NOT_PAY.title} wide="dialog" onClose={() => setOpen(false)}>
        <p className="dispute-lead">{DO_NOT_PAY.body}</p>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          {DO_NOT_PAY.close}
        </Button>
      </Sheet>
    </section>
  );
}
