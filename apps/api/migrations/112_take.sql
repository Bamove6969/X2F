-- Plan 3, Task 5: taking an offer. The trades table itself is 103 (built early by Task 6); this adds
-- what the take needs on top of it.

-- Every trade comes from an offer (Task 4 left this key to Task 5). An offer is never deleted,
-- only marked removed, so a trade's offer always exists.
alter table trades add constraint trades_offer_fk foreign key (offer_id) references offers (id);

-- `already-waiting`: one trade waiting for setup or funding per buyer per sell ad (a sell ad serves
-- every buyer at once, one waiting take each; Review Focus 4).
create unique index trades_waiting_per_buyer on trades (offer_id, buyer_account_id)
  where poster = 'seller' and state in ('setup', 'funding');

-- `ad-busy`: one trade waiting for setup or funding per buy ad and amount, so five sellers racing
-- for the same amount get one trade (spec 2.2 step 4).
create unique index trades_waiting_per_amount on trades (offer_id, amount_atomic)
  where poster = 'buyer' and state in ('setup', 'funding');

-- Trades per offer, and the open trades an account is part of (the Starter open-trade count).
create index trades_offer on trades (offer_id);
create index trades_open_seller on trades (seller_account_id) where closed_at is null;
create index trades_open_buyer on trades (buyer_account_id) where closed_at is null;

-- The buyer's payout and the seller's refund address never change once set: Task 8 attests them,
-- and each trader's device checks the attested address against the one its user confirmed. They
-- are set once (the take for the taker, POST /v1/trades/:code/wallet for the poster) and may later
-- only be nulled by the retention purge (x2f_purge, 104).
create function trades_addresses_fixed() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  if (old.buyer_payout is not null and new.buyer_payout is not null and new.buyer_payout is distinct from old.buyer_payout)
     or (old.seller_refund is not null and new.seller_refund is not null and new.seller_refund is distinct from old.seller_refund) then
    raise exception 'trade addresses never change once set' using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end
$$;

create trigger trades_addresses_fixed
  before update of buyer_payout, seller_refund on trades
  for each row execute function trades_addresses_fixed();
