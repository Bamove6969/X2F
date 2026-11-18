-- Re-review lead-mod-chat m5 (design build task 7, T2). Moderation number 021.
--
-- A notice the API refused for good (a 4xx other than 401, 408, 409 or 429) is not posted again: the status
-- is kept here (`refused_status`), and the owner is told once (`alerted_at`, set when the API took
-- the `chat-notice-stopped` report). A 5xx, 401, 408, 409, 429 or a network error still retries.
alter table mod_chat_notices add column refused_status integer;
alter table mod_chat_notices add column alerted_at timestamptz;
