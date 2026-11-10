-- J-14 review J6, sealing half (lead 10 Nov): ticket text is sealed at rest, like main's Jabber
-- addresses (migration 331). `body_sealed` = the key store's format 1 (apps/api/src/auth/keystore.ts):
-- AES-256-GCM under the current X2F_TICKET_KEYS key, bound to `x2f/ticket-message/<ticket id>/<message
-- id>` (apps/api/src/tickets/seal.ts), so a blob moved to another message or ticket does not open.
-- That covers every message of a support ticket, staff replies, and the "My account has been
-- compromised" report's comment (where the sender types any credentials; the typed login name is
-- never stored at all, migration 450).
--
-- Step 1 (this migration). SQL has no key, so rows written before it are sealed by the app, as
-- migration 012's login names were (FU-D precedent): stop the API, migrate, run
-- `npm run seal-tickets -w @x2f/api` once (it seals every row still holding `body` and nulls `body`
-- in the same update; prints `{"sealed":n}`, a re-run `{"sealed":0}`), then, as a database
-- superuser, `VACUUM FULL ticket_messages; CHECKPOINT;` (the update leaves the old text in dead
-- tuples until the table is rewritten; older backups and WAL still hold it: docs/dev-setup.md), then
-- start the API. The API refuses to start while any row still holds `body`. Before launch there
-- should be no rows to seal.
-- Step 2 (a later migration, once `select count(*) from ticket_messages where body is not null` is 0
-- on every deployment): drop `body`.
alter table ticket_messages add column body_sealed bytea;
alter table ticket_messages alter column body drop not null;
-- A row holds its text in one form only: sealed, or (until the tool has run) the old plaintext.
alter table ticket_messages add constraint ticket_messages_one_form check ((body is null) <> (body_sealed is null));
-- Format 1: 3-byte header, 12-byte nonce, 16-byte tag, then 1..4000 code points of UTF-8 (at most
-- 16,000 bytes; the app checks the length in code points before sealing).
alter table ticket_messages add constraint ticket_messages_sealed_size check (
  body_sealed is null or (octet_length(body_sealed) between 32 and 16031 and get_byte(body_sealed, 0) = 1)
);
