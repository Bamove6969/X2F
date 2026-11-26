import { timerEvents, TIMER_LOOP_MS, TradeRuleError, type TimerPass } from '@x2f/trade';
import type pg from 'pg';
import { tradeHeldSql } from '../tickets/held.js';
import { applyEvent, rowToTrade, type TradePublisher, type TradeRow } from './store.js';

/**
 * The API timer loop (Plan 3 Task 9): every TIMER_LOOP_MS it reads the open trades (and a buyer's
 * cancel awaiting the seller's Confirm cancel, Task 39), asks the pure
 * `timerEvents` which system events are due (deadline ticks, maintenance pause/resume, the lapse
 * escalation) and applies each through the trade store in order, each with its own `at` (a pause
 * is at `maintenance_since`), never resuming or ticking a trade a recovery-code hold holds. A trade the pure layer or the store refuses is logged by its rule
 * code and the pass goes on; a failed pass is logged and the next one runs on schedule.
 */
export interface TimerDeps {
  db: pg.Pool;
  /** The server clock (never a device's). */
  clock: () => Date;
  publish?: TradePublisher;
  /**
   * `site_flags.maintenance_since` (main.ts passes `siteMaintenanceSince`; the table is
   * `102_offers.sql`'s, Plan 4's owner tools write the switch).
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

/** `site_flags.maintenance_since` (null: no maintenance, also when the row is missing). */
export async function siteMaintenanceSince(db: pg.Pool): Promise<Date | null> {
  const { rows } = await db.query<{ maintenance_since: Date | null }>('select maintenance_since from site_flags');
  return rows[0]?.maintenance_since ?? null;
}

export function startTimers(deps: TimerDeps): TimerHandle {
  const log = deps.log ?? (() => {});
  const tick: TimerHandle['tick'] = async () => {
    const maintenance = deps.maintenanceSince ? await deps.maintenanceSince() : null;
    // Open trades, paused ones, and a buyer's cancel still waiting for the seller's Confirm cancel
    // (closed, but its 48 h auto-close and maintenance still apply: `awaitingCancelConfirm`, Task 39;
    // the pure layer re-checks the rest of that rule).
    // `held`: an open `held_trades` row (an account in a recovery-code hold, trades/held.ts). Such a
    // trade stays paused until the hold ends or a moderator decides (owner G7; lead review 8 Nov C2):
    // the loop never resumes or ticks it; the hold's own sync resumes it when its last row goes.
    // D-059 (J-14, ported): `lock_held`, a buyer or seller account locked by a compromised report:
    // the pure layer pauses such a trade and never resumes it while it is locked.
    const { rows } = await deps.db.query<TradeRow & { held: boolean; lock_held: boolean }>(
      `select t.*, exists (select 1 from held_trades h where h.code = t.code and h.released_at is null) as held,
              ${tradeHeldSql('t')} as lock_held
         from trades t
        where t.closed_at is null or t.paused_at is not null
           or (t.state = 'refunded' and t.settling = 'buyer-cancel' and t.cancel_confirmed_at is null and t.dispute_by is null and t.paid_at is null)
        order by t.code`,
    );
    const held = new Set(rows.filter((r) => r.held).map((r) => r.code));
    const locked = new Set(rows.filter((r) => r.lock_held).map((r) => r.code));
    const pass = timerEvents(rows.map(rowToTrade), maintenance, deps.clock(), held, locked);
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
