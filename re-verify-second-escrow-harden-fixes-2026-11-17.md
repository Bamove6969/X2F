# Re-verify: wip/second-escrow-harden-fixes 9c7e7a78 (security), 17 Nov 2026

**Verdict: APPROVED.** M1, M2 and M3 from review-lead-escrow-harden-2026-11-16.md are fixed. F3, F4 and F5 from review-multisig-vs-retoswap-2026-11-12.md stay fixed. I found no new hole and no weakened test. The head's full `npm run check` is green. So are the escrow, regtest, regtest-verify and node-proxy suites.

There are two new minors (N1, N2). Neither blocks landing, and neither changes behaviour today. Both are owner or lead questions for the day the first key gets a validity date.

- **Scope:** `git log b1a364ce..9c7e7a78`, 4 commits:
  - 2a271acb: red tests;
  - c647858f: M1;
  - d37aa965: M2 and M3;
  - 9c7e7a78: READY note.
  23 files, +433/-58. I read every changed line. main 4f0afa14 is an ancestor of the head.
- **Inputs:** review-multisig-vs-retoswap-2026-11-12.md, build-escrow-harden-2026-11-12.md, review-lead-escrow-harden-2026-11-16.md, and to-lead.log lines 407 and 411.
- **Threat model:** the same as the 16 Nov review. The API and its DB are compromised, a counterparty may be malicious, and the monerod node (the operator's node proxy) may lie.

## Earlier findings

| Finding | Status | How it was checked |
|---|---|---|
| M1: a thief of a rotated-out key backdates `issuedAt` | **Fixed** | See M1 below |
| M2: a lying node moves the fee bound both ways | **Fixed for deflation and for the mask.** Inflation through `fees[1]` up to 0.01 XMR remains, flagged as an owner question | See M2 below |
| M3: `signRelease` fetches the estimate again after commit | **Fixed** | See M3 below |
| F3: 2-of-3 check with distinct keys | Unchanged since b1a364ce: `monero.ts` changed only in `checkRelease` and `signRelease` | The diff, plus shape.test in the escrow run (18 files, 135/0) |
| F4: fee bound | Kept, now inside a band | fee-bound.test and regtest-verify 10/0 |
| F5: key list with validity dates, `issuedAt` check | Kept. `takenAt` is now only an extra check | trade attestation.test |
| I1 nit: `outputs = max(2, expected.length)` | Not taken. It stays harmless: `checkTxSet` checks the length | n/a |

### M1 (c647858f)
- **What changed:** `AttestationSelf.identityCreatedAt` is required (`number | null`). Code: packages/trade/src/attestation.ts:408-415.
  - A missing value, a non-number, NaN, Infinity or a value below 0 gives `bad-time`. A runtime `typeof` guard catches a missing key, not just TypeScript.
  - `issuedAt < made − 10 min` gives `bad-time`.
  - `null` is accepted only when the key that verified the signature (`signedBy`, taken from the verify loop) has `notBefore === null && notAfter === null`.
- **Where the time comes from:** the device clock (`now()` and `d.now`), written into the record next to the fresh identity, before `persist()` and before `registerIdentity`.
  - Escrow: apps/web/src/escrow/runtime.ts:525.
  - Chat: apps/web/src/chat/engine.ts:252.
  - Records live only in local IndexedDB. Nothing imports or restores them from the API, so the API cannot set or strip the value.
- **Runtime:** passes `this.rec.identityCreatedAt ?? null` (runtime.ts:621). The chat engine does the same.
- **No other callers:** there are no verifyAttestation call sites in src beyond these two, and none on batch10a either.
- **The 16 Nov PoC is now a red-then-green test.** It covers a backdated `issuedAt` with and without `takenAt`, the chat case, and both web flow cases (view without `takenAt`, and `takenAt` backdated too).
- **The comment is corrected:** the key window is not revocation.

### M2 (d37aa965)
- **The band:** `bound = min(MAX_NETWORK_FEE, max(FEE_BOUND_FLOOR = 2e8, 4 × quantize(weight × fees[1])))`, at verify.ts:111-117.
- **The mask is capped at 1e8** in both `parseFeeEstimate` and `feeCeiling`.
- **Checked by hand:**
  - A tiny estimate gives exactly 2e8, so an honest sweep at about 1.3e8 passes.
  - A 9e15 mask gives 4 × 2 × 1e8 = 8e8 (0.0008 XMR), not 1e10.
  - The floor only raises the bound, so it cannot strand an honest release.
  - Capping the mask can only lower the bound if monerod's real mask were above 1e8. It is 1e4.
- **Still open (owner Q1):** a node that lies high through `fees[1]` can still lift the bound to the 0.01 XMR backstop, so a malicious seller plus the operator can still burn up to 0.01 XMR. This is the pre-F4 status, not a regression. The code comment says it openly.

### M3 (d37aa965)
- **Storing the bound:** `checkRelease` returns the bound. The co-signer stores it as `rel.feeCeiling` together with `committed` and `txSet` in the same `persist()` (party.ts:714-718). It is cleared in `nextAttempt` (party.ts:600).
- **Using it:** the `signRelease` re-check uses the stored bound and does not ask the daemon.
- **A tampered stored bound cannot lift the fee:** `checkTxSet` still enforces `fee > MAX_NETWORK_FEE` separately (verify.ts:162). The test "never lifts the 0.01 XMR backstop" covers this.
- **Malformed or old state:** the regex `^[1-9][0-9]*$` falls back to reading the estimate again, which is the old behaviour.
- **Regtest test:** followups "review M3" shows a power cut while cosigning, then a node that withholds `get_fee_estimate`, and the release still completes with 0 estimate calls. It passed in the 135/0 escrow run.
- **Not affected:** `cosign()` (monero.ts:483) still checks without a stored bound, but the party never calls it.

## New-hole hunt
- **Distinct-key bypass:** F3 code is untouched. The 16 Nov proof stands: the decoder is a bijection, wallet2 checks the round-1 signature against those exact bytes, and the own-message-back case is refused.
- **Can the fee bound strand an honest release?**
  - No. The floor is above an honest normal sweep, and 4× normal is unchanged above the floor.
  - With M3, a falling estimate between the check and the signature no longer refuses a set that was just accepted.
  - A node that refuses the estimate before commit gives `daemon-unavailable` (retryable), as before.
- **Can `bad-time` block a trade?**
  - The new lower-bound check is deterministic. Its inputs are the stored identity time and the signed `issuedAt`, and neither changes. So it cannot start failing after funding.
  - It runs at the P3-C1 check before any escrow work, and gives the same answer on every later start.
  - The API cannot influence it. It can still use `takenAt` to cause `bad-time`, which is unchanged (16 Nov I3) and is no new lever.
  - The exceptions are N1 and N2 below.

### N1 (minor, new): a device clock more than 10 min fast when the identity is made blocks that trade on that device for good
- **Cause:** `identityCreatedAt` is the device clock, and `issuedAt` is the moderation clock. If the device was more than 10 min fast when it made the identity, then `issuedAt < made − skew` on every start.
  - Unlike the existing "future" check, this one never heals, because the stored time does not change.
  - The record and identity are already registered, so they cannot be remade.
- **Effect:** the runtime shows the retryable `escrow-failed` before any escrow work. No funds are at risk: there is no funding yet. But the trade cannot go ahead on that device until it is cancelled or times out.
- **Also covered:** a moderation server clock more than 10 min slow does the same for everyone. That was already true via `takenAt`.
- **Fix options (owner and lead):**
  - a wider skew for this bound only (e.g. 1 h; it only has to beat a key rotation date, so hours are fine);
  - or the `bad-time` copy already asked about ("check your device's clock", builder Q1) together with a way to cancel.
- **Recommendation:** use a separate, larger skew for the identity bound, such as 1 h. It costs nothing against a thief, because rotation dates are days apart.

### N2 (minor, future): pre-M1 records plus the first bounded key stall in-flight trades, funded ones included
- **Cause:** records written before this change have `identityCreatedAt` absent, read as null. The day `attestationKeys()` returns any bounded key, these records get `bad-time` on every start, at P3-C1, before the party runs.
- **Effect:** for a funded trade the runtime never resumes on that device, so it cannot release or co-sign. Funds wait on the dispute or moderator path.
- **Today:** nothing happens, since there is a single unbounded key.
- **Recommendation for the rotation release (lead):** ship the first bounded key only once no pre-M1 trade or chat is open. Or let `null` keep the old behaviour when the signing key's window covers `issuedAt` and the record predates the release. That second option weakens M1 only for old records.
- **Owner question:** this is a choice of rotation date and policy.

## Tests weakened?
No.
- **Escrow assertions:** `checkRelease(...).resolves.toBeUndefined()` became `resolves.toBeTypeOf('bigint')`, which is equivalent.
- **attestation-flow:** the "before the trade was taken" case moved `takenAt` from 09:00 to 12:30 because the fake `issuedAt` now defaults to the registration time (12:00). The refusal is still exercised, with the same margin logic.
- **Fakes:** the e2e chat and design-shots stubs now issue `issuedAt` at "now" instead of a fixed past time. The moderation, API and test fakes only add `identityCreatedAt`, or return `MAX_NETWORK_FEE` from `checkRelease`.
- **Nothing removed:** no assertion was removed, and nothing was skipped or marked todo.

## Merges
- **main 4f0afa14:** already an ancestor of 9c7e7a78, so the merge is a no-op and clean.
- **origin/wip/lead-batch10a 846d83ba:**
  - **Conflict:** one textual conflict, inherited from b1a364ce rather than new here: the import block of apps/web/src/chat/engine.ts.
    - batch10a adds `ProofError`, `ProofAttachedPayload` and `sealProofAttached`.
    - This branch adds `attestationKeys`.
    - Resolution: take the union of both lines. Everything else auto-merges, including chat/store.ts, cantDoCodes.ts, chatEngine/chatNotice tests and trade index.ts.
  - **Not affected by the new required field:** batch10a adds no other verifyAttestation call site and no other EscrowSession fake.
  - **On the trial merge (detached worktree, fresh npm ci):**
    - tsc is clean on trade, escrow, web, moderation and api, and copy-lint is clean.
    - The touched tests (see the table) pass: 9 files, 282 passed, 0 failed.

## Tests (my runs, Node 24.22.1, detached worktree at 9c7e7a78, fresh `npm ci`, all under ~/x2f-comms/check.lock with the timeout inside the flock)

| Run | Result |
|---|---|
| Full `npm run check` at 9c7e7a78 | **exit 0**. typecheck clean, copy-lint clean, separation-check ok, vitest **372 files, 6946 passed, 1 todo, 0 failed** (regtest projects included; monerod v0.18.5.3 fetched and verified), semgrep 0 findings, audit 0 vulnerabilities. 04:38-05:06 UTC |
| `@x2f/escrow` (whole, regtest engine and party included) | **18 files, 135 passed**, exit 0 |
| `regtest` | **4 passed**, exit 0 |
| `regtest-verify` | **10 passed**, exit 0 |
| `@x2f/node-proxy` | **3 files, 34 passed**, exit 0 |
| Trial merge with lead-batch10a: trade attestation, escrow fee-bound and verify, web attestation-flow, chatEngine, chatNotice, moderation attest, chat, releaseSettles | **9 files, 282 passed, 0 failed**, exit 0 (07:54 UTC) |

The Monero suites ran as scratchpad/final-check-9c.sh runs them: one `npx vitest run --project <p>` each, in sequence, in one flock. Not run: Playwright (not part of `npm run check`; the e2e changes are stub-only). The worktrees, node_modules and .regtest were removed afterwards.

## Owner questions (via the lead)
1. **(carried from M2)** Should the fee bound also be capped relative to the payout, against a node that lies high? Recommended: `max(FEE_BOUND_FLOOR, payouts[0]/200)` as a second cap. Also confirm the FEE_BOUND_FLOOR value of 0.0002 XMR, marked `// OWNER: value`.
2. **(N1)** Should the identity-time bound get its own, larger skew (recommended 1 h)? Or keep 10 min and give `bad-time` the "check your device's clock" copy?
3. **(N2)** First key rotation policy: wait until no pre-M1 trade or chat is open (recommended), or accept old records without a lower bound.
4. **(carried)** Revocation list (review F5.2) together with the first rotation; the `bad-time` copy.
