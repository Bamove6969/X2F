import { autoRefundDecision, FINAL_ALERT_MS, type AutoRefundRefusal, type Payout } from '@x2f/escrow';
import type { Trade } from '@x2f/trade';

/**
 * The buyer no-show auto-refund (Plan 3 Task 10, spec 2.3 and 3.3): may the moderator co-sign the
 * seller-built refund ALONE, now? Pure. The moderation service calls it every watcher pass while
 * the API shows the trade `refund_requested`.
 *
 * Every fact it trusts is the service's own: the shadow trade (payBy, paidAt, finalAlertAt, fed only
 * by its watcher and the signals it opened), whether it ever opened a valid `trade.paid` from the
 * buyer's identity, the refund address the SELLER's identity signed (never the API's
 * `seller_refund`) and the escrow balance read by its own party (balance == unlocked). The API
 * supplies only brakes: its state (nothing is signed unless it, too, says `refund_requested`) and
 * the buyer's seen-receipt for the final alert (`final_alert_seen_at`, set only by Task 25's
 * FinalAlert; absent = not seen, Task 19 review 2026-10-27).
 *
 * Order:
 * 1. The API must show `refund_requested`.
 * 2. The shadow must be `refund_requested` too, with no `trade.paid` ever opened and a seller-signed
 *    refund address; otherwise nothing is signed, and once the API has shown `refund_requested`
 *    for REFUND_UNVERIFIED_MS the trade escalates (`refund-unverified`) instead of hanging.
 * 3. `shadow.finalAlertAt > shadow.payBy` (rulings Task 9: the alert only after the payment window).
 * 4. Wait until `shadow.finalAlertAt + 15 min`.
 * 5. No seen-receipt by then → escalate (`alert-unseen`).
 * 6. Wait until `final_alert_seen_at + 15 min` (a push may sit with the push service for its 15-min
 *    TTL, so the buyer's 15 minutes run from the receipt).
 * 7. Wait until the whole balance is unlocked.
 * 8. `autoRefundDecision` with the derived one-payout refund: ok → sign; otherwise refused with its
 *    reason only (and the 2. fallback escalates later).
 */
export const REFUND_UNVERIFIED_MS = 60 * 60_000;

export interface AutoRefundInputs {
  now: Date;
  /** Null when the attested deal could not make a shadow trade: then nothing is ever signed alone. */
  shadow: Trade | null;
  api: { state: string; finalAlertSeenAt: Date | null };
  /** When this service first saw the API show `refund_requested` (this episode), or null. */
  apiRefundSince: Date | null;
  /** A valid `trade.paid` from the buyer's identity was opened, ever. */
  paidSeen: boolean;
  /** The seller-signed `trade.terms` refund address, or null before it arrived. */
  recordedRefundAddress: string | null;
  /** The escrow read by this service's own party. */
  funds: { balance: bigint; unlocked: bigint };
  /** The refund payouts for a balance (payoutsFor('auto-refund', …) with the seller-signed address). */
  refundFor: (balance: bigint) => Payout[];
}

export type AutoRefundWait =
  | 'api-not-refund-requested'
  | 'final-alert-pending'
  | 'receipt-too-recent'
  | 'not-unlocked'
  | 'unverified';

export type AutoRefundStep =
  | { action: 'wait'; reason: AutoRefundWait | 'buyer-paid' | 'no-seller-terms' | 'shadow-not-refund-requested' }
  | { action: 'sign'; proposed: Payout[] }
  | { action: 'escalate'; report: 'alert-unseen' | 'refund-unverified' }
  | { action: 'refuse'; reason: AutoRefundRefusal | 'alert-not-after-deadline' | 'no-payout' };

export function autoRefundStep(f: AutoRefundInputs): AutoRefundStep {
  if (f.api.state !== 'refund_requested') return { action: 'wait', reason: 'api-not-refund-requested' };
  const now = f.now.getTime();
  const overdue = f.apiRefundSince !== null && now >= f.apiRefundSince.getTime() + REFUND_UNVERIFIED_MS;
  const notYet = <S extends AutoRefundStep>(s: S): AutoRefundStep => (overdue ? { action: 'escalate', report: 'refund-unverified' } : s);

  const t = f.shadow;
  if (f.paidSeen || (t !== null && t.paidAt !== null)) return notYet({ action: 'wait', reason: 'buyer-paid' });
  if (f.recordedRefundAddress === null) return notYet({ action: 'wait', reason: 'no-seller-terms' });
  if (t === null || t.state !== 'refund_requested' || t.finalAlertAt === null || t.payBy === null) {
    return notYet({ action: 'wait', reason: 'shadow-not-refund-requested' });
  }
  if (t.finalAlertAt.getTime() <= t.payBy.getTime()) return notYet({ action: 'refuse', reason: 'alert-not-after-deadline' });
  if (now < t.finalAlertAt.getTime() + FINAL_ALERT_MS) return { action: 'wait', reason: 'final-alert-pending' };
  const seen = f.api.finalAlertSeenAt;
  if (seen === null || Number.isNaN(seen.getTime())) return { action: 'escalate', report: 'alert-unseen' };
  if (now < seen.getTime() + FINAL_ALERT_MS) return { action: 'wait', reason: 'receipt-too-recent' };
  const { balance, unlocked } = f.funds;
  if (balance <= 0n || balance !== unlocked) return { action: 'wait', reason: 'not-unlocked' };
  let proposed: Payout[];
  try {
    proposed = f.refundFor(balance);
  } catch {
    return notYet({ action: 'refuse', reason: 'no-payout' });
  }
  const d = autoRefundDecision({
    paymentDeadline: t.payBy,
    markedPaidAt: t.paidAt,
    finalAlertAt: t.finalAlertAt,
    now: f.now,
    recordedRefundAddress: f.recordedRefundAddress,
    proposed,
  });
  return d.ok ? { action: 'sign', proposed } : notYet({ action: 'refuse', reason: d.reason });
}
