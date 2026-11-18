-- Design build task 7 (design-chat-membership-keys-2026-11-08 section 3, T2). Moderation number 018.
--
-- mod_chat_notices: this process's own record of every dispute notice it signed: the chat, the
-- dispute seq it names, when. One per chat per dispute, so a pass never signs a second notice for
-- the same dispute. Holds no key. Deleted with the chat's keys by the shred pass (section 5).
create table mod_chat_notices (
  chat text not null,
  trade text not null,
  dispute_seq integer not null check (dispute_seq >= 1),
  issued_at timestamptz not null,
  primary key (chat, dispute_seq)
);

revoke all on mod_chat_notices from public;
