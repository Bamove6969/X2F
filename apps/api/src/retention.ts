import type pg from 'pg';
import type { Deps } from './app.js';

/** A purge job: deletes or nulls what has outlived its retention and returns the rows touched. */
export type RetentionJob = { name: string; run(db: pg.Pool, now: Date): Promise<number> };

/** The only things the scheduler ever logs: a job name and a row count, or that it failed. */
export type RetentionLog = { job: string; rows: number } | { job: string; failed: true };

const jsonLine = (e: RetentionLog) => process.stdout.write(`${JSON.stringify(e)}\n`);

/**
 * Runs every job in order each tick (default 10 minutes). One job's failure is logged as
 * `{ job, failed: true }` (never the error, which may quote data) and does not stop the others.
 * A tick that is still running when the next is due makes that next tick skip. Returns `stop`,
 * which starts no further job and resolves once the job in flight (if any) has finished, so the
 * caller can then close the pool.
 */
export function startRetention(
  deps: Pick<Deps, 'db' | 'clock'>,
  jobs: RetentionJob[],
  everyMs = 600_000,
  log: (e: RetentionLog) => void = jsonLine,
): () => Promise<void> {
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  const run = async () => {
    for (const job of jobs) {
      if (stopped) return;
      try {
        const rows = await job.run(deps.db, deps.clock());
        log({ job: job.name, rows });
      } catch {
        log({ job: job.name, failed: true });
      }
    }
  };
  const tick = () => {
    if (inFlight || stopped) return;
    // run() may settle synchronously (no jobs, or jobs that throw at once), so it is cleared
    // through the promise rather than inside run(), which would leave a stale settled promise.
    const p = run();
    inFlight = p;
    void p.finally(() => {
      if (inFlight === p) inFlight = null;
    });
  };
  const timer = setInterval(tick, everyMs);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await inFlight;
  };
}
