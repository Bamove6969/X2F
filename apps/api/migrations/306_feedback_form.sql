-- Plan 5, Task 21 (owner, 2026-10-29): the feedback form every "can't do that" popup links to
-- (spec 5.2). A complaint, feedback or a recommendation, sent named or anonymously.
--
-- Anonymous rows hold NO account id, no session, no device, no address and no refusal code (a rare
-- refusal such as a trading hold would narrow the sender down); named rows hold the account id so
-- staff can reach out for details, and the refusal code the form was opened from. Both keep only
-- the day the row arrived (not the time), and the id is random (no sequence that orders rows), so
-- an anonymous row cannot be lined up with a session's activity. Deleting an account nulls its id
-- (its named rows keep their refusal code; they were sent named). The route, not a check, keeps
-- anonymous rows free of a refusal code, so an account delete is never blocked by this table.
create table feedback_form (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('complaint', 'feedback', 'recommendation')),
  body text not null check (char_length(body) between 1 and 2000),
  account_id uuid references accounts (id) on delete set null,
  from_code text check (from_code ~ '^[a-z0-9-]{1,40}$'),
  created_on date not null
);

create index feedback_form_created on feedback_form (created_on);
