-- Plan 2 follow-up (owner, 2026-10-23, spec 6.1): a public display name and a private login name.
-- The old `username` was public, so it becomes the display name. Existing accounts get NO login
-- name (null): copying the public name into it would leave every existing account loggable by the
-- name anyone can read on the site, which is exactly what the private login name is for. Until a
-- login name is set, the name-based logins (password, security key by name, backup codes) find
-- nothing for such an account, while PGP (by key) and discoverable passkeys keep working.
-- The login name is never returned by a public route, never logged, and never shown to anyone.
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
alter table accounts add constraint accounts_login_key_key unique (login_key);
alter table accounts add constraint accounts_login_name_pair check ((login_name is null) = (login_key is null));
-- The two names must differ case-insensitively (keys are the lower-cased names).
alter table accounts add constraint accounts_names_differ check (login_key is null or login_key <> display_key);
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

insert into name_keys (key, account_id, kind) select display_key, id, 'display' from accounts;

create function accounts_name_keys() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    delete from name_keys where account_id = old.id;
  end if;
  insert into name_keys (key, account_id, kind) values (new.display_key, new.id, 'display');
  if new.login_key is not null then
    insert into name_keys (key, account_id, kind) values (new.login_key, new.id, 'login');
  end if;
  return null;
end
$$;

create trigger accounts_name_keys
  after insert or update of display_key, login_key on accounts
  for each row execute function accounts_name_keys();
