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

const MIN_MS = 60_000;

export function addMin(d: Date, min: number): Date {
  return new Date(d.getTime() + min * MIN_MS);
}
