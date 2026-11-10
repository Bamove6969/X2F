-- Batch 4 classification of the Jabber change paths (lead default, owner p11-119; the reviewed list
-- is apps/api/src/jabber/changePaths.ts, checked by apps/api/test/jabber-paths.test.ts).
-- accounts: idle_hours went with 307; last_login_at (200) and terms_signature (316) are bookkeeping,
-- so writes to them alone queue no notice. banned_identifiers (017) is a change table: a ban of one
-- of the account's identifiers queues one notice.
drop trigger jabber_note_change on accounts;
create trigger jabber_note_change after update on accounts for each row
  execute function jabber_note_change('id', 'had_wallet', 'webauthn_user_id', 'login_tag', 'login_tag_key_id', 'login_name', 'login_key', 'last_login_at', 'terms_signature');
create trigger jabber_note_change after insert or update or delete on banned_identifiers for each row
  execute function jabber_note_change('account_id');
