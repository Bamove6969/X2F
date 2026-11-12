import { appealReviewers, type Dispute, type StaffRole } from '@x2f/staff';
import { addOwnerAlert } from '../alerts.js';
import type { Queryable } from '../db/pool.js';
import { PUBLIC_NAME_COLUMN } from '../events/publicName.js';

/**
 * Plan 4 Task 24, the owner's appeal rules that read more than the dispute row:
 *
 * - D-005: a File appeal button on the completed-trades list and on the trade page, gone at the
 *   deadline. `appealOpenUntil` is the deadline the trade view carries while an appeal can still
 *   be filed: a published round-1 ruling, no appeal yet, strictly before `appealEndsAt` (the same
 *   rule the machine applies to the appeal itself).
 * - D-011 (lead default, 28 Oct): when nobody may review an appeal (every senior moderator and the
 *   owner was involved in round 1, R37, or none is switched on), the appeal waits in the queue, the
 *   owner is alerted (`appeal-no-reviewer`, at filing) and the traders are told (`appealWaiting`).
 *   Nobody involved is ever let in instead: there is no fallback (R37).
 */

export interface ReviewerCandidate {
  id: string;
  role: StaffRole;
  name: string;
}

/**
 * The senior moderators and the owner who could review an appeal today: switched on, not removed,
 * their account not disabled. Login hours are not checked: someone outside their hours now can
 * still review within the 48 hours.
 */
export async function reviewerCandidates(q: Queryable): Promise<ReviewerCandidate[]> {
  const { rows } = await q.query<{ id: string; role: StaffRole; name: string }>(
    `select m.account_id::text as id, m.role, a.${PUBLIC_NAME_COLUMN} as name
       from staff_members m join accounts a on a.id = m.account_id
      where m.role in ('senior', 'owner') and m.switched_off_at is null and m.removed_at is null and a.disabled_at is null
      order by m.joined_at, m.account_id`,
  );
  return rows;
}

/** Who may review this dispute's appeal (R37's `involved`, frozen at the appeal, is left out). */
export async function eligibleReviewers(q: Queryable, d: Pick<Dispute, 'round1'>): Promise<ReviewerCandidate[]> {
  const all = await reviewerCandidates(q);
  const ids = new Set(appealReviewers(all, d.round1?.involved ?? []));
  return all.filter((s) => ids.has(s.id));
}

/**
 * D-011: whether this dispute's appeal is waiting for an independent reviewer: the appeal round
 * with no ruling proposed, and nobody eligible exists. An assignee who is still eligible is in the
 * list, so a taken case waits only once its assignee can no longer review (switched off, removed,
 * disabled) and nobody else can.
 */
export async function appealWaiting(q: Queryable, d: Pick<Dispute, 'round' | 'status' | 'round1'>): Promise<boolean> {
  if (d.round !== 2 || d.status !== 'appealed') return false;
  return (await eligibleReviewers(q, d)).length === 0;
}

/**
 * D-011, idempotent (lead call 12 Nov): brings `disputes.no_reviewer_alerted_at` in line with
 * whether the appeal waits, on `client` inside the dispute's locked transaction. Entering the
 * no-reviewer state writes the owner's `appeal-no-reviewer` alert and marks the row, once; leaving
 * it clears the mark, so a later loss alerts again. Returns true when an alert was written (the
 * caller pushes after the commit).
 */
export async function syncNoReviewerAlert(q: Queryable, d: Pick<Dispute, 'code' | 'seq' | 'round' | 'status' | 'round1'>, now: Date): Promise<boolean> {
  const waiting = await appealWaiting(q, d);
  const { rows } = await q.query<{ at: Date | null }>('select no_reviewer_alerted_at as at from disputes where code = $1 and seq = $2', [d.code, d.seq]);
  const alerted = (rows[0]?.at ?? null) !== null;
  if (waiting && !alerted) {
    await addOwnerAlert(q, 'appeal-no-reviewer', { trade: d.code }, now);
    await q.query('update disputes set no_reviewer_alerted_at = $3 where code = $1 and seq = $2', [d.code, d.seq, now]);
    return true;
  }
  if (!waiting && alerted) await q.query('update disputes set no_reviewer_alerted_at = null where code = $1 and seq = $2', [d.code, d.seq]);
  return false;
}

/** D-005: until when an appeal can still be filed on the trade's current dispute, or null. */
export async function appealOpenUntil(q: Queryable, code: string, now: Date): Promise<Date | null> {
  const { rows } = await q.query<{ until: Date }>(
    `select d.appeal_ends_at as until from disputes d
      where d.code = $1 and d.seq = (select max(x.seq) from disputes x where x.code = $1)
        and d.status = 'published' and d.round = 1 and d.appeal_ends_at > $2
        and not exists (select 1 from dispute_appeals a where a.code = d.code and a.seq = d.seq)`,
    [code, now],
  );
  return rows[0]?.until ?? null;
}
