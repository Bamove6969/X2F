-- Plan 4 Task 13: what the moderation process's ruling gate reads, through its read-only role
-- `x2f_mod_reader` (208). The gate trusts none of it: it re-verifies every security-key tap and
-- every staff key registration itself, against owner keys pinned outside this database
-- (`apps/moderation/src/gate`). Reading is all it needs; it writes nothing here.
--
-- `staff_key_registrations`: the WebAuthn registration response of every attested security key an
-- invited staff member registered through their invite (challenge `inviteRegistrationChallenge
-- (tokenHash)`), exactly the fields verification read (clientDataJSON and attestationObject). The
-- gate verifies it again with attestation and links the key to the owner's `create-invite` tap for
-- that token hash, so a key added to `webauthn_credentials` any other way is never one it accepts.
-- It holds a public key and an attestation certificate, nothing secret, no name, no IP address.
create table staff_key_registrations (
  credential_id bytea primary key references webauthn_credentials (credential_id) on delete cascade,
  invite_id uuid not null references staff_invites (id) on delete cascade,
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  created_at timestamptz not null
);

create index staff_key_registrations_invite on staff_key_registrations (invite_id);

-- The gate's columns, and only these (never a name, a login name, a reason's author or a detail).
grant select (id, kind) on accounts to x2f_mod_reader;
grant select (account_id, role, switched_off_at, removed_at) on staff_members to x2f_mod_reader;
grant select (id, token_hash, role, tap_id, account_id, used_at) on staff_invites to x2f_mod_reader;
grant select (credential_id, invite_id, response) on staff_key_registrations to x2f_mod_reader;
grant select (account_id, credential_id, public_key, kind, attested, aaguid) on webauthn_credentials to x2f_mod_reader;
grant select (id, account_id, credential_id, intent, nonce, response, finished_at, used_at) on key_taps to x2f_mod_reader;
-- The ruling as the API stored it (the machine's draft and round 1), and the published reason's
-- text so the gate can check it is the one both taps bound (its SHA-256).
grant select (round, ruling, round1) on disputes to x2f_mod_reader;
grant select (code, seq, round, reason) on dispute_rulings to x2f_mod_reader;
-- R37: who has an activity-log entry on the trade before its appeal.
grant select (actor_kind, actor_id) on activity_log to x2f_mod_reader;
