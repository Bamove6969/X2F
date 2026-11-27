-- Private moderator lanes (owner 27 Nov, docs/security/private-mod-chat-2026-11-27.md). In a dispute
-- the moderator may talk to ONE trader; that trader's lane key PK is made and kept by the moderation
-- process alone, sealed to the trader in a lane record the moderator's chat identity signs. The API
-- is the courier: it files the record and the v3 envelopes, ciphertext only. API number 897.
--
-- chat_envelopes.to_role: null for a shared envelope (v1/v2, both traders read it), else the lane
-- ('buyer' or 'seller') of a v3 envelope, sent by the moderator or by that lane's trader only. The
-- seq is per (sender, lane), so the unique index takes the lane in.
alter table chat_envelopes
  add column to_role text null check (to_role in ('buyer', 'seller')),
  add constraint chat_envelopes_lane_sender check (to_role is null or sender_role in ('mod', to_role));

drop index chat_envelopes_seq;
create unique index chat_envelopes_seq on chat_envelopes (chat, sender_role, coalesce(to_role, ''), seq);

-- One lane record per trader per chat, exactly as the moderation process signed it (the trader's
-- device verifies it against the attested moderator and opens its wrap; the API cannot).
create table chat_private_lanes (
  chat text not null references chats (code) on delete cascade,
  to_role text not null check (to_role in ('buyer', 'seller')),
  pkh text not null check (pkh ~ '^[0-9a-f]{64}$'),
  record jsonb not null,
  created_at timestamptz not null,
  primary key (chat, to_role)
);

-- Goes with its chat by the same cascade as the envelopes (purgeChats, as x2f_purge), as chat_keys.
grant select, delete on chat_private_lanes to x2f_purge;
