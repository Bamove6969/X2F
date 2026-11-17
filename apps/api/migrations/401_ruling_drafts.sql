-- Plan 4 Task 12 (J-06, in its reserved 400-409): what a moderator proposed, as they wrote it.
--
-- The machine's draft (`disputes.ruling`, 207) holds ids, the outcome and the account action only,
-- never a reason. The reason and evidence lines a proposal carries are kept here, staff-only, until
-- the ruling is published, when they are copied to the trader-visible `dispute_rulings` (108). The
-- approver reads them here, and the approval tap binds the same reason (its SHA-256, the
-- `reasonSha256` of the `ruling` key-tap intent), so a reason cannot change between the two taps.
--
-- - `status`: `proposed` until decided; `published` once it is the dispute's ruling; `sent-back`
--   when an approver returned it (with `sent_back_note`, staff-only, for the proposer).
-- - Staff ids carry no foreign key (activity-log actor ids, as in 207).
-- - No column holds an address, chat text or an IP address.
-- - Deleted with the dispute by the dispute purge (Plan 4 Task 23 deletes this table before
--   `disputes`, as it does `dispute_rulings`).
create table ruling_drafts (
  ruling_id uuid primary key,
  code text not null,
  seq smallint not null,
  round smallint not null check (round in (1, 2)),
  reason text not null check (char_length(reason) between 40 and 4000),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'array'),
  proposer uuid not null,
  proposed_at timestamptz not null,
  status text not null default 'proposed' check (status in ('proposed', 'published', 'sent-back')),
  decided_by uuid,
  decided_at timestamptz,
  sent_back_note text check (sent_back_note is null or char_length(sent_back_note) between 1 and 1000),
  foreign key (code, seq) references disputes (code, seq),
  check ((status = 'proposed') = (decided_at is null)),
  check ((status = 'sent-back') = (sent_back_note is not null))
);

-- At most one proposal waiting per dispute round (the machine holds one draft at a time).
create unique index ruling_drafts_one_waiting on ruling_drafts (code, seq, round) where status = 'proposed';
create index ruling_drafts_case on ruling_drafts (code, seq, proposed_at);
