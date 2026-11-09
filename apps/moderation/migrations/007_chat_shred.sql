-- The moderation shred pass (design-chat-membership-keys-2026-11-08 section 5, build task 1): when
-- the API purges a chat, this service deletes its sealed moderator chat identity and the signed
-- attestation (mod_chat_identities, signed_chats). The API's purge list is only a trigger; this
-- service keeps its own clock and its own record of which chat belongs to which trade, from the
-- watch list reads and its own escalation reports.
--
-- mod_dispute_seen: every trade the API's watch list showed `disputed`, or that this service
--   escalated itself, with the first and last time this service saw it so (its own clock).
-- mod_chat_trade: the chat the watch list named for each trade, kept as first seen (a later list
--   cannot rewrite it). Recorded while the trade is live, so a later compromise of the API cannot
--   unlink a disputed chat. Deleted with the chat's keys when it is shredded.
--
-- A chat is never shredded while the trade this service recorded it linked to (or the order's own
-- trade) was seen disputed within CHAT_AFTER_DISPUTE_DAYS, whatever trade the order names, nor while
-- the order's trade disagrees with the recorded link. Rows of both tables go once last_seen_at is
-- past MOD_DISPUTE_SEEN_DAYS (the owner's 90 days).
create table mod_dispute_seen (
  trade text primary key,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null
);

create table mod_chat_trade (
  chat text primary key,
  trade text not null,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null
);

create index mod_chat_trade_last_seen on mod_chat_trade (last_seen_at);

revoke all on mod_dispute_seen from public;
revoke all on mod_chat_trade from public;
