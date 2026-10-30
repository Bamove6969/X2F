-- Plan 7, Task 2: the whole-trade purge (owner 2026-10-29, R36). An undisputed trade is deleted
-- whole 30 days after it ends, a disputed trade 90 days after the dispute button (never while a
-- dispute is open); @x2f/trade `tradeDeleteAt` is the rule, apps/api/src/retention/tradePurge.ts
-- the job. Deletion is real: rows are deleted, nothing is flagged and kept.
--
-- The foreign keys to trades(code) and disputes(code, seq) keep NO cascade (108's choice): the
-- purge deletes in an explicit order (appeals, rulings, disputes, the trade's identities,
-- attestation, refusal and work row, its chat when Plan 3 Task 20's `chats` exists, its events,
-- then the trade), so a forgotten table makes the purge fail instead of silently deleting.
-- apps/api/test/tradePurge.test.ts checks that every foreign key to trades is in that order.

-- No per-trade stub (owner): before a trade is deleted, what must last moves into the account.
-- Today that is the completed-trade count behind the starter-limit stage and the public
-- "completed trades" figure (COMPLETED_TRADES_SQL adds this column). Plan 5 Task 20's running
-- totals take it over (it adds won/lost disputes and the rest).
alter table accounts add column completed_trades_purged integer not null default 0 check (completed_trades_purged >= 0);

grant select (id, completed_trades_purged) on accounts to x2f_purge;
grant update (completed_trades_purged) on accounts to x2f_purge;

grant delete on trades to x2f_purge;
grant select, delete on disputes, dispute_rulings, dispute_appeals to x2f_purge;
grant select, delete on trade_identities, trade_attestations, trade_refusals, trade_work_served to x2f_purge;

-- Only x2f_purge deletes a trade or its dispute records (Review Focus 3, "no early delete"): the
-- API's own role owns these tables, so a privilege alone would not stop it. TRUNCATE is refused
-- for everyone. (trade_events has the same guard since 104.)
create function trade_delete_purge_only() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' and current_user = 'x2f_purge' then
    return old;
  end if;
  raise exception '% rows are deleted only by the retention purge', tg_table_name using errcode = 'insufficient_privilege';
end
$$;

create trigger trades_delete_purge_only before delete on trades
  for each row execute function trade_delete_purge_only();
create trigger trades_no_truncate before truncate on trades
  for each statement execute function trade_delete_purge_only();
create trigger disputes_delete_purge_only before delete on disputes
  for each row execute function trade_delete_purge_only();
create trigger disputes_no_truncate before truncate on disputes
  for each statement execute function trade_delete_purge_only();
create trigger dispute_rulings_delete_purge_only before delete on dispute_rulings
  for each row execute function trade_delete_purge_only();
create trigger dispute_rulings_no_truncate before truncate on dispute_rulings
  for each statement execute function trade_delete_purge_only();
create trigger dispute_appeals_delete_purge_only before delete on dispute_appeals
  for each row execute function trade_delete_purge_only();
create trigger dispute_appeals_no_truncate before truncate on dispute_appeals
  for each statement execute function trade_delete_purge_only();

-- The purge's candidate scan: ended trades, oldest first (trades_closed covers closed_at alone).
create index trades_purge_scan on trades (closed_at, code) where closed_at is not null and state <> 'disputed';
