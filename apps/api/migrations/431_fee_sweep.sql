-- Plan 4 Task 9 / B-006 (owner 2026-10-29 lead calls q7): the fee wallet stays online (hot). When its
-- balance reaches a threshold the owner sets, the excess moves automatically to the owner's cold
-- (offline) wallet, leaving enough in the hot wallet for one day plus one night of staff pay, and
-- the owner is notified. Numbered 431 (J-13's reserved 430-439).
--
-- 1. The owner's sweep settings, on Task 8's one-row `settings` (206). They ship unset: a null
--    threshold means the sweep is OFF. Turning it on needs all three: the threshold, the float to
--    leave behind (the owner's "one day plus one night of staff pay", in atomic units) and the cold
--    address, with the threshold above the float. Only the cold wallet's ADDRESS is ever stored: no
--    cold key is online. `fee_sweep_tap_id` is the security-key tap that authorised the current
--    values (intent `fee-sweep`); `fee_sweep_set_at` when they were set.
alter table settings
  add column fee_sweep_threshold_atomic numeric(30, 0) check (fee_sweep_threshold_atomic > 0),
  add column fee_sweep_float_atomic numeric(30, 0) check (fee_sweep_float_atomic >= 0),
  add column fee_sweep_cold_address text check (fee_sweep_cold_address ~ '^[1-9A-HJ-NP-Za-km-z]{95}$'),
  add column fee_sweep_tap_id uuid references key_taps (id),
  add column fee_sweep_set_at timestamptz,
  add constraint settings_fee_sweep_on check (
    fee_sweep_threshold_atomic is null
    or (fee_sweep_float_atomic is not null and fee_sweep_cold_address is not null
        and fee_sweep_threshold_atomic > fee_sweep_float_atomic)
  );

-- 2. Every sweep attempt, for the owner (amounts only; the address is the setting's). An attempt is
--    written `pending` and committed BEFORE the send, which runs outside any transaction; a second
--    transaction settles it (`sent` with its tx hash, or `failed`) and stamps `settled_at`. A row
--    left `pending` (the process died mid-send) has an unknown result, so, like a `failed` one, it
--    holds every later pass until the owner saves the sweep settings again (no repeat sends or
--    alerts every pass).
create table fee_sweeps (
  id bigserial primary key,
  at timestamptz not null,
  balance_atomic numeric(30, 0) not null check (balance_atomic > 0),
  amount_atomic numeric(30, 0) not null check (amount_atomic > 0),
  keep_atomic numeric(30, 0) not null check (keep_atomic >= 0),
  outcome text not null check (outcome in ('pending', 'sent', 'failed')),
  tx_hash text check (tx_hash ~ '^[0-9a-f]{64}$'),
  settled_at timestamptz,
  check ((outcome = 'sent') = (tx_hash is not null)),
  check ((outcome = 'pending') = (settled_at is null))
);
