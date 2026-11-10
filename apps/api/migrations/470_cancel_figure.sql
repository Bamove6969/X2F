-- J-21 (owner 2 Nov 01:50, register T-017): "all cancel types grouped into ONE cancel figure, seen
-- ONLY by moderators as an extra stat on the account (not public)". 308's buyer-only count becomes
-- that figure: `cancels`, the trades this account ended as a cancel of any kind (traders/tradedTotal.ts
-- `countCancel` says who ended which), counted once per trade by a `trade_totals_counted` row of kind
-- 'cancel'. Never in a trader-facing answer; the moderator's case view reads it.
alter table account_traded_totals rename column buyer_cancels to cancels;
alter table account_traded_totals rename constraint account_traded_totals_buyer_cancels_check to account_traded_totals_cancels_check;

-- The buyer cancels already counted stay counted, now under the one kind.
alter table trade_totals_counted drop constraint trade_totals_counted_kind_check;
update trade_totals_counted set kind = 'cancel' where kind = 'buyer-cancel';
alter table trade_totals_counted add constraint trade_totals_counted_kind_check check (kind in ('completed', 'cancel', 'action-times'));
