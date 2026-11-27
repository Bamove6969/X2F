import { autoAssignDispute, can, DisputeRuleError, type Dispute, type Perm, type StaffRole } from '@x2f/staff';
import type pg from 'pg';
import { addAlert, addOwnerAlert } from '../alerts.js';
import type { Queryable } from '../db/pool.js';
import { appendLog } from '../log/append.js';
import { pushOwnerAlert, type OwnerAlertDeps } from '../push/ownerAlert.js';
import { tradeHeldSql } from '../tickets/held.js';
import { disputeSettings } from './settings.js';
import { withDispute, type DisputeDeps } from './store.js';

/**
 * Owner decision (Jess, 26 Nov 2026), "Pool first, auto-assign if untaken". Cases wait in the pool
 * (the queue's Unassigned, where anyone may Take one); a case nobody took within the owner's
 * setting (`settings.auto_assign_min`, lead default 15 minutes; `auto_assign_on`, lead default on)
 * goes to the least-busy moderator on shift, on the dispute timer's pass (every 30 seconds).
 * Seniors and the owner can still reassign, as before.
 *
 * - **Pool time.** Since the case last became unassigned: `disputes.pooled_at` (a switch-off or
 *   removal sent it back, or round 2 opened on an appeal), else the appeal's time, else its opening.
 * - **On shift.** A staff member is on shift while one of their staff-app sessions is live with its
 *   shift running (migration 420: clock-in is the staff login, one `staff_shifts` row per staff
 *   session, `ended` set at a clock-out, a logout, a switch-off or an automatic logout; a session
 *   past `expires_at`, which already counts the idle limit, the 12-hour cap and the login-hours
 *   window, is over even before the purge records it). Not the traders' Away switch (856).
 * - **Who.** A moderator or a senior moderator (lead default, owner question: never the owner, who
 *   may still take any case; an owner who opens the staff app to change a setting is not on
 *   shift for cases), switched on, not removed, the account neither disabled nor locked by a
 *   compromised report, never the trade's buyer or seller, with a role that may handle disputes
 *   (`can(role, 'disputes.handle', grants)`), and accepted by the machine's own rules (`autoAssignDispute`:
 *   an appeal only to a senior moderator who had no part in round 1, R37). Of those,
 *   the fewest open assigned cases (open, awaiting approval or appealed); ties: least recently
 *   assigned (never assigned first), then the account id.
 * - **Races.** Each case is its own transaction (`withDispute`: the trade and dispute rows locked
 *   `for update`), and every auto-assignment also takes one site-wide advisory lock
 *   (`AUTO_ASSIGN_LOCK_KEY`), so two API processes never count loads at the same time. Under the
 *   locks the case is read again: still open or appealed, still unassigned, not paused, still past
 *   its pool time. A moderator's Take waits on the same row lock, so it either wins (the timer then
 *   sees an assignee and skips) or finds the case taken (409 `wrong-state`, as for any take race).
 * - **Nobody eligible on shift.** The case stays in the pool; the next pass after an eligible person
 *   clocks in assigns the overdue cases, oldest first, one at a time (each to the least busy then).
 *   A case still unassigned past its reply deadline alerts the owner (in-app and by push) and every
 *   senior moderator (their staff alerts, and a push), once per round (`pool_alert_round`), while
 *   auto-assign is on (off, the queue works as it did before the decision: no timer, no alert).
 * - **Clock-out or away.** A moderator's open cases stay with them (lead default; owner question).
 * - **Record.** `dispute.assigned` with `auto: true`, actor system, as the case's log entry; the
 *   assignee gets a `dispute-auto-assigned` staff alert and the generic `alert` push, and the case
 *   shows "Assigned to you automatically" until its assignee changes (`auto_assigned`).
 */

/** The advisory lock every auto-assignment takes ("x2aA"), apart from the log's and the migrations'. */
export const AUTO_ASSIGN_LOCK_KEY = 0x7832_6141;
/** At most this many cases are assigned per pass, oldest first (the rest wait for the next pass). */
export const AUTO_ASSIGN_BATCH = 200;
/** The roles the timer assigns to (lead default: not the owner; owner question). */
export const AUTO_ASSIGN_ROLES: readonly StaffRole[] = ['mod', 'senior'];
/** The statuses whose assigned cases count as a person's load (the queue's). */
const LOAD_STATUSES = ['open', 'awaiting-approval', 'appealed'];

/** SQL over a `disputes d` / `dispute_appeals ap` pair: when the case last entered the pool. */
export const POOL_SINCE_SQL = 'coalesce(d.pooled_at, ap.at, d.opened_at)';

