-- Plan 3, Task 8: the moderation service's own database (x2f_moderation). Only the moderation
-- process connects here; the API's database role has NO grant on anything in it.
--
-- mod_party_state: each trade's moderator party state (its trade identity, participants and, from
--   Task 9, the saved escrow session), sealed with AES-256-GCM under MOD_KEYSTORE_KEY, bound to
--   the trade code as associated data.
-- mod_wallet_secrets: each trade's escrow wallet password, 32 random bytes from the OS CSPRNG,
--   sealed with AES-256-GCM under a SEPARATE subkey of MOD_KEYSTORE_KEY, in its own table apart
--   from the saved session (R27).
-- signed_terms: every attestation this service signed, kept so it is posted again unchanged after
--   a restart instead of being signed anew with a different moderator identity.
create table mod_party_state (
  trade text primary key,
  sealed bytea not null,
  updated_at timestamptz not null default now()
);

create table mod_wallet_secrets (
  trade text primary key,
  sealed bytea not null,
  created_at timestamptz not null default now()
);

create table signed_terms (
  trade text primary key,
  attestation jsonb not null,
  sig text not null,
  posted_at timestamptz,
  created_at timestamptz not null default now()
);

revoke all on mod_party_state, mod_wallet_secrets, signed_terms from public;
