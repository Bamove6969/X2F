-- Owner 26 Nov 2026 (OQ1/Q1 answered, docs/lien-recovery.md): a lien's recovery rate defaults to and
-- is capped at 10000 bps (100%), as @x2f/trade LIEN_DEFAULT_RATE_BPS / LIEN_RECOVERY_MAX_BPS (API
-- migration 890 does the same to its checks). Migration 023's three rate checks (mod_liens.rate_bps,
-- mod_lien_rate_taps.rate_bps and .from_rate_bps) go from 1..9000 to 1..10000. They were unnamed
-- column checks, so they are found by definition and replaced by named ones.
--
-- No row changes: a lien this service already pinned (mod_liens) keeps the rate it applied and
-- signed into its LienStatement; a statement cannot be re-signed from SQL. The API's migration 890
-- leaves such a lien's rate as stored too (it has a hold or a lien statement), so the two agree; it
-- moves to 100% only through a senior's `lien-rate` tap, as any rate change.
do $$
declare c record;
begin
  for c in select conrelid::regclass::text as tbl, conname from pg_constraint
            where contype = 'c'
              and conrelid in ('mod_liens'::regclass, 'mod_lien_rate_taps'::regclass)
              and pg_get_constraintdef(oid) ~ '_bps <= 9000'
  loop
    execute format('alter table %I drop constraint %I', c.tbl, c.conname);
  end loop;
end
$$;
alter table mod_liens add constraint mod_liens_rate_bps_check check (rate_bps between 1 and 10000);
alter table mod_lien_rate_taps add constraint mod_lien_rate_taps_rate_bps_check check (rate_bps between 1 and 10000);
alter table mod_lien_rate_taps add constraint mod_lien_rate_taps_from_rate_bps_check check (from_rate_bps between 1 and 10000);