/** SQL over `disputes d`: the trade's current dispute, waiting in the pool and running (not paused, not held). */
const IN_POOL_SQL = `d.seq = (select max(x.seq) from disputes x where x.code = d.code)
  and d.status in ('open', 'appealed') and d.assignee is null and d.paused_since is null
  and not exists (select 1 from trades t where t.code = d.code and ${tradeHeldSql('t')})`;

/** SQL over `staff_members m`, `accounts a`: switched on, not removed, not disabled or locked, on shift at `$1`. */
const ON_SHIFT_SQL = `m.switched_off_at is null and m.removed_at is null and a.disabled_at is null
  and not exists (select 1 from account_locks l where l.account_id = m.account_id and l.unlocked_at is null)
  and exists (select 1 from staff_shifts sh join sessions s on s.id = sh.session_id
               where sh.staff_id = m.account_id and sh.ended is null
                 and s.app = 'staff' and s.revoked_at is null and s.expires_at > $1)`;

export interface AutoAssignCandidate {
  id: string;
  role: StaffRole;
  grants: Perm[];
  load: number;
  lastAssignedAt: Date | null;
}

/**
 * The staff on shift at `now` who could take a case, least busy first (then least recently
 * assigned, never assigned first, then id); `exclude` are the trade's parties. The machine's rules
 * for one case are applied by the caller.
 */
export async function onShiftCandidates(q: Queryable, now: Date, exclude: readonly string[] = []): Promise<AutoAssignCandidate[]> {
  const { rows } = await q.query<{ id: string; role: StaffRole; grants: Perm[]; load: number; last_at: Date | null }>(
    `select m.account_id::text as id, m.role, m.grants::text[] as grants,
            (select count(*)::int from disputes x
              where x.assignee = m.account_id and x.status = any($2::text[])
                and x.seq = (select max(y.seq) from disputes y where y.code = x.code)) as load,
            (select max(x.assigned_at) from disputes x where x.assignee = m.account_id) as last_at
       from staff_members m join accounts a on a.id = m.account_id
      where ${ON_SHIFT_SQL} and m.role = any($4::text[]) and m.account_id::text <> all($3::text[])
      order by load, last_at asc nulls first, m.account_id`,
    [now, LOAD_STATUSES, exclude, AUTO_ASSIGN_ROLES],
  );
  return rows
    .filter((r) => can(r.role, 'disputes.handle', r.grants))
    .map((r) => ({ id: r.id, role: r.role, grants: r.grants, load: r.load, lastAssignedAt: r.last_at }));
}

/**
 * Assigns one pooled case inside its `withDispute` transaction, or returns it unchanged. The
 * assignee, the `auto_assigned` mark and `assigned_at` are written before `saveDispute` runs, so it
 * sees no change of assignee and keeps the mark (store.ts). Returns the assignee's id via `got`.
 */
async function assignOne(client: pg.PoolClient, d: Dispute, at: Date, got: (id: string) => void): Promise<Dispute> {
  await client.query('select pg_advisory_xact_lock($1)', [AUTO_ASSIGN_LOCK_KEY]);
  if ((d.status !== 'open' && d.status !== 'appealed') || d.assignee !== null) return d;
  const s = await disputeSettings(client);
  if (!s.autoAssignOn) return d;
  const { rows } = await client.query<{ since: Date; paused: boolean; held: boolean; seller: string; buyer: string; taken_at: Date }>(
    `select ${POOL_SINCE_SQL} as since, d.paused_since is not null as paused, ${tradeHeldSql('t')} as held,
            t.seller_account_id::text as seller, t.buyer_account_id::text as buyer, t.taken_at
       from disputes d join trades t on t.code = d.code
       left join dispute_appeals ap on ap.code = d.code and ap.seq = d.seq
      where d.code = $1 and d.seq = $2`,
    [d.code, d.seq],
  );
  const r = rows[0];
  if (!r || r.paused || r.held || r.since.getTime() > at.getTime() - s.autoAssignMin * 60_000) return d;
  let next: Dispute | null = null;
  let who: AutoAssignCandidate | null = null;
  for (const c of await onShiftCandidates(client, at, [r.seller, r.buyer])) {
    try {
      next = autoAssignDispute(d, c, at, s);
      who = c;
      break;
    } catch (err) {
      if (!(err instanceof DisputeRuleError)) throw err;
    }
  }
  if (next === null || who === null) return d;
  await client.query('update disputes set assignee = $3, auto_assigned = true, assigned_at = $4 where code = $1 and seq = $2', [d.code, d.seq, who.id, at]);
  await addAlert(client, who.id, 'dispute-auto-assigned', { trade: d.code }, at);
  // The log entry last: nothing after it waits on a contended lock (appendLog's rule N3).
  await appendLog(client, {
    at,
    actor: { kind: 'system' },
    tradeCode: d.code,
    action: 'dispute.assigned',
    detail: { staffId: who.id, auto: true, tradeOpenedAt: r.taken_at.toISOString() },
  });
  got(who.id);
  return next;
}

