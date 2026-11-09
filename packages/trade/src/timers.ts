/** Trade timers (Global Constraints). All are measured on the server clock. */
export const TIMERS = {
  setupMin: 15,
  fundMin: 30,
  payMin: 90,
  extendMin: 30,
  maxExtensions: 2,
  settleMin: 15,
  lapseCosignMin: 30,
  /** Owner 2026-10-29: the buyer may dispute a refund (to prove they paid) for 48 hours after it lands (was 90 days). */
  disputeAfterRefundHours: 48,
} as const;

/** Confirmations after which Monero coins unlock. */
export const UNLOCK_CONFIRMATIONS = 10;

/**
 * Owner 2026-10-29: when the seller never taps "Confirm cancel" after a buyer's cancel, the trade
 * stays in their active trades ("Your input is needed to cancel this trade.") and closes as
 * cancelled this many hours after the button became available (`cancelConfirmableAt`). Frozen by
 * maintenance like every other trade timer.
 */
export const SELLER_CONFIRM_CANCEL_TIMEOUT_H = 48;

const MIN_MS = 60_000;

export function addMin(d: Date, min: number): Date {
  return new Date(d.getTime() + min * MIN_MS);
}
