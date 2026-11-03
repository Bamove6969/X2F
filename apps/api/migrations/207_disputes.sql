-- Plan 4 Task 10: the dispute machine (`@x2f/staff` Task 2) on Plan 3 Task 27's tables. Lead
-- decision 2026-10-30 (docs/coordination.md, "Plan 4 Tasks 1–3"): alter 108/110 rather than add
-- the plan's `disputes(state jsonb)`, `rulings` and `appeals` tables.
--
-- - `status` takes the machine's seven values; traders see them through `traderStatus()`
--   (`awaiting-approval` -> open, `published` -> ruled, `complying` -> final). 110's
--   `closed` <=> `closed_at` check stays.
-- - `due_at` becomes `ruling_due_at`: the current round's ruling deadline (round 1: opened +
--   RULING_DEADLINE_H; round 2: appealed + APPEAL_GOAL_H).
-- - The appeal's side and time stay in `dispute_appeals` only (its primary key is the one-appeal
--   guarantee); they are not stored twice.
-- - `ruling` / `round1` hold the machine's drafts (ids, outcome, account action, proposer,
--   approver; round 1's involved staff), never a reason text: the trader-visible ruling with its
--   reason is `dispute_rulings`, written when a ruling is published (Task 12).
-- - Staff ids carry no foreign key: they are activity-log actor ids (uuids).
-- No column holds an IP address, an address or chat text.
alter table disputes drop constraint disputes_status_check;
update disputes set status = 'published' where status = 'ruled';
alter table disputes add constraint disputes_status_check
  check (status in ('open', 'awaiting-approval', 'published', 'appealed', 'final', 'complying', 'closed'));

alter table disputes rename column due_at to ruling_due_at;

alter table disputes
  add column round smallint not null default 1 check (round in (1, 2)),
  add column assignee uuid,
  add column first_reply_at timestamptz,
  add column reply_due_at timestamptz,
  -- The USD value (cents) and the large-trade limit snapshot, both fixed when the dispute opened.
  add column usd_cents numeric(20, 0) check (usd_cents >= 0),
  add column limit_usd_cents numeric(20, 0) check (limit_usd_cents > 0),
  add column ruling jsonb check (ruling is null or jsonb_typeof(ruling) = 'object'),
  add column round1 jsonb check (round1 is null or jsonb_typeof(round1) = 'object'),
  -- Round 1's publish time, the anchor of the 48-hour appeal window (Task 24).
  add column published_at timestamptz,
  add column appeal_ends_at timestamptz,
  add column comply_by timestamptz,
  add column executed_at timestamptz,
  add column complied_at timestamptz,
  add column overturned boolean,
  -- Staff with any log entry on the case (R37's "involved").
  add column seen uuid[] not null default '{}',
  -- A7: when maintenance began for this dispute (the later of maintenance_since and opened_at);
  -- the timer shifts every running deadline by the pause when maintenance ends.
  add column paused_since timestamptz;

-- Rows from before this migration (none in production): the machine's defaults at opening.
update disputes set
  reply_due_at = opened_at + interval '4 hours',
  ruling_due_at = coalesce(ruling_due_at, opened_at + interval '48 hours'),
  usd_cents = 0,
  limit_usd_cents = 100000;

alter table disputes
  alter column reply_due_at set not null,
  alter column ruling_due_at set not null,
  alter column usd_cents set not null,
  alter column limit_usd_cents set not null,
  add constraint disputes_round2_has_round1 check ((round = 2) = (round1 is not null)),
  add constraint disputes_published_has_window check ((published_at is null) = (appeal_ends_at is null));

-- The queue: unassigned open disputes by reply deadline (the trader's queue position).
create index disputes_queue on disputes (reply_due_at) where status = 'open' and assignee is null;
-- The timer's work: appeal windows still open, and disputes paused by maintenance.
create index disputes_appeal_open on disputes (appeal_ends_at) where status = 'published';
create index disputes_paused on disputes (code) where paused_since is not null;
