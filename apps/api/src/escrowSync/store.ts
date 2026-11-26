/**
 * Escrow-key sync storage helpers (migration 860; routes.ts has the whole design). Kept apart from
 * the routes so team/members.ts can drop a member's copies without importing the routes.
 */
import type pg from 'pg';
import type { Queryable } from '../db/pool.js';
import type { RetentionJob } from '../retention.js';

/** The box that is the lead's assignment of a member as a reader of the trade keys (team/abilities.ts row 67). */
export const ESCROW_KEYS_ABILITY = 'trades-escrow-keys';

/** How long a closed trade's copy may stay: the device's own rule (web escrow/runtime.ts KEEP_AFTER_CLOSE_MS). */
export const ESCROW_COPY_KEEP_AFTER_CLOSE_MS = 30 * 24 * 60 * 60 * 1000;

/** Deletes every wrapped trade key sealed to the member's reader key (the box was unticked). */
export async function dropMemberWraps(c: Queryable, memberId: string): Promise<void> {
  await c.query('delete from escrow_blob_wraps where reader_id in (select id from escrow_readers where member_id = $1)', [memberId]);
}

/**
 * Retention backstop (every 10 minutes with the other jobs): deletes the server copy of every trade
 * that is gone (purged) or closed longer ago than the device keeps its own record. The device
 * deletes its copy itself when it deletes the local record; this catches a device that never came
 * back. Returns the copies deleted (their wraps go by cascade).
 */
export const purgeEscrowBlobs: RetentionJob = {
  name: 'purgeEscrowBlobs',
  async run(db: pg.Pool, now: Date): Promise<number> {
    const r = await db.query(
      `delete from escrow_blobs b
        where not exists (select 1 from trades t where t.code = b.trade_code)
           or exists (select 1 from trades t where t.code = b.trade_code and t.closed_at is not null and t.closed_at <= $1)`,
      [new Date(now.getTime() - ESCROW_COPY_KEEP_AFTER_CLOSE_MS)],
    );
    return r.rowCount ?? 0;
  },
};
