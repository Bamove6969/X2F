-- Plan 7 Task 2 and Plan 4 Task 23 (R36; owner 2026-10-29, p11-11): the whole-trade purge
-- (apps/api/src/retention/tradePurge.ts, disputes/purge.ts). A trade with no dispute is deleted
-- whole 30 days after it closed, one that had a dispute 90 days after its last dispute closed.
--
-- 1. The running totals the purge moves a trade's figures into, so a profile and a starter-limit
--    stage read the same before and after (Plan 5 Task 20's seam, folded into 308's per-account
--    row). Each is what the trade added, by the reader's own SQL, to:
--    - purged_completed: COMPLETED_TRADES_SQL (R38: released, or refunded after a dispute; the stage);
--    - purged_sales: FINAL_SALES_SQL (R-012: the completed count traders see);
--    - purged_won / purged_lost: the "N won, M lost" line and Clean record (traders/summary.ts).
--    The readers add these back. Only ever added to (trigger below), never by x2f_purge (it deletes;
--    the API's role adds, in the purge's own transaction).
alter table account_traded_totals
  add column purged_completed integer not null default 0 check (purged_completed >= 0),
  add column purged_sales integer not null default 0 check (purged_sales >= 0),
  add column purged_won integer not null default 0 check (purged_won >= 0),
  add column purged_lost integer not null default 0 check (purged_lost >= 0);

create function account_purged_totals_add_only() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  if new.purged_completed < old.purged_completed or new.purged_sales < old.purged_sales
     or new.purged_won < old.purged_won or new.purged_lost < old.purged_lost then
    raise exception 'purged totals only rise' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger account_purged_totals_add_only
  before update on account_traded_totals
  for each row execute function account_purged_totals_add_only();

-- 2. What x2f_purge (104) may do, and nothing more: delete a due trade and every row with a foreign
--    key to it that has no cascade, reading only the key column each delete matches on. The trade's
--    reviews are detached (301 already grants that), its chat deleted with its shred order (106,
--    123 already grant that). It is granted nothing on liens, fees_owed, trading_holds,
--    revenue_ledger, activity_log or account_traded_totals: those outlive the trade.
grant delete on trades to x2f_purge;
grant select (code) on trade_identities, trade_attestations, trade_refusals, trade_work_served, ruling_statements to x2f_purge;
grant delete on trade_identities, trade_attestations, trade_refusals, trade_work_served, ruling_statements to x2f_purge;
grant select (code) on dispute_appeals, ruling_drafts, dispute_rulings to x2f_purge;
grant delete on dispute_appeals, ruling_drafts, dispute_rulings, disputes to x2f_purge;

-- 3. Defence in depth behind the purge's own check under the trade lock (review round 1, m1), as
--    104 guards trade_events: x2f_purge may never delete a trade that is open or disputed, nor a
--    dispute that is not closed (an appeal window, round 2, a payout or payment still owed).
create function purge_keeps_open_trades() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  if current_user = 'x2f_purge' and (old.closed_at is null or old.state = 'disputed') then
    raise exception 'x2f_purge may not delete an open trade' using errcode = 'insufficient_privilege';
  end if;
  return old;
end
$$;

create trigger purge_keeps_open_trades
  before delete on trades
  for each row execute function purge_keeps_open_trades();

create function purge_keeps_open_disputes() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  if current_user = 'x2f_purge' and old.status <> 'closed' then
    raise exception 'x2f_purge may not delete a dispute that is not closed' using errcode = 'insufficient_privilege';
  end if;
  return old;
end
$$;

create trigger purge_keeps_open_disputes
  before delete on disputes
  for each row execute function purge_keeps_open_disputes();
