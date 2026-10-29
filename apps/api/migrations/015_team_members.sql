-- Plan 2, Task 18 (owner, 2026-10-29c; spec 6.7, R44): team members. An account (the "team
-- account", a trader) may add up to 3 members, each with roles Offers and/or Trades and a login of
-- its own. No column may hold an IP address, user agent, email or phone number.
--
-- A member's own login (login name, PGP keys, security keys, passkeys) lives on an `accounts` row
-- of the new kind 'member', so the existing login, two-factor and method code serves it. That row
-- is only a login: it never owns offers, trades, wallets or reputation, and its display name is a
-- random placeholder nobody sees. The name in chat labels is `team_members.display_name`.
--
-- A member's sessions are rows of the team account (`sessions.account_id` = the team account) with
-- `member_id` set: everything keyed by the account (holds, bans, device counts, live streams)
-- covers members too, and `requireSession` refuses a member session on every route that does not
-- name the member role it allows (fail closed).
alter table accounts drop constraint accounts_kind_check;
alter table accounts add constraint accounts_kind_check check (kind in ('trader', 'staff', 'owner', 'member'));

create table team_members (
  id uuid primary key default gen_random_uuid(),
  -- The team account (the account owner's trader account).
  account_id uuid not null references accounts (id) on delete cascade,
  -- Shown in chat labels: "Message from Team <account display name> member: <display_name>".
  display_name text not null,
  display_key text not null check (display_key = lower(display_name)),
  roles text[] not null check (roles <@ '{offers,trades}'::text[] and cardinality(roles) >= 1),
  -- SHA-256 of the one-time invite code; null once the invite is used.
  invite_hash bytea unique,
  invite_expires_at timestamptz not null,
  -- The member's own login account, set when the invite is accepted.
  member_account_id uuid unique references accounts (id) on delete cascade,
  -- When the member finished registering both login factors; until then nobody logs in as them.
  joined_at timestamptz,
  created_at timestamptz not null,
  removed_at timestamptz,
  check (member_account_id is null or member_account_id <> account_id),
  check (joined_at is null or member_account_id is not null)
);
create index team_members_account on team_members (account_id);
-- One live member (or open invite) per name in a team.
create unique index team_members_live_name on team_members (account_id, display_key) where removed_at is null;

alter table sessions add column member_id uuid references team_members (id) on delete cascade;
create index sessions_member on sessions (member_id) where member_id is not null;

-- The account owner's audit log (R44): one row per member action that has an effect, written in
-- the same transaction as the action. Append-only: the trigger below refuses every update except
-- clearing `trade_code` (R36: a trade's code goes when the trade is deleted), and every delete
-- except the cascade from deleting the team account itself.
create table team_audit (
  id bigint generated always as identity primary key,
  account_id uuid not null references accounts (id) on delete cascade,
  member_id uuid not null references team_members (id) on delete cascade,
  at timestamptz not null,
  action text not null check (action ~ '^[a-z][a-z-]{1,39}$'),
  -- No foreign key: trades (103) come after this migration. Plan 7's trade purge must null it
  -- (`forgetAuditTrade` in apps/api/src/team/audit.ts; tripwire in apps/api/test/team.test.ts).
  trade_code text,
  detail jsonb not null default '{}'
);
create index team_audit_account on team_audit (account_id, at);
create index team_audit_trade on team_audit (trade_code) where trade_code is not null;

create function team_audit_append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    -- The cascade from deleting the account has already removed the account row.
    if exists (select 1 from accounts where id = old.account_id) then
      raise exception 'team_audit is append-only';
    end if;
    return old;
  end if;
  if new.trade_code is null and old.trade_code is not null
     and new.id = old.id and new.account_id = old.account_id and new.member_id = old.member_id
     and new.at = old.at and new.action = old.action and new.detail = old.detail then
    return new;
  end if;
  raise exception 'team_audit is append-only';
end
$$;

create trigger team_audit_append_only
  before update or delete on team_audit
  for each row execute function team_audit_append_only();
