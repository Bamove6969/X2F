-- Plan 3, Task 20: end-to-end encrypted chat. Numbered 106 as Plan 3 reserves it (it runs after
-- 102_offers and 103_trades on a new database; on an existing one it is applied after 111, which
-- migrate() allows: it depends only on offers, trades and accounts).
--
-- The API stores ciphertext only. Each chat has two trader identities (public keys with a proof of
-- possession over "x2f/chat-identity/v1\0" + code + "\0" + role + "\0" + signPublic + boxPublic)
-- and the moderation service's attestation, which adds the moderator's chat identity (spec 6.6).

-- One chat per offer and taker while no trade is linked; a take links it (trade_code) and a later
-- chat on the same offer between the same two accounts is a new one. Roles are fixed by the offer
-- side: a 'sell' offer's poster is the seller.
create table chats (
  code text primary key,
  offer_id uuid not null references offers (id),
  buyer_account_id uuid not null references accounts (id),
  seller_account_id uuid not null references accounts (id),
  trade_code text unique references trades (code),
  created_at timestamptz not null,
  last_message_at timestamptz,
  check (buyer_account_id <> seller_account_id)
);

create unique index chats_open_pair on chats (offer_id, buyer_account_id, seller_account_id) where trade_code is null;
create index chats_buyer on chats (buyer_account_id, created_at);
create index chats_seller on chats (seller_account_id, created_at);

create table chat_identities (
  chat text not null references chats (code) on delete cascade,
  role text not null check (role in ('buyer', 'seller')),
  sign_public text not null,
  box_public text not null,
  proof text not null,
  created_at timestamptz not null,
  primary key (chat, role)
);

-- The moderation service's signed chat attestation (channels.chat only, no terms), posted over the
-- private internal listener and served to the two traders only.
create table chat_attestations (
  chat text primary key references chats (code) on delete cascade,
  attestation jsonb not null,
  sig text not null,
  created_at timestamptz not null default now()
);

-- A chat the moderation service will never attest (bad proofs or a shared key).
create table chat_refusals (
  chat text primary key references chats (code) on delete cascade,
  reason text not null check (reason in ('bad-proof', 'bad-work')),
  created_at timestamptz not null default now()
);

-- When each chat was last served as moderation work (least recently served first, as for trades).
create table chat_work_served (
  chat text primary key references chats (code) on delete cascade,
  served_at timestamptz not null
);

-- The envelopes, ciphertext only. sender_role is the SESSION's role in the chat when it was posted
-- (Revision 2026-10-28: never a body field), kept per message so Plan 7's per-side self-delete can
-- find each side's messages without a schema change. 'mod' and 'system' are written by later plans.
-- A sender's seq must rise: the unique index backs the route's 409 (review I1).
create table chat_envelopes (
  id bigserial primary key,
  chat text not null references chats (code) on delete cascade,
  sender_role text not null check (sender_role in ('buyer', 'seller', 'mod', 'system')),
  seq bigint not null check (seq >= 0),
  envelope jsonb not null,
  created_at timestamptz not null
);

create unique index chat_envelopes_seq on chat_envelopes (chat, sender_role, seq);
create index chat_envelopes_read on chat_envelopes (chat, id);

-- purgeChats runs as x2f_purge (104_trade_retention.sql): it reads chats and their trades and
-- deletes whole chats (the cascade removes identities, attestations and envelopes).
grant select on chats to x2f_purge;
grant delete on chats, chat_identities, chat_attestations, chat_refusals, chat_work_served, chat_envelopes to x2f_purge;
grant select on chat_identities, chat_attestations, chat_refusals, chat_work_served, chat_envelopes to x2f_purge;
