-- Plan 2, Task 7: PGP login keys.
-- R16: a key's armored text is stored only encrypted (AES-256-GCM under subkey('pgp-key'), random
-- 12-byte nonce first), with user IDs stripped where the key survives it (v6). No column holds a
-- user ID, a name or an email address.
create table pgp_keys (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id) on delete cascade,
  fingerprint text unique not null check (fingerprint ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
  armored_enc bytea not null,
  created_at timestamptz not null,
  last_used_at timestamptz
);
create index pgp_keys_account on pgp_keys (account_id);
