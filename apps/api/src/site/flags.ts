import type { Queryable } from '../db/pool.js';

/**
 * Startup check (watcher revival review M1): `site_flags` is one row (`102_offers.sql` inserts it).
 * The API refuses to start with none or several, so every reader can take "no row" as impossible:
 * the maintenance readers (trade timers, dispute timers, the cancel-return watch, the moderator's
 * watch list) all read a missing `maintenance_since` as "no maintenance", consistently.
 */
export async function assertOneSiteFlagsRow(db: Queryable): Promise<void> {
  const { rows } = await db.query<{ n: number }>('select count(*)::int as n from site_flags');
  const n = rows[0]!.n;
  if (n !== 1) throw new Error(`startup: site_flags must hold exactly one row, found ${n}; restore it (migration 102_offers.sql inserts it)`);
}
