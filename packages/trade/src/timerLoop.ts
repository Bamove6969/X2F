/**
 * The API timer loop's decisions (Task 9), pure: given the open trades, the maintenance flag
 * (`site_flags.maintenance_since`) and the server's clock, which system events to apply now.
 * The loop itself (`startTimers(deps)` in apps/api, every TIMER_LOOP_MS) reads the trades,
 * applies these events through the trade store in order and writes them; it lands with Task 6's
 * `applyEvent`.
 */
import { TradeRuleError, apply, nextDeadline, type Trade, type TradeEvent } from './machine.js';
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
 * At most one event per trade per pass. A trade the state machine refuses is skipped and returned
 * in `skipped` with its rule code, and the pass goes on.
 */
export function timerEvents(trades: readonly Trade[], maintenanceSince: Date | null, now: Date): TimerPass {
  checkDate(now);
  if (maintenanceSince !== null) checkDate(maintenanceSince);
  const events: TimerEvent[] = [];
  const skipped: TimerPass['skipped'] = [];
  for (const t of trades) {
    try {
      const e = decide(t, maintenanceSince, now);
      if (e !== null) events.push(e);
    } catch (err) {
      skipped.push({ code: t.code, reason: reasonOf(err) });
    }
  }
  return { events, skipped };
}

function decide(t: Trade, maintenanceSince: Date | null, now: Date): TimerEvent | null {
  if (maintenanceSince !== null) {
    if (t.closedAt !== null || t.pausedAt !== null) return null;
    const from = Math.max(maintenanceSince.getTime(), t.takenAt.getTime());
    return { code: t.code, event: { type: 'pause' }, at: new Date(Math.min(from, now.getTime())) };
  }
  if (t.pausedAt !== null) return { code: t.code, event: { type: 'resume' }, at: now };
  if (t.state === 'lapsed') {
    if (t.receivedAtomic > 0n && t.lapsedAt !== null && now.getTime() > addMin(t.lapsedAt, TIMERS.lapseCosignMin).getTime()) {
      return { code: t.code, event: { type: 'escalate' }, at: now };
    }
    return null;
  }
  const due = nextDeadline(t);
  if (due === null || now.getTime() <= due.getTime()) return null;
  return apply(t, { type: 'tick' }, 'system', now) !== t ? { code: t.code, event: { type: 'tick' }, at: now } : null;
}
