-- Lien recovery (owner rules 16 Nov 2026; docs/lien-recovery.md). Numbered 560: the next free
-- number on the dispute stack (550 is ruling_statements; wip/third-netfee-split also uses 550).
--
-- 1. liens.recovery_rate_bps: the share of the debtor's proceeds each completed trade recovers
--    (owner: default 50%). Changed only by a senior-approved rate request (lien_rate_requests).
-- 2. lien_recovery_holds: what a trade in progress reserved at take (its signed terms carry it),
--    so two trades never reserve the same remainder. `open` → `recovered` (the trade completed: a
--    ledger row is written in the same transaction) or `released` (cancelled or refunded). The
--    creditor's address is kept only while open (the signed terms need it), then cleared.
-- 3. lien_recoveries: the add-only ledger. One row per lien and trade; the sum never exceeds the
--    lien's amount (rule 2: the creditor never receives more than the moderator determined).
-- 4. lien_rate_requests: a moderator's proposed rate with a required reason, pending until a
--    senior moderator (or the owner) approves or rejects it; never decided by its proposer.
alter table liens add column recovery_rate_bps integer not null default 5000 check (recovery_rate_bps between 1 and 10000);

-- 400's guard freezes the parties, amounts and origin; the rate may change while the lien binds,
-- never once it is over (the guard's L4 rule already refuses any change then).

create table lien_recovery_holds (
  id uuid primary key default gen_random_uuid(),
  lien_id uuid not null references liens (id),
  trade_code text not null unique,
  amount_atomic numeric(30, 0) not null check (amount_atomic > 0),
  address text,
  status text not null default 'open' check (status in ('open', 'recovered', 'released')),
  created_at timestamptz not null,
  closed_at timestamptz,
  check ((status = 'open') = (closed_at is null)),
  check ((status = 'open') = (address is not null))
);
create index lien_recovery_holds_open on lien_recovery_holds (lien_id) where status = 'open';

-- A hold only closes, once, and its lien, trade and amount never change.
create function lien_recovery_holds_guard() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'recovery holds are never deleted' using errcode = 'insufficient_privilege';
  end if;
  if new.id <> old.id or new.lien_id <> old.lien_id or new.trade_code <> old.trade_code
     or new.amount_atomic <> old.amount_atomic or new.created_at <> old.created_at
     or old.status <> 'open' then
    raise exception 'a recovery hold only closes, once' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
create trigger lien_recovery_holds_guard before update or delete on lien_recovery_holds for each row execute function lien_recovery_holds_guard();
create trigger lien_recovery_holds_no_truncate before truncate on lien_recovery_holds for each statement execute function lien_recovery_holds_guard();

create table lien_recoveries (
  id uuid primary key default gen_random_uuid(),
  lien_id uuid not null references liens (id),
  trade_code text not null,
  amount_atomic numeric(30, 0) not null check (amount_atomic > 0),
  at timestamptz not null,
  unique (lien_id, trade_code)
);

-- Add-only, and never past the amount owed. The insert locks the lien row first, so two inserts
-- for one lien serialise and each sees the other's row.
create function lien_recoveries_guard() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
declare
  owed numeric;
  got numeric;
begin
  if tg_op <> 'INSERT' then
    raise exception 'recoveries are add-only' using errcode = 'insufficient_privilege';
  end if;
  select l.amount_atomic into owed from public.liens l where l.id = new.lien_id for update;
  select coalesce(sum(r.amount_atomic), 0) into got from public.lien_recoveries r where r.lien_id = new.lien_id;
  if got + new.amount_atomic > owed then
    raise exception 'a lien never recovers more than it is owed' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger lien_recoveries_insert before insert on lien_recoveries for each row execute function lien_recoveries_guard();
create trigger lien_recoveries_change before update or delete on lien_recoveries for each row execute function lien_recoveries_guard();
create trigger lien_recoveries_no_truncate before truncate on lien_recoveries for each statement execute function lien_recoveries_guard();

create table lien_rate_requests (
  id uuid primary key default gen_random_uuid(),
  lien_id uuid not null references liens (id),
  proposed_bps integer not null check (proposed_bps between 1 and 10000),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  proposed_by uuid not null references accounts (id),
  proposed_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references accounts (id),
  decided_at timestamptz,
  check ((status = 'pending') = (decided_by is null)),
  check ((status = 'pending') = (decided_at is null)),
  check (decided_by is null or decided_by <> proposed_by)
);
-- One pending request per lien.
create unique index lien_rate_requests_one_pending on lien_rate_requests (lien_id) where status = 'pending';

create function lien_rate_requests_guard() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'rate requests are never deleted' using errcode = 'insufficient_privilege';
  end if;
  if new.id <> old.id or new.lien_id <> old.lien_id or new.proposed_bps <> old.proposed_bps or new.reason <> old.reason
     or new.proposed_by <> old.proposed_by or new.proposed_at <> old.proposed_at or old.status <> 'pending' then
    raise exception 'a rate request is decided once' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
create trigger lien_rate_requests_guard before update or delete on lien_rate_requests for each row execute function lien_rate_requests_guard();
create trigger lien_rate_requests_no_truncate before truncate on lien_rate_requests for each statement execute function lien_rate_requests_guard();
