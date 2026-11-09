-- The moderation shred pass (design-chat-membership-keys-2026-11-08 section 5, build task 1): when
-- the API purges a chat, this service deletes its sealed moderator chat identity and the signed
-- attestation (mod_chat_identities, signed_chats). The API's purge list is only a trigger; this
-- service keeps its own clock from the dispute facts it already gets.
--
-- mod_dispute_seen: every trade the API's watch list showed `disputed`, with the first and last
--   time this service saw it so (its own clock). A chat linked to a trade seen disputed within
--   CHAT_AFTER_DISPUTE_DAYS is never shredded, whatever the API says, so a compromised API cannot
--   get a dispute's evidence destroyed mid-case. Rows go once last_seen_at is past
--   MOD_DISPUTE_SEEN_DAYS.
create table mod_dispute_seen (
  trade text primary key,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null
);

revoke all on mod_dispute_seen from public;
