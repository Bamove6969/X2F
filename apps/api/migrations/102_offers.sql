-- Plan 3, Task 4: offers (ads), plus the two switches Plan 4 writes and Plan 3 enforces: an
-- account's trading hold and the site-wide trading pause.
--
-- Fiat amounts are the currency's minor units (ISO 4217 exponent, Revision 2026-10-20) and
-- prices are minor units per whole XMR, as numeric(30,0) like the trades table. `side` is what
-- the poster does with XMR: a 'sell' ad is someone selling XMR, browsed by buyers.
create table offers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id),
  side text not null check (side in ('sell', 'buy')),
  method_id text not null check (char_length(method_id) between 1 and 64),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  price_mode text not null check (price_mode in ('market', 'fixed')),
  -- Market offers: the margin over the market price in basis points (±50%, @x2f/trade rateFor).
  margin_bps integer check (margin_bps between -5000 and 5000),
  -- Fixed-price offers: the price per XMR.
  fixed_cents_per_xmr numeric(30, 0) check (fixed_cents_per_xmr > 0),
  min_fiat_cents numeric(30, 0) not null check (min_fiat_cents > 0),
  max_fiat_cents numeric(30, 0) not null,
  min_trades integer not null check (min_trades in (0, 5, 10, 50)),
  terms text not null check (char_length(terms) <= 4000),
  -- Gift-card offers name the card's country, ISO 3166-1 alpha-2 (Revision 2026-10-27); the API
  -- requires it exactly for methods in the "Gift cards & vouchers" group.
  country text check (country ~ '^[A-Z]{2}$'),
  status text not null default 'live' check (status in ('live', 'paused', 'removed')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check (max_fiat_cents >= min_fiat_cents),
  -- margin_bps only for market offers, fixed_cents_per_xmr only for fixed ones.
  check (
    (price_mode = 'market' and margin_bps is not null and fixed_cents_per_xmr is null)
    or (price_mode = 'fixed' and fixed_cents_per_xmr is not null and margin_bps is null)
  )
);

-- Browsing reads live offers by side, method and currency; `/v1/methods` counts them by side and currency.
create index offers_live on offers (side, currency, method_id) where status = 'live';
create index offers_account on offers (account_id, created_at);

-- A moderator's trading hold (spec 2.3): while a row has no lifted_at, the account cannot post or
-- relist offers or start trades, and its offers are not listed. Plan 4 writes these rows (and adds
-- its own columns: kind, dispute_code, placed_by).
create table trading_holds (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id),
  created_at timestamptz not null,
  lifted_at timestamptz,
  check (lifted_at is null or lifted_at >= created_at)
);

create index trading_holds_active on trading_holds (account_id) where lifted_at is null;

-- Site-wide switches, exactly one row. trading_paused stops new offers and new trades;
-- maintenance_since pauses every trade timer (P3-I19, Task 9). Plan 4's owner tools write it.
create table site_flags (
  id boolean primary key default true check (id),
  trading_paused boolean not null default false,
  maintenance_since timestamptz
);

insert into site_flags default values;

-- The starter-limit settings (Revision 2026-10-24: starter_cap_usd, building_cap_usd,
-- building_min_trades, building_min_days, graduated_min_trades, graduated_min_days,
-- starter_max_open_trades) are rows of owner_settings (109). This migration runs before 109 on a
-- new database, so it inserts none: a missing row means the default (traders/stage.ts).
