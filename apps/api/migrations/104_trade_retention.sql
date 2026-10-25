-- Plan 3, Task 6: trade retention (P3-I12, X-12).
--
-- x2f_purge is the only role that may delete from trade_events and the role purgeTradeAddresses
-- runs as (`set local role x2f_purge`). It cannot log in; the API's own database user is made a
-- member with SET but without INHERIT, so ordinary queries never carry its rights. Roles are
-- cluster-wide, so it is created only if missing (each database of a cluster runs this file).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'x2f_purge') then
    create role x2f_purge nologin;
  end if;
end
$$;

grant x2f_purge to current_user with inherit false, set true;

grant select on trades to x2f_purge;
grant update (buyer_payout, seller_refund) on trades to x2f_purge;
grant select, delete on trade_events to x2f_purge;

-- trade_events is append-only: UPDATE is always refused, DELETE only for x2f_purge (Plan 4 deletes
-- a disputed trade's events after its retention), TRUNCATE always.
create function trade_events_append_only() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' and current_user = 'x2f_purge' then
    return old;
  end if;
  raise exception 'trade_events is append-only' using errcode = 'insufficient_privilege';
end
$$;

create trigger trade_events_append_only
  before update or delete on trade_events
  for each row execute function trade_events_append_only();

create trigger trade_events_no_truncate
  before truncate on trade_events
  for each statement execute function trade_events_append_only();

-- x2f_purge may only null the two addresses, never write one.
create function trades_purge_nulls_only() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  if current_user = 'x2f_purge'
     and ((new.buyer_payout is not null and new.buyer_payout is distinct from old.buyer_payout)
       or (new.seller_refund is not null and new.seller_refund is distinct from old.seller_refund)) then
    raise exception 'x2f_purge may only null addresses' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger trades_purge_nulls_only
  before update on trades
  for each row execute function trades_purge_nulls_only();
