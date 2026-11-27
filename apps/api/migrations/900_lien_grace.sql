-- Owner decision, 26 Nov 2026 5:43 PM Pacific (docs/lien-recovery.md "Grace: 7 days to pay the
-- agreed way"): when a ruling places a lien, the moderator chooses "Start collecting now" (recovery
-- from the debtor's later trades at once, as before) or "Give them 7 days to pay the agreed way".
--
-- ruling_drafts.lien_grace_method: the moderator's "How they agreed to pay" text sent with the
--   proposal (null: collect now). Staff-only like the reason; copied onto the lien it places.
-- liens:
--   ruled_by               the staff member whose ruling placed the lien (its proposer): told when
--                          the grace lapses, and the one who switches it (or a senior / the owner).
--   grace_method           how the traders agreed the debt is paid (1..500 chars); null: no grace.
--   grace_until            placed + 7 days (@x2f/staff LIEN_GRACE_DAYS); set with grace_method.
--   grace_lapsed_at        the timer marked the days passed without the creditor's sign-off (once).
--   grace_escalated_at/_by the moderator sent the lapsed lien to a senior moderator / the owner.
--   collect_started_at/_by/_tap  the switch to collecting (a `lien-collect` key tap): from then on
--                          the API reserves recoveries as for any lien. Null while in grace.
--   repaid_off_platform_at the person owed signed off "I've been paid" (their own session): the lien
--                          is settled in full off the platform, its remainder is 0 and it never
--                          recovers again (status `repaid` unless it carries X2F's 1%, as `complied`).
-- While in grace (grace_until set, collect_started_at null) nothing is reserved from the debtor's
-- trades: recovery.ts `pickRecovery` reads lien.ts LIEN_COLLECTING_SQL.
alter table ruling_drafts add column lien_grace_method text
  check (lien_grace_method is null or char_length(lien_grace_method) between 1 and 500);
-- Owner addition 26 Nov 2026 5:51 PM: with "Start collecting now" the share of each later trade
-- collected (null: 100%). The moderation service signs a rate under 100% only with a senior's
-- `lien-rate` tap bound to the lien, so a rate under 100% becomes the placed lien's pending
-- lien_rate_requests row (proposed by the ruling's proposer, with this reason); 100% applies until
-- a senior approves it.
alter table ruling_drafts add column lien_rate_bps integer check (lien_rate_bps is null or lien_rate_bps between 1 and 9999);
alter table ruling_drafts add column lien_rate_reason text
  check (lien_rate_reason is null or char_length(lien_rate_reason) between 1 and 500);
alter table ruling_drafts add constraint ruling_drafts_lien_rate_check check (
  (lien_rate_bps is null) = (lien_rate_reason is null) and (lien_rate_bps is null or lien_grace_method is null));

alter table liens add column ruled_by uuid references accounts (id);
alter table liens add column grace_method text;
alter table liens add column grace_until timestamptz;
alter table liens add column grace_lapsed_at timestamptz;
alter table liens add column grace_escalated_at timestamptz;
alter table liens add column grace_escalated_by uuid references accounts (id);
alter table liens add column collect_started_at timestamptz;
alter table liens add column collect_started_by uuid references accounts (id);
-- No foreign key, as written_off_tap (851): a lien ties to nothing but accounts.
alter table liens add column collect_tap uuid;
alter table liens add column repaid_off_platform_at timestamptz;

alter table liens add constraint liens_grace_method_check
  check (grace_method is null or char_length(grace_method) between 1 and 500);
alter table liens add constraint liens_grace_pair_check check ((grace_method is null) = (grace_until is null));
-- Lapse, escalation, the switch and the sign-off only exist on a lien that was given the grace.
alter table liens add constraint liens_grace_only_check check (
  grace_until is not null
  or (grace_lapsed_at is null and grace_escalated_at is null and collect_started_at is null and repaid_off_platform_at is null));
alter table liens add constraint liens_grace_escalated_check check ((grace_escalated_at is null) = (grace_escalated_by is null));
alter table liens add constraint liens_grace_escalated_lapsed_check check (grace_escalated_at is null or grace_lapsed_at is not null);
-- A staff switch carries who and the tap; a switch by the lapse itself (only if the owner turns on
-- @x2f/staff LIEN_LAPSE_STARTS_COLLECTING) carries neither.
alter table liens add constraint liens_collect_check check (
  (collect_started_by is null) = (collect_tap is null) and (collect_started_by is null or collect_started_at is not null));
-- Paid off the platform and collecting never go together (the sign-off is refused once collecting).
alter table liens add constraint liens_off_platform_check check (repaid_off_platform_at is null or collect_started_at is null);

-- The timer's read: grace liens whose days may have passed.
create index liens_grace_due on liens (grace_until)
  where grace_until is not null and grace_lapsed_at is null and collect_started_at is null and repaid_off_platform_at is null;

-- Owner change 26 Nov 2026 5:53 PM: a senior moderator (or the owner) approves a lower lien rate
-- WITHOUT a security-key tap, after reading the dispute's chat. The moderation service then takes
-- the approved request on this database's word (apps/moderation lienRecovery.ts
-- `lienRateRequestApprovals`: the rate 1..10000, the decider not the proposer and a senior or the
-- owner in its own owner-rooted registry). These columns only, never the reason.
grant select (id, lien_id, proposed_bps, proposed_by, status, decided_by, decided_at) on lien_rate_requests to x2f_mod_reader;
