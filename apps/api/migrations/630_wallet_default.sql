-- Owner, 17 Nov 2026 (answer to note #6 Q1, overriding OD-11 "no default payout wallet"): "If they only
-- have one wallet saved then that's the default. If they have multiple they can choose to have one as
-- the default that will automatically be selected for the trade but they can change to a different".
-- `is_default` is the one the person chose (PUT /v1/wallets/:id/default). The default the app shows
-- (`isDefault` on GET /v1/wallets, wallets/routes.ts `effectiveDefault`) is that wallet while it is
-- open, else the account's only usable saved wallet, else none. It is only what the trade screen picks
-- first: the take still names a wallet, and any usable wallet of the account may be named.
-- A one-time wallet is never the default. A removed wallet keeps its flag but is never open again.
alter table wallets add column is_default boolean not null default false;
alter table wallets add constraint wallets_default_saved check (not (is_default and one_time));
create unique index wallets_one_default on wallets (account_id) where is_default and removed_at is null;
