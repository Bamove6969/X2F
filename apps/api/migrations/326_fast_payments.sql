-- R-042 (owner p11-20, 9 Nov 2026, replacing R-037's "Fast = median of both lists"): "the system
-- accumulates and keeps track of how many times the person sends the payment in less than half the
-- time they have to make a payment ... a total of 30 times ... then they earn the badge".
--
-- account_traded_totals.fast_payments: the account's payments, as the buyer, sent in strictly less
-- than half the trade's time to pay (`pay_window_min`), measured from the escrow being secured to
-- the "I've paid" tap. A running count with no trade code and no date, so it survives the 30-day
-- trade delete (like the other running totals, 308). traders/actionTimes.ts countFastPayment adds one
-- when the seller releases the trade, once per trade (`trade_totals_counted` kind 'fast-payment').
-- Never returned as a number: only the Fast badge (@x2f/reputation FAST_MIN_PAYMENTS) shows.
alter table account_traded_totals add column fast_payments integer not null default 0 check (fast_payments >= 0);

alter table trade_totals_counted drop constraint trade_totals_counted_kind_check;
alter table trade_totals_counted add constraint trade_totals_counted_kind_check
  check (kind in ('completed', 'buyer-cancel', 'action-times', 'fast-payment'));
