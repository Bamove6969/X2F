-- Plan 3, Task 26: nudges (spec 2.4). Settings and blocks belong to the account that set them.
-- A nudge record says only who nudged whom and when, and lives one hour (purgeNudges): just long
-- enough for the two limits (one per sender per 10 minutes, three received per hour).

-- No row means the defaults: nudges on, no quiet hours.
create table nudge_settings (
  account_id uuid primary key references accounts (id) on delete cascade,
  enabled boolean not null default true,
  -- Minutes after local midnight in `tz`; a window with quiet_from > quiet_to crosses midnight.
  quiet_from smallint check (quiet_from between 0 and 1439),
  quiet_to smallint check (quiet_to between 0 and 1439),
  tz text check (char_length(tz) between 1 and 64),
  check ((quiet_from is null) = (quiet_to is null)),
  check (quiet_from is null or (quiet_from <> quiet_to and tz is not null))
);

-- `account_id` blocked `blocked_id`. Never shown to the blocked person.
create table account_blocks (
  account_id uuid not null references accounts (id) on delete cascade,
  blocked_id uuid not null references accounts (id) on delete cascade,
  created_at timestamptz not null,
  primary key (account_id, blocked_id),
  check (account_id <> blocked_id)
);

-- Every accepted nudge, delivered or silently dropped (a drop must still count for the sender's
-- own 10 minutes, or `too-soon` would reveal it).
create table nudges (
  id bigint generated always as identity primary key,
  from_id uuid not null references accounts (id) on delete cascade,
  to_id uuid not null references accounts (id) on delete cascade,
  sent_at timestamptz not null,
  delivered boolean not null
);

create index nudges_from on nudges (from_id, sent_at);
create index nudges_to_delivered on nudges (to_id, sent_at) where delivered;
create index nudges_sent on nudges (sent_at);
