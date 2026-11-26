import type pg from 'pg';
import { withTx } from '../auth/liveSession.js';
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
    // Task 33 (D-045): the end of the login hours is an automatic logout, recorded as information
    // only (no pay is calculated). The shift is marked first, so the session trigger leaves it.
    const shift = await c.query<{ id: string }>(
      `update staff_shifts sh set ended = 'auto-logout', ended_at = $2
         from sessions s
        where sh.session_id = $1 and sh.ended is null and s.id = sh.session_id and s.app = 'staff' and s.revoked_at is null
        returning sh.id`,
      [sessionId, now],
    );
    const r = await c.query("update sessions set revoked_at = $2 where id = $1 and app = 'staff' and revoked_at is null", [sessionId, now]);
    if ((r.rowCount ?? 0) === 0) return false;
    await appendLog(c, { at: now, actor: { kind: 'system' }, tradeCode: null, action: 'staff.session-ended-hours', detail: { staffId: staffId.toLowerCase() } });
    const shiftId = shift.rows[0]?.id;
    if (shiftId !== undefined) {
      await appendLog(c, { at: now, actor: { kind: 'system' }, tradeCode: null, action: 'shift.abandoned', detail: { shiftId, ended: 'auto-logout' } });
    }
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
 * One timer pass: the hours sweep, then (RV5 m8) the purge of taps never finished or never used.
 * Each runs whatever the other did (lead review 7 Nov M3: a failed sweep must not skip the purge);
 * each failure goes to `onError`.
 */
export async function sweepPass(deps: SweepDeps, onError: (err: unknown) => void): Promise<void> {
  try {
    await sweepHours(deps);
  } catch (e) {
    onError(e);
  }
  try {
    await purgeKeyTaps(deps.db, deps.clock());
  } catch (e) {
    onError(e);
  }
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
    running = sweepPass(deps, onError)
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
