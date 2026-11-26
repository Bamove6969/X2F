-- Owner 16 Nov 2026 (migration 820; written as 600): "the xmr fees are paid by the person who sends the xmr to escrow and then paid
-- by the person who is set to receive it. We should also pay for our fees". A completed trade's
-- payout network fee is shared by its receiving outputs, one equal share per output (Monero's
-- subtract_fee_from_outputs over the buyer's output and X2F's fee output; @x2f/trade
-- `feeWalletNetworkFee`). The books show the network fees X2F paid and the total after them.
-- Add-only next to 430 (430 is not edited).
--
-- 1. revenue_ledger.network_fee_atomic: the network fee X2F's fee outputs paid, summed per day,
--    market and kind (the settlement's day, the trade's market, kind 'fee'). Add-only like the
--    other amounts (the trigger below now covers it).
alter table revenue_ledger
  add column network_fee_atomic numeric(30, 0) not null default 0 check (network_fee_atomic >= 0);

-- 2. revenue_booked.network_fee_atomic: what one trade's fee output paid, set once when the
--    settlement's tx fee is known (the moderation watcher's `settled` report); null until then.
alter table revenue_booked
  add column network_fee_atomic numeric(30, 0) check (network_fee_atomic >= 0);

create or replace function revenue_ledger_add_only() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  if tg_op = 'UPDATE'
     and new.day = old.day and new.currency = old.currency and new.kind = old.kind
     and new.trades >= old.trades and new.fee_atomic >= old.fee_atomic
     and new.usd_estimate_cents >= old.usd_estimate_cents
     and new.network_fee_atomic >= old.network_fee_atomic then
    return new;
  end if;
  raise exception 'revenue_ledger is add-only' using errcode = 'insufficient_privilege';
end
$$;
