import { applyDispute, DisputeRuleError, shiftDeadlines } from '@x2f/staff';
import type { Deps } from '../app.js';
import { appendLog } from '../log/append.js';
import { tradeHeldSql } from '../tickets/held.js';
import { startRetention, type RetentionJob } from '../retention.js';
import { disputeSettings } from './settings.js';
import { withDispute, type DisputeDeps } from './store.js';

/** How often the dispute timers run (Plan 4 Task 10). */
export const DISPUTE_TIMER_MS = 30_000;

/**
 * One pass of the dispute timers, on the server clock:
 *
 * 1. **Maintenance (A7).** While `site_flags.maintenance_since` is set, every dispute not closed is
 *    marked paused from the later of `maintenance_since` and its opening, and nothing else runs:
 *    no appeal window closes during maintenance. Once maintenance is off, each paused dispute's
 *    running deadlines (reply, ruling, appeal window, comply-by) move by the time it was paused
 *    (`shiftDeadlines`), once.
 *    J-14 (owner D-059, "open trades are PAUSED (all timers stop)"): outside maintenance, a dispute
 *    whose trade's buyer or seller account is locked by a "My account has been compromised" ticket
 *    is paused the same way, from the later of the lock and its opening, and is resumed (its
 *    deadlines shifted) only once no lock holds the trade.
 * 2. **Window closed.** A published round 1 whose `appealEndsAt` has passed with no appeal
 *    becomes final (`window-closed`, by the system), logged as `ruling.final`. Coins already
 *    moved at the ruling (A1 dropped): this only ends the one chance to appeal.
 *
 * Each dispute is its own transaction (`withDispute`); one that fails is skipped and retried on the
 * next pass, and the others still run (lead review 7 Nov). The failures are thrown together once the
 * pass is over, so the scheduler still reports them. Returns the number of disputes changed.
 */
export async function runDisputeTimers(deps: DisputeDeps): Promise<number> {
  const now = deps.clock();
  const flags = await deps.db.query<{ since: Date | null }>('select maintenance_since as since from site_flags');
  const since = flags.rows[0]?.since ?? null;
  if (since !== null) {
    const r = await deps.db.query(
      `update disputes set paused_since = greatest($1::timestamptz, opened_at) where paused_since is null and status <> 'closed'`,
      [since],
    );
    return r.rowCount ?? 0;
  }
  let n = 0;
  const held = await deps.db.query(
    `update disputes d set paused_since = greatest(d.opened_at, (
         select max(l.locked_at) from account_locks l join trades t on t.code = d.code
          where l.unlocked_at is null and l.account_id in (t.seller_account_id, t.buyer_account_id)))
      where d.paused_since is null and d.status <> 'closed'
        and exists (select 1 from trades t where t.code = d.code and ${tradeHeldSql('t')})`,
  );
  n += held.rowCount ?? 0;
  const failures: unknown[] = [];
  const step = (run: () => Promise<unknown>) => stepOne(run, failures);
  const paused = await deps.db.query<{ code: string; seq: number }>(
    `select d.code, d.seq from disputes d where d.paused_since is not null
        and not exists (select 1 from trades t where t.code = d.code and ${tradeHeldSql('t')})`,
  );
  for (const p of paused.rows) {
    if (await step(() => withDispute(deps, p, async (d, client, at, rec) => {
      if (rec.pausedSince === null) return d;
      const still = await client.query(`select 1 from trades t where t.code = $1 and ${tradeHeldSql('t')}`, [d.code]);
      if ((still.rowCount ?? 0) > 0) return d;
      await client.query('update disputes set paused_since = null where code = $1 and seq = $2', [d.code, d.seq]);
      const ms = Math.max(0, at.getTime() - rec.pausedSince.getTime());
      return shiftDeadlines(d, rec.pausedSince, ms);
    }))) n++;
  }
  const due = await deps.db.query<{ code: string; seq: number }>(
    `select d.code, d.seq from disputes d where d.status = 'published' and d.appeal_ends_at <= $1 and d.paused_since is null
        and not exists (select 1 from trades t where t.code = d.code and ${tradeHeldSql('t')})`,
    [now],
  );
  for (const p of due.rows) {
    if (await step(() => withDispute(deps, p, async (d, client, at) => {
      if (d.status !== 'published' || d.appealEndsAt === null || at.getTime() < d.appealEndsAt.getTime()) return d;
      const s = await disputeSettings(client);
      const next = applyDispute(d, { type: 'window-closed' }, { kind: 'system' }, at, s);
      await appendLog(client, {
        at,
        actor: { kind: 'system' },
        tradeCode: d.code,
        action: 'ruling.final',
        detail: { rulingId: d.ruling!.id, round: 1, overturned: false },
      });
      return next;
    }))) n++;
  }
  if (failures.length > 0) throw new AggregateError(failures, `dispute timers: ${failures.length} dispute(s) failed`);
  return n;
}

/**
 * Runs one dispute's change; a rule refusal (the state moved on meanwhile) counts as no change, and
 * any other error is kept in `failures` so the rest of the pass still runs.
 */
async function stepOne(run: () => Promise<unknown>, failures: unknown[]): Promise<boolean> {
  try {
    await run();
    return true;
  } catch (err) {
    if (!(err instanceof DisputeRuleError)) failures.push(err);
    return false;
  }
}

/** The timers as a scheduler job (the scheduler logs only its name and a count, never data). */
export function disputeTimerJob(events?: DisputeDeps['events']): RetentionJob {
  return {
    name: 'disputeTimers',
    run: (db, now) => runDisputeTimers({ db, clock: () => now, ...(events ? { events } : {}) }),
  };
}

/** Starts the dispute timers every 30 seconds. Returns `stop`. */
export function startDisputeTimers(deps: Pick<Deps, 'db' | 'clock'>, events?: DisputeDeps['events']): () => Promise<void> {
  return startRetention(deps, [disputeTimerJob(events)], DISPUTE_TIMER_MS);
}