/**
 * Alerts the owner and every senior moderator, once per round, about a case still in the pool past
 * its reply deadline. Returns the seniors alerted (for their pushes), or null when nothing was sent.
 */
async function alertOverdue(client: pg.PoolClient, d: Dispute, at: Date): Promise<string[] | null> {
  if (!(await disputeSettings(client)).autoAssignOn) return null;
  if ((d.status !== 'open' && d.status !== 'appealed') || d.assignee !== null || d.replyDueAt.getTime() > at.getTime()) return null;
  const { rows } = await client.query<{ alerted: number | null; paused: boolean }>(
    'select pool_alert_round as alerted, paused_since is not null as paused from disputes where code = $1 and seq = $2',
    [d.code, d.seq],
  );
  const r = rows[0];
  if (!r || r.paused || (r.alerted !== null && r.alerted >= d.round)) return null;
  const seniors = (await client.query<{ id: string }>(
    `select m.account_id::text as id from staff_members m join accounts a on a.id = m.account_id
      where m.role = 'senior' and m.switched_off_at is null and m.removed_at is null and a.disabled_at is null
      order by m.account_id`,
  )).rows.map((x) => x.id);
  const detail = { trade: d.code, round: d.round };
  await addOwnerAlert(client, 'dispute-unassigned-overdue', detail, at);
  for (const id of seniors) await addAlert(client, id, 'dispute-unassigned-overdue', detail, at);
  await client.query('update disputes set pool_alert_round = $3 where code = $1 and seq = $2', [d.code, d.seq, d.round]);
  return seniors;
}

/**
 * The auto-assign step of the dispute timer pass (timers.ts): assigns every pooled case past its
 * pool time that someone on shift may take, oldest first, then alerts about the cases still in the
 * pool past their reply deadline. `step` runs one case's transaction as the pass does (a refusal is
 * no change; another failure is kept and the pass goes on). Returns the number of cases assigned.
 */
export async function runAutoAssign(
  deps: DisputeDeps & { push?: OwnerAlertDeps['push'] },
  step: (run: () => Promise<unknown>) => Promise<boolean>,
): Promise<number> {
  const now = deps.clock();
  const s = await disputeSettings(deps.db);
  let n = 0;
  const pushes: string[] = [];
  // Nobody on shift who may handle disputes: no case can move, so no case is locked this pass.
  if (s.autoAssignOn && (await onShiftCandidates(deps.db, now)).length > 0) {
    const due = await deps.db.query<{ code: string; seq: number }>(
      `select d.code, d.seq from disputes d left join dispute_appeals ap on ap.code = d.code and ap.seq = d.seq
        where ${IN_POOL_SQL} and ${POOL_SINCE_SQL} <= $1
        order by ${POOL_SINCE_SQL}, d.code limit ${AUTO_ASSIGN_BATCH}`,
      [new Date(now.getTime() - s.autoAssignMin * 60_000)],
    );
    for (const p of due.rows) {
      const got: { id: string | null } = { id: null };
      // Counted only once the transaction committed.
      const ok = await step(() => withDispute(deps, p, (d, client, at) => assignOne(client, d, at, (id) => (got.id = id))));
      if (ok && got.id !== null) {
        n++;
        pushes.push(got.id);
      }
    }
  }
  // The overdue alert belongs to auto-assign: with it off, the queue works as before (no alert).
  const overdue = !s.autoAssignOn ? { rows: [] } : await deps.db.query<{ code: string; seq: number }>(
    `select d.code, d.seq from disputes d
      where ${IN_POOL_SQL} and d.reply_due_at <= $1 and (d.pool_alert_round is null or d.pool_alert_round < d.round)
      order by d.reply_due_at, d.code`,
    [now],
  );
  let alerted = 0;
  for (const p of overdue.rows) {
    let seniors: string[] | null = null;
    const ok = await step(() => withDispute(deps, p, async (d, client, at) => {
      seniors = await alertOverdue(client, d, at);
      return d;
    }));
    const sent = seniors as string[] | null;
    if (ok && sent !== null) {
      alerted++;
      pushes.push(...sent);
    }
  }
  if (deps.push) {
    if (alerted > 0) await pushOwnerAlert({ db: deps.db, push: deps.push }, 'dispute-unassigned-overdue').catch(() => undefined);
    // The generic `alert` push names nothing (push/send.ts); one per person per pass.
    for (const id of new Set(pushes)) await deps.push.send(id, 'alert').catch(() => false);
  }
  return n;
}
