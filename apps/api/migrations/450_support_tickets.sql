-- J-14 (owner D-055, D-056, D-057, D-059; Plan 4 Task 30): support tickets, and the
-- "My account has been compromised" ticket with the account lock it starts.
--
-- A support ticket belongs to the account that opened it. For a team that is the team account, so
-- the team shares one open ticket and one daily count (owner Q69: "tickets shared"); each trader
-- message records which member wrote it. One open ticket per account until it is resolved
-- (D-055): `tickets_one_open`. "Answered" is still open: only a closed ticket is resolved.
--
-- A compromised ticket can be sent without logging in. It holds the account the typed username
-- matched (never the typed name: login names are stored only as keyed tags, migration 012), or
-- no account when it matched none, or matched an account the form never locks (staff, the owner).
-- `methods_left`: the ways to log in the sender ticked as still theirs (method kinds only, never a
-- secret). Its comment is its first message.
create table tickets (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity (start with 1001) unique,
  kind text not null check (kind in ('support', 'compromised')),
  account_id uuid references accounts (id) on delete cascade,
  category text not null check (category ~ '^[a-z-]{1,32}$'),
  trade_code text check (trade_code ~ '^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$'),
  methods_left text[] not null default '{}',
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  closed_at timestamptz,
  check ((status = 'closed') = (closed_at is not null)),
  check (kind = 'compromised' or account_id is not null),
  check ((kind = 'compromised') = (category = 'compromised')),
  check (kind = 'support' or trade_code is null),
  check (kind = 'compromised' or cardinality(methods_left) = 0)
);

create unique index tickets_one_open on tickets (account_id) where kind = 'support' and status <> 'closed';
create index tickets_account_created on tickets (account_id, created_at);
create index tickets_queue on tickets (kind, status, created_at);
create index tickets_closed on tickets (closed_at) where closed_at is not null;

-- A ticket's thread. Staff messages name the staff member (for the queue and the log, never shown
-- to the trader); a team member's message names the member.
create table ticket_messages (
  id uuid primary key default gen_random_uuid(),
  -- The thread's order (two messages can share a moment).
  seq bigint generated always as identity unique,
  ticket_id uuid not null references tickets (id) on delete cascade,
  author text not null check (author in ('trader', 'staff')),
  staff_id uuid references accounts (id) on delete set null,
  member_id uuid references team_members (id) on delete set null,
  body text not null check (char_length(body) between 1 and 4000),
  at timestamptz not null,
  check (author = 'staff' or staff_id is null),
  check (author = 'trader' or member_id is null)
);

create index ticket_messages_ticket on ticket_messages (ticket_id, seq);

-- D-059: the lock a compromised ticket puts on an account (full lockout). While a row has no
-- `unlocked_at`: `accounts.disabled_at` is set (so every login, session, offer listing, take and
-- push already refuses the account), its open trades are paused and no trader event moves them.
-- `set_disabled`: the lock set `disabled_at` itself (it was null), so the unlock clears it; a lock
-- on an account already disabled for another reason leaves it disabled on unlock.
-- Only a staff unlock (senior moderator or owner, with a key tap) ends a lock.
create table account_locks (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id) on delete cascade,
  ticket_id uuid references tickets (id) on delete set null,
  locked_at timestamptz not null,
  set_disabled boolean not null,
  unlocked_at timestamptz,
  unlocked_by uuid references accounts (id) on delete set null
);

create unique index account_locks_active on account_locks (account_id) where unlocked_at is null;
