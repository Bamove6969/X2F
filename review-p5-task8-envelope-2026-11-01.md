# Review: Plan 5 Task 8, proof encryption and envelope payloads (`origin/wip/third-p5-proof-envelope` @ d081dc7, base b5e85cf)

Reviewer: security reviewer, 2026-11-01. Scope: `git diff b5e85cf..d081dc7` only (6cd3c44 red tests, d081dc7 implementation). Plan text: `docs/superpowers/plans/2026-10-24-plan-5-reputation.md`, Task 8 (lines 398-416), plus Global Constraints, P5-A25 and Review Focus 4.

## Verdict: APPROVED WITH MINOR

The code does what Task 8 says, and nothing more:
- `encryptProof` uses XChaCha20-Poly1305 IETF with a fresh `randombytes_buf` 32-byte key and 24-byte nonce for every call.
- The ciphertext layout is `nonce ‖ AEAD output`.
- The AAD is exactly `x2f/proof/v1\0` + normalised code + `\0` + proofId + `\0` + kind. I checked this separately by decrypting an `encryptProof` output with raw libsodium and the literal AAD from the plan, using a lower-case, space-separated code. It opened.
- `decryptProof` gives the same `bad-ciphertext` code and message for every failure: bad key length, short input, AEAD failure and sha256 mismatch. Nothing distinguishes one cause from another. The key holder is the only party that can reach these paths anyway.
- `parseProofPayload` checks exact keys, rejects symbol and inherited properties, and accepts only a canonical 32-byte padded standard base64 key. I checked the last-character class `[AEIMQUYcgkosw048]` by hand. It also checks lower-case hex sha256, sides 1..`PROOF_MAX_SIDE`, PNG or JPEG mime, and `hidden` as a duplicate-free subset of `HiddenKind`, with a compile-time check that the list is exactly `HiddenKind`.
- The `newProofId` Crockford encoding and its regex are correct: 25 full characters, and a last character carrying 3 bits, so its index is a multiple of 4.
- Error messages carry no ids, codes or bytes.
- The constant-time question: Poly1305 tag verification is libsodium's constant-time check. The only JS compare is sha256 hex `!==` (seal.ts:143). The value it compares is not secret: it comes from the envelope, and whoever calls `decryptProof` already holds the key. No constant-time compare is needed there.

Every test the plan names is present and meaningful:
- round trip;
- a different code, proof id or kind gives `bad-ciphertext`;
- a flipped byte in the nonce, body or tag gives `bad-ciphertext`;
- fresh key and nonce on every call;
- `proof.unblurred` sealed by the buyer opens for the mod and gives `not-for-me` for the seller, through the real Plan 1 `seal`/`open`;
- an extra `filename` field is refused.

Checks run in the worktree:
- `vitest --project @x2f/proof`: 167/167 pass.
- `tsc --noEmit` (proof, protocol): clean.
- `separation-check`: ok.
- Semgrep (repo config) on `packages/proof`: 0 findings.
- `npm audit --omit=dev`: reports fast-uri advisories. These do not come from this diff: the lockfile change only adds `@x2f/protocol` and `libsodium-wrappers` 0.8.4 (already pinned in protocol) to `@x2f/proof`.

No important findings. The minor findings below are hardening and guard-rails for Tasks 13-15. None of them blocks the merge.

## Minor

### M1: nothing pins the plan's exact AAD string or ciphertext layout

- **Where:** `packages/proof/test/seal.test.ts:47-125`, `packages/proof/src/seal.ts:85`.
- **Failure scenario:** every test encrypts and decrypts through the same `aad()`. A future edit that changes the domain string, the separators, the normalised code format (for example if `@x2f/core` stopped adding dashes) or the nonce position would still pass every test. Ciphertexts already stored, which are kept up to 90 days or longer while disputed, would then stop opening in `apps/moderation`. The format is part of the plan's interface, and nothing checks it.
- **Fix:** add a test that runs `encryptProof` and then opens the result with raw `sodium.crypto_aead_xchacha20poly1305_ietf_decrypt`. Use `ciphertext.subarray(24)` as the ciphertext and `ciphertext.subarray(0, 24)` as the nonce. Build the AAD from a literal such as `` `x2f/proof/v1\0K7M2-9QXA-4FTR-8WPN\0${id}\0evidence` ``, and pass a lower-case or spaced code to `encryptProof`. I ran exactly this and it passes today.

