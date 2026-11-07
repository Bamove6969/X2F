import type pg from 'pg';
import { withTx } from '../auth/hold.js';
import type { EventBus } from '../events/bus.js';
import { appendLog } from '../log/append.js';
import { loadStaff, withinHours } from './guard.js';
import { purgeKeyTaps } from './keyTap.js';

/** How often the sweeper looks for staff sessions outside their login hours (Plan 4 Task 4). */
export const HOURS_SWEEP_MS = 30_000;

export interface SweepDeps {
  db: pg.Pool;
  clock: () => Date;
  events: Pick<EventBus, 'closeSession'>;
}

/**
 * Ends one staff session because its login hours are over, and appends `staff.session-ended-hours`
 * (actor `system`) in the same transaction. Only the call that actually revokes the session logs,
 * so a session is logged exactly once whether the sweeper or the session's next request ends it.
 * Returns whether this call ended it.
 */
export async function endSessionForHours(deps: SweepDeps, sessionId: string, staffId: string): Promise<boolean> {
  const now = deps.clock();
  const ended = await withTx(deps.db, async (c) => {
    const r = await c.query("update sessions set revoked_at = $2 where id = $1 and app = 'staff' and revoked_at is null", [sessionId, now]);
    if ((r.rowCount ?? 0) === 0) return false;
    await appendLog(c, { at: now, actor: { kind: 'system' }, tradeCode: null, action: 'staff.session-ended-hours', detail: { staffId: staffId.toLowerCase() } });
    return true;
  });
  if (ended) deps.events.closeSession(staffId, sessionId);
  return ended;
}

/** One pass: ends every live staff-app session whose member is outside their login hours now. */
export async function sweepHours(deps: SweepDeps): Promise<number> {
  const now = deps.clock();
  const { rows } = await deps.db.query<{ id: string; account_id: string }>(
    `select s.id, s.account_id from sessions s join staff_members m on m.account_id = s.account_id
      where s.app = 'staff' and s.revoked_at is null and s.expires_at > $1 and m.role <> 'owner'`,
    [now],
  );
  let n = 0;
  for (const r of rows) {
    // Read again per session: hours changed since the select count as they are now.
    const s = await loadStaff(deps.db, r.account_id);
    if (s === null || withinHours(s, now)) continue;
    if (await endSessionForHours(deps, r.id, r.account_id)) n++;
  }
  return n;
}

/**
 * `startHoursSweeper(deps)`: every 30 s, ends the staff sessions outside their window (the owner has
 * no hours), then purges stale key taps (`purgeKeyTaps`). A failed pass is reported to `onError`
 * and the next one runs as usual.
 */
export function startHoursSweeper(deps: SweepDeps, onError: (err: unknown) => void = () => undefined, everyMs = HOURS_SWEEP_MS): { stop(): Promise<void> } {
  let running: Promise<unknown> | null = null;
  const timer = setInterval(() => {
    if (running) return;
    // RV5 m8 (lead re-review item 4): the same pass purges the taps never finished or never used.
    running = sweepHours(deps)
      .then(() => purgeKeyTaps(deps.db, deps.clock()))
      .catch(onError)
      .finally(() => {
        running = null;
      });
  }, everyMs);
  timer.unref();
  return {
    async stop() {
      clearInterval(timer);
      await running;
    },
  };
}
