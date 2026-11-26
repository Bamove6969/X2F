-- Team audit v2 follow-up (review of migration 855): who closed an unused invite.
--
-- 855 logged every unused invite removed at or after its expiry as closed by 'system'. The owner
-- can cancel such an invite too (removeMember finds any row not yet removed, and a staged removal
-- applies 24 h after it is submitted, often past the invite's end), and that was logged as X2F's
-- doing. Now only X2F's own sweeps of expired invites (team/members.ts closeExpiredInvites: the
-- leftovers job and the sweep before a new invite) are 'system': they mark their statement with
-- the transaction-local setting `x2f.team_actor` = 'system'. Every other removal is the owner's.
-- Rows already in the log are left as they are (the chain covers them).

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
            jsonb_build_object('name', new.display_name, 'abilities', to_jsonb(new.abilities),
                               'assistantNo', new.assistant_no, 'inviteExpiresAt', new.invite_expires_at));
    return new;
  end if;
  if old.joined_at is null and new.joined_at is not null then
    insert into team_audit (account_id, member_id, actor_kind, subject_id, category, at, action, detail)
    values (new.account_id, new.id, 'member', new.id, 'team', t, 'member-joined', jsonb_build_object('name', new.display_name));
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
            jsonb_build_object('name', new.display_name));
  end if;
  return new;
end
$$;
