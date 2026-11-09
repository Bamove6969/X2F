/**
 * Review L4: a typed address that was never proven (`jabber_contacts.pending_*`, possibly someone
 * else's address) is kept only `PENDING_RETENTION_MS` after its test message. The purge clears the
 * pending columns of a row that also holds a proven address (which stays and keeps its notices) and
 * deletes a row that holds nothing else. Neither is an account change (migration 331's
 * `jabber_contact_changed` only fires for the proven address), so the purge sends no notice.
 */
import type pg from 'pg';
import type { RetentionJob } from '../retention.js';

export const PENDING_RETENTION_MS = 24 * 3_600_000;

export const purgeJabberPending: RetentionJob = {
  name: 'purgeJabberPending',
  async run(db: pg.Pool, now: Date): Promise<number> {
    const before = new Date(now.getTime() - PENDING_RETENTION_MS);
    const gone = await db.query('delete from jabber_contacts where jid_sealed is null and pending_sent_at <= $1', [before]);
    const cleared = await db.query(
      `update jabber_contacts set pending_sealed = null, pending_code_hash = null, pending_sent_at = null, pending_expires_at = null, pending_tries = 0
        where pending_sealed is not null and pending_sent_at <= $1`,
      [before],
    );
    return (gone.rowCount ?? 0) + (cleared.rowCount ?? 0);
  },
};
