-- Plan 4 Task 33 / J-12 (D-041..D-045): staff shifts, clock-out pay, the senior moderators'
-- large-trade share and clawback option A. Numbered 420 (J-12's reserved 420-429).
--
-- The owner's rules (owner answers 2026-10-28 13:07 and 13:24, 2026-10-29 lead calls q5/q6), which
-- replace Plan 4 Task 33's hourly reading:
-- - clock-in is the staff login; a staff member is paid AT A CORRECT CLOCK-OUT for every dispute
--   they completed since their previous paid clock-out (forgetting to clock out for days loses
--   nothing: it is paid at the next correct clock-out). Closing the app is no clock-out; an
--   automatic logout is recorded as information only;
-- - for now pay is per completed dispute only, no hourly element, for every moderator; the pay
--   kinds stay open to new kinds (support answers, ...) through `staff_pay_items.kind`;
-- - senior moderators also get a % of the revenue of large trades, set aside when the dispute
--   completes; the threshold and the % are the owner's numbers (no default);
-- - clawback option A: pay goes out normally at clock-out; an overruled decision reduces FUTURE pay,
--   and what is owed stays recorded if the person leaves;
-- - the payout goes to an address the staff member approved beforehand; adding one needs a strong
--   login (a security-key tap here).
-- No column holds an IP address, a name, a chat text or a trader's account.

-- 1. The owner's pay settings, on Task 8's one-row `settings` (206). All ship unset ("Not set"):
--    a dispute completed while its role's amount is unset earns nothing (the item is recorded with
--    no amount), and with no threshold or no % no large-trade share is set aside. Amounts in US
--    cents per completed dispute; the share in basis points of the X2F fee of the trade; the
--    threshold in whole US dollars of the trade's value at dispute opening. `pay_tap_id` is the
--    security-key tap that authorised the current values (intent `pay-settings`).
alter table settings
  add column pay_mod_dispute_usd_cents bigint check (pay_mod_dispute_usd_cents between 0 and 10000000),
  add column pay_senior_dispute_usd_cents bigint check (pay_senior_dispute_usd_cents between 0 and 10000000),
  add column senior_large_trade_bp integer check (senior_large_trade_bp between 0 and 10000),
  add column large_trade_bonus_threshold_usd integer check (large_trade_bonus_threshold_usd between 1 and 10000000),
  add column pay_tap_id uuid references key_taps (id),
  add column pay_set_at timestamptz;

-- 2. Shifts: one row per staff-app session (clock-in = the staff login, owner q5). Written by the
--    triggers below, so every staff session has one whatever code path opened or ended it:
--    `clock-out` (the staff member's own correct clock-out, the only end that pays), `auto-logout`
--    (the session ran out: idle, the 12-hour cap or the login-hours window; information only) and
--    `ended` (logged out without clocking out, signed out elsewhere, switched off). `session_id`
--    carries no foreign key: purging a session must keep its shift.
create table staff_shifts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique,
  staff_id uuid not null references accounts (id),
  clocked_in_at timestamptz not null,
  ended_at timestamptz,
  ended text check (ended in ('clock-out', 'auto-logout', 'ended')),
  check ((ended is null) = (ended_at is null))
);
create index staff_shifts_staff on staff_shifts (staff_id, clocked_in_at desc);

create function staff_shift_open() returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
begin
  if new.app = 'staff' then
    insert into staff_shifts (session_id, staff_id, clocked_in_at) values (new.id, new.account_id, new.created_at)
      on conflict (session_id) do nothing;
  end if;
  return null;
end
$$;

create trigger sessions_staff_shift_open
  after insert on sessions
  for each row execute function staff_shift_open();

-- A revoke the clock-out or the hours sweep did not already record is `ended`; a session deleted
-- while still live (the purge of expired sessions) ran out: `auto-logout` at its expiry.
create function staff_shift_close() returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
begin
  if old.app <> 'staff' then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    if new.revoked_at is not null and old.revoked_at is null then
      update staff_shifts set ended = 'ended', ended_at = new.revoked_at where session_id = new.id and ended is null;
    end if;
  else
    update staff_shifts
       set ended = case when old.revoked_at is null then 'auto-logout' else 'ended' end,
           ended_at = coalesce(old.revoked_at, old.expires_at)
     where session_id = old.id and ended is null;
  end if;
  return null;
