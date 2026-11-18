-- Review lead-mod-chat t7-9 N3 (design build task 7, T2). Moderation number 020.
--
-- mod_chat_notices keeps the signed notice itself and when the API took it (201). A pass re-posts
-- exactly that notice while the API still lists the dispute and `posted_at` is null, so one failed
-- post (a network error, a 503, a restart) no longer leaves a dispute without a notice, and no
-- second notice is ever signed for the same dispute. A row from before this column (no notice) is
-- never signed again either.
alter table mod_chat_notices add column notice jsonb;
alter table mod_chat_notices add column posted_at timestamptz;
