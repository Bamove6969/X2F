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
 * A tick that is still running when the next is due makes that next tick skip. Returns `stop`.
 */
export function startRetention(
  deps: Pick<Deps, 'db' | 'clock'>,
  jobs: RetentionJob[],
  everyMs = 600_000,
  log: (e: RetentionLog) => void = jsonLine,
): () => void {
  let stopped = false;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      for (const job of jobs) {
        if (stopped) return;
        try {
          const rows = await job.run(deps.db, deps.clock());
          log({ job: job.name, rows });
        } catch {
          log({ job: job.name, failed: true });
        }
      }
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), everyMs);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
