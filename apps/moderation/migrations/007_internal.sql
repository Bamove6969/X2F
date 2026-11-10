-- Plan 4 Task 11: the internal API's own records (only the moderation process connects here).
--
-- used_log_entries: every API activity-log entry an internal call was accepted under. An entry
--   authorises exactly one call (a chat read, a message, a proof read); a second use is refused.
-- mod_chat_seq: the next `seq` of the moderator's chat envelopes per chat. A seq is taken before
--   the envelope is sealed and never reused, so a message the API failed to store leaves a gap,
--   never a replay.
create table used_log_entries (
  id bigint primary key,
  action text not null,
  trade text not null,
  used_at timestamptz not null default now()
);

create table mod_chat_seq (
  chat text primary key,
  next_seq bigint not null check (next_seq >= 0)
);

revoke all on used_log_entries, mod_chat_seq from public;
