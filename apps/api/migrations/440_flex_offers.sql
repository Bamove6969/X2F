-- J-16, Plan 3 Tasks 34/35: flexible offers (owner 29 Oct; several currencies 2 Nov; the numbers of
-- 6 Nov Q23: at most 3 bands per currency and 5 payment types per offer). Rebuilt from claude2's
-- Task 34 migration (117_flex_offers on wip/second-p3-task34 c2d1006c) on top of offer units (324),
-- minimum-trades choices (315) and market-only offers (345). Numbered 440 (440-449 free for J-16).
--
-- One offer lists up to 5 currencies, each with its own price bands by amount, and up to 5 payment
-- methods, each offered in some or all of those currencies (@x2f/trade flexOffer.ts). The offer
-- keeps its amount unit (324: 'fiat' or 'xmr', one per offer); every band is in that unit.
--
-- An offer is never edited after it is posted (only its status changes), so its currencies, bands
-- and methods are written once, in the posting transaction, and never change (the triggers below),
-- except that a removed offer's instructions are blanked (Task 34 review M3: payment details are not
-- kept at rest once nothing can be taken). All reference the offer `on delete cascade`, so deleting
-- an offer deletes its payment details with it.
--
-- Fixed prices (J-02): an offer stored as fixed before 345 stays exactly as invisible as it is today
-- (offers.price_mode and fixed_cents_per_xmr are kept; the API's MARKET_PRICED leaves it out). Its
-- band below gets margin 0 only because the column needs a number: what happens to those rows is
-- still the owner's call (J-02 BLOCKED d7217fa5).

-- The offer's currencies, in the poster's order (position 0 is the one shown first).
create table offer_currencies (
  offer_id uuid not null references offers (id) on delete cascade,
  position smallint not null check (position between 0 and 4),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  primary key (offer_id, currency),
  unique (offer_id, position)
);

-- Bands, per currency, in the poster's order sorted by start: inclusive ranges in the offer's unit
-- (fiat: that currency's minor units, as the bands typed in whole units cover them; xmr: atomic
-- units), each with its margin over that currency's market, its trade rule (null: no minimum; as
-- 315) and optionally the payment types it is for (method_ids, null: every method of the offer in
-- that currency). Bands may share amounts when they differ by a condition (owner Q20/F3); the API
-- checks the rule (@x2f/trade checkBands). At most 3 per currency (owner Q23): the API refuses more;
-- the position check here is only a backstop.
create table offer_tiers (
  offer_id uuid not null,
  currency text not null,
  position smallint not null check (position between 0 and 9),
  min_amount numeric(30, 0) not null check (min_amount > 0),
  max_amount numeric(30, 0) not null,
  margin_bps integer not null check (margin_bps between -5000 and 5000),
  min_trades integer check (min_trades in (5, 10, 25, 50)),
  method_ids text[] check (method_ids is null or cardinality(method_ids) between 1 and 10),
  primary key (offer_id, currency, position),
  foreign key (offer_id, currency) references offer_currencies (offer_id, currency) on delete cascade,
  check (max_amount >= min_amount)
);

-- Methods, in the poster's order (`position`): each with its shared instructions (the payment details,
-- shown only to the poster and, once the escrow is secured, to the trade's two traders) and a price
-- adjustment, a percent of the market in basis points (owner via design, 29 Oct b). The API keeps
-- every margin + adjustment within ±50% (rateFor's range) and at most 5 methods (owner Q23).
create table offer_methods (
  offer_id uuid not null references offers (id) on delete cascade,
  position smallint not null check (position between 0 and 9),
  method_id text not null check (char_length(method_id) between 1 and 64),
  instructions text not null check (char_length(instructions) <= 1000),
  adjust_bps integer not null check (adjust_bps between -2000 and 2000),
  primary key (offer_id, method_id),
  unique (offer_id, position)
);

-- Which method is offered in which of the offer's currencies (one row per pair; browsing filters by
-- the pair), and the pair's own instructions where they differ from the method's shared ones (owner
-- 2 Nov via the lead, Q3: a bank transfer in USD = account + routing, in EUR = IBAN); null = the
-- method's shared instructions. `on update cascade`: nothing updates a method's id (the written-once
-- triggers refuse it); the cascade only lets a test rename a method in one statement.
create table offer_method_currencies (
  offer_id uuid not null,
  method_id text not null,
  currency text not null,
  instructions text check (char_length(instructions) <= 1000),
  primary key (offer_id, method_id, currency),
  foreign key (offer_id, method_id) references offer_methods (offer_id, method_id) on delete cascade on update cascade,
  foreign key (offer_id, currency) references offer_currencies (offer_id, currency) on delete cascade
);

