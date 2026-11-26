-- Plan 4 Task 30 (spec 6.6, Helper: support tickets "in categories plus a final 'Everything
-- else'"): a trader's tickets to X2F staff and their messages.
--
-- Privacy:
-- - A message's text is never stored in clear: `body_sealed` is AES-256-GCM under the server key's
--   `subkey('ticket-body')` (as PGP keys and pending login names are sealed), bound to the ticket,
--   the message's place and who wrote it, so a stolen database holds no ticket text and a blob
--   cannot be moved to another ticket or turned into the other side's line (tickets/seal.ts).
-- - A ticket names its account (only that account and staff who took the ticket read it) and,
--   when the trader chose to, one of the trader's own trades (`trade_code`). No session, device,
--   address or IP address. The activity log holds the ticket id only, never the text.
-- - Retention (tickets/store.ts purgeTickets): deleted TICKET_KEEP_DAYS (90) after the ticket's
--   last activity, and a ticket naming a trade as soon as that trade is purged (no foreign key:
--   the trade purge, as x2f_purge, is granted nothing here, and this job checks for the trade).
--   Deleting the account deletes its tickets.
--
-- `sender` is the plan's `from` (a reserved word in SQL). `taken_by` is the staff member working
-- the ticket (the brief's "take"; a removed staff account sets it back to the queue).
create table tickets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id) on delete cascade,
  category text not null check (category in ('account', 'trades', 'offers', 'wallets', 'alerts', 'everything-else')),
  trade_code text check (trade_code ~ '^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$'),
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  taken_by uuid references accounts (id) on delete set null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  closed_at timestamptz,
  check ((status = 'closed') = (closed_at is not null)),
  check (updated_at >= created_at)
);
create index tickets_account on tickets (account_id, updated_at desc);
create index tickets_queue on tickets (created_at) where status <> 'closed';
create index tickets_updated on tickets (updated_at);
create index tickets_trade on tickets (trade_code) where trade_code is not null;

create table ticket_messages (
  ticket_id uuid not null references tickets (id) on delete cascade,
  seq integer not null check (seq >= 1),
  sender text not null check (sender in ('trader', 'staff')),
  staff_id uuid references accounts (id) on delete set null,
  -- nonce (12) || ciphertext || GCM tag (16); 4000 characters are at most 16000 bytes of UTF-8.
  body_sealed bytea not null check (octet_length(body_sealed) between 29 and 16028),
  at timestamptz not null,
  primary key (ticket_id, seq),
  check (sender = 'staff' or staff_id is null)
);
