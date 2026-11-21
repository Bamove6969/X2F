-- Design build task 9 groundwork (design-chat-membership-keys-2026-11-08 section 4; lead 18 Nov,
-- option C). Moderation number 016: the next free one
-- (009 is the lien branch's, 010-015 are reserved for J-01 and J-06).
--
-- mod_chat_access: this process's OWN record of every staff access to a disputed chat, which the
-- API cannot write (the API's `chat.read` activity-log entry is the API's word; this is the
-- authoritative one, lead 18 Nov). One row per grant request that passed every check: the staff
-- member as the ruling gate knows them, the certified device key id (design task 8), the API log
-- entry it was made under, and what was done. Until the chat key exists (design tasks 3-6) the
-- only action is `grant-unavailable`: every check passed, nothing was granted.
-- Deleted with the chat's keys by the shred pass (section 5), never otherwise.
create table mod_chat_access (
  chat text not null,
  trade text not null,
  at timestamptz not null,
  staff_id uuid not null,
  device_key_id text not null check (device_key_id ~ '^[0-9a-f]{32}$'),
  log_entry_id bigint not null references used_log_entries (id),
  action text not null check (action in ('grant-unavailable')),
  primary key (chat, log_entry_id)
);
create index mod_chat_access_trade on mod_chat_access (trade);

revoke all on mod_chat_access from public;
