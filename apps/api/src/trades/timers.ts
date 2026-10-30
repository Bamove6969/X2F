import { timerEvents, TIMER_LOOP_MS, TradeRuleError, type TimerPass } from '@x2f/trade';
import type pg from 'pg';
import { applyEvent, rowToTrade, type TradePublisher, type TradeRow } from './store.js';

/**
 * The API timer loop (Plan 3 Task 9): every TIMER_LOOP_MS it reads the open trades, asks the pure
 * `timerEvents` which system events are due (deadline ticks, maintenance pause/resume, the lapse
 * escalation) and applies each through the trade store in order, each with its own `at` (a pause
 * is at `maintenance_since`). A trade the pure layer or the store refuses is logged by its rule
 * code and the pass goes on; a failed pass is logged and the next one runs on schedule.
 */
export interface TimerDeps {
  db: pg.Pool;
  /** The server clock (never a device's). */
  clock: () => Date;
  publish?: TradePublisher;
  /**
   * `site_flags.maintenance_since` (Plan 4 Task 8 builds that table and its switch). Until it
   * lands main.ts passes nothing and maintenance is never on (tripwire NEEDS_SITE_FLAGS).
   */
  maintenanceSince?: () => Promise<Date | null>;
  /** 0 runs no loop (tests drive `tick`). Default TIMER_LOOP_MS. */
  intervalMs?: number;
  /** Reasons and rule codes only, never addresses or amounts. */
  log?: (e: { reason: string }) => void;
}

export interface TimerHandle {
  /** One pass; resolves with what it applied and what it skipped. */
  tick(): Promise<{ applied: { code: string; type: string }[]; skipped: TimerPass['skipped'] }>;
  stop(): Promise<void>;
}

export function startTimers(deps: TimerDeps): TimerHandle {
  const log = deps.log ?? (() => {});
  const tick: TimerHandle['tick'] = async () => {
    const maintenance = deps.maintenanceSince ? await deps.maintenanceSince() : null;
    const { rows } = await deps.db.query<TradeRow>('select * from trades where closed_at is null or paused_at is not null order by code');
    const pass = timerEvents(rows.map(rowToTrade), maintenance, deps.clock());
    const applied: { code: string; type: string }[] = [];
    const skipped = [...pass.skipped];
    for (const s of pass.skipped) log({ reason: `timer-skipped-${s.reason}` });
    for (const ev of pass.events) {
      try {
        await applyEvent({ db: deps.db, clock: () => ev.at, ...(deps.publish ? { publish: deps.publish } : {}) }, ev.code, ev.event, 'system');
        applied.push({ code: ev.code, type: ev.event.type });
      } catch (e) {
        const reason = e instanceof TradeRuleError ? e.code : 'error';
        skipped.push({ code: ev.code, reason });
        log({ reason: `timer-skipped-${reason}` });
      }
    }
    return { applied, skipped };
  };

  const intervalMs = deps.intervalMs ?? TIMER_LOOP_MS;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<unknown> = Promise.resolve();
  const loop = (): void => {
    if (stopped) return;
    running = tick()
      .catch(() => log({ reason: 'timers-pass-failed' }))
      .finally(() => {
        if (!stopped) timer = setTimeout(loop, intervalMs);
      });
  };
  if (intervalMs > 0) loop();
  return {
    tick,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running.catch(() => undefined);
    },
  };
}
