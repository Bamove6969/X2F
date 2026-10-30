/**
 * The one retention rule (Plan 7 Task 1; owner 2026-10-29, R36; spec 4.1 Revision 2026-10-29).
 *
 * An undisputed trade self-destructs TRADE_KEEP_DAYS (30) days after it ends: this is the
 * advertised self-destruct. A disputed trade is kept DISPUTE_KEEP_DAYS (90) days from the moment
 * the dispute button was pressed (the latest dispute, if a trade had more than one), and never
 * while a dispute is still open. Nobody can choose another time or delete early, staff included.
 * No per-trade stub is kept: the purge moves what must last into account totals first (Task 2).
 *
 * Automatic exceptions, each only ever making the keep LONGER:
 * - a dispute still open (or still appealable) at day 90 is kept until it is closed;
 * - a refunded trade is kept until the buyer's dispute-after-refund window has closed (the state
 *   machine's own window, `refundDisputeWindowEndsAt`), so a trade is never deleted while its
 *   buyer may still dispute it;
 * - a closed trade that still waits for a party (`awaitingAction`, e.g. Task 38's seller
 *   "Confirm cancel") is never deleted while it waits.
 *
 * Pure and clock-free: every caller passes `now`. Any invalid date keeps the trade (a corrupt row
 * is never a reason to delete).
 */
import { TIMERS } from './timers.js';

/** An undisputed trade is deleted this many days after it ends (owner 2026-10-29). */
export const TRADE_KEEP_DAYS = 30;
/** A disputed trade is deleted this many days after the dispute button (owner 2026-10-29). */
export const DISPUTE_KEEP_DAYS = 90;
/**
 * Backups keep deleted data for at most this many days (Plan 6 D6; the plan recommends 14 and the
 * owner has not confirmed it). Only the Privacy page reads it; nothing here waits for backups.
 */
export const BACKUP_KEEP_DAYS = 14;

const DAY_MS = 86_400_000;

/**
 * How long after a refund the buyer may still open a dispute: the state machine's own window
 * (`apply` → `open-dispute` on a `refunded` trade). SEAM (Plan 3 Task 38, `wip/lead-p3-task38`):
 * that branch replaces `TIMERS.disputeAfterRefundDays` (90) with `disputeAfterRefundHours` (48,
 * owner 2026-10-29); when it lands, this line becomes `TIMERS.disputeAfterRefundHours * 3_600_000`
 * (tsc flags it). The rule itself does not change: the window never shortens the 30 days.
 */
export const REFUND_DISPUTE_WINDOW_MS = TIMERS.disputeAfterRefundDays * DAY_MS;

export interface RetentionFacts {
  /** When the trade ended, or null while it is open (the machine nulls it while a dispute is open). */
  closedAt: Date | null;
  /** When the latest dispute button was pressed, or null if the trade was never disputed. */
  disputeOpenedAt: Date | null;
  /** Every dispute on the trade is closed: no ruling pending, no appeal pending or still possible. */
  disputeClosed: boolean;
  /** When the buyer's dispute-after-refund window closes, or null when there is none. */
  refundDisputeWindowEndsAt: Date | null;
  /** The trade has ended but still waits for a party (Task 38's seller Confirm cancel). */
  awaitingAction: boolean;
}

const valid = (d: Date | null): d is Date => d instanceof Date && Number.isFinite(d.getTime());
const nullable = (d: Date | null): boolean => d === null || valid(d);
const addDays = (d: Date, days: number): Date => new Date(d.getTime() + days * DAY_MS);

/**
 * When the trade self-destructs, or null while it must be kept with no date yet: the trade is
 * open, a dispute is not closed, it waits for a party, or a fact is invalid.
 */
export function tradeDeleteAt(f: RetentionFacts): Date | null {
  if (!nullable(f.closedAt) || !nullable(f.disputeOpenedAt) || !nullable(f.refundDisputeWindowEndsAt)) return null;
  if (!valid(f.closedAt) || f.awaitingAction !== false) return null;
  let at: Date;
  if (f.disputeOpenedAt !== null) {
    if (f.disputeClosed !== true) return null;
    at = addDays(f.disputeOpenedAt, DISPUTE_KEEP_DAYS);
  } else {
    at = addDays(f.closedAt, TRADE_KEEP_DAYS);
  }
  // The machine still accepts a dispute AT the window's last instant (`now <= limit`), so the
  // trade is kept through it: due 1 ms later.
  const w = f.refundDisputeWindowEndsAt;
  if (w !== null && w.getTime() >= at.getTime()) at = new Date(w.getTime() + 1);
  return at;
}

/** True from the instant `tradeDeleteAt` is reached (never 1 ms before). */
export function tradeDeleteDue(f: RetentionFacts, now: Date): boolean {
  if (!valid(now)) return false;
  const at = tradeDeleteAt(f);
  return at !== null && now.getTime() >= at.getTime();
}

/**
 * The end of the buyer's dispute-after-refund window for a trade in `state` that ended at
 * `closedAt`: only a refunded trade with no dispute yet has one (once disputed, the dispute rule
 * applies instead).
 */
export function refundDisputeWindowEndsAt(state: string, closedAt: Date | null, disputed: boolean): Date | null {
  if (state !== 'refunded' || disputed || !valid(closedAt)) return null;
  return new Date(closedAt.getTime() + REFUND_DISPUTE_WINDOW_MS);
}
