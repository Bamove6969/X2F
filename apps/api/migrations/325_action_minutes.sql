-- Offer cards' trust row (design review 8 Nov, item 5: "Releases in ~8 min" / "Pays in ~6 min" and the
-- Fast badge). Plan 5 P5-A8: a trader's typical time is the median of their own action times over
-- their last 20 completed trades, as buyer `paid_at - secured_at` (0 when paid before secured), as
-- seller the `release-started` event time `- paid_at`; null below 3. Lead call 2026-10-29 (Plan 5
-- Task 20): each account keeps its last 20 durations in minutes, with no trade code and no date, so
-- the numbers survive the 30-day trade delete.
--
-- One row per account and kind. `minutes` is oldest first, at most 20 whole minutes, never negative.
-- traders/actionTimes.ts appends in the transaction that stores the trade's `released` event, once
-- per trade (a `trade_totals_counted` row of kind 'action-times', which goes with the trade). A
-- release by a dispute ruling is not the seller's own action and adds nothing.
create table account_action_minutes (
  account_id uuid not null references accounts (id),
  kind text not null check (kind in ('pay', 'release')),
  minutes integer[] not null default '{}' check (cardinality(minutes) <= 20 and 0 <= all (minutes)),
  primary key (account_id, kind)
);

alter table trade_totals_counted drop constraint trade_totals_counted_kind_check;
alter table trade_totals_counted add constraint trade_totals_counted_kind_check check (kind in ('completed', 'buyer-cancel', 'action-times'));
