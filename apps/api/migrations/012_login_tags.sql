-- Plan 2 follow-up FU-D (owner, 2026-10-25): the private login name is stored only as a keyed tag,
-- so a stolen database holds no login names.
--
-- login_tag = HMAC-SHA-256 under the X2F_LOGIN_NAME_KEYS key `login_tag_key_id` of
-- "x2f/login-name\0" || the lower-cased NFC login name. A login looks the name up under every key in
-- the ring and moves the row to the current key on success (apps/api/src/accounts.ts).
--
-- Step 1 (this migration): the new columns. SQL has no key, so existing plaintext rows are tagged by
-- the app: stop the API, migrate, run `npm run tag-login-names -w @x2f/api` (it tags every row that
-- still holds `login_key` and nulls `login_name` / `login_key` in the same update; the `name_keys`
-- trigger from 009 then drops the row's plaintext `login` entry), then start the API again. The API
-- refuses to start while any row still holds a plaintext login name. A pre-009 account
-- (`legacy_login_name`, login key = its display key) is tagged the same way and keeps logging in by
-- its display name until it sets a private one.
-- Step 2 (a later migration, once `select count(*) from accounts where login_key is not null` is 0
-- on every deployment): drop `login_name` and `login_key` with their constraints, and `name_keys`
-- with its trigger (it then only repeats `accounts_display_key_key`).
alter table accounts add column login_tag bytea;
alter table accounts add column login_tag_key_id smallint check (login_tag_key_id between 1 and 32767);
-- One account per tag. Tags made under different keys never collide, so this alone does not stop
-- one name being held twice under two keys, and SQL cannot see that a login name equals another
-- account's display name any more (FU-A review I1). Every write of a name therefore takes one
-- advisory lock and checks the name in both namespaces under every key in the ring first
-- (`createAccount`, `setLoginName`).
alter table accounts add constraint accounts_login_tag_key unique (login_tag);
alter table accounts add constraint accounts_login_tag_pair check ((login_tag is null) = (login_tag_key_id is null));
-- A row holds its login name in one form only: the tag, or (until the tool has run) the plaintext.
alter table accounts add constraint accounts_login_one_form check (login_tag is null or login_key is null);
-- `accounts_names_differ` stays for rows not tagged yet; for tagged rows the app checks that the
-- names differ when it creates the account or sets the login name.

-- Sign-ups waiting in a challenge kept the plaintext login name in their payload (FU-A review
-- note 1). From now on it is sealed there (`sealNames`); the old ones are ended (they last
-- minutes, and one without a sealed name could not finish anyway). Expired ones that the purge has
-- not reached yet go too.
delete from challenges where purpose = 'register' and payload ? 'names';