### M2: the "proof.unblurred is sealed to the mod only" rule is not in code anywhere

- **Where:** `packages/proof/src/payloads.ts:1-11` (the rule appears only in a comment).
- **Failure scenario:** Plan 1's `Opened` (`packages/protocol/src/envelope.ts:69-74`) does not expose the recipient list. Slots for non-recipients are random, so a receiver cannot tell who an envelope was sealed to. The only enforcement is therefore whatever `to:` the Task 15 sender passes. A Task 15 bug such as reusing the `proof.attached` call path, or a copy-pasted `to: ['buyer','seller','mod']`, would seal the unblurred key to the seller. The seller's client would open it and could decrypt the unblurred image if it ever got the ciphertext: a cache, a later API bug, or the buyer's own device. No Task 8 test would catch this. This is Review Focus 4 and a Global Constraint.
- **Fix:** keep the rule next to the payload types, either as `export const PROOF_RECIPIENTS = { 'proof.attached': ['buyer','seller','mod'], 'proof.unblurred': ['mod'] } as const` or as a thin `sealProofEnvelope(env, args)` wrapper around Plan 1 `seal` that sets `to` from the type and runs `parseProofPayload` on the payload first. Add a test that the wrapper's `proof.unblurred` gives `not-for-me` for both the seller and, without `allowSelf`, the buyer. Task 15 should then use only the wrapper. Separately, for Task 15 (not this diff): the seller's chat should drop any `proof.unblurred` it manages to open.

### M3: no helper to encode and decode the payload key, and libsodium's default base64 does not parse

- **Where:** `packages/proof/src/payloads.ts:58` (`KEY_B64`); there is no encoder.
- **Failure scenario:** the payload requires padded standard base64. `sodium.to_base64(key)` with no variant argument, which is the obvious call in a libsodium codebase, returns URL-safe base64 without padding. I checked: 32 zero bytes give 43 characters and no `=`. That output is refused as `bad-payload` on every receiver. The tests use Node `Buffer`, which browsers do not have. Tasks 14 (moderation `readProof`) and 15 (web) will each write their own encode and decode, and each must also remember to zero the decoded key.
- **Fix:** export `proofKeyToBase64(key: Uint8Array): string` (`sodium.base64_variants.ORIGINAL`) and `proofKeyFromBase64(s: string): Uint8Array` (validates with `KEY_B64` and decodes with ORIGINAL; the caller zeroes the result). Test that they round-trip through `parseProofPayload`. Note in the doc comment that the base64 string itself cannot be zeroed. That is a known residual for Task 18's list.

## Nits

### N1: `decryptProof` does not limit its input size; P5-A25's `PROOF_MAX_CIPHERTEXT` is not defined anywhere yet

- **Where:** `packages/proof/src/seal.ts:129`.
- **Scenario:** the API is untrusted for proof contents. A broken or hostile API could serve a ciphertext of hundreds of MB to the seller's browser or to moderation. Copying it into libsodium's wasm heap and hashing it would exhaust memory before the tag check fails. Uploads are already capped by the Task 14 route `bodyLimit`, so this is defence in depth only.
- **Fix:** export `PROOF_MAX_CIPHERTEXT = 4 * 1024 * 1024` next to `PROOF_MAX_SIDE` (P5-A25 names it, and Tasks 13 and 14 need it). Refuse a larger input in `decryptProof` as `bad-ciphertext`. Optionally, `encryptProof` could refuse a plaintext whose output would exceed the cap, so that Task 13's PNG-to-JPEG fallback has one source of truth.

### N2: `decryptProof` accepts any string as `sha256`

