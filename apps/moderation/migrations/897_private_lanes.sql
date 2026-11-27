-- Owner 27 Nov (docs/security/private-mod-chat-2026-11-27.md): private moderator lanes. In a dispute
-- the moderator may talk to one trader where the other cannot read it; every staff reader this
-- process grants the chat still reads all of it (the audit path). Moderation number 897, as the API's
-- 897_chat_private_lanes. Same rules as 001: only the moderation process connects here.
--
-- mod_private_lanes: each chat's lane key PK per trader (`lane`, the trader who reads it), made here
--   on the chat's first staff grant and never by a trader or the API. `sealed` is PK under
--   MOD_KEYSTORE_KEY (AES-256-GCM, associated data `chat || '\0' || lane`, so a row moved to another
--   chat or lane fails to open); `pkh` its fingerprint (`privateKeyHash`); `record` the lane record
--   (`makePrivateLaneRecord`: PK sealed to the trader's attested box key, signed with the chat's
--   moderator identity) the API files and serves to that trader. One row per (chat, lane), first
--   insert wins: a lane key is never replaced, so every lane message stays readable.
-- mod_private_lane_seq: the next `seq` of the moderator's lane envelopes (v3) per chat and lane, as
--   mod_chat_seq for the shared one (007): taken before the envelope is signed, never reused.
-- mod_chat_access.lane: the lane of a `send` row (null: the shared chat, and every other row).
-- All of it is deleted with the chat's keys by the shred pass (design section 5).
create table mod_private_lanes (
  chat text not null,
  lane text not null check (lane in ('buyer', 'seller')),
  sealed bytea not null,
  pkh text not null check (pkh ~ '^[0-9a-f]{64}$'),
  record jsonb not null,
  created_at timestamptz not null default now(),
  primary key (chat, lane)
);

create table mod_private_lane_seq (
  chat text not null,
  lane text not null check (lane in ('buyer', 'seller')),
  next_seq bigint not null check (next_seq >= 0),
  primary key (chat, lane)
);

alter table mod_chat_access add column lane text check (lane in ('buyer', 'seller'));
alter table mod_chat_access add constraint mod_chat_access_lane_send check (lane is null or action = 'send');

revoke all on mod_private_lanes, mod_private_lane_seq from public;
