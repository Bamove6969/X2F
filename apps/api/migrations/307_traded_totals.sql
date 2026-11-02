-- C12b (owner 2026-11-01/02, via the lead): the opt-in "Completed over $X in trades to date" line,
-- and a buyer-cancel count for moderators. The smallest per-account running totals; a SEAM for
-- Plan 5 Task 20's account_totals (fold these columns into it, or keep this table beside it).
--
-- 1. account_traded_totals: one row per account, created on its first counted trade.
--    - own_usd_cents: the sum of trades.usd_cents (the take-time USD value) of the account's
--      COMPLETED trades (released, or refunded to settle a dispute, whoever won: R38 /
--      COMPLETED_TRADES_SQL), both sides. Kept here so it survives the 30-day trade purge (no
--      foreign key to trades). Never returned: the API shows only @x2f/reputation's rounded-down
--      bucket, and only when the trader opted in.
--    - imported_verified_usd_cents: volume proven on other sites, moderator-verified claims only
--      (owner 2026-11-02). 0 until Plan 5 Task 10/11 provide a verified USD figure
--      (NEEDS_P5_T10_VERIFIED_VOLUME, apps/api/test/tradedTotal-tripwire.test.ts).
--    - buyer_cancels: trades this account cancelled as the buyer (settled `buyer-cancel`), for ONE
--      moderator-only cancel figure (owner 2026-11-02; a Plan 4 seam). Never in a trader-facing answer.
create table account_traded_totals (
  account_id uuid primary key references accounts (id),
  own_usd_cents bigint not null default 0 check (own_usd_cents >= 0),
  imported_verified_usd_cents bigint not null default 0 check (imported_verified_usd_cents >= 0),
  buyer_cancels integer not null default 0 check (buyer_cancels >= 0)
);

-- 2. trade_totals_counted: what each trade already added (idempotent per trade and kind). It names
--    no account and goes with its trade (on delete cascade): the totals above stay.
create table trade_totals_counted (
  trade_code text not null references trades (code) on delete cascade,
  kind text not null check (kind in ('completed', 'buyer-cancel')),
  primary key (trade_code, kind)
);

-- 3. The opt-in, off by default: only the trader turns it on (PUT /v1/account/profile/traded-total).
alter table accounts add column show_traded_total boolean not null default false;
