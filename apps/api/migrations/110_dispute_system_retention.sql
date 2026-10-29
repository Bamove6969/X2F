-- Plan 3, Task 27 fix round: system-escalated disputes and when a dispute closed.
--
-- A trade the timer loop escalates (late funds after it closed, or a lapse nobody refunded) is
-- disputed by 'system' with the reason 'escalated' (applyEvent writes the row with the trade).
alter table disputes drop constraint disputes_opened_by_check;
alter table disputes add constraint disputes_opened_by_check check (opened_by in ('buyer', 'seller', 'system'));
alter table disputes drop constraint disputes_reason_check;
alter table disputes add constraint disputes_reason_check check (reason in ('paid', 'silent', 'terms', 'other', 'escalated'));
alter table disputes add constraint disputes_system_reason_check check ((opened_by = 'system') = (reason = 'escalated'));

-- When the dispute closed (Plan 4 writes 'closed'). Not the purge clock: R36 deletes a disputed
-- trade 90 days after the dispute button (opened_at), Plan 7 Task 2 / Plan 4 Task 23; nothing in
-- Plan 3 deletes a dispute.
alter table disputes add column closed_at timestamptz;
alter table disputes add constraint disputes_closed_at_check check ((status = 'closed') = (closed_at is not null));
create index disputes_closed_at on disputes (closed_at) where closed_at is not null;
