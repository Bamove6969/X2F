import { applyDispute, DisputeRuleError, shiftDeadlines } from '@x2f/staff';
import type { Deps } from '../app.js';
import { appendLog } from '../log/append.js';
import { pushOwnerAlert, type OwnerAlertDeps } from '../push/ownerAlert.js';
import { syncNoReviewerAlert } from './appeals.js';
import { startRetention, type RetentionJob } from '../retention.js';
import { disputeSettings } from './settings.js';
import { withDispute, type DisputeDeps } from './store.js';
import { runComplyLapses, runPendingProofs } from './comply.js';
import type { TxProofCheck } from './txProof.js';

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
 * 2. **Window closed.** A published round 1 whose `appealEndsAt` has passed with no appeal
 *    becomes final (`window-closed`, by the system), logged as `ruling.final`. Coins already
 *    moved at the ruling (A1 dropped): this only ends the one chance to appeal.
 *
 * 3. **No reviewer (D-011, lead call 12 Nov).** An appeal whose last eligible reviewer dropped away
 *    after filing (switched off, removed, disabled) alerts the owner, in-app and by push, once per
 *    transition into that state (`syncNoReviewerAlert`); one that has a reviewer again is unmarked.
 *    Not counted as a change.
 * 4. **Payment proofs (Plan 4 Task 12, A6).** A seller's proof still waiting for its confirmations
 *    is checked again on the node (`runPendingProofs`, only with a `txProof` check); one that
 *    reaches them applies `complied`.
 * 5. **Comply time lapsed (A6).** A `seller-sends-xmr` ruling whose comply time passed with no proof
 *    goes to a senior moderator or the owner (`runComplyLapses`: marked, logged, the owner alerted
 *    in-app and, once per pass with any lapse, by push).
 *
 * Each dispute is its own transaction (`withDispute`); one that fails is skipped and retried on the
 * next pass, and the others still run (lead review 7 Nov). The failures are thrown together once the
 * pass is over, so the scheduler still reports them. Returns the number of disputes changed.
 */
export async function runDisputeTimers(deps: DisputeDeps & { push?: OwnerAlertDeps['push']; txProof?: TxProofCheck }): Promise<number> {
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
  const failures: unknown[] = [];
  const step = (run: () => Promise<unknown>) => stepOne(run, failures);
  const paused = await deps.db.query<{ code: string; seq: number }>('select code, seq from disputes where paused_since is not null');
  for (const p of paused.rows) {
    if (await step(() => withDispute(deps, p, async (d, client, at, rec) => {
      if (rec.pausedSince === null) return d;
      await client.query('update disputes set paused_since = null where code = $1 and seq = $2', [d.code, d.seq]);
      const ms = Math.max(0, at.getTime() - rec.pausedSince.getTime());
      return shiftDeadlines(d, rec.pausedSince, ms);
    }))) n++;
  }
  const due = await deps.db.query<{ code: string; seq: number }>(
    `select code, seq from disputes where status = 'published' and appeal_ends_at <= $1 and paused_since is null`,
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
  const appealed = await deps.db.query<{ code: string; seq: number }>(
    `select code, seq from disputes where status = 'appealed' and round = 2 and paused_since is null`,
  );
  let alerts = 0;
  for (const p of appealed.rows) {
    await step(() => withDispute(deps, p, async (d, client, at) => {
      if (await syncNoReviewerAlert(client, d, at)) alerts++;
      return d;
    }));
  }
  if (alerts > 0 && deps.push) await pushOwnerAlert({ db: deps.db, push: deps.push }, 'appeal-no-reviewer').catch(() => undefined);
  n += await runPendingProofs(deps, failures);
  const lapsed = await runComplyLapses(deps, failures);
  n += lapsed;
  // Lead call (18 Nov): a lapse reaches the owner's phone too, through the owner-alert push path.
  if (lapsed > 0 && deps.push) await pushOwnerAlert({ db: deps.db, push: deps.push }, 'dispute-comply-lapsed').catch(() => undefined);
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
export function disputeTimerJob(events?: DisputeDeps['events'], push?: OwnerAlertDeps['push'], txProof?: TxProofCheck): RetentionJob {
  return {
    name: 'disputeTimers',
    run: (db, now) => runDisputeTimers({ db, clock: () => now, ...(events ? { events } : {}), ...(push ? { push } : {}), ...(txProof ? { txProof } : {}) }),
  };
}

/** Starts the dispute timers every 30 seconds. Returns `stop`. */
export function startDisputeTimers(deps: Pick<Deps, 'db' | 'clock' | 'txProof'>, events?: DisputeDeps['events'], push?: OwnerAlertDeps['push']): () => Promise<void> {
  return startRetention(deps, [disputeTimerJob(events, push, deps.txProof)], DISPUTE_TIMER_MS);
}
