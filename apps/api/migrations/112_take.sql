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

-- The deal and the addresses are written once and never updated (Plan 3 rule; Task 5 review I1).
-- Task 8 attests them, and each trader's device checks the attested deal and addresses against the
-- ones its user confirmed, so no role may change them later, whatever an app path does:
--   - The deal: the offer, the parties, who posted, the method, the locked rate and currency, the
--     confirm window, the offer range at take and the take's amount and total. Growth (spec 11.1)
--     changes amount_atomic and fiat_cents and keeps the take's in grown_from_*, so the take's
--     amount is coalesce(grown_from_atomic, amount_atomic), and the same for the total.
--   - buyer_payout and seller_refund: set once from null while the trade is in setup (the take for
--     the taker, POST /v1/trades/:code/wallet for the poster). Once set, only x2f_purge may change
--     one, only to null, and only on a closed trade (the 90-day purge, 104); a purged address is
--     never written again. seller_wallet_app is set with seller_refund and never changes.
-- State, timestamps, the escrow fields and the dispute fields stay writable (Tasks 6, 9, 27).
create function trades_deal_fixed() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
declare
  purge boolean := current_user = 'x2f_purge';
begin
  if new.offer_id is distinct from old.offer_id
     or new.poster is distinct from old.poster
     or new.seller_account_id is distinct from old.seller_account_id
     or new.buyer_account_id is distinct from old.buyer_account_id
     or new.method_id is distinct from old.method_id
     or new.locked_currency is distinct from old.locked_currency
     or new.locked_cents_per_xmr is distinct from old.locked_cents_per_xmr
     or new.confirm_window_min is distinct from old.confirm_window_min
     or new.min_fiat_cents is distinct from old.min_fiat_cents
     or new.max_fiat_cents is distinct from old.max_fiat_cents
     or new.taken_at is distinct from old.taken_at
     or coalesce(new.grown_from_atomic, new.amount_atomic) is distinct from coalesce(old.grown_from_atomic, old.amount_atomic)
     or coalesce(new.grown_from_fiat_cents, new.fiat_cents) is distinct from coalesce(old.grown_from_fiat_cents, old.fiat_cents) then
    raise exception 'a trade''s deal never changes' using errcode = 'integrity_constraint_violation';
  end if;
  -- Once set: only the purge, only to null, only after close.
  if (old.buyer_payout is not null and new.buyer_payout is distinct from old.buyer_payout
        and not (purge and new.buyer_payout is null and old.closed_at is not null))
     or (old.seller_refund is not null and new.seller_refund is distinct from old.seller_refund
        and not (purge and new.seller_refund is null and old.closed_at is not null))
     or (old.seller_wallet_app is not null and new.seller_wallet_app is distinct from old.seller_wallet_app) then
    raise exception 'trade addresses never change once set' using errcode = 'integrity_constraint_violation';
  end if;
  -- Set from null: only in setup, never by the purge (so a purged address stays null).
  if ((old.buyer_payout is null and new.buyer_payout is not null)
      or (old.seller_refund is null and new.seller_refund is not null)
      or (old.seller_wallet_app is null and new.seller_wallet_app is not null))
     and (purge or old.state <> 'setup') then
    raise exception 'trade addresses are set only in setup' using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end
$$;

-- Named to run after 104's trades_purge_nulls_only (triggers fire in name order), so x2f_purge
-- writing an address is still refused there first, as insufficient_privilege.
create trigger trades_set_once_deal
  before update on trades
  for each row execute function trades_deal_fixed();
