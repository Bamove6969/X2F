-- Design build task 9 (design-chat-membership-keys-2026-11-08 section 2.4 M4; lead 18 Nov).
-- Moderation number 019.
--
-- mod_chat_access now records what was done: `grant` (the chat key re-wrapped to a certified staff
-- device of a staff member on the case) and `send` (a moderator message countersigned by that
-- device and signed here as the moderator). `grant-unavailable` stays for rows written before.
-- mod_countersign_requests: every countersign request id this process accepted, so none is used
-- twice (lead 18 Nov). Deleted with the chat by the shred pass.
alter table mod_chat_access drop constraint mod_chat_access_action_check;
alter table mod_chat_access add constraint mod_chat_access_action_check check (action in ('grant-unavailable', 'grant', 'send'));

create table mod_countersign_requests (
  request_id text primary key check (request_id ~ '^[0-9a-f]{32}$'),
  chat text not null,
  at timestamptz not null
);
create index mod_countersign_requests_chat on mod_countersign_requests (chat);

revoke all on mod_countersign_requests from public;
