-- Plan 2 Task 18 review M5 (R36): a deleted trade's code leaves the team audit log, done by the
-- database itself so no purge (Plan 7's 701, a CTE, a query builder, a schema-qualified name) can
-- forget it. The rest of each audit row stays with the account. team_audit (015) comes before
-- trades (103), so this trigger needs its own migration after both; 199 is the last number of the
-- Plan 3 range, which its plan names no file for.
--
-- The update below is the one change team_audit's append-only trigger allows (clearing trade_code
-- with every other column unchanged). There is no foreign key: a trade code in the log of a trade
-- that is still there is fine, and one whose trade is gone is cleared here.
-- security definer: Plan 7's purge may run as a role with no rights on team_audit (as x2f_purge, 104).
create function team_audit_forget_trade() returns trigger
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
begin
  update public.team_audit set trade_code = null where trade_code = old.code;
  return old;
end
$$;

create trigger team_audit_forget_trade
  after delete on trades
  for each row execute function team_audit_forget_trade();
