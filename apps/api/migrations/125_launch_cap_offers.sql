-- The launch cap (owner p11-6; launch-rules review F1): one trade is worth at most $5,000
-- (@x2f/trade LAUNCH_TRADE_CAP_USD_CENTS, 500000 US cents). Posting and relisting refuse an offer
-- whose maximum is above it; an offer posted before the cap may still be live with a larger one.
-- Pause those, as their owner would (the status My offers' Turn off writes): a relist then runs the
-- cap check and refuses until the maximum is lowered. Only US-dollar offers can be judged here: the
-- exchange rates live in the API's memory, not the database. An offer in any other currency stays
-- as it is; its takes are still refused above the cap, and its trades' growth is clamped at take.
update offers
   set status = 'paused', updated_at = now()
 where status = 'live' and currency = 'USD' and max_fiat_cents > 500000;
