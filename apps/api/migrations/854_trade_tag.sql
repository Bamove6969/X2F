-- The public name is called the Trade Tag (owner, 26 Nov 2026): "display name" becomes "Trade Tag"
-- in the product's words and in the code, so its columns and stored names follow. Renames only;
-- every value is kept as it is. Earlier migrations keep their old words (they are history).
--
-- 1. The name columns of accounts (009) and team_members (015). Their keys (`display_key`) keep
--    their name, and the indexes and constraints on them follow the rename by themselves.
alter table accounts rename column display_name to trade_tag;
alter table team_members rename column display_name to trade_tag;

-- 2. rekey_display_names() (810) names the old columns in its plpgsql body, which is only bound
--    when it runs: it is replaced by rekey_trade_tags(), the same function over the new columns.
--    Nothing calls it here (810 already ran it); it is kept for a later fold change.
drop function rekey_display_names();
create function rekey_trade_tags() returns void
language plpgsql
as $$
declare
  clashes int;
begin
  select count(*) into clashes from (
    select display_key_fold(trade_tag) from accounts group by 1 having count(*) > 1
  ) c;
  if clashes > 0 then
    raise exception 'display key collision: % folded keys are shared by more than one account', clashes;
  end if;
  select count(*) into clashes from (
    select account_id, display_key_fold(trade_tag) from team_members where removed_at is null group by 1, 2 having count(*) > 1
  ) c;
  if clashes > 0 then
    raise exception 'display key collision: % folded keys are shared by more than one live team member of a team', clashes;
  end if;
  update accounts set display_key = display_key_fold(trade_tag) where display_key is distinct from display_key_fold(trade_tag);
  update team_members set display_key = display_key_fold(trade_tag) where display_key is distinct from display_key_fold(trade_tag);
end $$;

-- 3. The ban list's kind for a banned public name (017): 'display-name' becomes 'trade-tag'. The
--    tag itself does not depend on the kind (a name's tag is its login-name tag), so every ban
--    keeps working. The relabel is not a new ban, so it queues no Jabber notice (334's trigger is
--    off for this one statement).
alter table banned_identifiers drop constraint banned_identifiers_kind_check;
alter table banned_identifiers disable trigger jabber_note_change;
update banned_identifiers set kind = 'trade-tag' where kind = 'display-name';
alter table banned_identifiers enable trigger jabber_note_change;
alter table banned_identifiers add constraint banned_identifiers_kind_check
  check (kind in ('trade-tag', 'login-name', 'pgp-fingerprint', 'jabber'));
