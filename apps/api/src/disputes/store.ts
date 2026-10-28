import type pg from 'pg';

/**
 * The dispute row for a trade the system escalated (Task 9's timer loop: late funds after the
 * trade closed, or a lapse nobody refunded). Called by applyEvent inside the escalate's own
 * transaction, so a trade is never `disputed` without a dispute row.
 *
 * One dispute row per trade (108_disputes.sql). Escalate only moves a trade that is not in
 * dispute, so an existing row belongs to an earlier dispute that is over: it is replaced by the
 * new one, with its rulings and appeal, so the traders never see the old dispute as current.
 * (Plan 4: if earlier disputes must outlive a re-escalation, give disputes their own id.)
 */
export async function openSystemDispute(client: pg.PoolClient, code: string, now: Date): Promise<void> {
  await client.query('delete from dispute_appeals where code = $1', [code]);
  await client.query('delete from dispute_rulings where code = $1', [code]);
  await client.query(
    `insert into disputes (code, opened_by, reason, note, opened_at, after_refund) values ($1, 'system', 'escalated', '', $2, false)
     on conflict (code) do update set opened_by = 'system', reason = 'escalated', note = '', opened_at = $2, after_refund = false,
       due_at = null, status = 'open', moderator_name = null, moderator_joined_at = null, closed_at = null`,
    [code, now],
  );
}
