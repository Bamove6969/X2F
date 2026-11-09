-- Review follow-up to 331 (security review of wip/lead-jabber-notices, 2026-11-08; owner rulings
-- p11-31: OMEMO and Tor are both mandatory). 332: next after 331; re-check the number at landing.

-- Review M4: `npm run rewrap-jabber` (apps/api/src/jabber/rewrap.ts) reseals each address under the
-- current X2F_JABBER_KEYS key. A reseal is not a change of address, so in a transaction that set
-- `x2f.jabber_rewrap` (set_config(..., true): that transaction only) a new `jid_sealed` with the
-- same `verified_at` queues no notice. Proving a new address always sets `verified_at`, so it is
-- still told; turning off and deleting are told as before.
create or replace function jabber_contact_changed() returns trigger language plpgsql as $$
begin
  if old.enabled and old.jid_sealed is not null
     and (tg_op = 'DELETE' or not new.enabled
          or (new.jid_sealed is distinct from old.jid_sealed
              and not (coalesce(current_setting('x2f.jabber_rewrap', true), '') = 'on'
                       and new.verified_at is not distinct from old.verified_at))) then
    perform jabber_queue(old.account_id, old.jid_sealed);
  end if;
  return null;
end
$$;
