-- Plan 2 follow-up (owner, 2026-10-23, spec 6.1): a public display name and a private login name.
-- The old `username` was public, so it becomes the display name. Existing accounts get NO login
-- name (null): copying the public name into it would leave every existing account loggable by the
-- name anyone can read on the site, which is exactly what the private login name is for. Until a
-- login name is set, the name-based logins (password, security key by name, backup codes) find
-- nothing for such an account, while PGP (by key) and discoverable passkeys keep working.
-- The login name is never returned by a public route, never logged, and never shown to anyone.
alter table accounts rename column username to display_name;
alter table accounts rename column username_key to display_key;
alter table accounts rename constraint accounts_username_key_key to accounts_display_key_key;

alter table accounts add column login_name text;
alter table accounts add column login_key text;
alter table accounts add constraint accounts_login_key_key unique (login_key);
alter table accounts add constraint accounts_login_name_pair check ((login_name is null) = (login_key is null));
-- The two names must differ case-insensitively (keys are the lower-cased names).
alter table accounts add constraint accounts_names_differ check (login_key is null or login_key <> display_key);
