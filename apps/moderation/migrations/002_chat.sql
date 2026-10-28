-- Plan 3, Task 20: the moderator's chat identity per chat (spec 6.6: a moderator can read a chat
-- once a dispute opens). Same rules as 001: only the moderation process connects here.
--
-- mod_chat_identities: each chat's moderator identity (secret keys included), sealed with
--   AES-256-GCM under MOD_KEYSTORE_KEY, bound to the chat code as associated data.
-- signed_chats: every chat attestation this service signed, re-posted unchanged after a restart
--   instead of being signed anew with a different moderator identity.
create table mod_chat_identities (
  chat text primary key,
  sealed bytea not null,
  created_at timestamptz not null default now()
);

create table signed_chats (
  chat text primary key,
  attestation jsonb not null,
  sig text not null,
  posted_at timestamptz,
  created_at timestamptz not null default now()
);

revoke all on mod_chat_identities, signed_chats from public;
