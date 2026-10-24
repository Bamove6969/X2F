-- Plan 2, Task 12: payout wallets (spec 6.4). Never a balance, a key or a seed: only the receive
-- address the person pasted, the app it came from and their own label. A removed wallet's address
-- is nulled 90 days after removal (purgeRemovedWalletAddresses).
create table wallets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id) on delete cascade,
  app text not null check (app in ('cake', 'edge', 'feather', 'monerujo', 'stack', 'monero-gui-cli', 'ledger-trezor', 'other')),
  label text not null check (char_length(label) between 1 and 40),
  address text,
  created_at timestamptz not null,
  usable_from timestamptz not null,
  removed_at timestamptz,
  -- Only a removed wallet may lose its address.
  check (address is not null or removed_at is not null)
);

create unique index wallets_account_address on wallets (account_id, address) where removed_at is null;
create index wallets_account on wallets (account_id, created_at);
create index wallets_removed on wallets (removed_at) where removed_at is not null and address is not null;
