-- Plan 3, Task 5 (schema built early by Task 6, which reads and writes it): trades and their
-- event log. One row per trade, keyed by its trade code; every column is a field of @x2f/trade's
-- `Trade` (see apps/api/src/trades/store.ts for the mapping), plus the two payout addresses and
-- the seller's wallet app. Monero amounts are atomic units and fiat is minor units, both as
-- numeric(30,0) (Monero's supply in atomic units does not fit a bigint).
--
-- Task 5 adds, in its own later migration: the partial unique indexes behind `already-waiting` and
-- `ad-busy`, the starter-limit checks, and the foreign key from offer_id to Task 4's offers table
-- (which does not exist yet).
create table trades (
  code text primary key,
  -- No foreign key until Task 4's offers table exists (Task 5 adds it).
  offer_id uuid not null,
  poster text not null check (poster in ('seller', 'buyer')),
  seller_account_id uuid not null references accounts (id),
  buyer_account_id uuid not null references accounts (id),
  method_id text not null,
  amount_atomic numeric(30, 0) not null check (amount_atomic > 0),
  fee_atomic numeric(30, 0) not null check (fee_atomic >= 0),
  seller_funds_atomic numeric(30, 0) not null check (seller_funds_atomic > 0),
  locked_currency text not null,
  locked_cents_per_xmr numeric(30, 0) not null check (locked_cents_per_xmr > 0),
  fiat_cents numeric(30, 0) not null check (fiat_cents > 0),
  confirm_window_min integer not null check (confirm_window_min between 1 and 1440),
  min_fiat_cents numeric(30, 0) not null,
  max_fiat_cents numeric(30, 0) not null,
  grown_at timestamptz,
  grown_from_atomic numeric(30, 0),
  grown_from_fiat_cents numeric(30, 0),
  state text not null check (state in (
    'setup', 'funding', 'securing', 'secured', 'paid', 'refund_requested', 'settling', 'released', 'refunded', 'lapsed',
    'cancelled', 'disputed'
  )),
  escrow_address text,
  received_atomic numeric(30, 0) not null default 0 check (received_atomic >= 0),
  unlocked_atomic numeric(30, 0) not null default 0 check (unlocked_atomic >= 0),
  confirmations integer not null default 0 check (confirmations >= 0),
  releasable boolean not null default false,
  taken_at timestamptz not null,
  setup_by timestamptz,
  fund_by timestamptz,
  funding_seen_at timestamptz,
  lapsed_at timestamptz,
  secured_at timestamptz,
  pay_by timestamptz,
  extensions integer not null default 0 check (extensions >= 0),
  paid_at timestamptz,
  confirm_by timestamptz,
  final_alert_at timestamptz,
  cancel_proposed_by text check (cancel_proposed_by in ('buyer', 'seller')),
  settling text check (settling in ('release', 'mutual-cancel', 'buyer-cancel', 'auto-refund', 'lapse-refund')),
  settle_from text,
  settle_by timestamptz,
  paused_at timestamptz,
  tx_hash text,
  dispute_by text check (dispute_by in ('buyer', 'seller', 'system')),
  dispute_at timestamptz,
  closed_at timestamptz,
  -- The buyer's payout address and the seller's refund address. Nulled 90 days after close
  -- (purgeTradeAddresses, Task 6), never while a dispute is open (P3-I12).
  buyer_payout text,
  seller_refund text,
  seller_wallet_app text,
  check (seller_account_id <> buyer_account_id),
  check ((grown_at is null) = (grown_from_atomic is null) and (grown_at is null) = (grown_from_fiat_cents is null)),
  check ((dispute_by is null) = (dispute_at is null))
);

create index trades_seller on trades (seller_account_id, taken_at);
create index trades_buyer on trades (buyer_account_id, taken_at);
create index trades_closed on trades (closed_at) where closed_at is not null;

-- Every accepted event, in order. `event` never holds an address: store.ts replaces each one with
-- its last 6 characters (P3-I12). Append-only (trigger in 104_trade_retention.sql).
create table trade_events (
  id bigserial primary key,
  code text not null references trades (code),
  at timestamptz not null,
  by text not null check (by in ('buyer', 'seller', 'system')),
  event jsonb not null
);

create index trade_events_code on trade_events (code, id);
