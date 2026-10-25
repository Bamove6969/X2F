-- Plan 2 follow-up FU-C (owner, 2026-10-23): stored secrets get extra protection before launch.

-- Passwords: Argon2id of HMAC-SHA-256(pepper, NFC password), the pepper picked by `pepper_id` from
-- X2F_PASSWORD_PEPPERS. Null marks a hash from before this migration (Argon2id of the NFC password,
-- no pepper); it is still accepted and is rehashed under the current pepper at the next successful
-- password check. `select count(*) from passwords where pepper_id is null` shows how many are left.
alter table passwords add column pepper_id smallint check (pepper_id between 1 and 32767);

-- Recovery codes: HMAC-SHA-256 under the X2F_RECOVERY_CODE_KEYS key `key_id`, bound to the account.
-- Null marks a code from before this migration (plain SHA-256 of the normalized code). Those cannot
-- be converted (only their hash is stored); they keep working until used or until the set is
-- regenerated, and `select count(distinct account_id) from recovery_codes where key_id is null`
-- shows the accounts still holding such a set.
alter table recovery_codes add column key_id smallint check (key_id between 1 and 32767);

-- TOTP secrets: every sealed blob now starts with a format byte. 0x00 marks a secret sealed before
-- this migration (under subkey('totp') of X2F_SERVER_KEY); 0x01 is the key-store format (key id
-- from X2F_TOTP_KEYS in the header). `npm run rewrap-totp -w @x2f/api` moves every blob to the
-- current key.
update totp set secret_enc = '\x00'::bytea || secret_enc;
-- Enrolments in flight hold an unmarked sealed secret in their payload; they live 5 minutes, so
-- they are simply ended (the person starts the enrolment again).
update challenges set used_at = now() where purpose = 'add-totp' and used_at is null;
