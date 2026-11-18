-- Design build task 9 groundwork (design-chat-membership-keys-2026-11-08; lead 18 Nov, option C):
-- the moderation process checks that a staff member asking for a disputed chat is its assigned
-- moderator (or a senior or the owner, by the ruling gate's own records). It reads the assignee
-- of the trade's current dispute through the read-only role, and nothing else new. The assignee
-- is the API's word: moderation still takes the person's role from the gate and requires a
-- certified device key, so a compromised API can at most point a case at a real moderator, which
-- moderation's own `mod_chat_access` record then shows (design section 10, staff device row).
-- API number 710 (lead 18 Nov): after retention's 701, above every number main uses, so an
-- existing database applies it in order.
grant select (assignee) on disputes to x2f_mod_reader;
