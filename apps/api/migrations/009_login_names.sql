-- Plan 2 follow-up (owner, 2026-10-23, spec 6.1): a public display name and a private login name.
-- The old `username` was public, so it becomes the display name.
--
-- Existing accounts keep logging in by their old name (FU-A review I3): the login name is backfilled
-- with the display name and the row is marked `legacy_login_name`. A null login name instead would
-- have locked out every pre-009 password and security-key account for good (no session, so no way
-- to set one). Only while that flag is set may the two names be equal; `POST /v1/account/login-name`
-- sets a distinct private login name once and clears it, and `GET /v1/account/me` says
-- `needsLoginName: true` until then, so Security settings can ask.
-- The login name is never returned by a public route, never logged, and never shown to anyone.
--
-- Deployment: stop the API, migrate, start (not rolling-safe): the renames below break the old code
-- and the new code needs the new columns (docs/dev-setup.md).
--
-- One namespace for both names (FU-A review I1): a login name may never equal any account's display
-- key and a display name may never equal any account's login key, or a private login name would be
-- printed on the site under someone else's offers. `name_keys` holds every key of both kinds,
-- maintained by trigger in the same transaction as the account row, so two racing inserts cannot
-- both pass (the second blocks on the primary key and fails with 23505 `name_keys_pkey`).
alter table accounts rename column username to display_name;
alter table accounts rename column username_key to display_key;
alter table accounts rename constraint accounts_username_key_key to accounts_display_key_key;

alter table accounts add column login_name text;
alter table accounts add column login_key text;
alter table accounts add column legacy_login_name boolean not null default false;
update accounts set login_name = display_name, login_key = display_key, legacy_login_name = true;
alter table accounts add constraint accounts_login_key_key unique (login_key);
alter table accounts add constraint accounts_login_name_pair check ((login_name is null) = (login_key is null));
-- The two names must differ case-insensitively (keys are the lower-cased names), except on a
-- pre-009 account that has not chosen its private login name yet.
alter table accounts add constraint accounts_names_differ check (login_key is null or login_key <> display_key or legacy_login_name);
-- Keys are the lower-cased names, always (review Minor 8): a row whose key is not the lower-cased
-- name could never be found by a lookup.
alter table accounts add constraint accounts_display_key_lower check (display_key = lower(display_name));
alter table accounts add constraint accounts_login_key_lower check (login_key = lower(login_name));

create table name_keys (
  key text primary key,
  account_id uuid not null references accounts (id) on delete cascade,
  kind text not null check (kind in ('display', 'login'))
);
create index name_keys_account_id on name_keys (account_id);

-- A legacy row's login key equals its display key: the one row of kind 'display' reserves it.
insert into name_keys (key, account_id, kind) select display_key, id, 'display' from accounts;

create function accounts_name_keys() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    delete from name_keys where account_id = old.id;
  end if;
  insert into name_keys (key, account_id, kind) values (new.display_key, new.id, 'display');
  if new.login_key is not null and new.login_key <> new.display_key then
    insert into name_keys (key, account_id, kind) values (new.login_key, new.id, 'login');
  end if;
  return null;
end
$$;

create trigger accounts_name_keys
  after insert or update of display_key, login_key on accounts
  for each row execute function accounts_name_keys();
