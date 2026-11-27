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

-- 4. The team audit log's trigger on team_members (855, replaced by 857) names the old column in
--    its plpgsql body (the 'name' of an invite, a join and a removal), bound only when it fires:
--    it is replaced by the same function over trade_tag. The log's detail keeps its key 'name', so
--    the rows already in the chain and the ones after read the same.
create or replace function team_audit_member_change() returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
declare
  t timestamptz := clock_timestamp();
  added text[];
  removed text[];
begin
  -- The account is being deleted (cascade): its log goes with it.
  if not exists (select 1 from accounts where id = new.account_id) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    insert into team_audit (account_id, member_id, actor_kind, subject_id, category, at, action, detail)
    values (new.account_id, null, 'lead', new.id, 'team', t, 'member-invited',
            jsonb_build_object('name', new.trade_tag, 'abilities', to_jsonb(new.abilities),
                               'assistantNo', new.assistant_no, 'inviteExpiresAt', new.invite_expires_at));
    return new;
  end if;
  if old.joined_at is null and new.joined_at is not null then
    insert into team_audit (account_id, member_id, actor_kind, subject_id, category, at, action, detail)
    values (new.account_id, new.id, 'member', new.id, 'team', t, 'member-joined', jsonb_build_object('name', new.trade_tag));
  end if;
  if old.abilities is distinct from new.abilities then
    added := array(select unnest(new.abilities) except select unnest(old.abilities) order by 1);
    removed := array(select unnest(old.abilities) except select unnest(new.abilities) order by 1);
    insert into team_audit (account_id, member_id, actor_kind, subject_id, category, at, action, detail)
    values (new.account_id, null, 'lead', new.id, 'team', t, 'abilities-changed',
            jsonb_build_object('added', to_jsonb(added), 'removed', to_jsonb(removed), 'abilities', to_jsonb(new.abilities)));
  end if;
  if old.band_min_atomic is distinct from new.band_min_atomic or old.band_max_atomic is distinct from new.band_max_atomic
     or old.hours is distinct from new.hours then
    insert into team_audit (account_id, member_id, actor_kind, subject_id, category, at, action, detail)
    values (new.account_id, null, 'lead', new.id, 'team', t, 'limits-changed',
            jsonb_build_object(
              'before', jsonb_build_object('bandMinAtomic', old.band_min_atomic::text, 'bandMaxAtomic', old.band_max_atomic::text, 'hours', old.hours),
              'after', jsonb_build_object('bandMinAtomic', new.band_min_atomic::text, 'bandMaxAtomic', new.band_max_atomic::text, 'hours', new.hours)));
  end if;
  if old.removed_at is null and new.removed_at is not null then
    insert into team_audit (account_id, member_id, actor_kind, subject_id, category, at, action, detail)
    values (new.account_id, null,
            -- Only X2F's own sweep of an expired, unused invite is 'system'; the owner cancelling
            -- one (even after it ran out) or removing a member is 'lead'.
            case when new.joined_at is null and new.invite_expires_at <= new.removed_at
                      and coalesce(current_setting('x2f.team_actor', true), '') = 'system'
                 then 'system' else 'lead' end,
            new.id, 'team', t,
            case when new.joined_at is null then 'invite-closed' else 'member-removed' end,
            jsonb_build_object('name', new.trade_tag));
  end if;
  return new;
end
$$;
