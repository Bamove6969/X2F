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
alter table ticket_messages drop constraint if exists ticket_messages_body_sealed_check;
-- Idempotent (review of feat/lockout, item 6): only a row that does not carry a format byte yet is
-- prefixed. A 811 blob is 12 + 1..16000 + 16 bytes (29..16028); a marked blob (format 0 or 1) is at
-- least 30. A 811 blob of 30..16028 bytes could start with 0x00 or 0x01 by chance, so the marker is
-- not the byte but this migration's own record: the column comment, set below in the same
-- transaction, says the rows are marked. A re-run (the comment already set) changes nothing.
-- The deploy is stop, migrate, start (docs/dev-setup.md): an API without the key ring cannot read
-- marked rows, and one with it cannot read unmarked ones.
do $$
begin
  if coalesce(col_description('ticket_messages'::regclass, (select attnum from pg_attribute where attrelid = 'ticket_messages'::regclass and attname = 'body_sealed')), '') <> 'x2f:format-byte' then
    update ticket_messages set body_sealed = '\x00'::bytea || body_sealed;
    comment on column ticket_messages.body_sealed is 'x2f:format-byte';
  end if;
end $$;
-- Format 0: 1 + 12 + 1..16000 + 16 bytes; format 1: 3 + 12 + 1..16000 + 16 bytes.
alter table ticket_messages add constraint ticket_messages_body_sealed_check
  check (case when octet_length(body_sealed) between 30 and 16031 then get_byte(body_sealed, 0) in (0, 1) else false end);
