-- Plan 4 Task 25 and Task 12's owed fees (J-06; register rows D-006, D-008, D-009, D-062, D-063).
-- Numbered 400: the lead reserved 400-409 for J-06 (owner-answers-assignments section 1).
--
-- 1. liens: what a dispute's outcome leaves an account owing the other trader. While a lien is
--    `active` its debtor cannot trade (no offers live, no takes, no new trade set up); `suspended`
--    (the debtor's appeal is pending, D-008) has no effect; `repaid` and `void` are over. Placed,
--    suspended, re-activated and voided only by the dispute's own transaction
--    (apps/api/src/disputes/lien.ts, from @x2f/staff `lienSteps`).
--    - `amount_atomic`: owed to the creditor, the trade's XMR (D-006: "the loss, the trade's XMR").
--    - `fee_atomic`: the unpaid 1% X2F fee, only when the debtor was the one who owed it (D-063);
--      0 otherwise. A repayment trade adds no fee of its own (D-063).
--    - `from_code`/`dispute_seq`/`round`: the dispute and round that placed it. No foreign key to
--      trades: a lien is an account record and outlives the trade's 90-day purge (Task 25).
--    - `repayment_code`: the repayment trade that repaid it (Task 25; NEEDS_REPAYMENT_TRADE).
-- 2. fees_owed (D-062 with owner g63): a 1% the escrow never carried, owed by the poster from their
--    future trades; `collected_atomic` rises as later trades collect it (NEEDS_FEE_OWED_COLLECTION),
--    `settled_at` is set once it reaches the amount. Also an account record, kept after the purge.
--    `revenue_booked.debt_id` (430) names a row here by its id.
--
-- Neither table holds an address, a chat line or a reason text.
create table liens (
  id uuid primary key default gen_random_uuid(),
  debtor_account_id uuid not null references accounts (id),
  creditor_account_id uuid not null references accounts (id),
  amount_atomic numeric(30, 0) not null check (amount_atomic > 0),
  fee_atomic numeric(30, 0) not null default 0 check (fee_atomic >= 0),
  from_code text not null,
  dispute_seq integer not null check (dispute_seq >= 1),
  round smallint not null check (round in (1, 2)),
  cause text not null check (cause in ('restitution', 'overturned')),
  status text not null default 'active' check (status in ('active', 'suspended', 'repaid', 'void')),
  created_at timestamptz not null,
  -- The last change of status (suspend, re-activate, repaid, void).
  changed_at timestamptz not null,
  -- When it ended (repaid or void); null while it can still bind.
  lifted_at timestamptz,
  repayment_code text,
  check (debtor_account_id <> creditor_account_id),
  check ((status in ('repaid', 'void')) = (lifted_at is not null)),
  check (repayment_code is null or status = 'repaid'),
  check (changed_at >= created_at and (lifted_at is null or lifted_at >= created_at))
);

-- One lien per dispute round and debtor: a replayed change places nothing twice.
create unique index liens_one_per_round on liens (from_code, dispute_seq, round, debtor_account_id);
-- The trading guard's read: an account's active liens.
create index liens_active on liens (debtor_account_id) where status = 'active';
create index liens_creditor on liens (creditor_account_id) where status in ('active', 'suspended');

-- A lien never comes back once over, and its parties, amounts and origin never change.
create function liens_guard() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'liens are never deleted' using errcode = 'insufficient_privilege';
  end if;
  if new.id <> old.id or new.debtor_account_id <> old.debtor_account_id or new.creditor_account_id <> old.creditor_account_id
     or new.amount_atomic <> old.amount_atomic or new.fee_atomic <> old.fee_atomic or new.from_code <> old.from_code
     or new.dispute_seq <> old.dispute_seq or new.round <> old.round or new.cause <> old.cause or new.created_at <> old.created_at then
    raise exception 'a lien''s parties, amounts and origin never change' using errcode = 'insufficient_privilege';
  end if;
  -- Review L4: once over, nothing about it changes again, not even when or how it ended.
  if old.status in ('repaid', 'void') and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'a lien that is over stays over' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger liens_guard before update or delete on liens for each row execute function liens_guard();
-- Review L3: row triggers do not fire on TRUNCATE (as 201 and 430 guard theirs).
create trigger liens_no_truncate before truncate on liens for each statement execute function liens_guard();

create table fees_owed (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id),
  amount_atomic numeric(30, 0) not null check (amount_atomic > 0),
  from_code text not null,
  dispute_seq integer not null check (dispute_seq >= 1),
  created_at timestamptz not null,
  collected_atomic numeric(30, 0) not null default 0 check (collected_atomic >= 0 and collected_atomic <= amount_atomic),
  settled_at timestamptz,
  check ((settled_at is not null) = (collected_atomic = amount_atomic))
);

-- One owed fee per dispute: a replayed change writes nothing twice.
create unique index fees_owed_one_per_dispute on fees_owed (from_code, dispute_seq);
create index fees_owed_open on fees_owed (account_id, created_at) where settled_at is null;

-- Only `collected_atomic` (rising) and `settled_at` ever change; a row is never deleted.
create function fees_owed_guard() returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'owed fees are never deleted' using errcode = 'insufficient_privilege';
  end if;
  if new.id <> old.id or new.account_id <> old.account_id or new.amount_atomic <> old.amount_atomic
     or new.from_code <> old.from_code or new.dispute_seq <> old.dispute_seq or new.created_at <> old.created_at
     or new.collected_atomic < old.collected_atomic then
    raise exception 'an owed fee only collects' using errcode = 'insufficient_privilege';
  end if;
  -- Review L4: once settled, nothing about it changes again.
  if old.settled_at is not null and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'a settled owed fee stays as it is' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger fees_owed_guard before update or delete on fees_owed for each row execute function fees_owed_guard();
create trigger fees_owed_no_truncate before truncate on fees_owed for each statement execute function fees_owed_guard();

-- Review L2 (lead call, 12 Nov): liens stay dark until the owner rules how each kind ends and the
-- repayment trade (or a settle action) exists. While `liens_enabled` is false no lien is placed and
-- none blocks trading (`ACTIVE_LIEN_SQL` reads it); owed fees are still recorded. Switched on by the
-- operator once ruled (no route sets it). The test template turns it on (test/setup/postgres.ts).
alter table site_flags add column liens_enabled boolean not null default false;

-- Owner rule p5-7: a change to an account sends one Jabber notice (331's choke point). A lien on
-- the account and a fee it owes are changes to it, like a freeze (`trading_holds`); lead default,
-- owner may change (see the J-06 report). The creditor's column is classified in changePaths.ts.
-- Neither table allows a delete (the guards above), so the triggers watch inserts and updates.
create trigger jabber_note_change after insert or update on liens for each row
  execute function jabber_note_change('debtor_account_id');
create trigger jabber_note_change after insert or update on fees_owed for each row
  execute function jabber_note_change('account_id');
