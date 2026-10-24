-- Plan 3, Task 8: trade membership, per-role trade identities and the moderation attestation.
--
-- The API knows who the buyer and seller of a trade are, but holds NO escrow key and never mints
-- a trade identity: each trader's app generates its own key pair and registers only the public
-- keys, with a proof of possession. The moderation service (a separate process and database)
-- generates the third identity and signs the attestation; the API only stores and serves it. No
-- column here holds a secret key.
create table trades (
  code text primary key,
  buyer_account uuid not null references accounts (id),
  seller_account uuid not null references accounts (id),
  created_at timestamptz not null default now(),
  constraint trade_two_parties check (buyer_account <> seller_account)
);

-- One public identity per role, with the trader's Ed25519 proof of possession over
-- "x2f/trade-identity/v1\0" + code + "\0" + role + "\0" + signPublic + boxPublic.
create table trade_identities (
  code text not null references trades (code) on delete cascade,
  role text not null check (role in ('buyer', 'seller')),
  sign_public text not null,
  box_public text not null,
  proof text not null,
  created_at timestamptz not null default now(),
  primary key (code, role)
);

-- The moderation service's signed attestation, posted over the private internal listener. The
-- participants and channels live inside the JSON, verified against MOD_SIGNING_PUBLIC before it is
-- stored, and served to the two traders only.
create table trade_attestations (
  code text primary key references trades (code) on delete cascade,
  attestation jsonb not null,
  sig text not null,
  created_at timestamptz not null default now()
);
