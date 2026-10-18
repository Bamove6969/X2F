-- Plan 2, Task 4: sessions, trusted devices, throttles, daily caps, challenges and alerts.
-- No column may hold an IP address, user agent, email or phone number. Tokens and device cookies
-- are stored only as hashes.
create table sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id) on delete cascade,
  token_hash bytea unique not null,
  level text not null check (level in ('full', 'recovery')),
  -- Chosen by the client (at most 60 characters), never taken from request headers.
  device_label text not null,
  onboarding_until timestamptz,
  created_at timestamptz not null,
  last_seen_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index sessions_account on sessions (account_id);

create table trusted_devices (
  account_id uuid not null references accounts (id) on delete cascade,
  device_hash bytea not null,
  created_at timestamptz not null,
  last_used_at timestamptz not null,
  primary key (account_id, device_hash)
);

create table login_throttle (
  key text primary key,
  failures int not null,
  last_failure_at timestamptz not null,
  alerted boolean not null default false
);

create table daily_counts (
  key text not null,
  day date not null,
  count int not null,
  primary key (key, day)
);

create table challenges (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts (id) on delete cascade,
  session_id uuid references sessions (id) on delete cascade,
  device_hash bytea,
  purpose text not null,
  method text not null,
  secret_hash bytea,
  webauthn_challenge text,
  payload jsonb not null default '{}',
  created_at timestamptz not null,
  expires_at timestamptz not null,
  used_at timestamptz
);
create index challenges_account on challenges (account_id);

create table alerts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id) on delete cascade,
  kind text not null,
  detail jsonb not null,
  created_at timestamptz not null,
  seen_at timestamptz
);
create index alerts_account on alerts (account_id, created_at);
