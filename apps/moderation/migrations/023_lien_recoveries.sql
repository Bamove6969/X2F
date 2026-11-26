-- Lien recovery, review B1 (2026-11-16), with the provisional owner answers of 17 Nov 2026
-- (docs/lien-recovery.md). This service is the authority on what it signs into a trade's terms.
--
-- mod_liens: each lien it checked (the source trade it attested, the creditor's side there, both
-- parties as the API named them the first time, the amount it verified, the rate it verified) and
-- its own signed LienStatement (@x2f/trade). The parties, source and amount are pinned on first
-- sight: a later work item naming other ones for the same lien is refused. The rate and statement
-- change only when a rate change is verified (a senior's `lien-rate` key tap its gate checked).
create table mod_liens (
  lien_id text primary key,
  source_code text not null,
  creditor_side text not null check (creditor_side in ('buyer', 'seller')),
  debtor text not null,
  creditor text not null,
  amount_atomic numeric(30, 0) not null check (amount_atomic > 0),
  rate_bps integer not null check (rate_bps between 1 and 9000),
  statement jsonb not null,
  sig text not null,
  posted_at timestamptz,
  updated_at timestamptz not null default now()
);

-- mod_lien_recoveries: every recovery it signed into a trade's terms, counted against its lien and
-- the lien's source (the disputed trade it attested, and the creditor's side in it), so that across
-- all trades it never signs more than the lien's amount, nor more than that trade's XMR for the
-- source. One row per trade, written in the transaction that stores the signed attestation.
-- `freed_at`: the watcher saw the trade end without paying it (a refund proven to the signed refund
-- address, or a watch that ended with no coin ever received); a freed recovery no longer counts.
-- Never deleted. The trade shred (main.ts, TRADE_SHRED_KEPT) blanks `trade` ('') and keeps the
-- row, so what it signed keeps counting after the trade's signed_terms are gone (no reference to
-- them); one row per trade while its code is kept (the unique index below).
create table mod_lien_recoveries (
  id bigint generated always as identity primary key,
  trade text not null,
  lien_id text not null references mod_liens (lien_id),
  source_code text not null,
  creditor text not null check (creditor in ('buyer', 'seller')),
  amount_atomic numeric(30, 0) not null check (amount_atomic > 0),
  created_at timestamptz not null default now(),
  freed_at timestamptz
);
create unique index mod_lien_recoveries_trade on mod_lien_recoveries (trade) where trade <> '';
create index mod_lien_recoveries_source on mod_lien_recoveries (source_code, creditor) where freed_at is null;
create index mod_lien_recoveries_lien on mod_lien_recoveries (lien_id) where freed_at is null;

-- mod_lien_rate_taps (Q1): each senior's `lien-rate` key tap (its nonce, verified by the gate) this
-- service applied to a lien's rate, written with the recovery that applied it. A spent tap is never
-- again a reason to change the rate: an API cannot replay an old approval, nor go back to the
-- default once another rate was applied, without a new tap (the replaced rate stays good for a
-- grace period, apps/moderation lienRecovery.ts LIEN_RATE_GRACE_HOURS). Never deleted; the trade
-- shred blanks `trade` (the trade that applied it) and keeps the tap spent.
create table mod_lien_rate_taps (
  nonce text primary key,
  lien_id text not null references mod_liens (lien_id),
  rate_bps integer not null check (rate_bps between 1 and 9000),
  -- The rate it replaced, good for LIEN_RATE_GRACE_HOURS more (trades accepted before the change).
  from_rate_bps integer not null check (from_rate_bps between 1 and 9000),
  trade text not null,
  applied_at timestamptz not null default now()
);

revoke all on mod_liens, mod_lien_recoveries, mod_lien_rate_taps from public;
