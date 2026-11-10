-- Lead follow-up to the OMEMO interop run (2026-11-10, step 4b): the one-time prekeys X2F used, per
-- recipient device, kept across outbox passes so that a client which stays offline between passes
-- (its published bundle unchanged) never gets two messages on the same prekey (jabber/prekeys.ts).
-- Ids only: the row is found by `device_tag`, an HMAC of the address and the device id, and checked
-- against `identity_tag`, an HMAC of the address, device id and the device's identity key, both
-- under a subkey of X2F_JABBER_KEYS, so the table names no address, device or key. An id is dropped
-- once the device's fetched bundle no longer lists it (the client used it and republished), and the
-- whole record when the identity key changes. `purgeJabberPreKeys` drops records untouched for 30
-- days. 335: next after 333 and 334 (the lead's numbering); re-check the number at landing.
create table jabber_omemo_prekeys (
  device_tag bytea primary key check (length(device_tag) = 32),
  identity_tag bytea not null check (length(identity_tag) = 32),
  prekey_ids integer[] not null check (cardinality(prekey_ids) between 1 and 1000),
  updated_at timestamptz not null
);
create index jabber_omemo_prekeys_updated on jabber_omemo_prekeys (updated_at);
