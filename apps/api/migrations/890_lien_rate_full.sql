-- Owner 26 Nov 2026 (OQ1/Q1 answered, docs/lien-recovery.md): "100% of their earnings are pulled
-- until they pay back in full". The default and the ceiling of a lien's recovery rate are both
-- 10000 bps (100%), as @x2f/trade LIEN_DEFAULT_RATE_BPS / LIEN_RECOVERY_MAX_BPS and @x2f/staff
-- DEFAULT_RECOVERY_RATE_BPS. A moderator may still propose a lower rate, with a reason, for a senior
-- moderator (or the owner) to approve with a `lien-rate` key tap. What the buyer's output keeps
-- for the payout to work (MAX_NETWORK_FEE + 1 atomic unit) is @x2f/trade lienRecoveryCap, not SQL.
--
-- 1. The three rate checks of migration 820 (liens.recovery_rate_bps, lien_recovery_holds.rate_bps,
--    lien_rate_requests.proposed_bps) go from 1..9000 to 1..10000. They were unnamed column checks,
--    so they are found by definition (as 851 does) and replaced by named ones.
do $$
declare c record;
begin
  for c in select conrelid::regclass::text as tbl, conname from pg_constraint
            where contype = 'c'
              and conrelid in ('liens'::regclass, 'lien_recovery_holds'::regclass, 'lien_rate_requests'::regclass)
              and pg_get_constraintdef(oid) ~ '_bps <= 9000'
  loop
    execute format('alter table %I drop constraint %I', c.tbl, c.conname);
  end loop;
end
$$;
alter table liens add constraint liens_recovery_rate_bps_check check (recovery_rate_bps between 1 and 10000);
alter table lien_recovery_holds add constraint lien_recovery_holds_rate_bps_check check (rate_bps between 1 and 10000);
alter table lien_rate_requests add constraint lien_rate_requests_proposed_bps_check check (proposed_bps between 1 and 10000);

-- 2. A new lien starts at 100%.
alter table liens alter column recovery_rate_bps set default 10000;

-- 3. Existing liens that still bind (active, suspended): only a rate that is the old 5000 default,
--    never set by a senior, moves to the new default. Left as stored:
--    - any lien with an approved rate request (a senior chose its rate, even if that was 5000);
--    - any lien the moderation service has already signed a statement for (lien_statements): it
--      pinned that lien at the rate it applied (mod_liens, the old 5000 default) and signs another
--      rate only with a senior's `lien-rate` tap, so moving the API's rate alone would make every
--      later recovery for that lien refused (`lien-refused-rate-unverified`) and the debtor's buys
--      wait unsigned. Such a lien goes to 100% through the normal flow: a rate request for 10000
--      and a senior's tap. A lien the service never pinned starts there at the new default (100%),
--      so moving it here keeps the two in agreement.
--    Open holds keep the rate they were reserved at (lien_recovery_holds.rate_bps, what the buyer
--    accepted); nothing here changes them.
--    Over liens (repaid, void, uncollectible) never change (liens_guard, review L4).
--    The update is a change to the debtor's lien, so jabber_note_change notifies them (recovery_rate_bps
--    is a tracked change, jabber/changePaths.ts), as an approved rate change does.
update liens l
   set recovery_rate_bps = 10000
 where l.status in ('active', 'suspended')
   and l.recovery_rate_bps = 5000
   and not exists (select 1 from lien_rate_requests r where r.lien_id = l.id and r.status = 'approved')
   and not exists (select 1 from lien_statements s where s.lien_id = l.id);
