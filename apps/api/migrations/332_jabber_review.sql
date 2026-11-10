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

-- Review H1 (owner ruling p11-31: OMEMO is mandatory): X2F's own OMEMO identity (jabber/omemo.ts),
-- one row, created on first use: a device id and a Curve25519 identity key pair, the private key
-- sealed under X2F_JABBER_KEYS (bound to `x2f/jabber-omemo-identity/<public key hex>`). Not an
-- account's data (no account refers to it).
create table jabber_omemo_identity (
  singleton boolean primary key default true check (singleton),
  device_id integer not null check (device_id between 1 and 2147483647),
  identity_public bytea not null check (length(identity_public) = 32),
  identity_sealed bytea not null,
  created_at timestamptz not null
);
