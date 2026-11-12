# Review: mod-gate (Plan 4 Task 13, the ruling gate), 2026-11-12

Reviewer: independent adversarial security review (helper). Not committed.

- **Reviewed:** `origin/wip/lead-mod-gate` = **f4b486ab** (`READY: mod-gate`), with its RED commit bf31b34b. Fetched just before the review.
- **Base:** the branch still sits on `wip/lead-rulings` **97e342c6**, NOT yet on c9a5ad75. c9a5ad75 ("lead calls Q1 and Q3") only touches `apps/api/src/disputes/rulings.ts` (pause/emergency-stop refusals, removes `GET …/appeal-reviewers`), `errors.ts`, rulings/routes tests and `cantDoCodes.ts`. The only overlap with this branch is the comment block in `disputes/rulings.ts`, so the rebase is mechanical, and none of the findings below depend on it. If the rebased head changes anything under `apps/moderation/src/gate/`, `211_gate_reader.sql` or `staff/invites.ts`, it needs a re-look.
- **Threat model:** the API process and its database are fully compromised (any row, any order, rows held back). The gate's own state (`gate.bin`, MOD_KEYSTORE_KEY) and the owner's and honest staff's security keys are not.

## Verdict

**Not ready: 2 blocking findings.** The tap verification, nonce binding, two-person and limit logic, payouts, store sealing, pinning and the 211 grants all hold up. But the staff-onboarding link in the chain of trust can be taken over from the database alone (B1), and the R37 check that the gate is meant to own can be skipped with one unsigned field (B2).

## Blocking

### B1. A compromised database can get its own key trusted as staff under any owner `create-invite` tap, including an expired one, and can add keys to a joined staff member

`registry.ts` step 1 trusts, for an owner `create-invite` tap: (a) `staff_invites.account_id` as the person, (b) **every** row in `staff_key_registrations` for that invite that verifies, and (c) `used_at` to decide when the invite closes. Of all this, only `inviteId`, `role`, `tokenHash` and `expiresAt` are signed. The registration challenge is `inviteRegistrationChallenge(tokenHash) = SHA-256("x2f-invite-v1\n" + tokenHash)`, and `token_hash` is a column in the same database (granted to the reader as well). So the challenge needs nothing secret.

Scenario (PoC P1, passes on f4b486ab):
1. The owner taps `create-invite` for a senior. The invite can be expired and never used: `expiresAt` is never checked against the gate's clock.
2. The attacker reads `token_hash` and computes the challenge. With its own genuine allowlisted security key (a retail YubiKey) and a CTAP client that lets it pick the origin and rpId, it produces a packed, x5c-attested registration for the staff RP.
3. It writes `staff_invites.account_id = <attacker account>`, a `staff_key_registrations` row and a `staff_members` row.
4. On the next sync the gate adds the attacker as a **senior**. The attacker can now approve any over-limit ruling a colluding or compromised mod proposes, or propose and win as the senior with an honest-looking second. In the PoC, a 10,000,000-cent ruling is authorised with a mod's proposal and the attacker's approval.

Variant (PoC P2, passes): for a real, already joined senior, the database keeps `used_at` null and adds another registration row under the senior's invite. The attacker's key is added to the senior's `creds`, so it can sign as that senior. The invite latches closed only when the database says `used`, and the database can say that never.

The API's live process sees the real token in any case. So even with a token-secret challenge, a compromised API can race the invitee. A fix that holds needs an owner act that binds the key:
- **Fix (owner question, recommended):** the owner confirms each new staff key by tapping a signed intent such as `{kind:'add-staff-key', accountId, credentialId, publicKeySha256}` after comparing the invitee's key check code. This mirrors `add-owner-key`; the invite page already shows `keyCheckCode`.
- **At minimum:** check `expiresAt` against `ctx.now()`; accept at most the registrations seen up to the first sync where the staff row appears, then latch `inviteClosed` when `joined` becomes true whatever `used_at` says; and bind the account id. Even then, B1 is open to a DB-only attacker until the owner confirms the key.
- Tests: the existing invite test only covers missing tap, self/none attestation, off-list AAGUID and wrong token. None of them has an attacker holding a valid attested key.

### B2. R37 (appeal by someone involved in round 1) is bypassed by naming an unseen or wrong `round1Id`

`authorizeRuling` round 2 reads `rul.round1Id` from the API's `disputes.round1.id`. The ruling tap intent does **not** sign it: `KeyTapIntent['ruling']` has no round1Id. If `g.rulingsSeen[round1Id]` is undefined, the gate quietly falls back to the database's `involved` list alone, which is `activity_log` and so also the database's word.

