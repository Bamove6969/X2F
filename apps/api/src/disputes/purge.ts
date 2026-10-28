import type pg from 'pg';
import type { RetentionJob } from '../retention.js';

/** A dispute's records are kept this long after it closes (spec 4.1; owner 2026-10-17). */
export const DISPUTE_RETENTION_MS = 30 * 24 * 3_600_000;

/**
 * Deletes every dispute closed more than 30 days ago with its rulings and appeal, in one
 * transaction (appeals, rulings, then the dispute). A dispute that is not closed is never touched,
 * however old. Returns the number of disputes deleted, which is all the scheduler logs.
 */
export async function purgeClosedDisputes(db: pg.Pool, now: Date): Promise<number> {
  const before = new Date(now.getTime() - DISPUTE_RETENTION_MS);
  const due = `select code from disputes where status = 'closed' and closed_at < $1`;
  const client = await db.connect();
  try {
    await client.query('begin');
    try {
      await client.query(`delete from dispute_appeals where code in (${due})`, [before]);
      await client.query(`delete from dispute_rulings where code in (${due})`, [before]);
      const { rowCount } = await client.query(`delete from disputes where status = 'closed' and closed_at < $1`, [before]);
      await client.query('commit');
      return rowCount ?? 0;
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  } finally {
    client.release();
  }
}

export const purgeDisputes: RetentionJob = { name: 'purgeDisputes', run: purgeClosedDisputes };
