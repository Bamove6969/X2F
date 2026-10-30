-- Plan 2 Task 16 (owner + design, 2026-10-29b): new-device approval with number matching, the
-- 3-device limit and "One device at a time". Traders only (lead default). No column holds an IP
-- address, a user agent or a login name; the approval's poll secret is stored only as a hash.
--
-- This runs before migration 109 on a fresh database, so the owner's `max_devices` setting has no
-- row here: a missing row means the default (3), as for every owner setting.

-- "One device at a time" (Settings -> Security -> Devices): approving a new device logs out every
-- other session of the account.
alter table accounts add column one_device boolean not null default false;

create table login_approvals (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id) on delete cascade,
  -- The new device: its device-cookie hash and the hash of the approval cookie set with this
  -- request (the poll needs both, so the approval is bound to that browser and that login).
  device_hash bytea not null,
  secret_hash bytea not null,
  -- What the approving device is shown: a coarse "Browser on Linux" style label with no digits,
  -- never the client's free text (it could say "tap 47").
  device_label text not null check (device_label !~ '[0-9]' and length(device_label) <= 40),
  -- The cleaned label the new session gets, as for any login.
  session_label text not null,
  method text not null check (method in ('pgp', 'passkey', 'security-key', 'password')),
  -- The 2-digit number the new device shows, and the three the approving device offers (the right
  -- one plus two others, shuffled), all from the OS random generator.
  number smallint not null check (number between 10 and 99),
  choices smallint[] not null check (cardinality(choices) = 3 and number = any(choices)),
  created_at timestamptz not null,
  -- Open until then; once approved, the new device must start its session before then.
  expires_at timestamptz not null,
  decided_at timestamptz,
  outcome text check (outcome in ('approved', 'blocked', 'expired')),
  -- The session that approved or blocked it.
  decided_by uuid references sessions (id) on delete set null,
  -- Set when approved: which sessions the new login ends ('one-device': all others; 'session':
  -- `end_session` only, chosen at the 3-device limit).
  ends text check (ends in ('one-device', 'session')),
  end_session uuid references sessions (id) on delete set null,
  -- When the approved login started its session (an approval starts one session, once).
  used_at timestamptz,
  check ((outcome is null) = (decided_at is null)),
  check (used_at is null or outcome = 'approved')
);
create index login_approvals_account on login_approvals (account_id, created_at);
