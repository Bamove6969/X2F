-- Job 1c (J-10; owner S-087, S-092, S-097, D-066, T-076): team members hold a SET of abilities
-- (apps/api/src/team/abilities.ts, the catalogue) instead of the two roles Offers / Trades.
--
-- Every live or past member keeps exactly what their roles let them do (ROLE_ABILITIES in
-- abilities.ts; a test checks the two lists below agree with it), so this widens nobody. The Trades
-- role loses opening a dispute: only trade parties open disputes (owner D-066, p7-7).
--
-- The owner's hard rules are refused by the database too: no stored set may hold an ability the
-- catalogue marks hard owner-only (HARD_OWNER_ONLY; the same test checks the list below).
alter table team_members add column abilities text[];

update team_members set abilities = array(
  select distinct a from unnest(
    (case when 'offers' = any (roles) then
      '{offers-see,offers-pause,offers-edit-prices,offers-edit-amounts,offers-edit-methods,offers-edit-currencies,offers-post,offers-delete,feedback-send}'::text[]
     else '{}'::text[] end)
    || (case when 'trades' = any (roles) then
      '{trades-see-active,trades-see-history,trades-accept,trades-take,trades-pick-wallet,trades-mark-paid,trades-extend,trades-cancel,trades-cancel-no-show,trades-confirm-cancel,disputes-answer,disputes-appeal,wallets-see,feedback-send}'::text[]
     else '{}'::text[] end)
  ) as a order by a
);

alter table team_members alter column abilities set not null;
alter table team_members add constraint team_members_abilities check (
  cardinality(abilities) >= 1
  and not (abilities && '{trades-confirm-received,trades-release,disputes-open,wallets-manage,team-invite,team-remove,team-change-abilities,account-security,sessions-end-others,devices-approve,account-delete}'::text[])
);

alter table team_members drop column roles;

-- T-076 (p7-1): every release is in the team log with name and amount. Members never release
-- (p10-2), so a release row is the account owner's own: `member_id` null means "the lead"
-- (team/audit.ts `auditLead`). The append-only rule is unchanged, compared null-safely.
alter table team_audit alter column member_id drop not null;
alter table team_audit add constraint team_audit_lead_actions check (member_id is not null or action in ('release-started'));

create or replace function team_audit_append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    -- The cascade from deleting the account has already removed the account row.
    if exists (select 1 from accounts where id = old.account_id) then
      raise exception 'team_audit is append-only';
    end if;
    return old;
  end if;
  if new.trade_code is null and old.trade_code is not null
     and new.id = old.id and new.account_id = old.account_id and new.member_id is not distinct from old.member_id
     and new.at = old.at and new.action = old.action and new.detail = old.detail then
    return new;
  end if;
  raise exception 'team_audit is append-only';
end
$$;
