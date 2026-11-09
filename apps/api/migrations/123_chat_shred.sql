-- Chat keys go with the chat (owner, 8 Nov: chat retention and p11-10 "when the trade is purged it is
-- system wide"; design-chat-membership-keys-2026-11-08 section 5, build tasks 1 and 2).
--
-- purgeChats writes both of these in the same statement that deletes the chat, as x2f_purge (104),
-- so a chat is never purged without them:
--
-- chat_shred_orders: one row per purged chat until the moderation service confirms it destroyed its
--   own copy of the chat's keys (its sealed moderator chat identity and the signed attestation).
--   Served on GET /internal/v1/chat-shred; removed by the report { kind: 'chat-shredded', chat }.
--   The linked trade's code rides along so moderation can check its own view of that trade first.
-- chat_purged_marks: how a former member's device learns its copy must go (410 chat-purged instead
--   of 404). Only a tag: sha256 of 'x2f/chat-purged/v1|<chat>|<account id>', so the table names
--   neither the chat nor who was in it; the API computes the same tag from the code a caller asks
--   for and the caller's session. Kept CHAT_PURGED_MARK_DAYS, then deleted by purgeChats.
create table chat_shred_orders (
  chat text primary key,
  trade_code text,
  purged_at timestamptz not null
);

create table chat_purged_marks (
  tag bytea primary key check (length(tag) = 32),
  purged_at timestamptz not null
);

create index chat_purged_marks_purged_at on chat_purged_marks (purged_at);

-- Insert only, plus the key column each insert's `on conflict do nothing` checks (Postgres needs
-- select on the arbiter columns). x2f_purge reads nothing else here and deletes nothing.
grant insert on chat_shred_orders, chat_purged_marks to x2f_purge;
grant select (chat) on chat_shred_orders to x2f_purge;
grant select (tag) on chat_purged_marks to x2f_purge;
