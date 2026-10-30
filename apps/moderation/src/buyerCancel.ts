import { buyerCancelDecision, type BuyerCancelRefusal, type Payout } from '@x2f/escrow';

/**
 * The buyer-cancel refund (Plan 3 Task 10, spec 2.3): may the moderator co-sign the buyer-built
 * refund of the whole escrow to the seller? Pure. Only after this service opened a valid
 * `trade.cancel` sealed by the buyer's own trade identity (a cancel from any other identity is
 * never counted), and only to the refund address the SELLER's identity signed. No final alert and
 * no delivery proof: the buyer chose it, and only the seller is paid.
 *
 * Owner's option B (2026-10-29): no cancel of any kind after "I've paid". So nothing is signed once
 * this service has opened a valid `trade.paid` from the buyer, checked on every pass (a `trade.paid`
 * opened while the cancel waits for the coins to unlock still blocks it; review I3). The API only
 * brakes: nothing is signed while it shows the trade paid, a release (or any settlement other than
 * the buyer's cancel) in progress, disputed, lapsed or closed.
 */
export interface BuyerCancelInputs {
  /** A valid `trade.cancel` from the buyer's identity was opened, and the shadow trade took it. */
  cancelSeen: boolean;
  /** A valid `trade.paid` from the buyer's identity was opened, ever. */
  paidSeen: boolean;
  /** The API's watch-list item. */
  api: { state: string; settleKind: string | null };
  recordedRefundAddress: string | null;
  funds: { balance: bigint; unlocked: bigint };
  refundFor: (balance: bigint) => Payout[];
}

export type BuyerCancelStep =
  | { action: 'none' }
  | { action: 'wait'; reason: 'no-seller-terms' | 'not-unlocked' | 'api-state' }
  | { action: 'sign'; proposed: Payout[] }
  | { action: 'refuse'; reason: BuyerCancelRefusal | 'no-payout' | 'buyer-paid' };

/** The API states a buyer's cancel can still be co-signed in (the machine's BUYER_CANCEL_SETTLE, plus funding; never `paid`, Task 39). */
const API_CANCEL_OK: readonly string[] = ['funding', 'securing', 'secured', 'refund_requested'];

/** Exported for the armed refund's recheck every pass (review round 2 N2). */
export const apiAllows = (a: BuyerCancelInputs['api']): boolean =>
  API_CANCEL_OK.includes(a.state) || (a.state === 'settling' && a.settleKind === 'buyer-cancel');

export function buyerCancelStep(f: BuyerCancelInputs): BuyerCancelStep {
  if (!f.cancelSeen) return { action: 'none' };
  if (f.paidSeen) return { action: 'refuse', reason: 'buyer-paid' };
  if (!apiAllows(f.api)) return { action: 'wait', reason: 'api-state' };
  if (f.recordedRefundAddress === null) return { action: 'wait', reason: 'no-seller-terms' };
  const { balance, unlocked } = f.funds;
  if (balance <= 0n || balance !== unlocked) return { action: 'wait', reason: 'not-unlocked' };
  let proposed: Payout[];
  try {
    proposed = f.refundFor(balance);
  } catch {
    return { action: 'refuse', reason: 'no-payout' };
  }
  const d = buyerCancelDecision({ cancelSignedByBuyer: true, recordedRefundAddress: f.recordedRefundAddress, balance, proposed });
  return d.ok ? { action: 'sign', proposed } : { action: 'refuse', reason: d.reason };
}
