-- Security review of wip/lead-vendor, 8 Nov 2026 (review-vendor-2026-11-08.md).
--
-- I1: a ban covers only the parts of a PGP key the banned account has shown it controls: the
-- primary key, every subkey a code was encrypted to and proved (`proved_subkeys`, lower-case hex
-- fingerprints, added at each proof: sign-up, join, added key, login), and signing subkeys with a
-- valid binding and back-signature (read from the key itself). A subkey someone appended to their
-- own key (another person's key, say) is never banned through them. Rows from before this file have
-- no proved subkeys; their primary and signed-back subkeys still count.
alter table pgp_keys add column proved_subkeys text[] not null default '{}';

-- M2: the 60-day close deletes an account's PGP keys (owner G14: the person may reuse a key on a
-- new account), but a ban recorded later must still cover them. The close keeps, for each key, the
-- fingerprints a ban would record (as above), only as keyed tags (bans.ts `banTag` under one key of
-- X2F_LOGIN_NAME_KEYS, as in 017); `recordBan` copies them onto the ban list. Nothing else reads them,
-- and nothing checks a new key against them (a reused key is allowed).
create table closed_account_keys (
  account_id uuid not null references accounts (id) on delete cascade,
  tag_key_id smallint not null,
  tag bytea not null check (octet_length(tag) = 32),
  closed_at timestamptz not null,
  primary key (account_id, tag_key_id, tag)
);

-- M1: when one pass of the 60-day close finds more due accounts than its cap, the close switches
-- itself off (`auto_close_off_at`) and alerts the owner; no pass closes anything until the owner
-- turns it back on (POST /staff/v1/site/auto-close/resume).
alter table site_flags add column auto_close_off_at timestamptz;
