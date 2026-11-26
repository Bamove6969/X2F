-- Escrow-key sync (Plan 3 Task 42, first part; owner 26 Nov 2026: "The keys should be stored on our
-- servers but encrypted and accessible only to the person they are assigned to and the person who
-- they are assigned to also assigns them to"). apps/api/src/escrowSync/routes.ts.
--
-- A trade's escrow records (the browser's IndexedDB `x2f-escrow` / `x2f-escrow-secrets`) get a
-- server copy that is end-to-end encrypted in the browser. The API stores ciphertext only: it
-- holds no key that opens any of it, and there is no key escrow.
--
-- - escrow_readers: one reader key per person: the account holder (member_id null) and each team
--   member who registers one. Only its X25519 public key is here; its secret is stored only inside
--   the unlock envelopes below.
-- - escrow_reader_unlocks: the reader's secret, encrypted in the browser under a key that only an
--   unlock method of that person makes: a passkey or security key's WebAuthn PRF output
--   (method 'prf'), or the person's own PGP key (method 'pgp', an OpenPGP message to their public
--   key, decrypted on their side). An authenticator (TOTP) code is not a method and never can be
--   (the check below).
-- - escrow_blobs: one trade's encrypted record (AES-256-GCM under a fresh content key per write).
-- - escrow_blob_wraps: that content key sealed (crypto_box_seal) to each reader's public key; one
--   row per reader. Only the holder's own reader and members the holder assigned (the
--   `trades-escrow-keys` box, team/abilities.ts) may be wrapped to (checked by the route).
--
-- Lifecycle: the holder's device deletes a trade's copy when it deletes the local record (the
-- 30-day rule after the close, escrow/runtime.ts KEEP_AFTER_CLOSE_MS); `purgeEscrowBlobs`
-- (retention) deletes any copy whose trade is gone or closed longer than that. No foreign key to
-- trades: the trade purge (x2f_purge) is granted nothing here, the job checks for the trade.
create table escrow_readers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id) on delete cascade,
  member_id uuid references team_members (id) on delete cascade,
  public_key bytea not null check (octet_length(public_key) = 32),
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create unique index escrow_readers_holder on escrow_readers (account_id) where member_id is null;
create unique index escrow_readers_member on escrow_readers (member_id) where member_id is not null;

create table escrow_reader_unlocks (
  id uuid primary key default gen_random_uuid(),
  reader_id uuid not null references escrow_readers (id) on delete cascade,
  -- Never 'totp' (or anything else): an authenticator code makes no key.
  method text not null check (method in ('prf', 'pgp')),
  -- 'prf': the credential id (base64url) the PRF output comes from; 'pgp': the key's fingerprint.
  ref text not null check (length(ref) between 1 and 512),
  -- 'prf': the PRF salt (32 bytes); 'pgp': null.
  salt bytea check (salt is null or octet_length(salt) = 32),
  envelope bytea not null check (octet_length(envelope) between 28 and 16384),
  -- The order the person listed them in (the first is the one the app offers first).
  position smallint not null check (position between 0 and 31),
  created_at timestamptz not null,
  check ((method = 'prf') = (salt is not null)),
  unique (reader_id, method, ref)
);

create table escrow_blobs (
  account_id uuid not null references accounts (id) on delete cascade,
  trade_code text not null,
  ciphertext bytea not null check (octet_length(ciphertext) between 28 and 262144),
  version bigint not null check (version >= 1),
  updated_at timestamptz not null,
  primary key (account_id, trade_code)
);

create table escrow_blob_wraps (
  account_id uuid not null,
  trade_code text not null,
  reader_id uuid not null references escrow_readers (id) on delete cascade,
  -- crypto_box_seal of the 32-byte content key: 48 + 32 bytes.
  wrapped bytea not null check (octet_length(wrapped) = 80),
  primary key (account_id, trade_code, reader_id),
  foreign key (account_id, trade_code) references escrow_blobs (account_id, trade_code) on delete cascade
);
create index escrow_blob_wraps_reader on escrow_blob_wraps (reader_id);