-- Written once: no change to a currency or a band, and no change to a method or a pair but blanking
-- its instructions (the removal). Deletes go through the offer's cascade. plpgsql does not
-- short-circuit, so each function compares only its own table's columns.
create function offer_parts_written_once() returns trigger language plpgsql as $$
begin
  raise exception 'an offer''s currencies, bands and methods are written once (J-16)';
end;
$$;
create function offer_methods_written_once() returns trigger language plpgsql as $$
begin
  if new.offer_id = old.offer_id and new.position = old.position and new.method_id = old.method_id
     and new.adjust_bps = old.adjust_bps and new.instructions = '' then
    return new;
  end if;
  raise exception 'an offer''s currencies, bands and methods are written once (J-16)';
end;
$$;
create function offer_method_currencies_written_once() returns trigger language plpgsql as $$
begin
  if new.offer_id = old.offer_id and new.method_id = old.method_id and new.currency = old.currency
     and new.instructions is null then
    return new;
  end if;
  raise exception 'an offer''s currencies, bands and methods are written once (J-16)';
end;
$$;
create trigger offer_currencies_written_once before update on offer_currencies for each row execute function offer_parts_written_once();
create trigger offer_tiers_written_once before update on offer_tiers for each row execute function offer_parts_written_once();
create trigger offer_methods_written_once before update on offer_methods for each row execute function offer_methods_written_once();
create trigger offer_method_currencies_written_once before update on offer_method_currencies for each row execute function offer_method_currencies_written_once();

-- Browsing reads the live offers taking one method in one currency.
create index offer_method_currencies_pair on offer_method_currencies (currency, method_id, offer_id);

-- Every existing offer becomes one currency, one band and one method: its currency, its range in its
-- own unit (exactly as stored: an old fiat range need not be whole units), margin and trade rule, and
-- its method with no instructions and no adjustment, offered in that currency.
insert into offer_currencies (offer_id, position, currency) select id, 0, currency from offers;
insert into offer_tiers (offer_id, currency, position, min_amount, max_amount, margin_bps, min_trades, method_ids)
  select id, currency, 0,
         case when amount_unit = 'xmr' then min_atomic else min_fiat_cents end,
         case when amount_unit = 'xmr' then max_atomic else max_fiat_cents end,
         coalesce(margin_bps, 0), min_trades, null
    from offers;
insert into offer_methods (offer_id, position, method_id, instructions, adjust_bps) select id, 0, method_id, '', 0 from offers;
insert into offer_method_currencies (offer_id, method_id, currency, instructions) select id, method_id, currency, null from offers;

-- The method, the currency, the margin, the range and the trade rule now live in the rows above. An
-- offer is its side, unit, terms, gift-card country and status (and J-02's price_mode and
-- fixed_cents_per_xmr, until the owner rules on old fixed rows). Dropping the columns drops the
-- checks on them (102's, 315's offers_min_trades_check, 324's offers_amount_pair, 345's
-- offers_market_only) and 102's offers_live index; the market-only rule and the index come back on
-- the columns that remain.
alter table offers drop column method_id;
alter table offers drop column currency;
alter table offers drop column margin_bps;
alter table offers drop column min_fiat_cents;
alter table offers drop column max_fiat_cents;
alter table offers drop column min_atomic;
alter table offers drop column max_atomic;
alter table offers drop column min_trades;
alter table offers add constraint offers_market_only check (price_mode = 'market' and fixed_cents_per_xmr is null) not valid;
create index offers_live on offers (side) where status = 'live';

-- The take locks the chosen method's instructions for the chosen currency into the trade with the
-- method; the trade's min/max_fiat_cents are the chosen band's fiat limits and locked_cents_per_xmr
-- the final rate (band margin + method adjustment) in the chosen currency (locked_currency). Trades
-- from before this migration had no instructions.
alter table trades add column method_instructions text not null default '' check (char_length(method_instructions) <= 1000);

-- 112's trigger, with method_instructions added to the deal that never changes.
create or replace function trades_deal_fixed() returns trigger
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
     or new.method_instructions is distinct from old.method_instructions
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
