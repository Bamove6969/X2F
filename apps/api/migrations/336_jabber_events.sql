-- W-021 (owner p11-27, 2026-11-09): a Jabber notifications settings page where each user picks which
-- events send them a secure Jabber notice. The events are the notice kinds the outbox carries
-- (migration 331's `jabber_outbox.kind`, `NOTICE_KINDS` in apps/api/src/jabber/sender.ts). Each is
-- on until the user turns it off: `muted_kinds` lists the ones turned off, so an address set up
-- before this migration keeps every notice it had. Turn off (deleting the row) forgets the picks
-- with the address. 336: next after 335; re-check the number at landing.
alter table jabber_contacts add column muted_kinds text[] not null default '{}'
  check (muted_kinds <@ array['account-change', 'trade-attention']::text[]);

-- The change paths skip an account that turned account changes off (otherwise as 331).
create or replace function jabber_note_change() returns trigger language plpgsql as $$
declare
  col text := tg_argv[0];
  ignored text[] := coalesce(tg_argv[1:], '{}');
  acct uuid;
  r record;
begin
  if tg_op = 'UPDATE' and (to_jsonb(old) - ignored) = (to_jsonb(new) - ignored) then
    return null;
  end if;
  for acct in
    select distinct x from unnest(array[
      case when tg_op <> 'INSERT' then (to_jsonb(old) ->> col)::uuid end,
      case when tg_op <> 'DELETE' then (to_jsonb(new) ->> col)::uuid end
    ]) as x where x is not null
  loop
    for r in
      select c.account_id, c.jid_sealed from jabber_contacts c
       where c.enabled
         and not ('account-change' = any (c.muted_kinds))
         and (c.account_id = acct
              or c.account_id in (select tm.account_id from team_members tm where tm.member_account_id = acct))
    loop
      perform jabber_queue(r.account_id, r.jid_sealed);
    end loop;
  end loop;
  return null;
end
$$;

-- A dispute tells the payer only if they kept that event on (otherwise as 331).
create or replace function jabber_dispute_opened() returns trigger language plpgsql as $$
declare
  r record;
begin
  for r in
    select c.account_id, c.jid_sealed from trades t join jabber_contacts c on c.account_id = t.buyer_account_id
     where t.code = new.code and c.enabled and not ('trade-attention' = any (c.muted_kinds))
  loop
    perform jabber_queue(r.account_id, r.jid_sealed, 'trade-attention');
  end loop;
  return null;
end
$$;

-- The Jabber setting is itself an account change (331, 332). Changing the picks is too, and it is
-- told to the address that is on whatever the picks were or become, so turning account changes off
-- (by the person or by a thief) is always heard once. Lead default, COPY-UNSIGNED behaviour: see the
-- W-021 report.
create or replace function jabber_contact_changed() returns trigger language plpgsql as $$
begin
  if old.enabled and old.jid_sealed is not null
     and (tg_op = 'DELETE' or not new.enabled
          or new.muted_kinds is distinct from old.muted_kinds
          or (new.jid_sealed is distinct from old.jid_sealed
              and not (coalesce(current_setting('x2f.jabber_rewrap', true), '') = 'on'
                       and new.verified_at is not distinct from old.verified_at))) then
    perform jabber_queue(old.account_id, old.jid_sealed);
  end if;
  return null;
end
$$;
