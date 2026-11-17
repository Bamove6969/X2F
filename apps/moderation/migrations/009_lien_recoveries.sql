-- Lien recovery, review B1 (2026-11-16): every recovery this service signed into a trade's terms,
-- counted against the lien's source (the disputed trade it attested, and the creditor's side in it),
-- so that across all trades it never signs more than that trade's XMR. One row per trade, written
-- in the transaction that stores the signed attestation. `freed_at`: the watcher saw the trade end
-- without paying it (a refund proven to the signed refund address, or a watch that ended with no
-- coin ever received); a freed recovery no longer counts. Never deleted.
create table mod_lien_recoveries (
  trade text primary key references signed_terms (trade),
  source_code text not null,
  creditor text not null check (creditor in ('buyer', 'seller')),
  amount_atomic numeric(30, 0) not null check (amount_atomic > 0),
  created_at timestamptz not null default now(),
  freed_at timestamptz
);
create index mod_lien_recoveries_source on mod_lien_recoveries (source_code, creditor) where freed_at is null;

revoke all on mod_lien_recoveries from public;
