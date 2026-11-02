-- Plan 4, Task 4: staff members (role, login hours, switched off) and the staff app's own sessions.
--
-- One row per staff or owner account. `hours` is `@x2f/staff`'s LoginHours as JSON: the string
-- "any" or { days, start, end, tz } (checked by `validateHours` before every write). The owner's
-- row always has "any" hours and can never be switched off (Global Constraints: the owner cannot
-- be switched off, demoted or given login hours). `grants` are the extra perms the owner gave this
-- person (`GRANTABLE_PERMS`, Task 30); `can()` ignores anything else stored there.
create table staff_members (
  account_id uuid primary key references accounts (id),
  role text not null check (role in ('owner', 'senior', 'mod', 'helper')),
  hours jsonb not null check (hours = '"any"'::jsonb or jsonb_typeof(hours) = 'object'),
  grants text[] not null default '{}',
  has_security_key boolean not null,
  switched_off_at timestamptz,
  joined_at timestamptz not null,
  check (role <> 'owner' or hours = '"any"'::jsonb),
  check (role <> 'owner' or switched_off_at is null)
);

-- The owner role belongs to the owner account and to no one else; every other role to a staff
-- account. Checked on every insert and update, so a role change can never make a staff member the
-- owner or put the owner's row on a staff account.
create function staff_members_kind() returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
declare
  k text;
begin
  select a.kind into k from accounts a where a.id = new.account_id;
  if k is null or (new.role = 'owner') <> (k = 'owner') or k not in ('owner', 'staff') then
    raise exception 'staff_members: the role does not match the account kind' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger staff_members_kind
  before insert or update on staff_members
  for each row execute function staff_members_kind();

-- Which app a session belongs to. The trader API (`__Host-x2f_session`) accepts only 'trader'
-- sessions and the staff API (`__Host-x2f_staff`, its own origin) only 'staff' ones, so a staff
-- session can never be used on the trader origin, nor a trader cookie on the staff origin, even
-- when its value is sent under the other cookie name. Existing sessions are trader-app sessions.
alter table sessions add column app text not null default 'trader' check (app in ('trader', 'staff'));
create index sessions_staff_live on sessions (account_id) where app = 'staff' and revoked_at is null;
