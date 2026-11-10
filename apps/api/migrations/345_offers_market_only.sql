-- J-02, owner Q1 (6 Nov 2026: "all offers are going to be market + whatever percentage") and F1
-- (7 Nov: above or below the market, at most 50%): there are no fixed-price offers. From here on
-- every new or changed offer row is market-priced: a margin, no fixed price.
--
-- NOT VALID: a row stored as fixed before this rule is kept exactly as it was (no data is deleted
-- or rewritten here). The API never lists, shows, switches or takes such a row (offers/routes.ts
-- MARKET_PRICED, trades/take.ts). What happens to those rows is an open owner question (J-02
-- BLOCKED commit); once it is answered, a later migration converts or removes them, validates this
-- constraint and drops price_mode and fixed_cents_per_xmr.
alter table offers add constraint offers_market_only
  check (price_mode = 'market' and margin_bps is not null and fixed_cents_per_xmr is null) not valid;
