-- Owner p11-25 (S-105, 9 Nov 2026, replacing R44's "Team <name> member: <member>"): in a trade chat
-- a team member is labelled by the lead's display name and a number, "Circa 55 Assistant 1",
-- "Circa 55 Assistant 2"; the member's own name is not shown (team/label.ts).
--
-- `assistant_no` is that number. Every live member (or open invite) of a team holds a different
-- one; a new member takes the lowest number no live member holds (lead default, listed for the
-- owner: a removed member's number is used again), set by the trigger below so every insert gets
-- one. A removed row keeps its number for the record; only live rows are unique.
alter table team_members add column assistant_no smallint check (assistant_no >= 1);

with numbered as (
  select id, row_number() over (partition by account_id order by created_at, id) as k
    from team_members where removed_at is null
)
update team_members t set assistant_no = numbered.k from numbered where t.id = numbered.id;

create unique index team_members_assistant on team_members (account_id, assistant_no) where removed_at is null;
alter table team_members add constraint team_members_assistant_live check (removed_at is not null or assistant_no is not null);

-- The lowest number free in the team. Inserts come from `createInvite`, which holds the team
-- account's lock (team/members.ts `ownerWriteGate`), so two inserts never pick the same one; if one
-- ever did, the unique index above refuses it.
create function team_members_assistant_no() returns trigger language plpgsql as $$
begin
  if new.assistant_no is null and new.removed_at is null then
    select min(k) into new.assistant_no from generate_series(1, 1000) k
     where not exists (select 1 from team_members tm where tm.account_id = new.account_id and tm.removed_at is null and tm.assistant_no = k);
  end if;
  return new;
end
$$;

create trigger team_members_assistant_no before insert on team_members
  for each row execute function team_members_assistant_no();

-- Owner p11-21 (S-104, 9 Nov 2026, replacing 1 Nov's refusal of an invite from a username-and-password
-- login): such an invite goes out at once, but the boxes the lead ticked wait 24 h like every change
-- of that login (hold v3, a `team-abilities` change for the new member). Until they apply the
-- member holds no box: an empty set, which the API never accepts from a request (`parseAbilities`).
-- The owner's hard rules stay refused here as in 360.
alter table team_members drop constraint team_members_abilities;
alter table team_members add constraint team_members_abilities check (
  not (abilities && '{trades-confirm-received,trades-release,disputes-open,wallets-manage,team-invite,team-remove,team-change-abilities,account-security,sessions-end-others,devices-approve,account-delete}'::text[])
);
