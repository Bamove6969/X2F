-- S-085 (owner, 30 Oct 2026: device-bound sessions, a non-copyable browser key, before mainnet):
-- docs/superpowers/specs/2026-11-12-device-bound-sessions.md. A session created with the browser's
-- public key (`bound_key`, SPKI DER of an ECDSA P-256 key) also needs a short-lived bound cookie
-- (`bound_token_hash`, SHA-256 of its value, valid until `bound_until`), renewed only by a
-- signature over a server challenge. Challenges are stateless (an HMAC over the session id, an
-- expiry and a nonce, review MF1), so several may be outstanding; `session_proof_nonces` makes each
-- single-use: the first answer to one records its nonce until the challenge expires. All null for
-- an unbound session; checked only while X2F_DEVICE_BOUND_SESSIONS is on. The key is public: never
-- secret, never logged.
alter table sessions
  add column bound_key bytea check (bound_key is null or octet_length(bound_key) between 26 and 200),
  add column bound_token_hash bytea,
  add column bound_until timestamptz;

create table session_proof_nonces (
  nonce bytea primary key check (octet_length(nonce) = 16),
  session_id uuid not null references sessions (id) on delete cascade,
  expires_at timestamptz not null
);
create index session_proof_nonces_session on session_proof_nonces (session_id, expires_at);
