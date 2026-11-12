-- Plan 4 Task 14: the moderation process checkpoints and verifies the activity log's hash chain
-- (apps/moderation/src/checkpoint.ts, through @x2f/logchain). Its read-only role (211) saw only
-- who acted (actor_kind, actor_id, for R37); it now reads every column the chain hashes and links,
-- so it can recompute the chain itself. Read only: it still writes nothing (no insert, update or
-- delete grant on any table), and the checkpoint and the alarm reach the API as signed internal
-- reports (`log-checkpoint`, `log-alarm`). The log holds ids, enums, codes and amounts only (Task 3),
-- never chat text, notes, addresses or IP addresses.
grant select (id, at, actor_role, trade_code, action, detail, prev_hash, hash) on activity_log to x2f_mod_reader;
