-- Owner 26 Nov 2026 (thread "Design owner area and staff pay"):
-- 1. A lien can be marked `uncollectible` by the owner (tap `lien-uncollectible`): the debt is
--    written off. It ends like a void (lifted, no more recovery from the debtor's future trades, no
--    longer blocks them); any ban stays as it is. Once over it stays over (liens_guard).
-- 2. A trade with an unpaid lien (active or suspended) has no delete date: the whole-trade purge
--    keeps it until the lien ends, then for DISPUTE_KEEP_DAYS after it ended, so the owner can still
--    audit it (apps/api/src/retention/tradePurge.ts, @x2f/trade retention.ts).
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'liens'::regclass and contype = 'c'
              and (pg_get_constraintdef(oid) like '%lifted_at IS NOT NULL%' or pg_get_constraintdef(oid) like '%''suspended''%')
  loop
    execute format('alter table liens drop constraint %I', c.conname);
  end loop;
end
$$;
alter table liens add constraint liens_status_check check (status in ('active', 'suspended', 'repaid', 'void', 'uncollectible'));
alter table liens add constraint liens_lifted_check check ((status in ('repaid', 'void', 'uncollectible')) = (lifted_at is not null));
alter table liens add column written_off_by uuid references accounts (id);
-- No foreign key: a lien ties to nothing but accounts (lien.test.ts), so no purge can cascade to it.
alter table liens add column written_off_tap uuid;
alter table liens add constraint liens_written_off_check check ((status = 'uncollectible') = (written_off_by is not null));

create or replace function liens_guard() returns trigger
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
  if old.status in ('repaid', 'void', 'uncollectible') and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'a lien that is over stays over' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create index liens_from_code on liens (from_code);
