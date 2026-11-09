-- Owner p9-6 (8 Nov): the buyer's time to pay depends on the payment method. Each trade keeps the
-- method's time to pay from take (`Trade.payWindowMin`), so a later change to the method's
-- profile never moves a live trade. Rows already written were taken under the flat 90 minutes and
-- keep it. The cap follows @x2f/trade's MAX_PAY_WINDOW_MIN (1440 min, 24 hours).
alter table trades add column pay_window_min integer not null default 90
  check (pay_window_min between 1 and 1440);
-- Every new trade names its own window (the take writes it): no default from here on.
alter table trades alter column pay_window_min drop default;

-- Part of the deal, like confirm_window_min (112's trades_deal_fixed): it never changes once written.
create function trades_pay_window_fixed() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  if new.pay_window_min is distinct from old.pay_window_min then
    raise exception 'a trade''s deal never changes' using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end
$$;

create trigger trades_set_once_pay_window
  before update on trades
  for each row execute function trades_pay_window_fixed();
