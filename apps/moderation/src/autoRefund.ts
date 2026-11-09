import { autoRefundDecision, type AutoRefundRefusal, type Payout } from '@x2f/escrow';
import type { Trade } from '@x2f/trade';

/**
 * The seller's cancel refund (Plan 3 Task 10, spec 2.3 and 3.3; owner 8 Nov, p6-1 and p9-2: no
 * final warning, the refund starts at once): may the moderator co-sign the seller-built refund
 * ALONE, now? Pure. The moderation service calls it every watcher pass while the API shows the
 * trade settling as `auto-refund` (the seller's accepted `request-refund`).
 *
 * Every fact it trusts is the service's own: the shadow trade (payBy, paidAt, its own settling,
 * fed only by its watcher and the signals it opened; the shadow takes the seller's
 * `trade.refund-request` only once ITS payBy has passed and the buyer has not marked paid), whether
 * it ever opened a valid `trade.paid` from the buyer's identity, the refund address the SELLER's
 * identity signed (never the API's `seller_refund`) and the escrow balance read by its own party
 * (balance == unlocked). The API supplies only brakes: nothing is signed unless it, too, shows the
 * seller's cancel (`settling` / `auto-refund`), unpaused. A lying API can delay a refund, never
 * cause one: without the seller's signal after the shadow's own payBy nothing is signed.
 *
 * Order:
 * 1. The API must show `settling` as `auto-refund`, not paused (and the shadow not paused).
 * 2. No `trade.paid` ever opened (else wait, and once the API still shows the cancel
 *    PAID_CONFLICT_MS after it, escalate `refund-unverified`: review M7), a seller-signed refund
 *    address, and the shadow itself settling as `auto-refund`; otherwise nothing is signed, and
 *    once the API has shown the cancel for REFUND_UNVERIFIED_MS the trade escalates
 *    (`refund-unverified`) instead of hanging.
 * 3. Wait until the whole balance is unlocked.
 * 4. `autoRefundDecision` (the shadow's payBy has passed, no mark-paid, one payout to the
 *    seller-signed address) with the derived one-payout refund: ok → sign; otherwise refused with
 *    its reason only (and the 2. fallback escalates later).
 * The API's `mark-paid` is closed from the moment it shows the cancel (one trade row decides which
 * came first), so no margin for an open buyer window is needed any more.
 */
export const REFUND_UNVERIFIED_MS = 60 * 60_000;
/** A `trade.paid` opened here while the API still shows the seller's cancel this long after: escalate (review M7). */
export const PAID_CONFLICT_MS = 2 * 60_000;

/** The API shows the seller's cancel refund: settling as `auto-refund`. */
export const apiShowsSellerCancel = (api: { state: string; settleKind?: string | null }): boolean =>
  api.state === 'settling' && api.settleKind === 'auto-refund';

export interface AutoRefundInputs {
  now: Date;
  /** Null when the attested deal could not make a shadow trade: then nothing is ever signed alone. */
  shadow: Trade | null;
  /** The API's watch-list item. */
  api: { state: string; settleKind?: string | null; paused?: boolean };
  /** When this service first saw the API show the seller's cancel (this episode, restarted by a pause), or null. */
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

export type AutoRefundWait = 'api-not-cancelled' | 'not-unlocked' | 'unverified' | 'paused';

export type AutoRefundStep =
  | { action: 'wait'; reason: AutoRefundWait | 'buyer-paid' | 'no-seller-terms' | 'shadow-not-cancelled' }
  | { action: 'sign'; proposed: Payout[] }
  | { action: 'escalate'; report: 'refund-unverified' }
  | { action: 'refuse'; reason: AutoRefundRefusal | 'no-payout' };

export function autoRefundStep(f: AutoRefundInputs): AutoRefundStep {
  if (!apiShowsSellerCancel(f.api)) return { action: 'wait', reason: 'api-not-cancelled' };
  // Maintenance: nothing is decided while paused.
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
  if (t === null || t.state !== 'settling' || t.settling !== 'auto-refund' || t.payBy === null) {
    return notYet({ action: 'wait', reason: 'shadow-not-cancelled' });
  }
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
    now: f.now,
    recordedRefundAddress: f.recordedRefundAddress,
    proposed,
  });
  return d.ok ? { action: 'sign', proposed } : notYet({ action: 'refuse', reason: d.reason });
}
