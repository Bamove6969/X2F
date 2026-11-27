-- Owner decision (Jess, 26 Nov 2026), "Pool first, auto-assign if untaken": a dispute waits in the
-- pool; if nobody takes it within a set time, the dispute timer gives it to the least-busy
-- moderator on shift (apps/api/src/disputes/autoAssign.ts). Seniors and the owner can still
-- reassign.
--
-- 1. The owner's setting, on Task 8's one-row `settings` (206): how many minutes a case may sit
--    untaken (lead default 15, 1..1440 like the other minute timers) and whether auto-assign runs
--    at all (lead default on). Neither binds the moderation gate, so neither needs a key tap.
alter table settings
  add column auto_assign_min integer not null default 15 check (auto_assign_min between 1 and 1440),
  add column auto_assign_on boolean not null default true;

-- 2. On each dispute, written by the API (disputes/store.ts saveDispute, staff/members.ts
--    unassignOpenCases, disputes/autoAssign.ts), always on the server clock:
--    - `pooled_at`: when the case last went back to the pool (its assignee cleared: a switch-off, a
--      removal, or round 2 opening on an appeal). Null: it has been in the pool since it opened
--      (`opened_at`), or since the appeal (`dispute_appeals.at`) for a row older than this column.
--    - `assigned_at`: when the current assignee got it; "least recently assigned" breaks ties.
--    - `auto_assigned`: the current assignee got it from the timer, not by taking it; any other
--      change of assignee clears it ("Assigned to you automatically").
--    - `pool_alert_round`: the round whose "still unassigned past its reply deadline" alert was
--      sent to the owner and the senior moderators, so each round alerts once.
--    None refers to an account.
alter table disputes
  add column pooled_at timestamptz,
  add column assigned_at timestamptz,
  add column auto_assigned boolean not null default false,
  add column pool_alert_round smallint check (pool_alert_round in (1, 2));

-- The open pool the timer reads every 30 seconds.
create index disputes_pool on disputes (status) where assignee is null and status in ('open', 'appealed');
-- A staff member's load and their last assignment.
create index disputes_assignee on disputes (assignee, assigned_at) where assignee is not null;
-- Who is on shift: a staff session's shift that has not ended.
create index staff_shifts_running on staff_shifts (staff_id) where ended is null;
