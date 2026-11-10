-- Owner F9 (7 Nov): the seller's confirm window, which is also the buyer's wait from "I've paid"
-- before a dispute, is 90 min for instant payment types, 24 h for same or next day, and 48 h to
-- 4 days for slow types ("raise the 24 h maximum"). The cap follows @x2f/trade's
-- MAX_CONFIRM_WINDOW_MIN (5760 min, 4 days). Rows already written keep their window.
alter table trades drop constraint trades_confirm_window_min_check;
alter table trades add constraint trades_confirm_window_min_check check (confirm_window_min between 1 and 5760);
