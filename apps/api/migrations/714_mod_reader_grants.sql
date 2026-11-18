-- Design build task 9 (design-chat-membership-keys-2026-11-08 section 2.4 M4): the moderation
-- process re-wraps a disputed chat's key to a certified staff device from the trader grant it
-- accepted. It finds that grant itself (its own `mod_chat_grants` names it by side and signature),
-- reads the signed statement through the read-only role, verifies it again against the traders it
-- attested, and opens the wrap inside it with its own sealed moderator identity. These columns of
-- the moderator's rows, nothing else: never a staff row's wrap, never an envelope. API number 714.
grant select (chat, member_kind, granted_by, sig, statement, removed_at) on chat_members to x2f_mod_reader;
