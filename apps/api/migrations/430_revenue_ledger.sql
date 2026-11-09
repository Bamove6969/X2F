-- Plan 4 Task 32 (B-004, owner 2026-10-28 Q3 and 2026-10-29c): the internal revenue ledger. Numbered
-- 430: the lead reserved 430-439 for this job (J-13, owner-answers-assignments section 1).
--
-- The owner's rules: the poster pays the 1% on a released trade and on a settled dispute whose
-- payout carries the fee; a cancel of any kind (buyer cancel, walk-away, mutual cancel, no-show or
-- lapse refund) never pays. A party who loses a dispute with no money in the escrow still owes the
-- 1% (Plan 4 Task 12's `fees_owed`); it is revenue on the day it is collected from a later trade.
--
-- 1. revenue_ledger: the aggregate, one row per UTC day, fiat market (the trade's locked currency)
--    and kind ('fee' = a trade's own 1%, 'owed' = an owed fee collected through a later trade). It
--    names no account and no trade, so it survives the 30-day and 90-day trade purges whole.
--    `usd_estimate_cents` is each fee at its trade's take-time USD value, rounded down, summed (an
--    estimate for the owner's totals, never a wallet figure). Only ever added to: an update that
--    lowers a column, a delete and a truncate are refused (trigger below).
create table revenue_ledger (
  day date not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  kind text not null check (kind in ('fee', 'owed')),
  trades integer not null default 0 check (trades >= 0),
  fee_atomic numeric(30, 0) not null default 0 check (fee_atomic >= 0),
  usd_estimate_cents bigint not null default 0 check (usd_estimate_cents >= 0),
  primary key (day, currency, kind)
);

-- 2. revenue_booked: what each trade already added (idempotent per trade and kind). It holds the
--    trade code and the amount only, no account, and goes with its trade (on delete cascade): when
--    the purge removes the trade, the code is gone and the ledger's amounts stay.
create table revenue_booked (
  trade_code text not null references trades (code) on delete cascade,
  kind text not null check (kind in ('fee', 'owed')),
  fee_atomic numeric(30, 0) not null check (fee_atomic > 0),
  booked_at timestamptz not null,
  primary key (trade_code, kind)
);

create function revenue_ledger_add_only() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  if tg_op = 'UPDATE'
     and new.day = old.day and new.currency = old.currency and new.kind = old.kind
     and new.trades >= old.trades and new.fee_atomic >= old.fee_atomic
     and new.usd_estimate_cents >= old.usd_estimate_cents then
    return new;
  end if;
  raise exception 'revenue_ledger is add-only' using errcode = 'insufficient_privilege';
end
$$;

create trigger revenue_ledger_add_only
  before update or delete on revenue_ledger
  for each row execute function revenue_ledger_add_only();

create trigger revenue_ledger_no_truncate
  before truncate on revenue_ledger
  for each statement execute function revenue_ledger_add_only();
