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