- **Where:** `packages/proof/src/seal.ts:127`.
- **Scenario:** the doc says invalid arguments throw `TypeError`. But an upper-case or truncated hash from a caller that skipped `parseProofPayload` decrypts the whole image first and then reports `bad-ciphertext`, which looks like a tampered file rather than a caller bug.
- **Fix:** check the value against `/^[0-9a-f]{64}$/` and throw `TypeError` before decrypting. Move `SHA256_HEX` into `seal.ts` and share it with `payloads.ts`.

### N3: small test gaps

- **Where:** `packages/proof/test/seal.test.ts:119-124`.
- **Gaps:**
  - The `TypeError` paths of `decryptProof` are untested: a non-Uint8Array ciphertext or key, a null binding, and a non-string sha256.
  - No test asserts that `ProofError` and `TypeError` messages contain neither the proof id nor the trade code, which is a Global Constraint.
  - The test name "before touching any bytes" claims more than the test checks.
- **Fix:** add these assertions, and rename the test or prove the claim.

### N4: `isProofId` is not exported from the package index

- **Where:** `packages/proof/src/index.ts:8`.
- **Scenario:** Task 14's `PUT/GET /v1/trades/:code/proofs/:id` must validate the client-chosen id. Without the export it will write its own regex, which can drift from the regex here.
- **Fix:** export `isProofId` (and `PROOF_KINDS`) from `index.ts`.

### N5: forward note for Task 14 (not a defect here)

- **Where:** Task 14's `readProof`.
- **Scenario:** the AAD does not bind the uploader role, and cannot usefully do so: anyone holding the key can produce a valid ciphertext. So `readProof` must take the envelope whose verified `Opened.from` equals `trade_proofs.uploader_role`, and must ignore later envelopes that reuse the same `proofId`. Otherwise the seller, who holds the blurred key, could post a second `proof.attached` for the buyer's id with a different `hidden` list. Please add this to Task 14's tests.

## OWNER QUESTIONS

None. Everything this diff decides is either in the plan (AAD format, payload fields, recipients, the `PROOF_MAX_SIDE` value from P5-A25) or is a purely technical choice (upper-case Crockford proof ids, one error code for all decrypt failures).

## Round 2 (`3a6ff67`, previous head d081dc7), 2026-11-01

Scope: `git diff d081dc7..3a6ff67` (d685f5a red tests, 3a6ff67 fix). Lockfile unchanged.

### Verdict: APPROVED WITH MINOR

Every round-1 finding is fixed as asked. One new nit (R2-N1): the test for the size cap does not prove the cap. It does not block the merge.

### Findings, one by one

- **M1, fixed.** The new test runs `encryptProof` with the code `'k7m2 9qxa 4ftr 8wpn'`, then opens the result with raw `crypto_aead_xchacha20poly1305_ietf_decrypt`. It passes `subarray(24)` as the ciphertext and `subarray(0,24)` as the nonce, and the AAD is the literal `x2f/proof/v1\0K7M2-9QXA-4FTR-8WPN\0${id}\0evidence`. Mutation check: changing the domain to `v2` turns this test red.
- **M2, fixed.** Two parts:
  - `PROOF_RECIPIENTS` is frozen: `proof.attached` → buyer, seller, mod; `proof.unblurred` → mod.
  - `sealProofEnvelope(env, args)` runs `parseProofPayload` first. It refuses own `to`, `type` or `payload` keys with `TypeError`, then calls Plan 1 `seal` and takes `to` from the table. It copies only `trade`, `from`, `seq`, `me` and `participants`, which is everything left in `SealArgs`.

  The tests check that `proof.unblurred` opens for the mod and gives `not-for-me` for the seller and for the buyer, both with and without `allowSelf`. They also check that a caller-supplied `to`, `type` or `payload` is refused, and that an extra `filename` field gives `bad-payload`. Mutation checks: widening `proof.unblurred` to all three roles turns 2 tests red, and dropping `to` from `FIXED_ARGS` turns 1 red. The two Task 15 duties are written down in coordination.md: seal only through the wrapper, and the seller drops any `proof.unblurred` it opens.
