-- Owner, 8 Nov 2026: a trader agrees to the Terms once, at account opening (and again when the
-- Terms version changes), with a tick AND a signature. The signature is kept with the account, next
-- to terms_version and terms_accepted_at, and goes when the account row goes. It is a small JSON
-- value checked by the API (src/termsSignature.ts, at most 64 KiB as JSON):
-- {"kind":"drawn","width","height","path"} (an SVG path of the strokes) or {"kind":"typed","name"}.
-- Nothing else is stored with it: no IP address, user agent or device fingerprint. Null for staff,
-- the owner, and accounts opened before this migration (they sign at their next Terms change).
-- The check is a backstop with room for jsonb's own spacing; the API's cap is the real limit.
alter table accounts add column terms_signature jsonb
  check (terms_signature is null or octet_length(terms_signature::text) <= 131072);
