-- Plan 5, Task 10 (spec 5.5; P5-A20 to P5-A24): past reputation from other sites, proven by a
-- signature with the PGP key the archived old profile shows. A moderator approves (Task 11).
--
-- The key is kept only sealed (`key_enc`: AES-256-GCM under subkey('pgp-key') with its own AAD,
-- `x2f/pastrep-key/<fingerprint>`, so it cannot be swapped into pgp_keys), reduced by storableKey
-- (user IDs removed where the key survives it, R16). `evidence_url` is never fetched by the server.
-- The challenge itself lives in `challenges` (purpose 'past-rep') until finish.
--
-- The verified signature is kept only sealed too (`signature_enc`, owner item 71: a signature may
-- carry a Signer's User ID, often an email): the one signature packet re-armored with no armor
-- headers, sealed like `key_enc` under its own AAD, `x2f/pastrep-sig/<claim id>`.
--
-- One key, one account (P5-A24; owner item 72: the same account may use one key for several
-- sites). Among `signed|approved` rows a fingerprint belongs to one account only; the trigger below
-- enforces it under a per-fingerprint advisory lock, so two accounts finishing the same key at once
-- cannot both win. A revoked, rejected or removed claim is not live: the same key may claim again
-- (owner item 74: it goes back to a moderator as `signed`).
create table past_reputation (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id) on delete cascade,
  site text not null,
  evidence_url text not null,
  claimed_trades int not null check (claimed_trades > 0),
  fingerprint text not null,
  key_enc bytea not null,
  challenge_text text not null,
  signature_enc bytea not null,
  status text not null check (status in ('signed', 'approved', 'rejected', 'removed', 'revoked')),
  verified_trades int,
  reviewer_id uuid references accounts (id) on delete set null,
  decided_at timestamptz,
  reason text,
  created_at timestamptz not null
);

-- Lookup for the one-account-per-key check.
create index past_reputation_fingerprint_live on past_reputation (fingerprint) where status in ('signed', 'approved');
-- P5-A21: one live claim per site per account.
create unique index past_reputation_site_live on past_reputation (account_id, site) where status in ('signed', 'approved');
create index past_reputation_account on past_reputation (account_id, created_at);
create index past_reputation_status on past_reputation (status, created_at);

-- P5-A24 with owner item 72: a live row's fingerprint may not be live on another account. The lock
-- (key space 7240304, the fingerprint's hash) is held to the end of the transaction, and the check
-- runs after it is taken, so it sees any row a racing transaction committed. Raised as a unique
-- violation on `past_reputation_fingerprint_account` so callers map it like an index clash.
create function past_reputation_one_account_per_key() returns trigger language plpgsql as $$
begin
  if new.status in ('signed', 'approved') then
    perform pg_advisory_xact_lock(7240304, hashtext(new.fingerprint));
    if exists (
      select 1 from past_reputation
       where fingerprint = new.fingerprint and account_id <> new.account_id and id <> new.id
         and status in ('signed', 'approved')
    ) then
      raise exception 'past_reputation: this key backs a live claim of another account'
        using errcode = 'unique_violation', constraint = 'past_reputation_fingerprint_account';
    end if;
  end if;
  return new;
end
$$;

create trigger past_reputation_one_account_per_key
  before insert or update of status, fingerprint, account_id on past_reputation
  for each row execute function past_reputation_one_account_per_key();
