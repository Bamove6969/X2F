-- Owner 26 Nov 2026: the hot payroll wallet (wallet 2) pays staff automatically at clock-out. Each
-- completed trade pays half of its 1% to it (the other half to the watch-only fee wallet), and any
-- balance over the owner's cap is swept to the fee wallet (431's sweep, now from this wallet).
--
-- Every send of a recorded payout (`staff_payouts`, `waiting-send`) is an attempt here, written
-- `pending` and committed BEFORE the wallet is asked; a second transaction settles it:
-- - `sent`: the wallet answered with its tx hash; the payout is settled `sent` with it;
-- - `refused`: the wallet answered with an error, so nothing went out (low balance, coins still
--   locked); the payout stays `waiting-send` and a later pass tries again;
-- - `unknown`: no answer (a timeout, a dropped connection): it may have gone out, so the payout is
--   never sent again by itself; the owner checks the wallet;
-- - `blocked`: the payout's address no longer matches the tap that approved it, or was removed
--   (security review 12 Nov M2); the payout is settled `failed` and nothing is sent.
-- A `pending` row left by a process that died mid-send is read as `unknown`. At most one attempt per
-- payout that is not `refused` (the unique index), so a payout is never sent twice.
create table staff_payout_sends (
  id bigserial primary key,
  payout_id uuid not null references staff_payouts (id),
  started_at timestamptz not null,
  outcome text not null check (outcome in ('pending', 'sent', 'refused', 'unknown', 'blocked')),
  tx_hash text check (tx_hash ~ '^[0-9a-f]{64}$'),
  -- The wallet's network fee for a sent payout, when it said (paid on top of the payout).
  network_fee_atomic numeric(30, 0) check (network_fee_atomic >= 0),
  settled_at timestamptz,
  check ((outcome = 'sent') = (tx_hash is not null)),
  check ((outcome = 'pending') = (settled_at is null))
);
create unique index staff_payout_sends_once on staff_payout_sends (payout_id) where outcome <> 'refused';
create index staff_payout_sends_payout on staff_payout_sends (payout_id, id desc);

-- An attempt only ever settles once, from `pending`; never deleted or truncated.
create function staff_payout_sends_settle_only() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  if tg_op = 'UPDATE' and old.outcome = 'pending' and new.outcome <> 'pending'
     and new.id = old.id and new.payout_id = old.payout_id and new.started_at = old.started_at then
    return new;
  end if;
  raise exception 'staff_payout_sends: an attempt only ever settles once' using errcode = 'insufficient_privilege';
end
$$;

create trigger staff_payout_sends_settle_only
  before update or delete on staff_payout_sends
  for each row execute function staff_payout_sends_settle_only();

create trigger staff_payout_sends_no_truncate
  before truncate on staff_payout_sends
  for each statement execute function staff_payout_sends_settle_only();

-- The sweep's own network fee, when the wallet said (the treasury's sends record what they paid).
alter table fee_sweeps add column network_fee_atomic numeric(30, 0) check (network_fee_atomic >= 0);
