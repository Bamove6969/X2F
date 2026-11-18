-- Owner rule p5-7: every change to an account sends one Jabber notice (331's choke point). Which
-- earned badges the public profile shows (chosen, levels, featured_order) and publishing the signed
-- record on it (portable_public) are changes to the account, like accounts.show_traded_total (lead
-- call, train-1). updated_at is bookkeeping: it is set with every save, and the save's other columns
-- notify, so a save that changes nothing else queues no notice. The row is only ever deleted by the
-- account's own deletion, which cascades (notified there), so the trigger watches inserts and
-- updates. Keep in step with CHANGE_TABLES in apps/api/src/jabber/changePaths.ts.
create trigger jabber_note_change after insert or update on badge_prefs for each row
  execute function jabber_note_change('account_id', 'updated_at');
