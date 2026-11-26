-- Owner question trades-release (26 Nov 2026, pending the owner's final yes): "Release coins"
-- (`trades-release`, row 22 of apps/api/src/team/abilities.ts) stops being a hard owner-only rule
-- and becomes a box the account holder may tick for one member. It is off for every member and in
-- every preset; this migration ticks it for nobody.
--
-- - The stored-set check (360, 390) no longer refuses `trades-release`; every other hard rule stays.
-- - A set holding `trades-release` must also hold `trades-escrow-keys` ("Hold trade keys",
--   migration 860): the release signs with the synced escrow keys (ABILITY_REQUIRES).
-- - A member's release is the member's own `team_audit` row (member_id set), which 360's
--   team_audit_lead_actions check already allows; nothing changes there.
--
-- To back out: untick the box for every member, then restore 390's check:
--   update team_members set abilities = array_remove(abilities, 'trades-release');
--   alter table team_members drop constraint team_members_abilities;
--   alter table team_members add constraint team_members_abilities check (not (abilities && '{trades-confirm-received,trades-release,...}'::text[]));
alter table team_members drop constraint team_members_abilities;
alter table team_members add constraint team_members_abilities check (
  not (abilities && '{trades-confirm-received,disputes-open,wallets-manage,team-invite,team-remove,team-change-abilities,account-security,sessions-end-others,devices-approve,account-delete}'::text[])
  and (not ('trades-release' = any (abilities)) or 'trades-escrow-keys' = any (abilities))
);