end
$$;

create trigger sessions_staff_shift_close
  after update of revoked_at or delete on sessions
  for each row execute function staff_shift_close();

-- Sessions open before this migration have no shift; they get one now, so every live staff
-- session can clock out.
insert into staff_shifts (session_id, staff_id, clocked_in_at)
  select id, account_id, created_at from sessions where app = 'staff' and revoked_at is null
  on conflict (session_id) do nothing;

-- 3. Pre-approved payout addresses, one or more per staff member. Each was added with a
--    security-key tap bound to exactly that address (intent `payout-address`); a removed address
--    is kept (a payout names it) but can no longer be chosen.
create table staff_payout_addresses (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references accounts (id),
  address text not null check (address ~ '^[1-9A-HJ-NP-Za-km-z]{95}$'),
  added_at timestamptz not null,
  tap_id uuid not null references key_taps (id),
  removed_at timestamptz
);
create unique index staff_payout_addresses_live on staff_payout_addresses (staff_id, address) where removed_at is null;

-- 4. Payouts: one per paying clock-out. The amount is the net of every unpaid item at that moment
--    (dispute pay in US cents converted at `usd_cents_per_xmr`, plus the large-trade shares and
--    minus the clawbacks in atomic units). `status` stays `waiting-send` until the payroll wallet's
--    send is wired (NEEDS_PLAN_6_PAYROLL_WALLET): the fee wallet's spend key stays offline
--    (spec 6.6 Earnings), so the send is Plan 6's.
create table staff_payouts (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references accounts (id),
  at timestamptz not null,
  shift_id uuid references staff_shifts (id),
  address_id uuid not null references staff_payout_addresses (id),
  usd_cents bigint not null,
  usd_cents_per_xmr bigint check (usd_cents_per_xmr > 0),
  atomic numeric(30, 0) not null,
  amount_atomic numeric(30, 0) not null check (amount_atomic > 0),
  status text not null default 'waiting-send' check (status in ('waiting-send', 'sent', 'failed')),
  tx_hash text check (tx_hash ~ '^[0-9a-f]{64}$'),
  settled_at timestamptz,
  check ((status = 'sent') = (tx_hash is not null)),
  check ((status = 'waiting-send') = (settled_at is null)),
  check (usd_cents = 0 or usd_cents_per_xmr is not null)
);
create index staff_payouts_staff on staff_payouts (staff_id, at desc);

