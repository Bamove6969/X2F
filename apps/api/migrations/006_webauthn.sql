-- Plan 2, Task 8: passkeys and security keys. `attested` is true only for a credential whose
-- attestation chained to the FIDO metadata snapshot and whose AAGUID is allowlisted (staff and
-- owner security keys). `backed_up` and `device_type` are what the authenticator reported: they are
-- kept for display and never trusted for policy.
create table webauthn_credentials (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id) on delete cascade,
  credential_id bytea unique not null,
  public_key bytea not null,
  counter bigint not null,
  kind text not null check (kind in ('passkey', 'security-key')),
  transports text[],
  backed_up boolean not null,
  device_type text not null,
  attested boolean not null default false,
  aaguid uuid,
  label text not null,
  created_at timestamptz not null,
  last_used_at timestamptz
);
create index webauthn_credentials_account on webauthn_credentials (account_id);
