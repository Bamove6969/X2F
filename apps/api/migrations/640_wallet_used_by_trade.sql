-- Owner, 17 Nov 2026 (note #6 Q10): a one-time wallet used up by a trade that then ends in `setup`
-- (cancelled, walked away from or expired, before any XMR was funded) is open again. `used_by_trade`
-- is the code of the trade that used it up (set with `removed_at` by wallets/routes.ts
-- `useUpOneTimeWallet`, cleared when it is restored or when a removal of the wallet applies meanwhile,
-- so a wallet the person removed never comes back). No foreign key to `trades`, for the lock order of
-- migration 016 (trade row, then account) and because a trade's addresses outlive nothing here.
alter table wallets add column used_by_trade text;
alter table wallets add constraint wallets_used_one_time check (used_by_trade is null or (one_time and removed_at is not null));
create index wallets_used_by_trade on wallets (used_by_trade) where used_by_trade is not null;
