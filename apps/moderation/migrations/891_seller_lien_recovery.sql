-- Seller lien recovery (owner 27 Nov 2026, option (a) of docs/lien-recovery.md "Debtor is the
-- seller"; API migration 891 does the same to its holds). A trade's terms may carry a buyer's
-- `lienRecovery` and a seller's `sellerLienRecovery`, each for its own lien. This service records
-- every recovery it signs (mod_lien_recoveries), so a trade may now have one row per side.
-- `debtor_side`: which party of the trade owes the lien ('buyer' for every row before this
-- migration). One row per trade and side while the trade's code is kept (the trade shred blanks
-- it, TRADE_SHRED_KEPT, and the rows keep counting against their liens).
alter table mod_lien_recoveries add column debtor_side text not null default 'buyer' check (debtor_side in ('buyer', 'seller'));
drop index mod_lien_recoveries_trade;
create unique index mod_lien_recoveries_trade on mod_lien_recoveries (trade, debtor_side) where trade <> '';