-- 5. What each staff member earned and owes, item by item (the pay ledger). Kinds:
--    - `dispute`: a completed dispute (round 1's published ruling, by its proposer), in US cents;
--      `usd_cents` null when the role's amount was not set at that moment;
--    - `large-trade`: a senior moderator's share of the X2F fee of a large trade, atomic units;
--    - `clawback`: the reversal of one earlier item after its decision was overruled on appeal, in
--      the same unit and amount, negative; taken from future pay (option A).
--    New kinds (support answers, ...) are added here by a later migration (owner q6).
--    `payout_id` is set by the clock-out that settled the item; an item is never changed otherwise
--    and never deleted (trigger below). `trade_code` goes when the trade is purged (set null, the
--    retention rules): the amounts stay, as the owner's payroll record, without the trade.
create table staff_pay_items (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references accounts (id),
  kind text not null check (kind in ('dispute', 'large-trade', 'clawback')),
  trade_code text references trades (code) on delete set null,
  seq smallint check (seq >= 1),
  usd_cents bigint,
  atomic numeric(30, 0),
  earned_at timestamptz not null,
  payout_id uuid references staff_payouts (id),
  source_item uuid unique references staff_pay_items (id),
  check ((kind = 'clawback') = (source_item is not null)),
  check (kind <> 'dispute' or (atomic is null and (usd_cents is null or usd_cents >= 0))),
  check (kind <> 'large-trade' or (usd_cents is null and atomic > 0)),
  check (kind <> 'clawback' or ((usd_cents is null or usd_cents <= 0) and (atomic is null or atomic < 0)))
);
-- One dispute item and one large-trade item per dispute (only round 1's decider earns them).
create unique index staff_pay_items_once on staff_pay_items (kind, trade_code, seq) where kind <> 'clawback';
create index staff_pay_items_unpaid on staff_pay_items (staff_id) where payout_id is null;
create index staff_pay_items_trade on staff_pay_items (trade_code, seq);

create function staff_pay_items_settle_only() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  -- DELETE and TRUNCATE (the statement trigger has no row) are refused before any row is read.
  if tg_op <> 'UPDATE' then
    raise exception 'staff_pay_items: an item is only ever settled, never changed or deleted' using errcode = 'insufficient_privilege';
  end if;
  if new.id = old.id and new.staff_id = old.staff_id and new.kind = old.kind
     and new.seq is not distinct from old.seq
     and new.usd_cents is not distinct from old.usd_cents and new.atomic is not distinct from old.atomic
     and new.earned_at = old.earned_at and new.source_item is not distinct from old.source_item
     and (new.trade_code is not distinct from old.trade_code or new.trade_code is null)
     and (new.payout_id is not distinct from old.payout_id or old.payout_id is null) then
    return new;
  end if;
  raise exception 'staff_pay_items: an item is only ever settled, never changed or deleted' using errcode = 'insufficient_privilege';
end
$$;

create trigger staff_pay_items_settle_only
  before update or delete on staff_pay_items
  for each row execute function staff_pay_items_settle_only();

-- Security review 12 Nov M1: TRUNCATE skips row triggers, so it is refused by a statement trigger,
-- as for trade_events (104), team_audit (015) and activity_log (201).
create trigger staff_pay_items_no_truncate
  before truncate on staff_pay_items
  for each statement execute function staff_pay_items_settle_only();

-- Security review 12 Nov M2: the rows that say where pay goes cannot be rewritten. A payout changes
-- only when it settles: from `waiting-send` to `sent` (with its tx hash) or `failed`, its
-- settled time with it; everything else stays as recorded. Never deleted or truncated.
create function staff_payouts_settle_only() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  if tg_op <> 'UPDATE' then
    raise exception 'staff_payouts: a payout only ever settles once, never changes otherwise or goes' using errcode = 'insufficient_privilege';
  end if;
  if old.status = 'waiting-send' and new.status <> 'waiting-send'
     and new.id = old.id and new.staff_id = old.staff_id and new.at = old.at
     and new.shift_id is not distinct from old.shift_id and new.address_id = old.address_id
     and new.usd_cents = old.usd_cents and new.usd_cents_per_xmr is not distinct from old.usd_cents_per_xmr
     and new.atomic = old.atomic and new.amount_atomic = old.amount_atomic then
    return new;
  end if;
  raise exception 'staff_payouts: a payout only ever settles once, never changes otherwise or goes' using errcode = 'insufficient_privilege';
end
$$;

create trigger staff_payouts_settle_only
  before update or delete on staff_payouts
  for each row execute function staff_payouts_settle_only();

create trigger staff_payouts_no_truncate
  before truncate on staff_payouts
  for each statement execute function staff_payouts_settle_only();

-- An address is only ever removed, once; its address, owner and tap never change.
create function staff_payout_addresses_remove_only() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  if tg_op <> 'UPDATE' then
    raise exception 'staff_payout_addresses: an address is only ever removed, once' using errcode = 'insufficient_privilege';
  end if;
  if old.removed_at is null and new.removed_at is not null
     and new.id = old.id and new.staff_id = old.staff_id and new.address = old.address
     and new.added_at = old.added_at and new.tap_id = old.tap_id then
    return new;
  end if;
  raise exception 'staff_payout_addresses: an address is only ever removed, once' using errcode = 'insufficient_privilege';
end
$$;

create trigger staff_payout_addresses_remove_only
  before update or delete on staff_payout_addresses
  for each row execute function staff_payout_addresses_remove_only();

create trigger staff_payout_addresses_no_truncate
  before truncate on staff_payout_addresses
  for each statement execute function staff_payout_addresses_remove_only();
