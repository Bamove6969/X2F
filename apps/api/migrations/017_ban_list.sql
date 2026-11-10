-- Owner, 2 Nov 2026 (docs/design-hold-model-2026-11-02.md, "Ban list"): when an account is banned,
-- its usernames (display name and login name), its PGP key fingerprints (the primary key and every
-- subkey) and its secure Jabber account are recorded, and none of them can ever be used again: not
-- at sign-up, not as a new key, not at Jabber setup. Not tracked, and no column may hold them:
-- Monero addresses, payment details, IP addresses, device fingerprints.
--
-- Each value is stored only as a keyed tag, as login names are since FU-D: HMAC-SHA-256 under one
-- key of X2F_LOGIN_NAME_KEYS (`tag_key_id`), checked under every key of the ring. Names use the
-- login-name tag itself (apps/api/src/accounts.ts `loginTag`), so a banned account's login tag is
-- copied as it is; fingerprints and Jabber addresses use their own domain-separated tag
-- (apps/api/src/bans.ts `banTag`). Retiring a ring key retires the bans tagged under it (there
-- is no plaintext to re-tag them from): keep old keys in the ring.
--
-- The ban action itself is staff-side (Plan 4) and calls `recordBan` (bans.ts). A row outlives
-- its account (`on delete set null`): a ban is forever.
create table banned_identifiers (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('display-name', 'login-name', 'pgp-fingerprint', 'jabber')),
  tag_key_id smallint not null,
  tag bytea not null check (octet_length(tag) = 32),
  account_id uuid references accounts (id) on delete set null,
  banned_at timestamptz not null,
  unique (kind, tag_key_id, tag)
);
create index banned_identifiers_tag on banned_identifiers (tag_key_id, tag);