Scenario (PoC P3, passes): mod M proposes round 1, and the gate authorises it and records `signers: [M]`. On appeal, M proposes the round-2 ruling. The database serves `round1Id = <random uuid>` (or the id of an earlier dispute's round-1 ruling on the same trade, with other signers) and an empty log list. Result: `{ok: true, settle: null}`. The round-1 decider has judged their own appeal.

Money impact today is indirect: round 2 settles nothing here, and the overturn is a lien (Task 25). But the gate is the documented R37 control ("round 1's signers as the gate saw them"), and Task 14/25 will act on this authorisation.
- **Fix:** refuse round 2 unless `rulingsSeen[round1Id]` exists with the same code and `round === 1` (the executor must then check round 1 before round 2; it already does so per the M3 note). Better still, add `round1Id` to the round-2 ruling intent so the taps bind it: a `@x2f/staff` and API change, needing the lead's call.
- Add a test with an unseen `round1Id` and one pointing at another ruling.

## Minor

### M1. Withheld registry taps are applied whenever they first appear, so an old owner tap can undo a newer one
Registry taps (`switch-on`, `set-role`, `settings`) carry no time or sequence, and the gate applies them "in the order first seen". A database that held a tap back can release it after a newer one has been applied:
- PoC P4 (passes): the owner switches mod M on, and the database hides that tap. Later the owner switches M off, and the gate latches `revoked`. The database then clears `switched_off_at` and releases the old switch-on, and M counts again.
- PoC P5 (passes): the owner's earlier "limit US$1,000,000" settings tap is held back. The owner lowers the limit to US$100 and the gate applies it. The database releases the old tap, and the limit is back to US$1,000,000, so every trade under US$1M passes with one mod tap.
- The same applies to `set-role` (re-promoting a demoted senior, or a helper made mod again).

The comment "an earlier tap never undoes a later one" is true only for taps the gate saw in order; the `taps.reverse()` test does not cover a held-back tap.

Graded minor because an attacker present at the time can also simply never show the newer tap (see I1). Still, the gate could close the replay half cheaply: keep a per-credential high-water mark of `authenticatorData.signCount` (YubiKeys have monotonic counters), and refuse registry taps by that key below it. Alternatively, sign a sequence or issued-at into registry intents. `verifyTap` passes `counter: 0` today, so cloned-key detection is off too.

### M2. Concurrent `save()` calls share one temp file name
`startGateSync`'s pass and `gateCheck` (Task 14) can run `syncRegistry` and `save()` at the same time on the same `GateState`. Both write `${path}.${pid}.tmp`: two `open(…,'w')` handles truncate and write the same inode. The first `rename` publishes a possibly interleaved file, and the second `rename` fails with ENOENT. The likely result is a `gate.bin` that fails GCM on the next start (fail-closed but an outage, and the nonce/latch state is lost), or a thrown sync.
- **Fix:** a per-store mutex around sync+authorize+save, and a unique temp name. Also fsync the directory after the rename, or a crash can roll the gate back to an older file (older latches).

### M3. The "nothing in the gate calls settle" tripwire is weak
`buyerCancel.test.ts` checks only top-level files in `src/gate/` against `/\.settle\(/`. A destructured `settle(…)`, a call in `src/cli/`, or a file in a subfolder passes. Today nothing calls it: I grepped `gate/` and `cli/`, and the only `@x2f/escrow` import is `type Payout`. Suggest asserting that `gate/` imports nothing but types from `@x2f/escrow` and the party, recursively.

## Info

- **I1. Revocation and power-reducing owner taps rely on the database showing them.** Switch-off and removal are read unsigned, and a compromised API can simply never write `switched_off_at`. The gate also ignores the owner's tapped `remove-staff` and `emergency-stop` intents, which only reduce power and need no ordering. The new c9a5ad75 emergency-stop refusal is API-side only. Owner question: should the gate also honour the owner's tapped `remove-staff` / `emergency-stop` (and a tapped switch-off), and show the owner its own view (roster, limit) somewhere the API cannot fake?
- **I2. Attestation copy drift is fail-closed but unpinned.** `gate/attestation.ts` parses the same README the same way, but: it finds the heading with `trimEnd()` where the API uses `[ \t]*$` (a CRLF README makes the API throw and the gate accept; same sets otherwise). It does not check `nextUpdate`. It accepts only `fmt === 'packed'` where the API accepts any `fmt !== 'none'`, so a staff key the API took as `fido-u2f`/`tpm` silently signs nothing at the gate. `MOD_FIDO_MDS_DIR` may point at a different snapshot than the API's. No test compares the two parsers. Suggest a parity test (same README fixtures through `parseAllowlist` and the gate's `allowlist`) and a startup log of the allowlist hash in both processes.
- **I3. `recordedTerms` does not cross-check** `trade.amountAtomic`/`poster` against the attested `deal.takeAmountAtomic`/`deal.poster`. USD is computed from `trade.amountAtomic`. Cheap assertion; it removes a Task 14 wiring mistake class. Rounding is otherwise right: usdCents rounds up, compared with `>=`; non-USD (including `'usd'` lower case) gives null, so a second person is needed.
- **I4. A missing `gate.bin` opens as a fresh, re-pinnable gate (PoC P6).** A flipped byte, the wrong key or a zero-length file all throw (checked). Deletion or a changed `MOD_STATE_DIR` needs host access, not API access, and re-pinning still needs the operator's `yes`, so this is info. Consider writing a sentinel next to the keystore (or in the mod DB) recording "pinned" so that a missing file is an error after the first pin. An older sealed copy also opens (no freshness), which reverts latches; again host access.
- **I5. `pin-owner` does not check the owner keys' AAGUIDs against the owner allowlist**, and takes the first `kind='owner'` account. Fine given the operator compares every check code (80-bit) with the locked page. The prompt could also print the key count, so an extra planted key stands out.
- **I6. `add-owner-key`** does need two distinct pinned credentials (checked; a single key tapping twice is not enough), and verifies the public key hash. It does not check the new key's attestation/AAGUID, but the owner tapped its hash, so that is acceptable.
- **I7. 211 grants** are exactly the listed columns (plus 208's). There are no table-level, PUBLIC or default-privilege grants on these tables in any migration. The reader test checks only a few denials. `staff_invites.tap_id` is granted but unused; consider dropping it. `staff_key_registrations.response` holds the attestation certificate (device batch, no personal data).
- **I8. The API's `key/finish`** now stores only `id, rawId, type, clientExtensionResults:{}, clientDataJSON, attestationObject`, for attested security keys only, in the same transaction. Fine, and the gate does not trust it anyway.
- **I9. Tests not weakened**, with two tests replaced. Plan 3's "verifyRuling refuses every input" was replaced, because the function is gone and the gate's tests cover refusal. The `NEEDS_P4_MODERATION_REVOKE` tripwire was replaced by a source-regex test that the gate reads switch-off itself: this drops the earlier plan to notify the moderation process on switch-off, which is a design change the lead should acknowledge. `schema.test.ts` changes only add `211_gate_reader.sql` to the lists.

## Checked and holding

- **Forged or replayed taps:** signature, RP id and origin, canonical intent and nonce are all re-verified. A tap is bound to its `rulingId`, step and round by its signed intent, and `usedNonces` binds nonces across kinds. Re-checking the same ruling with the same taps succeeds again, as designed.
- **Revoked or removed staff:** latched (`removed` for good). A switch-on needs a fresh owner tap; see M1 for the hold-back variant.
- **Helpers and the second person:**
  - A helper can neither propose nor approve.
  - A mod cannot approve.
  - The same account twice is refused.
  - The owner proposing and approving alone is refused (`same-person`).
- **Two-person rule:**
  - It comes from the gate's own limit (owner `settings` taps only) and its own recorded USD.
  - Any account action needs two people.
  - Non-USD needs two people.
- **XMR amount:** it must equal the recorded amount in every tap.
- **Payouts:** only from `payoutsFor` on the caller's recorded terms (Task 14 must pass the desk's record), and only for a round-1 escrow outcome. Round 2 and after-refund rulings settle nothing.
- **`gate.bin`:** AES-256-GCM under its own HKDF subkey with AAD. A tampered file or the wrong key throws.
- **Pinning:** needs `yes` and two or more keys, and refuses when already pinned.
- **Owner keys:** a new one needs two different pinned keys.
- **`MOD_STATE_DIR`:** when unset, no gate runs and nothing is co-signed.

## Tests run

Detached worktree on f4b486ab, fresh `npm ci`, each run under `flock ~/x2f-comms/check.lock` plus the scratchpad serialised runner; worktree and node_modules removed afterwards.

- `apps/moderation/test/gate.test.ts` + review PoC file (`zz-review-poc.test.ts`, uncommitted, kept at `/tmp/claude-0/-home-user-X2F/992ece86-f5cc-5ebc-82cc-7f9bc9dec1c0/scratchpad/mod-gate-review-poc.test.ts`): 29/29 passed = 23 branch tests + 6 PoCs. The PoCs assert the ATTACK SUCCEEDS: P1, P2 (B1), P3 (B2), P4, P5 (M1) and P6 (I4). After a fix, flip them into refusals.
- `apps/api/test/staff/members.test.ts`: 28/28 passed.
- `apps/moderation/test/buyerCancel.test.ts`: 26/26 passed.
- `npx tsc -p apps/moderation --noEmit`: clean.
- Not run: `apps/api/test/schema.test.ts` (only migration-list edits; read), the full suites (not allowed on this box).
