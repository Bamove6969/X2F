/**
 * The API timer loop's decisions (Task 9), pure: given the open trades, the maintenance flag
 * (`site_flags.maintenance_since`) and the server's clock, which system events to apply now.
 * The loop itself (`startTimers(deps)` in apps/api, every TIMER_LOOP_MS) reads the trades,
 * applies these events through the trade store in order and writes them; it lands with Task 6's
 * `applyEvent`.
 */
import { TradeRuleError, apply, awaitingCancelConfirm, nextDeadline, type Trade, type TradeEvent } from './machine.js';
import { TIMERS, addMin } from './timers.js';

/** How often the API timer loop runs. */
export const TIMER_LOOP_MS = 5_000;

export interface TimerEvent {
  code: string;
  event: Extract<TradeEvent, { type: 'tick' | 'pause' | 'resume' | 'escalate' }>;
  /** The clock to apply it with: the loop's `now`, except a pause (see timerEvents). */
  at: Date;
}

export interface TimerPass {
  events: TimerEvent[];
  /** Trades this pass could not decide (the state machine refused them); surface each, never crash the pass. */
  skipped: { code: string; reason: string }[];
}

const checkDate = (d: Date): void => {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) throw new RangeError('bad clock');
};

const reasonOf = (e: unknown): string => (e instanceof TradeRuleError ? e.code : e instanceof RangeError ? 'bad-trade' : 'error');

/**
 * - Maintenance on: `pause` every open trade (closedAt null) not yet paused, at `maintenance_since`
 *   (or the trade's take, if later; never after now), so a loop that was down still shifts every
 *   deadline by the whole maintenance. Nothing ticks.
 * - Maintenance off: `resume` every paused trade (its deadlines move by the pause's length).
 * - Otherwise `tick` a trade whose `nextDeadline` has passed (strictly), but only when the tick
 *   changes it (a passed payBy or confirmBy only opens a client action, so ticking it every 5 s
 *   would write nothing).
 * - A `lapsed` trade still holding funds whose lapse refund was not settled within
 *   `lapseCosignMin` (strictly after lapsedAt + 30 min) → `escalate` (P3-I6, OD-2).
 * - A trade in `held` (the API: it has an open `held_trades` row, an account in a recovery-code
 *   hold) is frozen until the hold ends or a moderator decides (owner G7, G33; lead review 8 Nov
 *   C2): never resumed and never ticked. Maintenance still pauses it when it is not paused yet, and
 *   a lapse refund that was already overdue still escalates to a moderator.
 * - `locked` (J-14, owner D-059): codes of trades whose buyer or seller account is locked by a "My
 *   account has been compromised" ticket. A locked open trade is paused at `now` and stays paused
 *   (never resumed, never ticked), with or without maintenance, until it is no longer locked; then
 *   the rules above resume it. `locked` wins over `held`.
 * At most one event per trade per pass. A trade the state machine refuses is skipped and returned
 * in `skipped` with its rule code, and the pass goes on.
 */
export function timerEvents(trades: readonly Trade[], maintenanceSince: Date | null, now: Date, held: ReadonlySet<string> = new Set(), locked: ReadonlySet<string> = new Set()): TimerPass {
  checkDate(now);
  if (maintenanceSince !== null) checkDate(maintenanceSince);
  const events: TimerEvent[] = [];
  const skipped: TimerPass['skipped'] = [];
  for (const t of trades) {
    try {
      const e = locked.has(t.code) ? lockEvent(t, now) : decide(t, maintenanceSince, now, held.has(t.code));
      if (e !== null) events.push(e);
    } catch (err) {
      skipped.push({ code: t.code, reason: reasonOf(err) });
    }
  }
  return { events, skipped };
}

/** A locked trade (J-14): paused at once if it has a timer and is not paused yet, else nothing. */
function lockEvent(t: Trade, now: Date): TimerEvent | null {
  if ((t.closedAt !== null && !awaitingCancelConfirm(t)) || t.pausedAt !== null) return null;
  return { code: t.code, event: { type: 'pause' }, at: now };
}

function decide(t: Trade, maintenanceSince: Date | null, now: Date, held: boolean): TimerEvent | null {
  if (maintenanceSince !== null) {
    // A closed trade has no timer, except a buyer's cancel waiting for the seller's Confirm cancel.
    if ((t.closedAt !== null && !awaitingCancelConfirm(t)) || t.pausedAt !== null) return null;
    const from = Math.max(maintenanceSince.getTime(), t.takenAt.getTime());
    return { code: t.code, event: { type: 'pause' }, at: new Date(Math.min(from, now.getTime())) };
  }
  if (held) return t.pausedAt === null && t.state === 'lapsed' ? escalation(t, now) : null;
  if (t.pausedAt !== null) return { code: t.code, event: { type: 'resume' }, at: now };
  if (t.state === 'lapsed') return escalation(t, now);
  const due = nextDeadline(t);
  if (due === null || now.getTime() <= due.getTime()) return null;
  return apply(t, { type: 'tick' }, 'system', now) !== t ? { code: t.code, event: { type: 'tick' }, at: now } : null;
}

/** A lapsed trade still holding funds whose lapse refund was not settled in time: to a moderator. */
function escalation(t: Trade, now: Date): TimerEvent | null {
  if (t.receivedAtomic > 0n && t.lapsedAt !== null && now.getTime() > addMin(t.lapsedAt, TIMERS.lapseCosignMin).getTime()) {
    return { code: t.code, event: { type: 'escalate' }, at: now };
  }
  return null;
}
