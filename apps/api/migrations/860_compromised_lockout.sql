-- D-059 (owner 30 Oct): "My account has been compromised", a full lockout started from a form
-- that needs no login; and team-member tickets (owner Q69: "keep tickets shared"). Ported from
-- J-14 (`wip/lead-support-tickets`, its migration 660) onto main's tickets (migration 811).
--
-- A compromised report is a `tickets` row of kind 'compromised' (category 'compromised'). It holds
-- the account the typed login name matched (never the typed name: login names are stored only as
-- keyed tags, migration 012), or no account when it matched none or matched an account the form
-- never locks (staff, the owner). `methods_left`: the ways to log in the sender ticked as still
-- theirs (method kinds only, never a secret). Its comment is its first message (sealed, as every
-- message). `number` is the ticket number the sender is shown (lead default, owner question pending
-- on the board "Compromised": "Does the user get a ticket number?").
alter table tickets alter column account_id drop not null;
alter table tickets add column kind text not null default 'support' check (kind in ('support', 'compromised'));
alter table tickets add column methods_left text[] not null default '{}';
alter table tickets add column number bigint generated always as identity (start with 1001) unique;
alter table tickets drop constraint tickets_category_check;
alter table tickets add constraint tickets_category_check
  check (category in ('account', 'trades', 'offers', 'wallets', 'alerts', 'everything-else', 'compromised'));
alter table tickets add constraint tickets_kind_shape check (
  ((kind = 'compromised') = (category = 'compromised'))
  and (kind = 'compromised' or account_id is not null)
  and (kind = 'support' or (trade_code is null and taken_by is null and status <> 'answered'))
  and (kind = 'compromised' or cardinality(methods_left) = 0)
);
create index tickets_compromised on tickets (created_at) where kind = 'compromised';

-- Team tickets (Q69): a ticket belongs to the team account; a trader message written by a team
-- member names the member (shown to the team, never to staff). Removing the member keeps the line.
alter table ticket_messages add column member_id uuid references team_members (id) on delete set null;
alter table ticket_messages add constraint ticket_messages_member_trader check (sender = 'trader' or member_id is null);

-- D-059: the lock a compromised report puts on an account (full lockout). While a row has no
-- `unlocked_at`: `accounts.disabled_at` is set (every login, session, offer listing, take and push
-- already refuses the account), its open trades are held (tickets/held.ts `tradeHeldSql`: paused,
-- no trader event moves them, the moderation service sees them paused, dispute timers stop).
-- `set_disabled`: the lock set `disabled_at` itself (it was null), so the unlock clears it; a lock on
-- an account already disabled for another reason leaves it disabled on unlock. Only a staff unlock
-- (accounts.freeze: a senior moderator or the owner, with a key tap) ends a lock.
create table account_locks (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id) on delete cascade,
  ticket_id uuid references tickets (id) on delete set null,
  locked_at timestamptz not null,
  set_disabled boolean not null,
  unlocked_at timestamptz,
  unlocked_by uuid references accounts (id) on delete set null,
  check (unlocked_at is null or unlocked_at >= locked_at)
);
create unique index account_locks_active on account_locks (account_id) where unlocked_at is null;
create index account_locks_lifted on account_locks (unlocked_at) where unlocked_at is not null;
