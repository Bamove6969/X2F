-- Lead follow-up to the OMEMO interop run (2026-11-10, step 4b): the one-time prekeys X2F used, per
-- recipient device, kept across outbox passes so that a client which stays offline between passes
-- (its published bundle unchanged) never gets two messages on the same prekey (jabber/prekeys.ts).
-- The ids are plain; nothing else is: `recipient_tag` is an HMAC of the address under a subkey of
-- X2F_JABBER_KEYS, and `device_sealed` is the device id and the device's identity key, sealed
-- under X2F_JABBER_KEYS (bound to `x2f/jabber-prekeys/<recipient_tag hex>`), so the table names no
-- address, device or key. `npm run rewrap-jabber` re-tags and reseals rows under the current key
-- for the addresses it opens. An id is dropped once the device's fetched bundle no longer lists it
-- (the client used it and republished) unless the answer is partial (fewer prekeys than
-- `listed_ids`, none new), and the whole record when the identity key changes.
-- `purgeJabberPreKeys` drops records untouched for 30 days. 335: next after 333 and 334 (the lead's
-- numbering); re-check the number at landing.
create table jabber_omemo_prekeys (
  id bigint generated always as identity primary key,
  recipient_tag bytea not null check (length(recipient_tag) = 32),
  device_sealed bytea not null,
  prekey_ids integer[] not null check (cardinality(prekey_ids) between 1 and 10000),
  -- The prekey ids of the device's bundle when the record was last written (review R4: a later
  -- answer listing fewer of these and no new one is partial, and the record is kept as it is).
  listed_ids integer[] not null check (cardinality(listed_ids) <= 10000),
  updated_at timestamptz not null
);
create index jabber_omemo_prekeys_recipient on jabber_omemo_prekeys (recipient_tag);
create index jabber_omemo_prekeys_updated on jabber_omemo_prekeys (updated_at);
