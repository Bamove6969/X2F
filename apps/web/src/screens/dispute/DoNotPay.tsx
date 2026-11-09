/**
 * Owner p11-16 (8 Nov), drawn by design (BuyerPay tweak `dispute: opened`, docs/to-lead.md 9 Nov,
 * ea2a9ca8): a dispute opened before "I've paid" greys out the payer's "I've paid" at once, with a
 * line under it and an alert sheet that opens at once. The payer gets it whoever opened the
 * dispute. The API already refuses "I've paid" on a disputed trade (the machine's mark-paid is
 * wrong-state outside `secured`); this is what the payer sees.
 *
 * COPY-UNSIGNED: design's words (docs/to-lead.md); the owner has not signed them.
 */
import { useId, useState } from 'react';
import { methodOf, publicName, type TradeView } from '../../api/trade.js';
import { Button } from '../../ui/Button.js';
import { Sheet } from '../../ui/Sheet.js';

/** The payer (the buyer), on a disputed trade, before tapping "I've paid": whoever opened the dispute. */
export function mustNotPay(view: Pick<TradeView, 'role' | 'state' | 'paidAt' | 'dispute'>): boolean {
  return view.role === 'buyer' && view.state === 'disputed' && view.paidAt === null && view.dispute !== null;
}

/** Who opened it, as the sentence names them: the other trader, or X2F for its own escalation. */
function openerOf(view: Pick<TradeView, 'dispute' | 'counterparty'>): string {
  return view.dispute?.by === 'system' ? 'X2F' : view.dispute?.by === 'buyer' ? 'You' : publicName(view.counterparty);
}

export const DO_NOT_PAY = {
  eyebrow: 'DISPUTE OPENED',
  title: "Don't send any payment",
  paused: (opener: string) => `Paused: ${opener} opened a dispute. Don't send any payment.`,
  body: (opener: string, seller: string, method: string) =>
    `${opener} opened a dispute and a moderator has been called in. Don't send money to ${seller} by ${method} or any other way. "I've paid" is paused until the moderator tells you what happens next.`,
  toDispute: 'Go to the dispute',
  gotIt: "Got it, I won't pay",
} as const;

export function DoNotPay({ view }: { view: Pick<TradeView, 'code' | 'dispute' | 'counterparty' | 'methodId' | 'profile'> }) {
  const [open, setOpen] = useState(true);
  const id = useId();
  const opener = openerOf(view);
  const seller = publicName(view.counterparty);
  const method = methodOf(view).name;
  return (
    <section className="dispute-stack-4" aria-label="Payment" data-do-not-pay="">
      <Button variant="secondary" disabled aria-describedby={id}>
        I've paid
      </Button>
      <p id={id} className="dispute-lead" data-tone="danger">
        {DO_NOT_PAY.paused(opener)}
      </p>
      <Sheet open={open} eyebrow={DO_NOT_PAY.eyebrow} title={DO_NOT_PAY.title} wide="dialog" onClose={() => setOpen(false)}>
        <p className="dispute-lead">{DO_NOT_PAY.body(opener, seller, method)}</p>
        <Button variant="secondary" href={`/trade/${encodeURIComponent(view.code)}/dispute`}>
          {DO_NOT_PAY.toDispute}
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          {DO_NOT_PAY.gotIt}
        </Button>
      </Sheet>
    </section>
  );
}
