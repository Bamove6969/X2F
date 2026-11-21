-- Plan 4 Task 27 (Revision 2026-10-29, 2026-10-29b; owner Q15 / D-017, G39 / D-020): ban stages.
-- A `trade` ban: no new trades or offers (the account's offers are hidden); open trades finish. A
-- `site` ban: the trader app answers 403 `banned` but for the notice and, while something is
-- unfinished (an open trade or dispute), what finishes it. `until` null is a lifetime ban, never
-- ended by the clock; otherwise the ban ends at `until` by the server clock (the checks read it),
-- and `settleEndedBans` writes `ended_at` and the reinstatement log entry. `lifted_at`: lifted by
-- staff before its end.
--
-- `rule_id` is D-017's rule (`@x2f/staff` BAN_RULES), `reason_code` the general reason the trader
-- sees; `note` is staff-only and never logged (the activity log holds no staff notes) nor shown to
-- the trader. A row outlives nothing but its account: earlier bans are the offence count D-017
-- reads. 770 (first written as 560 on wip/lead-bans; renumbered after main's 760 when brought onto main).
create table account_bans (
  id uuid primary key,
  account_id uuid not null references accounts (id) on delete cascade,
  kind text not null check (kind in ('trade', 'site')),
  rule_id text not null check (rule_id ~ '^[a-z][a-z-]{0,63}$'),
  reason_code text not null check (reason_code in ('terms', 'trade-problems', 'abuse', 'account-security')),
  until timestamptz,
  note text check (note is null or char_length(note) <= 500),
  placed_by uuid not null references accounts (id),
  tap_id uuid unique references key_taps (id),
  created_at timestamptz not null,
  ended_at timestamptz,
  lifted_at timestamptz,
  lifted_by uuid references accounts (id),
  check (until is null or until > created_at),
  check (ended_at is null or (until is not null and ended_at >= until)),
  check (ended_at is null or lifted_at is null),
  check (lifted_by is null or lifted_at is not null)
);
-- One standing ban of each kind per account (a new one waits for the old to end or be lifted).
create unique index account_bans_one_standing on account_bans (account_id, kind) where ended_at is null and lifted_at is null;
create index account_bans_due on account_bans (until) where ended_at is null and lifted_at is null and until is not null;

-- Owner rule p5-7: a ban placed, ended or lifted is a change to the account (jabber/changePaths.ts).
create trigger jabber_note_change after insert or update or delete on account_bans for each row
  execute function jabber_note_change('account_id');
