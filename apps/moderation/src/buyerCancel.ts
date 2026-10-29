import { buyerCancelDecision, type BuyerCancelRefusal, type Payout } from '@x2f/escrow';

/**
 * The buyer-cancel refund (Plan 3 Task 10, spec 2.3): may the moderator co-sign the buyer-built
 * refund of the whole escrow to the seller? Pure. Only after this service opened a valid
 * `trade.cancel` sealed by the buyer's own trade identity (a cancel from any other identity is
 * never counted), and only to the refund address the SELLER's identity signed. No final alert and
 * no delivery proof: the buyer chose it, and only the seller is paid. The API is not consulted.
 */
export interface BuyerCancelInputs {
  /** A valid `trade.cancel` from the buyer's identity was opened. */
  cancelSeen: boolean;
  recordedRefundAddress: string | null;
  funds: { balance: bigint; unlocked: bigint };
  refundFor: (balance: bigint) => Payout[];
}

export type BuyerCancelStep =
  | { action: 'none' }
  | { action: 'wait'; reason: 'no-seller-terms' | 'not-unlocked' }
  | { action: 'sign'; proposed: Payout[] }
  | { action: 'refuse'; reason: BuyerCancelRefusal | 'no-payout' };

export function buyerCancelStep(f: BuyerCancelInputs): BuyerCancelStep {
  if (!f.cancelSeen) return { action: 'none' };
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
