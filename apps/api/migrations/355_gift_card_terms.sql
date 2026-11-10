-- J-17 (owner F13, T-081): gift-card tick-box terms. The poster of a gift-card offer and the taker of
-- one each tick their side's terms; the API keeps the version of the words they ticked
-- (@x2f/trade GIFT_CARD_TERMS_VERSION, COPY-UNSIGNED until design signs them), so a dispute can see
-- what each side agreed to. Null on every other offer and trade (the API refuses a version there).
-- The trade's column goes with the trade at its 30-day delete.
alter table offers add column gift_card_terms text check (char_length(gift_card_terms) between 1 and 64);
alter table trades add column gift_card_terms text check (char_length(gift_card_terms) between 1 and 64);

-- What the taker agreed to never changes (as the deal, 112's trades_deal_fixed).
create function trades_gift_card_terms_fixed() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  if new.gift_card_terms is distinct from old.gift_card_terms then
    raise exception 'a trade''s gift-card terms never change' using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end
$$;

create trigger trades_set_once_gift_card_terms
  before update on trades
  for each row execute function trades_gift_card_terms_fixed();
