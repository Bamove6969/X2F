import type pg from 'pg';

/** The next dispute number for a trade (108: a dispute is (code, seq); the current one is the highest seq). */
export const NEXT_SEQ = `(select coalesce(max(seq), 0) + 1 from disputes where code = $1)`;

/**
 * The dispute row for a trade the system escalated (Task 9's timer loop: late funds after the
 * trade closed, or a lapse nobody refunded). Called by applyEvent inside the escalate's own
 * transaction, with the trade row locked, so a trade is never `disputed` without a dispute row.
 *
 * It adds a new dispute (the next seq) and never deletes or rewrites an earlier one: an earlier
 * dispute's ruling, appeal and note stay exactly as they were (who lost it counts for Plan 5's
 * lost-dispute total, never the stage, R38; and the moderator of the new dispute can read them).
 */
export async function openSystemDispute(client: pg.PoolClient, code: string, now: Date): Promise<void> {
  await client.query(
    `insert into disputes (code, seq, opened_by, reason, note, opened_at, after_refund) values ($1, ${NEXT_SEQ}, 'system', 'escalated', '', $2, false)`,
    [code, now],
  );
}
