-- J-23 (S-075, owner p11-4 "full abilities on every strongly logged-in device"), phase 1 groundwork
-- per docs/security/multi-device-2026-11-09.md section 6.1. Migration range 500-509 is J-23's (the
-- next free range after 490-499). Nothing here is user-visible yet: the handover gesture waits for
-- owner p12-5 and the screens for design's boards.
--
-- The account chat key (ACK) is handed from one of a person's devices to another inside a sealed
-- box (libsodium crypto_box_seal, @x2f/protocol `sealTo`) addressed to the receiving device's
-- X25519 public key. The API is a courier only: it stores the sealed bytes and serves them to the
-- account's own strong sessions (auth/chatKeys.ts); it holds no chat secret and can open nothing
-- here. A row is collected once (`collected_at`) or expires unread; expired and collected rows are
-- swept when the account next posts one.
create table chat_key_envelopes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id) on delete cascade,
  -- The receiving device's X25519 public key (32 bytes); only that device's secret opens the box.
  recipient_public bytea not null check (octet_length(recipient_public) = 32),
  -- The sealed box: the plaintext plus 48 bytes (an ephemeral public key and a MAC). A 32-byte key
  -- seals to 80 bytes; the cap leaves room for a versioned payload and no more.
  sealed bytea not null check (octet_length(sealed) between 48 and 1024),
  -- Which account chat key this is (accounts.chat_key_epoch at the time); a rotation (owner
  -- question 6, not built) moves the epoch so an old key's envelope is told apart.
  epoch integer not null check (epoch >= 0),
  -- The strong session that posted it.
  created_by uuid references sessions (id) on delete set null,
  created_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > created_at),
  collected_at timestamptz
);
create index chat_key_envelopes_account on chat_key_envelopes (account_id, created_at);

-- The account's current chat-key epoch: 0 for every account until a rotation (not built) moves it.
alter table accounts add column chat_key_epoch integer not null default 0 check (chat_key_epoch >= 0);

-- The handover gate (design note section 3.1 rule 2) as it stood when the approval was approved:
-- true only when the new login's strength and the approving session's strength (read live under
-- the locks) were both 'strong'. False for every other row, blocked and expired ones included.
-- Nothing reads it yet: binding a handover to an approval waits for owner p12-5.
alter table login_approvals add column keys_offered boolean not null default false;

-- Jabber change paths (apps/api/src/jabber/changePaths.ts; lead default, owner p11-119 pattern):
-- chat_key_epoch is bookkeeping (a rotation comes with the removal or recovery that causes it, which
-- is where any notice belongs), so a write to it alone queues no notice. chat_key_envelopes is not a
-- change table (NOT_ACCOUNT_CHANGES): a sealed key in flight between the account's own devices.
drop trigger jabber_note_change on accounts;
create trigger jabber_note_change after update on accounts for each row
  execute function jabber_note_change('id', 'had_wallet', 'webauthn_user_id', 'login_tag', 'login_tag_key_id', 'login_name', 'login_key', 'last_login_at', 'terms_signature', 'chat_key_epoch');
