-- Owner 2026-11-06 (Q10): in `paid` the buyer may open a dispute 60 minutes after marking paid
-- (was 30), and maintenance pauses that clock like every other trade timer, without changing the
-- poster's own time. The machine keeps the moment as a deadline (`Trade.buyerDisputeFrom`) that
-- `resume` moves by the paused time while the wait still runs. Null = not marked paid.
alter table trades add column buyer_dispute_from timestamptz;

-- Trades marked paid before this migration: 60 minutes on the pause-adjusted paid time
-- (confirm_by - confirm window, which every past resume already moved), so a wait that a
-- maintenance had already paused keeps that pause. Hard-coded 60 = TIMERS.buyerDisputeAfterPaidMin.
update trades
  set buyer_dispute_from = confirm_by - make_interval(mins => confirm_window_min) + interval '60 minutes'
  where paid_at is not null and confirm_by is not null and buyer_dispute_from is null;
