-- Plan 3, Task 9: the moderator party's saved escrow session and the chain watcher's state.
-- Numbered 003 (review M7): 002 is Task 20's 002_chat.sql (wip/second-p3-task20-rest); Task 10's
-- 003_signals.sql moves to 004 when it re-merges this branch.
--
-- mod_escrow_state: each trade's escrow PartyState (the saved multisig wallet, its keys encrypted
--   by the trade's R27 wallet password, plus the protocol state), sealed with AES-256-GCM under
--   MOD_KEYSTORE_KEY with the trade code as associated data. The wallet password stays apart in
--   mod_wallet_secrets (R27).
-- mod_watch: one row per trade whose moderator party this service started: the escrow address all
--   three parties confirmed (ready()), when setup-done was accepted by the API, the watcher's
--   WatchState (JSON; bigints as decimal strings, dates as ISO strings) and whether it is still
--   watched (false once a closed escrow has been watched for 30 days, or it never had an escrow).
create table mod_escrow_state (
  trade text primary key,
  sealed bytea not null,
  updated_at timestamptz not null default now()
);

create table mod_watch (
  trade text primary key,
  escrow_address text,
  setup_done_at timestamptz,
  state jsonb not null,
  watching boolean not null default true,
  updated_at timestamptz not null default now()
);

revoke all on mod_escrow_state, mod_watch from public;
