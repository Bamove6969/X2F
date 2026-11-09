-- Job 1c (J-10; owner S-094, p7-8): an account's private notes on other traders. Two team boxes:
-- "View notes on traders" and "Add notes on traders"; every added note records who (the lead, or
-- the member: `member_id`) and when; a member never deletes one (the delete route is the account
-- owner's alone). A note's text never changes once written (the trigger below).
--
-- Gone with the account that wrote it and with the trader it is about (privacy: nothing about a
-- closed account is kept). No column may hold an IP address, user agent, email or phone number.
create table trader_notes (
  id uuid primary key default gen_random_uuid(),
  -- Insertion order, for newest first when two notes share a time.
  seq bigint generated always as identity unique,
  account_id uuid not null references accounts (id) on delete cascade,
  about_account_id uuid not null references accounts (id) on delete cascade,
  -- The member who wrote it; null for the account owner (the lead).
  member_id uuid references team_members (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 1000),
  created_at timestamptz not null,
  check (about_account_id <> account_id)
);
create index trader_notes_about on trader_notes (account_id, about_account_id, created_at);

create function trader_notes_no_update() returns trigger language plpgsql as $$
begin
  raise exception 'trader_notes are never edited';
end
$$;

create trigger trader_notes_no_update
  before update on trader_notes
  for each row execute function trader_notes_no_update();
