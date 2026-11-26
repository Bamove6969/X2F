-- Owner 26 Nov 2026 (thread "Design owner area and staff pay"): a moderator's or senior moderator's
-- dispute pay is a percentage (0-100%) of X2F's 1% fee on the trade whose dispute they rule. The
-- percentage is the owner's number: a default per role here, and an optional per-person number on
-- `staff_members` that overrides it. The existing US-cent amounts per dispute (420) stay as the
-- minimum a completed dispute pays, so a full refund (X2F takes no fee) or a small trade still pays.
-- All ship unset. Paid at clock-out from the payroll wallet (840), like every other pay item.
-- Percentages are basis points of the fee (10000 = 100%), never of the trade.
alter table settings
  add column pay_mod_fee_bp integer check (pay_mod_fee_bp between 0 and 10000),
  add column pay_senior_fee_bp integer check (pay_senior_fee_bp between 0 and 10000);

-- The owner's per-person percentage; null = the role's default. `pay_tap_id` is the security-key
-- tap (intent `staff-pay`) that set it.
alter table staff_members
  add column pay_fee_bp integer check (pay_fee_bp between 0 and 10000),
  add column pay_tap_id uuid references key_taps (id),
  add column pay_set_at timestamptz;

-- The percentage share is its own pay item, kind `fee-share` (XMR, set aside when the dispute
-- completes, like `large-trade`): one per dispute (the unique index of 420), reversed by a clawback
-- when the ruling is overruled. The `dispute` item then carries only the minimum top-up, if any.
alter table staff_pay_items drop constraint staff_pay_items_kind_check;
alter table staff_pay_items add constraint staff_pay_items_kind_check check (kind in ('dispute', 'large-trade', 'fee-share', 'clawback'));
alter table staff_pay_items add constraint staff_pay_items_fee_share_check check (kind <> 'fee-share' or (usd_cents is null and atomic > 0));

-- Owner 26 Nov 2026: the senior moderator (or the owner) who decides an appeal is paid too, so a
-- dispute's items carry the round that earned them. Round 1's are reversed when the appeal
-- overrules it; round 2's never are. One item of each kind per dispute round.
alter table staff_pay_items add column round smallint not null default 1 check (round in (1, 2));
drop index staff_pay_items_once;
create unique index staff_pay_items_once on staff_pay_items (kind, trade_code, seq, round) where kind <> 'clawback';

create or replace function staff_pay_items_settle_only() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  -- DELETE and TRUNCATE (the statement trigger has no row) are refused before any row is read.
  if tg_op <> 'UPDATE' then
    raise exception 'staff_pay_items: an item is only ever settled, never changed or deleted' using errcode = 'insufficient_privilege';
  end if;
  if new.id = old.id and new.staff_id = old.staff_id and new.kind = old.kind
     and new.seq is not distinct from old.seq and new.round = old.round
     and new.usd_cents is not distinct from old.usd_cents and new.atomic is not distinct from old.atomic
     and new.earned_at = old.earned_at and new.source_item is not distinct from old.source_item
     and (new.trade_code is not distinct from old.trade_code or new.trade_code is null)
     and (new.payout_id is not distinct from old.payout_id or old.payout_id is null) then
    return new;
  end if;
  raise exception 'staff_pay_items: an item is only ever settled, never changed or deleted' using errcode = 'insufficient_privilege';
end
$$;

-- Owner 26 Nov 2026: a flat amount per dispute for each role, US cents, paid on top of the share of
-- the fee (the minimum still applies to the total). Unset = none.
alter table settings
  add column pay_mod_flat_usd_cents bigint check (pay_mod_flat_usd_cents between 0 and 10000000),
  add column pay_senior_flat_usd_cents bigint check (pay_senior_flat_usd_cents between 0 and 10000000);
