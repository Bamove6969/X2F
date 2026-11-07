-- The buyer's dispute wait in `paid` (owner 2026-11-06 Q10, then 2026-11-07 F9).
--
-- F9: the wait depends on the payment type, fixed at take from the method profile
-- (`Trade.buyerDisputeWaitMin`): 90 minutes for instant types, 3 hours Faster Payments, 24 hours
-- same or next day, 48 hours ACH, 72 hours SWIFT, 4 days cash by mail. At most the seller's
-- confirm window, and both may now be up to 4 days (`MAX_TRADE_WINDOW_MIN`, was 24 hours).
--
-- Q10: maintenance pauses the wait like every other trade timer, without changing the poster's own
-- time. The machine keeps the moment as a deadline (`Trade.buyerDisputeFrom` = paid time + wait)
-- that `resume` moves by the paused time while the wait still runs. Null = not marked paid.
alter table trades
  drop constraint trades_confirm_window_min_check,
  add constraint trades_confirm_window_min_check check (confirm_window_min between 1 and 5760),
  add column buyer_dispute_wait_min integer
    check (buyer_dispute_wait_min between 1 and confirm_window_min),
  add column buyer_dispute_from timestamptz;

-- BACKFILL
-- Trades taken before this migration keep the rule they were taken under: the buyer may dispute
-- when the seller's confirm window ends, so the wait is the confirm window and, once marked paid,
-- opens at confirm_by (which every past resume already moved). A null wait reads as the confirm
-- window in the API (`rowToTrade`), the same rule.
update trades
  set buyer_dispute_wait_min = confirm_window_min
  where buyer_dispute_wait_min is null;
update trades
  set buyer_dispute_from = confirm_by
  where paid_at is not null and confirm_by is not null and buyer_dispute_from is null;
-- END BACKFILL
