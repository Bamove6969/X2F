/**
 * The API timer loop's decisions (Task 9), pure: given the open trades, the maintenance flag
 * (`site_flags.maintenance_since`) and the server's clock, which system events to apply now.
 * The loop itself (`startTimers(deps)` in apps/api, every TIMER_LOOP_MS) reads the trades,
 * applies these events through the trade store in order and writes them; it lands with Task 6's
 * `applyEvent`.
 */
import { apply, nextDeadline, type Trade, type TradeEvent } from './machine.js';
import { TIMERS, addMin } from './timers.js';

/** How often the API timer loop runs. */
export const TIMER_LOOP_MS = 5_000;

export interface TimerEvent {
  code: string;
  event: Extract<TradeEvent, { type: 'tick' | 'pause' | 'resume' | 'escalate' }>;
}

const checkDate = (d: Date): void => {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) throw new RangeError('bad clock');
};

/**
 * - Maintenance on: `pause` every open trade (closedAt null) not yet paused; nothing ticks.
 * - Maintenance off: `resume` every paused trade (its deadlines move by the pause's length).
 * - Otherwise `tick` a trade whose `nextDeadline` has passed (strictly), but only when the tick
 *   changes it (a passed payBy or confirmBy only opens a client action, so ticking it every 5 s
 *   would write nothing).
 * - A `lapsed` trade still holding funds whose lapse refund was not settled within
 *   `lapseCosignMin` (strictly after lapsedAt + 30 min) → `escalate` (P3-I6, OD-2).
 * At most one event per trade per pass.
 */
export function timerEvents(trades: readonly Trade[], maintenanceSince: Date | null, now: Date): TimerEvent[] {
  checkDate(now);
  if (maintenanceSince !== null) checkDate(maintenanceSince);
  const out: TimerEvent[] = [];
  for (const t of trades) {
    if (maintenanceSince !== null) {
      if (t.closedAt === null && t.pausedAt === null) out.push({ code: t.code, event: { type: 'pause' } });
      continue;
    }
    if (t.pausedAt !== null) {
      out.push({ code: t.code, event: { type: 'resume' } });
      continue;
    }
    if (t.state === 'lapsed') {
      if (t.receivedAtomic > 0n && t.lapsedAt !== null && now.getTime() > addMin(t.lapsedAt, TIMERS.lapseCosignMin).getTime()) {
        out.push({ code: t.code, event: { type: 'escalate' } });
      }
      continue;
    }
    const due = nextDeadline(t);
    if (due === null || now.getTime() <= due.getTime()) continue;
    if (apply(t, { type: 'tick' }, 'system', now) !== t) out.push({ code: t.code, event: { type: 'tick' } });
  }
  return out;
}
