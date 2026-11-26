/**
 * Plan 7 Task 1: the one retention rule for a whole trade (owner 2026-10-29, R36), pure and shared
 * by the API's purge (apps/api/src/retention/tradePurge.ts) and the trade room's self-destruct date
 * (TradeView.deleteAt).
 *
 * - An undisputed trade self-destructs TRADE_KEEP_DAYS (30) days after it closed: the advertised
 *   self-destruct. There are no user-chosen times and no early delete for anyone, staff included.
 * - A trade that had a dispute is kept DISPUTE_KEEP_DAYS (90) days after its LAST dispute closed
 *   (owner p11-11, 9 Nov 2026: counted from the dispute closing, not the dispute button), and
 *   never while any dispute is open. "Closed" is the dispute machine's `closed` status, the only one
 *   with a `disputes.closed_at`: it comes after the 48-hour appeal window (`published`), round 2
 *   (`appealed`), and any payout or payment still owed (`final`, `complying`). The 90 days count
 *   from the later of that close and the trade's own close, as `chatPurgeDue` does.
 * - Never before the window to dispute after a refund has closed (TIMERS.disputeAfterRefundHours,
 *   from the refund; it follows that timer if the owner changes it).
 * - Never while a buyer's cancel waits for the seller's Confirm cancel (`awaitingAction`): the
 *   trade is still among the seller's active trades.
 * - Never while the moderation service may still watch the escrow for late coins (`watchEndsAt`:
 *   the API keeps a closed, attested trade on the watch list for WATCH_LIST_CLOSED_DAYS). This one
 *   only holds the DELETE back; it does not move the date shown to the traders.
 *
 * The same numbers as the chat purge (CHAT_AFTER_CLOSE_DAYS, CHAT_AFTER_DISPUTE_DAYS): a trade's
 * chat is always due no later than its trade, so the chat purge goes first and the trade purge
 * never finds a chat it may not delete (test/retention.test.ts).
 *
 * Any invalid date keeps the trade: a corrupt row is never a reason to delete.
 */
import { CHAT_AFTER_CLOSE_DAYS, CHAT_AFTER_DISPUTE_DAYS } from './chat.js';
import type { TradeState } from './machine.js';
import { TIMERS } from './timers.js';

/** An undisputed trade is deleted whole this many days after it closed (owner 2026-10-29). */
export const TRADE_KEEP_DAYS = CHAT_AFTER_CLOSE_DAYS;
/** A disputed trade is deleted this many days after its last dispute closed (owner 2026-10-29, p11-11). */
export const DISPUTE_KEEP_DAYS = CHAT_AFTER_DISPUTE_DAYS;

const DAY_MS = 86_400_000;

/** What the rule reads about one trade. Every date is the server's. */
export interface RetentionFacts {
  /** When the trade closed, or null while it is open. */
  closedAt: Date | null;
  /** The trade has ever had a dispute (`trades.dispute_by`, or any `disputes` row). */
  disputed: boolean;
  /** A dispute is open: the trade is `disputed`, or any of its disputes is not yet `closed`. */
  disputeOpen: boolean;
  /** When the latest of its disputes closed (`disputes.closed_at`), or null if none has. */
  disputeClosedAt: Date | null;
  /** When the buyer's window to dispute a refund ends (`refundDisputeWindowEndsAt`), or null. */
  refundDisputeWindowEndsAt: Date | null;
  /** A buyer's cancel waits for the seller's Confirm cancel (@x2f/trade `awaitingCancelConfirm`). */
  awaitingAction: boolean;
  /** Until when the moderation service may still watch the escrow (null: nothing to watch). */
  watchEndsAt: Date | null;
  /**
   * Owner 26 Nov 2026: a lien from this trade's disputes is unpaid (active or suspended). The trade
   * then has no delete date until the lien ends (repaid, void, or written off as uncollectible).
   */
  lienOpen?: boolean;
  /** When the last lien from this trade ended, or null; the trade is kept DISPUTE_KEEP_DAYS after it. */
  lienEndedAt?: Date | null;
}

const valid = (d: Date | null): d is Date => d instanceof Date && Number.isFinite(d.getTime());
const nullable = (d: Date | null): boolean => d === null || valid(d);

/** The buyer's after-refund dispute window end for a trade in `state` that closed at `closedAt`, or null. */
export function refundDisputeWindowEndsAt(state: TradeState | string, closedAt: Date | null): Date | null {
  if (state !== 'refunded' || !valid(closedAt)) return null;
  return new Date(closedAt.getTime() + TIMERS.disputeAfterRefundHours * 3_600_000);
}

/**
 * When the trade self-destructs (the date the traders are shown), or null while it has none: open,
 * a dispute open, a cancel waiting, an unpaid lien from it (owner 26 Nov 2026), a disputed trade
 * with no close time, or any invalid date. A lien that ended keeps it DISPUTE_KEEP_DAYS after.
 */
export function tradeDeleteAt(f: RetentionFacts): Date | null {
  if (
    f.disputeOpen ||
    f.awaitingAction ||
    f.lienOpen === true ||
    !nullable(f.lienEndedAt ?? null) ||
    !valid(f.closedAt) ||
    !nullable(f.disputeClosedAt) ||
    !nullable(f.refundDisputeWindowEndsAt) ||
    !nullable(f.watchEndsAt)
  ) {
    return null;
  }
  let at: number;
  if (!f.disputed) {
    at = f.closedAt.getTime() + TRADE_KEEP_DAYS * DAY_MS;
  } else {
    if (!valid(f.disputeClosedAt)) return null;
    at = Math.max(f.disputeClosedAt.getTime(), f.closedAt.getTime()) + DISPUTE_KEEP_DAYS * DAY_MS;
  }
  if (f.refundDisputeWindowEndsAt !== null) at = Math.max(at, f.refundDisputeWindowEndsAt.getTime());
  if (f.lienEndedAt) at = Math.max(at, f.lienEndedAt.getTime() + DISPUTE_KEEP_DAYS * DAY_MS);
  return new Date(at);
}

/** The trade may be deleted at `now`: strictly after its date, and after the moderation watch. */
export function tradeDeleteDue(f: RetentionFacts, now: Date): boolean {
  if (!valid(now)) return false;
  const at = tradeDeleteAt(f);
  if (at === null || now.getTime() <= at.getTime()) return false;
  return f.watchEndsAt === null || now.getTime() > f.watchEndsAt.getTime();
}
