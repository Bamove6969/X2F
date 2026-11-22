-- Plan 7 Task 2, lead follow-up (the moderation-database purge): a purged trade's moderation side.
-- The whole-trade purge (retention/tradePurge.ts) writes one of these in the same statement that
-- deletes the trade, as x2f_purge (104, 701), so no trade is ever gone without it, the way
-- purgeChats writes chat_shred_orders (123):
--
-- trade_shred_orders: one row per purged trade until the moderation service confirms it destroyed
--   its own per-trade records (the signed terms with both addresses, the sealed party state, the
--   wallet password and escrow state, the watch state, the desk, the counted sweeps). Served on
--   GET /internal/v1/trade-shred; removed by the report { kind: 'trade-shredded', trade }. The order
--   is only a trigger: moderation destroys nothing until its own records say the trade is over and
--   its escrow is shown empty. `served_at`: when the list last served the order (least recently
--   served first, as 123's review M4). It keeps the trade code only until moderation reports.
create table trade_shred_orders (
  trade text primary key,
  purged_at timestamptz not null,
  served_at timestamptz
);

-- Insert only, plus the key column the insert's `on conflict do nothing` checks (Postgres needs
-- select on the arbiter column). x2f_purge reads nothing else here and deletes nothing.
grant insert on trade_shred_orders to x2f_purge;
grant select (trade) on trade_shred_orders to x2f_purge;
