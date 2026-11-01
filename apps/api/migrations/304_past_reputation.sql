-- Plan 5, Task 10 (spec 5.5; P5-A20 to P5-A24): past reputation from other sites, proven by a
-- signature with the PGP key the archived old profile shows. A moderator approves (Task 11).
--
-- The key is kept only sealed (`key_enc`: AES-256-GCM under subkey('pgp-key') with its own AAD,
-- `x2f/pastrep-key/<fingerprint>`, so it cannot be swapped into pgp_keys), reduced by storableKey
-- (user IDs removed where the key survives it, R16). `evidence_url` is never fetched by the server.
-- The challenge itself lives in `challenges` (purpose 'past-rep') until finish.
create table past_reputation (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id) on delete cascade,
  site text not null,
  evidence_url text not null,
  claimed_trades int not null check (claimed_trades > 0),
  fingerprint text not null,
  key_enc bytea not null,
  challenge_text text not null,
  signature text not null,
  status text not null check (status in ('signed', 'approved', 'rejected', 'removed', 'revoked')),
  verified_trades int,
  reviewer_id uuid references accounts (id) on delete set null,
  decided_at timestamptz,
  reason text,
  created_at timestamptz not null
);

-- P5-A24: a fingerprint backs one live claim.
create unique index past_reputation_fingerprint_live on past_reputation (fingerprint) where status in ('signed', 'approved');
-- P5-A21: one live claim per site per account.
create unique index past_reputation_site_live on past_reputation (account_id, site) where status in ('signed', 'approved');
create index past_reputation_account on past_reputation (account_id, created_at);
create index past_reputation_status on past_reputation (status, created_at);
