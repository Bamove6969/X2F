-- Plan 3, Task 9 I/O, review round 2 (R2-I1 b): every sweep tx the chain watcher counted, for ONE
-- trade only. A tx a party could make the mod's wallet attribute to a second escrow (forged partial
-- key images, wallet2 does not check them) is then never counted twice: the watcher records the tx
-- before it reports `settled`, and a tx already recorded for another trade is logged
-- (`sweep-counted-elsewhere`) and never counted (that trade's 6 h fallback escalates instead).
-- Numbered 005: 002 is Task 20's 002_chat.sql, 003 this branch's 003_watch.sql, 004 Task 10's
-- 004_signals.sql (wip/second-p3-task10).
create table mod_sweeps (
  tx_hash text primary key check (tx_hash ~ '^[0-9a-f]{64}$'),
  trade text not null,
  counted_at timestamptz not null default now()
);

revoke all on mod_sweeps from public;
