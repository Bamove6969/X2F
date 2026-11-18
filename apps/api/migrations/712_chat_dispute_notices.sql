-- Design build task 7 (design-chat-membership-keys-2026-11-08 section 3, T2): the moderation
-- service's signed dispute notice, for a dispute no trader's own grant reached the moderator through
-- (a system escalation, or a disputer with no device holding the chat key). API number 712, after
-- 711. One notice per chat per dispute (its seq), filed exactly as moderation signed it, so every
-- trader device verifies the same bytes against the attested moderator identity. The API cannot
-- forge one: only the chat's moderator identity signs it. Goes with its chat by the same cascade as
-- the envelopes (purgeChats, as x2f_purge).
create table chat_dispute_notices (
  chat text not null references chats (code) on delete cascade,
  dispute_seq integer not null check (dispute_seq >= 1),
  notice jsonb not null,
  received_at timestamptz not null,
  primary key (chat, dispute_seq)
);

grant select, delete on chat_dispute_notices to x2f_purge;
