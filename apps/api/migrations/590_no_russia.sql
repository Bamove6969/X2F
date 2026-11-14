-- Sanctioned countries (owner 12 Nov: "Russian anything is banned"; "I'm sticking to the US
-- sanction laws"). RUB left the price list and SBP, MIR and YOOMONEY left the payment-method
-- catalog (docs/sanctioned-countries-2026-11-12.md). IRR, KPW, CUP and CUC were never offerable.
--
-- Any offer that still names one of them is removed, exactly as its owner's Remove does
-- (offers/routes.ts): status 'removed' and no payment details kept at rest. An offer's currencies
-- and methods are written once (J-16), so an offer that is only partly affected is removed whole;
-- its owner can post the rest again. Already-removed offers get the same blanking. Trades, reviews
-- and the revenue ledger keep their records: nothing there can be taken or posted.
create temporary table banned_offers on commit drop as
  select o.id, o.status from offers o
   where exists (select 1 from offer_currencies c where c.offer_id = o.id and c.currency in ('RUB', 'IRR', 'KPW', 'CUP', 'CUC'))
      or exists (select 1 from offer_methods m where m.offer_id = o.id and m.method_id in ('SBP', 'MIR', 'YOOMONEY'));

-- A fixed-price row from before 345 is left as it is (its NOT VALID check refuses any change to it):
-- the API never lists, shows or takes one (MARKET_PRICED), and its payment details are blanked below.
update offers set status = 'removed', updated_at = now()
 where id in (select id from banned_offers where status <> 'removed') and price_mode = 'market';
update offer_methods set instructions = ''
 where offer_id in (select id from banned_offers) and instructions <> '';
update offer_method_currencies set instructions = null
 where offer_id in (select id from banned_offers) and instructions is not null;
