# Review: Plan 3 Task 8-b (moderation service), origin/wip/t3-p3-task8-b @0825614 — 2026-10-28

Reviewer: helper subagent of the lead (read-only). Original Task 8 review text was not found in
docs/superpowers/reviews/ or ~/x2f-comms (lost with the 2026-10-26 rebuild); I1 was reconstructed
from to-lead.log and the fix commits 4dadc30, 2ce0b0a, 224c5b7, 93fd7a5.

## Verdict: APPROVED (no Important findings; Minors below, none blocking)

Tests run (worktree ~/x2f-worktrees/p3-task8 @0825614, under check.lock):
- @x2f/trade attestation.test.ts + task9-io-tripwire.test.ts: 27/27 pass
- @x2f/web attestation-flow.test.ts + adapters-tripwire.test.ts: 92/92 pass
- @x2f/moderation (all): 8/8 pass
- @x2f/api identity.test.ts + schema.test.ts: 73/73 pass

## (A) I1 re-review: fixed
- identity-conflict: apps/api/src/trades/identity.ts:66-83 locks the trades row FOR UPDATE, then checks
  the other slot for the same sign or box key, so two concurrent registrations serialize; a same-key
  trade can never become work. Moderation still refuses equal keys (attest.ts:35) as defence in depth.
- Terminal refusals: internal/routes.ts:166-191 records a refusal only for a trade that is work
  (both identities, no attestation), idempotent (on conflict + re-select); the attestation POST
  refuses a refused trade (409 refused, :292) and GET attestation answers 409 attestation-refused
  (identity.ts:105). Moderation posts the refusal only for AttestRefused (main.ts:179-191).
- Rotation: work list orders `served_at nulls first, taken_at, code` and stamps served_at in the
  same statement (routes.ts:200-221), so stuck trades go to the back and new trades are always in
  the window.
- Web: 409 identity-conflict and attestation-refused are final (runtime.ts:454-480) -> kept
  `participants-mismatch`. Transient-strand check: identity-conflict needs the other slot to hold
  this device's random key (impossible honestly; proof of possession stops a third party
  registering it); attestation-refused needs a moderation AttestRefused, which only comes from data
  that never changes for that trade (proofs, keys, terms fixed at take). Network errors and 5xx stay
  in the retry loop. Only an API/moderation bug or version skew (Minor 3) can produce a false final
  answer, and that strands a trade still in `setup` (no coins yet; setupBy cancels it).

## (B) New work: terms in the attestation
Malicious API/server substitution analysis (the point of answer 4):
- Deal: the device compares every attested deal field to the deal its user confirmed
  (attestation.ts:72-80, 243) - poster, currency, rate, max, take amount, bigints compared as
  canonical decimal strings. A substituted deal -> wrong-terms -> deal-mismatch; nothing registered
  is signed and the attestation is not stored on the device (runtime.ts:486-506).
- Own address: compared exactly (attestation.ts:244). Counterparty address: taken only from the
  attestation, and a peer `trade.terms` with another address is ignored (runtime.ts:510-517). A
  substituted buyerPayout is therefore caught by the buyer's device; the buyer's party never starts,
  so all-three `ready()` never yields an escrow address and the seller cannot fund. Symmetric for
  sellerRefund. Mod slot cannot be injected (long-term mod signature; participants re-checked).
- Residual (already recorded as the Plan 6 follow-up in coordination.md): the device's own address
  comes from the take/accept screen fed by the API wallet list.
- Canonical serialization: one function (protocol canonicalJson: sorted keys, JSON.stringify
  strings, finite numbers only, throws on undefined/bigint) on both sides; the only number is v:1;
  bigints are strings constrained by /^[1-9]\d{0,30}$/ and numeric(30,0)::text never yields
  exponent/leading zeros/sign; exact key sets on terms and deal; jsonb round-trip in both DBs keeps
  strings exact and key order is irrelevant after canonicalisation. No issue.
- coalesce(grown_from_atomic, amount_atomic): correct. machine.ts:284 keeps fromAtomic as the
  ORIGINAL take amount across repeated growth and clears `grown` when the trade shrinks back to it,
  so the coalesce is always the amount at take, which is what the device stored
  (runtime.ts:422 requires view.amountAtomic === takeAmountAtomic when the record is made). Growth
  needs funding, which needs the attestation, so it cannot even occur before attesting.
- Backwards compat: a pre-terms signed_terms row (dev DBs only) is re-posted forever and refused
  400 bad-attestation (prepare() reuses it). Fine with no prod trades; wipe dev moderation DBs.
- Merge f8db6fa resolutions (app.ts route, errors.ts codes, schema lists incl. 111, flows.test.ts
  route list, check.sh separation-check, worker.ts generateIdentity exemption with its own test):
  correct. fea381d ModPartyArgs move and NEEDS_TASK_9_IO tripwire: correct, local-tree only.

## Minor
1. Work list serves closed trades. apps/api/src/internal/routes.ts:211-212 has no `t.closed_at is
   null` (or `state = 'setup'`) filter. Scenario: the moderation service is down past setupBy, or a
   trade sits on 409 terms-mismatch; the trade is cancelled, but stays work forever (until the
   90-day address purge), and once moderation comes back it attests a cancelled trade, registers
   its relay channels and (after Task 9) starts a mod party for it. Add the filter (and to refuse()).
2. Null-address trades: no end for the devices. The work list rightly skips trades without both
   addresses (routes.ts:212) and setupBy cancels the trade, but GET /v1/trades/:code/attestation
   (identity.ts:103-108) keeps answering 202 for a closed, never-attested trade, and the runtime's
   wait loop (runtime.ts:472-485) polls only that route, every 5 s, on every resumeAll(), forever;
   the record never reaches afterClose/30-day cleanup. Answer a final 409 (e.g. `trade-closed`) for
   a closed trade with no attestation, or have the loop re-read the view, and let the runtime drop
   the record.
3. `bad-work` for malformed terms is terminal (attest.ts:33 -> main.ts:183-188 -> trade_refusals ->
   devices keep participants-mismatch). Unlike bad proofs, malformed terms point at an API bug or a
   deploy skew (e.g. moderation rolled out before the API serves `terms`: every waiting trade is
   refused for good and both devices brick it). Either log-and-skip malformed terms (rotation already
   prevents starvation) or document the deploy order (API first) in the plan/dev-setup.
4. prepare() caches the signed attestation forever (main.ts:106-109). If the trade record's terms
   ever change before the first successful post (today impossible: deal fixed at take, addresses
   written once; Task 5/19 must keep it so), the trade loops on 409 terms-mismatch. Cheap guard:
   when posted_at is null and the cached terms differ from w.terms, re-sign (same mod identity) or
   log a distinct reason. At least note the invariant "addresses never change once both are set"
   for Tasks 5/19.
5. ModPartyArgs (packages/trade/src/modParty.ts:16-25) carries no terms. Plan line ~501 has the mod
   derive payouts from the recorded refund address; for the Task 9 I/O the source must be the
   moderation DB's signed_terms (what was attested), never a later API read. Add `terms:
   AttestedTerms` to ModPartyArgs now, or put that requirement in the NEEDS_TASK_9_IO tripwire
   message.
6. Plan revision 2026-10-24 (plan-3-trading.md, "Task 8 as built") is stale: verifyAttestation's
   `me` now also has `deal` and `ownAddress` and the `wrong-terms` code; the table is `trade_refusals`
   (not `trade_attestation_refusals`) and `trade_work_served` is unmentioned.
7. trade_work_served rows are never deleted (one per trade ever served). Harmless now; drop them
   when the attestation or refusal is recorded.
