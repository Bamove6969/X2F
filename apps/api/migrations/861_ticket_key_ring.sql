-- J-14 review J6 (lead 10 Nov), ported: ticket text is sealed under its own key ring,
-- `X2F_TICKET_KEYS` (env or file, like the other rings), through the key store (auth/keystore.ts),
-- no longer under `subkey('ticket-body')` of X2F_SERVER_KEY (migration 811).
--
-- Every sealed blob now starts with a format byte, as migration 011 did for TOTP secrets:
-- 0x00 marks a message sealed before this migration (under subkey('ticket-body'), opened only, never
-- written); 0x01 is the key-store format (key id from X2F_TICKET_KEYS in the header). The associated
-- data is unchanged (`x2f/ticket-message/<ticket>/<seq>/<sender>`). `npm run rewrap-tickets -w
-- @x2f/api` moves every blob to the current key (run it after this migration and after each
-- rotation, before an old key is removed).
alter table ticket_messages drop constraint ticket_messages_body_sealed_check;
update ticket_messages set body_sealed = '\x00'::bytea || body_sealed;
-- Format 0: 1 + 12 + 1..16000 + 16 bytes; format 1: 3 + 12 + 1..16000 + 16 bytes.
alter table ticket_messages add constraint ticket_messages_body_sealed_check
  check (case when octet_length(body_sealed) between 30 and 16031 then get_byte(body_sealed, 0) in (0, 1) else false end);
