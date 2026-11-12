import type { Queryable } from '../db/pool.js';

/**
 * Plan 4 Task 12: what `GET /staff/v1/disputes/:code` (and each ruling route's answer) shows of the
 * current round's proposals (`ruling_drafts`, migration 401), staff-only: the proposal waiting for
 * approval, with its reason and evidence for the approver to read, and the latest send-back with
 * its note for the proposer.
 */
/** What `GET /staff/v1/disputes/:code` adds under `ruling` (Task 12): the proposal and the send-back. */
export async function rulingExtras(db: Queryable, code: string) {
  const { rows } = await db.query<{ ruling_id: string; status: string; reason: string; evidence: string[]; proposer: string; proposed_at: Date; decided_at: Date | null; sent_back_note: string | null; dstatus: string }>(
    `select r.ruling_id::text, r.status, r.reason, r.evidence, r.proposer::text, r.proposed_at, r.decided_at, r.sent_back_note, d.status as dstatus
       from ruling_drafts r join disputes d on d.code = r.code and d.seq = r.seq
      where r.code = $1 and r.seq = (select max(seq) from disputes where code = $1) and r.round = d.round
      order by r.proposed_at desc, r.ruling_id limit 1`,
    [code],
  );
  const r = rows[0];
  const proposal = r && r.status === 'proposed'
    ? { rulingId: r.ruling_id, reason: r.reason, evidence: r.evidence, proposer: r.proposer, proposedAt: r.proposed_at.toISOString() }
    : null;
  const sentBack = r && r.status === 'sent-back' && r.dstatus !== 'awaiting-approval'
    ? { rulingId: r.ruling_id, note: r.sent_back_note, at: r.decided_at!.toISOString() }
    : null;
  return { proposal, sentBack };
}
