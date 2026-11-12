-- W-021 (owner p11-27, 2026-11-09): a Jabber notifications settings page where each user picks which
-- events send them a secure Jabber notice. The events are the notice kinds the outbox carries
-- (migration 331's `jabber_outbox.kind`, `NOTICE_KINDS` in apps/api/src/jabber/sender.ts). Each is
-- on until the user turns it off: `muted_kinds` lists the ones turned off, so an address set up
-- before this migration keeps every notice it had. Turn off (deleting the row) forgets the picks
-- with the address. 336: next after 335; re-check the number at landing.
--
-- Review F1 (safe default until the owner rules): only kinds that are not security notices may be
-- turned off. `account-change` and J-20's `team-member-first-login` stay on (ALWAYS_ON_KINDS in
-- apps/api/src/jabber/sender.ts; the API refuses them with 409 `jabber-event-always-on`). A ruling
-- that lets them be muted, or a new mutable kind, widens this check in a later migration.
alter table jabber_contacts add column muted_kinds text[] not null default '{}'
  check (muted_kinds <@ array['trade-attention']::text[]);

-- The mute is enforced where every notice is queued, so a trigger and a route that call
-- jabber_queue (J-20's first-login notice does) all honour it.
create or replace function jabber_queue(acct uuid, sealed bytea, k text default 'account-change') returns void language sql as $$
  insert into jabber_outbox (account_id, jid_sealed, txid, kind)
  select acct, sealed, txid_current(), k
   where not exists (select 1 from jabber_contacts c where c.account_id = acct and k = any (c.muted_kinds))
  on conflict (account_id, txid, kind) do nothing
$$;

-- The Jabber setting is itself an account change (331, 332). Changing the picks is too. This
-- notice bypasses the mute: it is told to the address that was on whatever the picks were or
-- become, so turning account changes off (by the person or by a thief) is always heard once. Lead
-- default: see the W-021 report.
create or replace function jabber_contact_changed() returns trigger language plpgsql as $$
begin
  if old.enabled and old.jid_sealed is not null
     and (tg_op = 'DELETE' or not new.enabled
          or new.muted_kinds is distinct from old.muted_kinds
          or (new.jid_sealed is distinct from old.jid_sealed
              and not (coalesce(current_setting('x2f.jabber_rewrap', true), '') = 'on'
                       and new.verified_at is not distinct from old.verified_at))) then
    insert into jabber_outbox (account_id, jid_sealed, txid, kind) values (old.account_id, old.jid_sealed, txid_current(), 'account-change')
    on conflict (account_id, txid, kind) do nothing;
  end if;
  return null;
end
$$;
