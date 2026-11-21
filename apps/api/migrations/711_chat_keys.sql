-- Design build task 4 (design-chat-membership-keys-2026-11-08 section 2.2): the key cabinet. Ciphertext
-- only: the API is the courier and holds nothing that opens any wrap. API number 711 (lead 18 Nov:
-- after retention's 701).
--
-- chat_keys: the creator's signed key record, "TK with fingerprint tkh, locked to the buyer's and the
--   seller's attested chat identities". First writer wins (the primary key); the other side opens its
--   own copy and checks it against tkh, and refuses the chat if it does not match.
-- chat_members: one row per further locked copy (the moderation service's at a dispute, a staff
--   device's at a grant), each with the signature that made it and the API log entry it was made
--   under. Rows are written by design tasks 6 and 9; this migration only files them.
-- Both go with their chat by the same cascade as the envelopes (purgeChats, as x2f_purge).
create table chat_keys (
  chat text primary key references chats (code) on delete cascade,
  tkh text not null check (tkh ~ '^[0-9a-f]{64}$'),
  created_by_role text not null check (created_by_role in ('buyer', 'seller')),
  wrap_buyer text not null,
  wrap_seller text not null,
  sig text not null check (sig ~ '^[0-9a-f]{128}$'),
  created_at timestamptz not null
);

create table chat_members (
  id bigserial primary key,
  chat text not null references chats (code) on delete cascade,
  member_kind text not null check (member_kind in ('mod', 'staff')),
  -- 'mod', or '<staff account id>/<device key id>' (lead 18 Nov: 32 hex characters).
  member_ref text not null check (member_ref = 'mod' or member_ref ~ '^[0-9a-f-]{36}/[0-9a-f]{32}$'),
  box_public text not null check (box_public ~ '^[0-9a-f]{64}$'),
  wrap text not null,
  tkh text not null check (tkh ~ '^[0-9a-f]{64}$'),
  trigger text not null check (trigger in ('dispute', 'notice', 'assigned', 'added')),
  granted_by text not null,
  granted_at timestamptz not null,
  sig text not null,
  log_entry_id bigint,
  removed_at timestamptz,
  -- Build task 6: a trader's dispute grant to the moderator (`granted_by` buyer or seller, its
  -- signed `disputeAt` here), and the moderator's signed acceptance of it, once it opened the wrap.
  grant_at timestamptz,
  -- The signed statements exactly as posted (the grant, and the moderator's acceptance of it), so
  -- every reader verifies the same bytes.
  statement jsonb,
  accepted jsonb,
  accepted_at timestamptz,
  check ((member_kind = 'mod') = (member_ref = 'mod')),
  check (member_kind <> 'mod' or (granted_by in ('buyer', 'seller') and grant_at is not null and statement is not null and sig ~ '^[0-9a-f]{128}$'))
);
-- One live copy per member per chat per granter (the disputer's grant and the counterparty's
-- fallback grant are both kept); a removed one may be granted again (a fresh row).
create unique index chat_members_live on chat_members (chat, member_ref, granted_by) where removed_at is null;

grant select, delete on chat_keys, chat_members to x2f_purge;
