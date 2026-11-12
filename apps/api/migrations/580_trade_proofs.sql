-- Plan 5 Task 14: proof storage (the plan's 305; renumbered into the free 580 range, 12 Nov 2026).
--
-- Each row is the ciphertext the uploader's device made (@x2f/proof encryptProof: XChaCha20-Poly1305,
-- nonce || AEAD output, the AAD binding trade code, proof id and kind). The key travels only inside a
-- sealed chat envelope: the API cannot read, check or re-key a proof, and stores nothing about the
-- picture (no name, type, size column or hash). It goes with its trade (on delete cascade) and on
-- the chat's retention (proofs/store.ts purgeProofs, run as x2f_purge).
create table trade_proofs (
  -- newProofId(): 16 random bytes as 26 upper-case Crockford base32 characters.
  id text primary key check (id ~ '^[0-9A-HJKMNP-TV-Z]{25}[048CGMRW]$'),
  trade_code text not null references trades (code) on delete cascade,
  uploader_role text not null check (uploader_role in ('buyer', 'seller')),
  kind text not null check (kind in ('proof', 'evidence', 'unblurred')),
  -- At least a nonce (24) and a tag (16); at most PROOF_MAX_CIPHERTEXT (4 MiB, P5-A25).
  ciphertext bytea not null check (octet_length(ciphertext) between 40 and 4194304),
  created_at timestamptz not null
);
create index trade_proofs_trade on trade_proofs (trade_code, uploader_role);

-- One-time ids: every id ever stored leaves its tag here, sha256 of `x2f/proof-id/v1|<id>`, kept
-- when the proof itself is purged, so an id can never be stored twice (a replayed upload, or one
-- moved to another trade, is 409 proof-exists). The tag names neither the trade nor the uploader.
create table proof_id_tags (
  tag bytea primary key check (octet_length(tag) = 32),
  used_at timestamptz not null
);

grant select, delete on trade_proofs to x2f_purge;
