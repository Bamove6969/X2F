/** Trade timers (Global Constraints). All are measured on the server clock. */
export const TIMERS = {
  setupMin: 15,
  fundMin: 30,
  payMin: 90,
  extendMin: 30,
  maxExtensions: 2,
  finalAlertMin: 15,
  settleMin: 15,
  lapseCosignMin: 30,
  disputeAfterRefundDays: 90,
} as const;

/** Confirmations after which Monero coins unlock. */
export const UNLOCK_CONFIRMATIONS = 10;

/**
 * OPEN (owner, 2026-10-29): what happens when the seller never taps "Confirm cancel" after a
 * buyer's cancel. `null` = nothing closes it by itself; the trade stays "Cancelling" (the coins are
 * already back with the seller). When the owner answers, set the hours here and add the timer
 * (tripwire NEEDS_OWNER_CONFIRM_CANCEL_TIMEOUT, packages/trade/test/machine.test.ts).
 */
export const SELLER_CONFIRM_CANCEL_TIMEOUT_H: number | null = null;

const MIN_MS = 60_000;

export function addMin(d: Date, min: number): Date {
  return new Date(d.getTime() + min * MIN_MS);
}
