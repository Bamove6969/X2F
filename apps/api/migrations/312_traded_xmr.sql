-- Owner Q63 (6 Nov 2026): the offer card shows the amount traded to date IN XMR, not dollars.
-- account_traded_totals (308) gains the XMR running total, added by the same idempotent count
-- (traders/tradedTotal.ts countTradeTotals): the final `trades.amount_atomic` of every COMPLETED
-- trade, both sides. The dollar total stays (moderators; never public now).
alter table account_traded_totals add column own_xmr_atomic numeric(30, 0) not null default 0 check (own_xmr_atomic >= 0);

-- Backfill from the trades already counted that are still stored. A trade purged before this
-- migration added its dollars but its XMR is lost: its account's XMR line starts lower (pre-launch,
-- test data only).
update account_traded_totals tt set own_xmr_atomic = s.xmr
  from (
    select a.id, sum(t.amount_atomic) as xmr
      from trade_totals_counted c join trades t on t.code = c.trade_code
      cross join lateral (values (t.buyer_account_id), (t.seller_account_id)) as a (id)
     where c.kind = 'completed'
     group by a.id
  ) s
 where s.id = tt.account_id;
