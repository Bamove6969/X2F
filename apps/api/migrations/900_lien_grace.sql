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
-- Lapse, escalation and the switch only exist on a lien that was given the grace. Paid off the
-- platform does not: staff may end any binding lien that way (`POST /staff/v1/liens/:id/paid-off-platform`).
alter table liens add constraint liens_grace_only_check check (
  grace_until is not null
  or (grace_lapsed_at is null and grace_escalated_at is null and collect_started_at is null));
-- A staff escalation names who; the timer's own (LIEN_LAPSE_ESCALATE_HOURS, or the moderator who
-- ruled is no longer active staff) names nobody.
alter table liens add constraint liens_grace_escalated_check check (grace_escalated_by is null or grace_escalated_at is not null);
alter table liens add constraint liens_grace_escalated_lapsed_check check (grace_escalated_at is null or grace_lapsed_at is not null);
-- A staff switch carries who and the tap; a switch by the lapse itself (only if the owner turns on
-- @x2f/staff LIEN_LAPSE_STARTS_COLLECTING) carries neither.
alter table liens add constraint liens_collect_check check (
  (collect_started_by is null) = (collect_tap is null) and (collect_started_by is null or collect_started_at is not null));
-- (The creditor's sign-off is refused once collecting; staff may still end a collecting lien as paid
-- off the platform, so the two may go together.)

-- The timer's read: grace liens whose days may have passed.
create index liens_grace_due on liens (grace_until)
  where grace_until is not null and grace_lapsed_at is null and collect_started_at is null and repaid_off_platform_at is null;

-- Owner change 26 Nov 2026 5:53 PM: a senior moderator (or the owner) approves a lower lien rate
-- WITHOUT a security-key tap, after reading the dispute's chat. The moderation service then takes
-- the approved request on this database's word (apps/moderation lienRecovery.ts
-- `lienRateRequestApprovals`: the rate 1..10000, the decider not the proposer and a senior or the
-- owner in its own owner-rooted registry). These columns only, never the reason.
grant select (id, lien_id, proposed_bps, proposed_by, status, decided_by, decided_at) on lien_rate_requests to x2f_mod_reader;

-- Coordinator follow-up 26 Nov 2026 (owner: seniors are "requested and needed to just go in and
-- approve"): a new rate request alerts the seniors and the owner who may decide it, in-app in the
-- same transaction (disputes/lien.ts `alertRateDeciders`) and on the phone once, after the commit
-- (disputes/lienGrace.ts `pushRateDeciders`); this marks the push as done. Requests already pending
-- count as told.
alter table lien_rate_requests add column deciders_pushed_at timestamptz;
update lien_rate_requests set deciders_pushed_at = proposed_at where status = 'pending';

-- Review of feat/lien-grace item 7: a pending rate request dies with its lien. When a lien ends
-- (repaid, void, uncollectible) or is paid off the platform, its pending request becomes `expired`
-- (decided by nobody) and the deciders' `lien-rate-requested` alerts for it are marked seen. A
-- trigger, so every way a lien ends is covered (disputes/lien.ts, recovery.ts, lienGrace.ts).
alter table lien_rate_requests drop constraint lien_rate_requests_status_check;
alter table lien_rate_requests add constraint lien_rate_requests_status_check check (status in ('pending', 'approved', 'rejected', 'expired'));
alter table lien_rate_requests drop constraint lien_rate_requests_check;
alter table lien_rate_requests add constraint lien_rate_requests_check check ((status in ('pending', 'expired')) = (decided_by is null));

create function liens_expire_rate_requests() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
declare
  at timestamptz := coalesce(new.lifted_at, new.repaid_off_platform_at, new.changed_at, now());
begin
  update public.lien_rate_requests set status = 'expired', decided_at = at where lien_id = new.id and status = 'pending';
  update public.alerts set seen_at = at
   where kind = 'lien-rate-requested' and seen_at is null and detail ->> 'lienId' = new.id::text;
  return null;
end
$$;
create trigger liens_expire_rate_requests after update of status, repaid_off_platform_at on liens for each row
  when ((new.status in ('repaid', 'void', 'uncollectible') and old.status in ('active', 'suspended'))
     or (new.repaid_off_platform_at is not null and old.repaid_off_platform_at is null))
  execute function liens_expire_rate_requests();
