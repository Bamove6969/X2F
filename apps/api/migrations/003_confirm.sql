-- Plan 2, Task 5: single-use confirm tokens, each bound to one session and one action.
-- Only hashes are stored: SHA-256 of the token and actionHash() of the action.
create table confirm_tokens (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions (id) on delete cascade,
  account_id uuid not null references accounts (id) on delete cascade,
  token_hash bytea unique not null,
  action_hash text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  used_at timestamptz
);
create index confirm_tokens_session on confirm_tokens (session_id);
