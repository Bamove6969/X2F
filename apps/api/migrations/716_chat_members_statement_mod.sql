-- Review lead-mod-chat t7-9 N11 (a) (design build task 9). API number 716.
--
-- Migration 714 lets the moderation reader select `statement` on chat_members, and a column grant
-- covers every row. Only a moderator row (a trader's signed grant to moderation) carries a
-- statement, so a later staff row can never expose one through that grant.
alter table chat_members add constraint chat_members_statement_mod_only check (member_kind = 'mod' or statement is null);
