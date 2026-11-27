-- Owner question trades-release (26 Nov 2026, pending the owner's final yes): "Release coins"
-- (`trades-release`, row 22 of apps/api/src/team/abilities.ts) stops being a hard owner-only rule
-- and becomes a box the account holder may tick for one member. It is off for every member and in
-- every preset; this migration ticks it for nobody.
--
-- - The stored-set check (360, 390) no longer refuses `trades-release`; every other hard rule stays.
-- - A set holding `trades-release` must also hold `trades-escrow-keys` ("Hold trade keys",
--   migration 864): the release signs with the synced escrow keys (ABILITY_REQUIRES).
-- - A member's release is the member's own `team_audit` row (member_id set, so actor_kind
--   'member' in migration 855's hash chain); nothing changes there.
-- - Owner 26 Nov 2026 18:41 UTC (Jess: "funding the escrow for sellers, yes as power granted to them
--   by team lead"): "Fund the escrow" (`trades-fund`, row 23) is a box too, ticked for nobody here,
--   and likewise needs `trades-escrow-keys`. "Upload payment proof" (`trades-upload-proof`, row 68)
--   needs no keys and no check.
--
-- To back out: untick the box for every member, then restore 390's check:
--   update team_members set abilities = array_remove(array_remove(abilities, 'trades-release'), 'trades-fund');
--   alter table team_members drop constraint team_members_abilities;
--   alter table team_members add constraint team_members_abilities check (not (abilities && '{trades-confirm-received,trades-release,...}'::text[]));
alter table team_members drop constraint team_members_abilities;
alter table team_members add constraint team_members_abilities check (
  not (abilities && '{trades-confirm-received,disputes-open,wallets-manage,team-invite,team-remove,team-change-abilities,account-security,sessions-end-others,devices-approve,account-delete}'::text[])
  and (not ('trades-release' = any (abilities)) or 'trades-escrow-keys' = any (abilities))
  and (not ('trades-fund' = any (abilities)) or 'trades-escrow-keys' = any (abilities))
);