- **M3, fixed.** `proofKeyToBase64` checks for 32 bytes, else `TypeError`, and encodes with ORIGINAL. `proofKeyFromBase64` checks `KEY_B64`, decodes with ORIGINAL, checks the length again, and on failure throws `ProofError('bad-payload')`. The doc comment says the caller zeroes the key, and that the base64 string cannot be zeroed (a residual for Task 18). Both functions are async because of `sodium.ready`; `parseProofPayload` stays sync. That is a technical call, and it is recorded. The tests cover the round trip through `parseProofPayload`, bytes that encode to `+`, and refusal of libsodium's default URL-safe output, of truncated, 33-byte and empty input, and of a non-canonical last character. Mutation check: switching the encoder to the URL-safe default turns 5 tests red. The tests no longer use `Buffer` for base64.
- **N1, fixed, but the test is weak (see R2-N1).** `PROOF_MAX_CIPHERTEXT = 4 MiB` is exported. `decryptProof` refuses anything longer as `bad-ciphertext`, and the check runs before `sodium.ready` and before any copy. Not done: `encryptProof` does not refuse an oversized output. The round-1 review marked that optional, and coordination.md says Task 13 checks the size.
- **N2, fixed.** `SHA256_HEX` has moved to `seal.ts` and `payloads.ts` uses the same one. `decryptProof` now throws `TypeError` before decrypting when the hash is upper-case, 63 or 65 characters, empty or not a string. Mutation check: removing the regex turns the test red.
- **N3, fixed.**
  - New `TypeError` tests: a non-Uint8Array ciphertext or key, a null binding, a bad code, and a bad sha256.
  - A message test collects 5 error messages, including those for a bad id and a bad code, and asserts that none contains the proof id or the trade code, with or without dashes.
  - The over-claiming test name is now "encryptProof refuses invalid arguments with a TypeError".
- **N4, fixed.** `isProofId`, `PROOF_KINDS`, `PROOF_MAX_CIPHERTEXT`, `PROOF_RECIPIENTS`, `sealProofEnvelope`, `proofKeyToBase64`, `proofKeyFromBase64` and `ProofSealArgs` are exported from `index.ts`, and a test covers the export.
- **N5.** Written into coordination.md as a Task 14 duty: `readProof` uses the first envelope whose verified `from` is the uploader role, and Task 14 validates `:id` with `isProofId`.

The test-only changes between d685f5a and 3a6ff67 are the sync-to-async adaptation and the replacement of `Buffer` with literal keys. No assertion was weakened. The red commit fails at collection (`proofKeyToBase64 is not a function`), so it shows red only as a whole suite, not test by test. That is why I ran the mutation checks above.

### New finding

#### R2-N1 (nit): the `PROOF_MAX_CIPHERTEXT` test passes even when the cap is removed

- **Where:** `packages/proof/test/seal.test.ts`, "refuses a ciphertext over PROOF_MAX_CIPHERTEXT".
- **Scenario:** the test decrypts `new Uint8Array(PROOF_MAX_CIPHERTEXT + 1)`, which is all zeros. The AEAD check rejects that input anyway. I deleted `|| ciphertext.length > PROOF_MAX_CIPHERTEXT` from `seal.ts` and all 178 tests still passed. A regression that drops the cap, the defence against an API serving hundreds of MB, would go unnoticed.
- **Fix:** encrypt a valid plaintext of `PROOF_MAX_CIPHERTEXT - 40 + 1` bytes (24-byte nonce + 16-byte tag, so one byte over the cap). Assert that `decryptProof` with the correct key, binding and sha256 gives `bad-ciphertext`, and that the same thing one byte smaller decrypts. Without the cap, the first case would succeed.

### Checks run (worktree @ 3a6ff67)

- `vitest --project @x2f/proof`: 178/178 pass.
- `tsc --noEmit`, proof and protocol: clean.
- `separation-check`: ok.
- Mutation checks as listed above. The worktree was restored afterwards and is clean.

### OWNER QUESTIONS

None. The recipients come from the plan (spec 6.6, Review Focus 4). The rest are technical calls listed in coordination.md:
- async key helpers;
- `ProofError` for bad base64 vs `TypeError` for a bad key length;
- the 4 MiB cap, from P5-A25.
