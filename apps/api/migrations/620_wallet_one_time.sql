-- Owner demo note #6 (16 Nov 2026; docs/trade-wallet-note6.md): a payout wallet may be for one trade
-- only. A one-time wallet is listed and usable like any other until a trade uses it: the take (or the
-- poster's wallet route) writes its address into the trade, as for every wallet, and marks it removed
-- in the same transaction, so it is never listed or offered again (its address is nulled 90 days
-- later by purgeRemovedWalletAddresses, like every removed wallet). The trade keeps its own copy of the
-- address (trades.buyer_payout / seller_refund, write-once, 112_take.sql); nothing here touches it.
-- Every wallet added before this migration is saved for future trades.
alter table wallets add column one_time boolean not null default false;
