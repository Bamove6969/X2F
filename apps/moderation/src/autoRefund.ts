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
 * 1. The API must show `refund_requested`, not paused (and the shadow not paused).
 * 2. The shadow must be `refund_requested` too, with no `trade.paid` ever opened and a seller-signed
 *    refund address; otherwise nothing is signed, and once the API has shown `refund_requested`
 *    for REFUND_UNVERIFIED_MS the trade escalates (`refund-unverified`) instead of hanging. A
 *    `trade.paid` this service opened while the API still shows `refund_requested` PAID_CONFLICT_MS
 *    later is a definite conflict: it escalates then (review M7).
 * 3. `shadow.finalAlertAt > shadow.payBy` (rulings Task 9: the alert only after the payment window).
 * 4. The API's own pause-shifted `finalAlertAt` must be on the watch list (review I1).
 * 5. Wait until max(shadow.finalAlertAt, api.finalAlertAt) + 15 min + AUTO_REFUND_MARGIN_MS. The
 *    API's `mark-paid` is open until ITS finalAlertAt + 15 min, and its finalAlertAt moves with
 *    every maintenance pause the API saw, even one this service missed (a restart across the pause
 *    start, an early refund-request signal, review I1). The margin covers a watch pass plus clock
 *    skew between the API and this service (review M1). Taking the later alert can only delay.
 * 6. No seen-receipt by then → escalate (`alert-unseen`).
 * 7. A receipt more than ALERT_LATE_MS after that alert → escalate (`alert-late`, lead decision I2
 *    option b, 2026-10-29): the API counts the buyer's 15 minutes from the alert, so a push that
 *    sat with the push service left the buyer less than its 15 minutes; a person decides.
 * 8. Wait until `final_alert_seen_at + 15 min + margin` (at most ALERT_LATE_MS more than 5.).
 * 9. Wait until the whole balance is unlocked.
 * 10. `autoRefundDecision` with the derived one-payout refund: ok → sign; otherwise refused with its
 *    reason only (and the 2. fallback escalates later).
 */
export const REFUND_UNVERIFIED_MS = 60 * 60_000;
/** One watch pass plus clock skew between the API and this service (review I1, M1). */
export const AUTO_REFUND_MARGIN_MS = 60_000;
/** A seen-receipt later than this after the alert escalates instead (lead decision I2 (b)). */
export const ALERT_LATE_MS = 2 * 60_000;
/** A `trade.paid` opened here while the API still shows `refund_requested` this long after: escalate (review M7). */
export const PAID_CONFLICT_MS = 2 * 60_000;

export interface AutoRefundInputs {
  now: Date;
  /** Null when the attested deal could not make a shadow trade: then nothing is ever signed alone. */
  shadow: Trade | null;
  /** The API's watch-list item: `finalAlertAt` is the API's own, shifted by every pause it applied. */
  api: { state: string; finalAlertSeenAt: Date | null; finalAlertAt?: Date | null; paused?: boolean };
  /** When this service first saw the API show `refund_requested` (this episode, restarted by a pause), or null. */
  apiRefundSince: Date | null;
  /** A valid `trade.paid` from the buyer's identity was opened, ever. */
  paidSeen: boolean;
  /** When the first one was opened (this service's clock), or null. */
  paidSeenAt?: Date | null;
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
  | 'unverified'
  | 'paused'
  | 'api-final-alert-missing';

export type AutoRefundStep =
  | { action: 'wait'; reason: AutoRefundWait | 'buyer-paid' | 'no-seller-terms' | 'shadow-not-refund-requested' }
  | { action: 'sign'; proposed: Payout[] }
  | { action: 'escalate'; report: 'alert-unseen' | 'alert-late' | 'refund-unverified' }
  | { action: 'refuse'; reason: AutoRefundRefusal | 'alert-not-after-deadline' | 'no-payout' };

export function autoRefundStep(f: AutoRefundInputs): AutoRefundStep {
  if (f.api.state !== 'refund_requested') return { action: 'wait', reason: 'api-not-refund-requested' };
  // Maintenance: nothing is decided while paused (every window is frozen).
  if (f.api.paused === true || (f.shadow !== null && f.shadow.pausedAt !== null)) return { action: 'wait', reason: 'paused' };
  const now = f.now.getTime();
  const overdue = f.apiRefundSince !== null && now >= f.apiRefundSince.getTime() + REFUND_UNVERIFIED_MS;
  const notYet = <S extends AutoRefundStep>(s: S): AutoRefundStep => (overdue ? { action: 'escalate', report: 'refund-unverified' } : s);

  const t = f.shadow;
  if (f.paidSeen || (t !== null && t.paidAt !== null)) {
    const since = f.paidSeenAt ?? t?.paidAt ?? null;
    if (since !== null && now >= since.getTime() + PAID_CONFLICT_MS) return { action: 'escalate', report: 'refund-unverified' };
    return notYet({ action: 'wait', reason: 'buyer-paid' });
  }
  if (f.recordedRefundAddress === null) return notYet({ action: 'wait', reason: 'no-seller-terms' });
  if (t === null || t.state !== 'refund_requested' || t.finalAlertAt === null || t.payBy === null) {
    return notYet({ action: 'wait', reason: 'shadow-not-refund-requested' });
  }
  if (t.finalAlertAt.getTime() <= t.payBy.getTime()) return notYet({ action: 'refuse', reason: 'alert-not-after-deadline' });
  const apiAlert = f.api.finalAlertAt ?? null;
  if (apiAlert === null || Number.isNaN(apiAlert.getTime())) return notYet({ action: 'wait', reason: 'api-final-alert-missing' });
  const alertAt = Math.max(t.finalAlertAt.getTime(), apiAlert.getTime());
  if (now < alertAt + FINAL_ALERT_MS + AUTO_REFUND_MARGIN_MS) return { action: 'wait', reason: 'final-alert-pending' };
  const seen = f.api.finalAlertSeenAt;
  if (seen === null || Number.isNaN(seen.getTime())) return { action: 'escalate', report: 'alert-unseen' };
  if (seen.getTime() > alertAt + ALERT_LATE_MS) return { action: 'escalate', report: 'alert-late' };
  if (now < seen.getTime() + FINAL_ALERT_MS + AUTO_REFUND_MARGIN_MS) return { action: 'wait', reason: 'receipt-too-recent' };
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
