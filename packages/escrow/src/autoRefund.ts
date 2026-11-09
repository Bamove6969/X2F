import type { Payout } from './engine.js';

export type AutoRefundRefusal = 'window-open' | 'buyer-marked-paid' | 'wrong-destination';

export interface AutoRefundFacts {
  paymentDeadline: Date;
  markedPaidAt: Date | null;
  /** Server clock only; never a time sent by a client. */
  now: Date;
  /** The seller's refund address recorded at escrow setup. */
  recordedRefundAddress: string;
  proposed: Payout[];
}

function valid(d: Date): boolean {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/**
 * May the moderator key co-sign the seller's cancel refund on its own (spec 2.3, 3.3; owner 8 Nov,
 * p6-1: no final warning)? Only when the payment window has passed, the buyer never marked paid,
 * and the refund pays exactly the recorded address. Pure; invalid dates never allow.
 */
export function autoRefundDecision(t: AutoRefundFacts): { ok: true } | { ok: false; reason: AutoRefundRefusal } {
  if (!valid(t.now) || !valid(t.paymentDeadline) || t.now.getTime() <= t.paymentDeadline.getTime()) {
    return { ok: false, reason: 'window-open' };
  }
  if (t.markedPaidAt !== null) return { ok: false, reason: 'buyer-marked-paid' };
  const [only, ...rest] = t.proposed;
  if (
    only === undefined ||
    rest.length > 0 ||
    typeof t.recordedRefundAddress !== 'string' ||
    t.recordedRefundAddress.length === 0 ||
    only.address !== t.recordedRefundAddress ||
    typeof only.amountAtomic !== 'bigint' ||
    only.amountAtomic <= 0n
  ) {
    return { ok: false, reason: 'wrong-destination' };
  }
  return { ok: true };
}

export type BuyerCancelRefusal = 'no-buyer-signal' | 'wrong-destination';

export interface BuyerCancelFacts {
  /** The buyer's own trade identity signed a `trade.cancel` signal for this trade. */
  cancelSignedByBuyer: boolean;
  /** The refund address the seller's identity signed at escrow setup. */
  recordedRefundAddress: string;
  /** The escrow's whole balance, read while balance == unlocked. */
  balance: bigint;
  proposed: Payout[];
}

/**
 * May the moderator key co-sign a buyer's cancel on its own (spec 2.3, 3.3)? Only when the
 * buyer's own identity signed the cancel, and the refund is exactly one payout of the whole
 * balance to the seller's recorded refund address (exact string equality). Pure.
 */
export function buyerCancelDecision(f: BuyerCancelFacts): { ok: true } | { ok: false; reason: BuyerCancelRefusal } {
  if (f.cancelSignedByBuyer !== true) return { ok: false, reason: 'no-buyer-signal' };
  const [only, ...rest] = f.proposed;
  if (
    only === undefined ||
    rest.length > 0 ||
    typeof f.recordedRefundAddress !== 'string' ||
    f.recordedRefundAddress.length === 0 ||
    only.address !== f.recordedRefundAddress ||
    typeof f.balance !== 'bigint' ||
    f.balance <= 0n ||
    only.amountAtomic !== f.balance // strict: a number never equals the bigint balance
  ) {
    return { ok: false, reason: 'wrong-destination' };
  }
  return { ok: true };
}
