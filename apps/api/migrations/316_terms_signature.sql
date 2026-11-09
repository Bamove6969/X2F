-- Owner, 8 Nov 2026: a trader agrees to the Terms once, at account opening (and again when the
-- Terms version changes), with a tick AND a signature. The signature is kept with the account, next
-- to terms_version and terms_accepted_at, and is erased when the account closes (owner, 9 Nov
-- 2026: a deleted row takes it, a close that keeps the row sets it null, eraseTermsSignature). It is a small JSON
-- value checked by the API (src/termsSignature.ts, at most 64 KiB as JSON):
-- {"kind":"drawn","width","height","path"} (an SVG path of the strokes) or {"kind":"typed","name"}.
-- It is stored sealed, never in clear: AES-256-GCM under a subkey of its own with the account id as
-- associated data (sealTermsSignature), as nonce (12) || ciphertext || tag (16).
-- Nothing else is stored with it: no IP address, user agent or device fingerprint. Everyone who gets
-- a login signs (owner, 9 Nov 2026): traders, team members and staff. Null for the owner, and for
-- accounts opened before this migration (they sign at their next Terms change).
-- The check is a backstop at the largest sealed length; the API's cap is the real limit.
alter table accounts add column terms_signature bytea
  check (terms_signature is null or octet_length(terms_signature) <= 65564);
