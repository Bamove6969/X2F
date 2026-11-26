-- Team audit v2 follow-up: who ended a member's session.
--
-- 855 logged every member session revoked as ended by 'system' ("X2F ended a session of Ana").
-- The account owner can now end them from the Team screen (team/memberSessions.ts:
-- DELETE /v1/team/members/:id/sessions and .../sessions/:sessionId), and that is the owner's doing.
-- Those writes mark their statement with the transaction-local setting `x2f.team_actor` = 'lead'
-- (as 857's 'system' mark for X2F's invite sweeps), and the row is then 'lead'. Every other
-- revocation (the member's own logout, the owner's account-wide session list, a removal, working
-- hours, a hold) stays 'system'. Rows already in the log are left as they are (the chain covers them).

create or replace function team_audit_session_change() returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
begin
  if new.member_id is null or not exists (select 1 from accounts where id = new.account_id) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    insert into team_audit (account_id, member_id, actor_kind, subject_id, category, at, action, detail)
    values (new.account_id, new.member_id, 'member', new.member_id, 'access', new.created_at, 'member-login',
            jsonb_build_object('session', left(new.id::text, 8), 'device', new.device_label));
  elsif old.revoked_at is null and new.revoked_at is not null then
    insert into team_audit (account_id, member_id, actor_kind, subject_id, category, at, action, detail)
    values (new.account_id, null,
            case when coalesce(current_setting('x2f.team_actor', true), '') = 'lead' then 'lead' else 'system' end,
            new.member_id, 'access', new.revoked_at, 'session-ended',
            jsonb_build_object('session', left(new.id::text, 8), 'device', new.device_label));
  end if;
  return new;
end
$$;
