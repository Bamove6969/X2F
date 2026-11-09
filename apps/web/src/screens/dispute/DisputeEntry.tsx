// The way into a dispute from the trade room (Tasks 23, 24 and Task 27's RefundedSlot place it):
// the BuyerPay board's rose "Open dispute", the explanation while either side must still wait out
// the payment method's confirm window (owner p9-4), and the buyer's "Open a dispute" on a refunded trade within 48
// hours (owner 2026-10-29; was 90 days). Nothing while the state machine would refuse a dispute.
import { Button } from '../../ui/Button.js';
import type { DisputeTrade } from './api.js';
import { disputeEntry } from './rules.js';

export function DisputeEntry({ trade, now }: { trade: DisputeTrade; now: Date }) {
  const e = disputeEntry(trade, now);
  const href = `/trade/${encodeURIComponent(trade.code)}/dispute`;
  if (e.kind === 'wait') return <p className="dispute-muted-sm">{e.text}</p>;
  if (e.kind === 'opened') return <Button variant="danger" href={href}>Go to the dispute</Button>; // COPY-UNSIGNED
  if (e.kind !== 'open') return null;
  return (
    <Button variant="danger" href={href}>
      {trade.state === 'refunded' ? 'Open a dispute' : 'Open dispute'}
    </Button>
  );
}
