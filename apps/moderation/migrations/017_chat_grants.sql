-- Design build task 6 (design-chat-membership-keys-2026-11-08 section 3, T1). Moderation number 017,
-- the next free one after 016.
--
-- mod_chat_grants: this process's own record of every trader grant of a chat key it accepted: the
-- grant's chat, who granted it, the grant's signature and the key's fingerprint, when. The chat key
-- itself is never stored here: the wrap stays in the API's chat_members, and this process opens it
-- again (with the chat's sealed moderator identity) each time it needs the key, checking its tkh.
-- Deleted with the chat's keys by the shred pass (section 5).
create table mod_chat_grants (
  chat text not null,
  grant_by text not null check (grant_by in ('buyer', 'seller')),
  grant_sig text not null check (grant_sig ~ '^[0-9a-f]{128}$'),
  tkh text not null check (tkh ~ '^[0-9a-f]{64}$'),
  accepted_at timestamptz not null,
  primary key (chat, grant_by, grant_sig)
);

revoke all on mod_chat_grants from public;
