-- Plan 2, Task 3: accounts. No column may hold an IP address, user agent, email or phone number.
create table accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  username_key text unique not null,
  kind text not null check (kind in ('trader', 'staff', 'owner')),
  webauthn_user_id bytea unique not null,
  payout_wait boolean not null default false,
  payout_wait_off_at timestamptz,
  had_wallet boolean not null default false,
  -- Null for staff and owner accounts (they carry no Terms version).
  terms_version text,
  terms_accepted_at timestamptz,
  created_at timestamptz not null,
  disabled_at timestamptz
);

create unique index one_owner on accounts (kind) where kind = 'owner';
