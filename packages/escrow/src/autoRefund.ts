import type { Payout } from './engine.js';

/** The buyer's final alert lasts 15 minutes before the moderator service may refund alone. */
export const FINAL_ALERT_MS = 15 * 60 * 1000;

export type AutoRefundRefusal = 'window-open' | 'buyer-marked-paid' | 'final-alert-pending' | 'wrong-destination';

export interface AutoRefundFacts {
  paymentDeadline: Date;
  markedPaidAt: Date | null;
  finalAlertAt: Date | null;
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
 * May the moderator key co-sign the buyer no-show refund on its own (spec 2.3, 3.3)?
 * Only when the payment window has passed, the buyer never marked paid, the final alert
 * went out at least 15 minutes ago, and the refund pays exactly the recorded address.
 * Pure; invalid dates never allow.
 */
export function autoRefundDecision(t: AutoRefundFacts): { ok: true } | { ok: false; reason: AutoRefundRefusal } {
  if (!valid(t.now) || !valid(t.paymentDeadline) || t.now.getTime() <= t.paymentDeadline.getTime()) {
    return { ok: false, reason: 'window-open' };
  }
  if (t.markedPaidAt !== null) return { ok: false, reason: 'buyer-marked-paid' };
  if (t.finalAlertAt === null || !valid(t.finalAlertAt) || t.now.getTime() < t.finalAlertAt.getTime() + FINAL_ALERT_MS) {
    return { ok: false, reason: 'final-alert-pending' };
  }
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
