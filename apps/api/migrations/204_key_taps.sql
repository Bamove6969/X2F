-- Plan 4, Task 5: security-key taps bound to one intent (spec 6.6, Global Constraints "two-person
-- rule"). Numbered 204, not the plan's 203: Task 4 holds 202 and may need the next number.
--
-- A tap is started for one `KeyTapIntent` (`intent`, its canonical JSON exactly as hashed into the
-- WebAuthn challenge, `tapChallenge` in @x2f/staff) with a fresh random `nonce`, answered once by
-- one of the account's attested security keys (`credential_id`, `response`: the assertion JSON the
-- moderation process re-verifies), and used once by the action it authorises (`used_at`, set in
-- that action's own transaction). A tap is valid for 2 minutes from `started_at` (`KEY_TAP_TTL_MS`).
-- No row holds a name, an address, a reason or an IP address: a ruling's reason is only its SHA-256.
create table key_taps (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id),
  credential_id text check (credential_id ~ '^[A-Za-z0-9_-]+$' and char_length(credential_id) between 16 and 1364),
  intent text not null check (char_length(intent) between 2 and 2048),
  nonce bytea not null unique check (octet_length(nonce) >= 16),
  response jsonb,
  started_at timestamptz not null,
  finished_at timestamptz,
  used_at timestamptz,
  -- Finished means answered: the credential and the response are set together, and only then.
  check ((finished_at is null) = (credential_id is null) and (finished_at is null) = (response is null)),
  -- Used means finished first.
  check (used_at is null or finished_at is not null)
);

create index key_taps_account on key_taps (account_id, started_at);
