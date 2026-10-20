-- Plan 2, Task 9: TOTP, recovery codes and the backup login hold.
-- The TOTP secret is stored only sealed (AES-256-GCM under subkey('totp'), random 12-byte nonce
-- first); recovery codes only as SHA-256 of the normalized code.
create table totp (
  account_id uuid primary key references accounts (id) on delete cascade,
  secret_enc bytea not null,
  -- The last accepted 30-second step; a code is accepted only for a later step (no replay).
  last_step bigint not null default 0,
  created_at timestamptz not null
);

create table recovery_codes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id) on delete cascade,
  code_hash bytea unique not null,
  used_at timestamptz
);
create index recovery_codes_account on recovery_codes (account_id);

-- A TOTP-only backup login opens a recovery session that may not add a primary method before this.
alter table sessions add column hold_until timestamptz;
