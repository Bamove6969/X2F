-- Plan 3, Task 27 fix round: system-escalated disputes and the 30-day dispute retention.
--
-- A trade the timer loop escalates (late funds after it closed, or a lapse nobody refunded) is
-- disputed by 'system' with the reason 'escalated' (applyEvent writes the row with the trade).
alter table disputes drop constraint disputes_opened_by_check;
alter table disputes add constraint disputes_opened_by_check check (opened_by in ('buyer', 'seller', 'system'));
alter table disputes drop constraint disputes_reason_check;
alter table disputes add constraint disputes_reason_check check (reason in ('paid', 'silent', 'terms', 'other', 'escalated'));
alter table disputes add constraint disputes_system_reason_check check ((opened_by = 'system') = (reason = 'escalated'));

-- Dispute records are deleted 30 days after the dispute closes (spec 4.1; purgeDisputes).
alter table disputes add column closed_at timestamptz;
alter table disputes add constraint disputes_closed_at_check check ((status = 'closed') = (closed_at is not null));
create index disputes_closed_at on disputes (closed_at) where closed_at is not null;

-- Deleting a trade (the owner's self-delete and auto-delete, 2026-10-27) takes its dispute with it.
alter table disputes drop constraint disputes_code_fkey;
alter table disputes add constraint disputes_code_fkey foreign key (code) references trades (code) on delete cascade;
alter table dispute_rulings drop constraint dispute_rulings_code_fkey;
alter table dispute_rulings add constraint dispute_rulings_code_fkey foreign key (code) references disputes (code) on delete cascade;
alter table dispute_appeals drop constraint dispute_appeals_code_fkey;
alter table dispute_appeals add constraint dispute_appeals_code_fkey foreign key (code) references disputes (code) on delete cascade;
