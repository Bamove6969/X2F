# Re-verify: wip/lead-proof-chat-receive at fdc5d83d (against review-proof-chat-receive-2026-11-12.md, a547aa4f)

Reviewer: independent re-verify, 12 Nov 2026. Detached worktree at fdc5d83d, fresh `npm ci`, each test
file run as `flock ~/x2f-comms/check.lock timeout 900 ...`. Not committed.

The lead's calls applied: **M2**, evidence that arrives outside a dispute is held, not refused.
**M3**, "attached" counts only after the proof was checked. The branch now merges
wip/lead-proof-upload at its tip, ce6057b7.

## Verdict

**All of M1-M5 and I3-I5 are fixed or addressed. No regression through the upload merge. Two new
minor points (R1, R2) and two info points (R3, R4), none blocking.**

The merge is clean. Against the upload tip, ce6057b7 is fully included, and the only changes to upload
files are the M4 edits:
- `AddProof.postProofToChat` publishes the send's snapshot;
- `proofSlot.tsx` drops `sent`/`installSource`;
- the blurEditor wiring test is updated to match.

Every privacy property from both reviews still holds:
- the blur is burned in before any upload;
- the encoder's output is cleaned;
- the header check runs before the decode;
- the key is sealed;
- only the buyer can send a payment proof;
- seller and mod payment proofs are refused on receipt;
- the decrypted bytes go only to ProofThumb;
- the AEAD binding to trade, proof id and kind holds.

## Item by item

| Item | Status | Evidence |
|---|---|---|
| M1: evidence lost after a reload | Fixed | `reopen(..., disputeOpen)` passes `evidenceAllowed: disputeOpen`. Test "review M1 ... shown again after a reload (a new worker), not as a gap" (my probe's exact case). After the dispute closes, a reload re-opens nothing (`disputeOpen` false): fails closed. |
| M2: evidence racing the dispute (lead: hold) | Fixed as decided | A second open with `evidenceAllowed: true` sets `heldEvidence` when there is no open dispute. `withheld` hides it until a session has it. `cold` re-reads once `disputeOpen` and a held receipt is unshown. The kind rules stay in the same `openChatMessage`, so the second open still refuses a seller or mod `kind: 'proof'` and mod evidence: there is no laundering through the hold path. A new tripwire test checks the seller's payment proof is refused with a `refused` receipt and nothing shown. A held receipt stores no key (tested). |
| M3: "attached" (lead: after check) | Fixed as decided, with R1 and R2 | `proofStateOfSnapshot` is `attached` only if a buyer `kind: 'proof'` line's id has `checked === 'ready'`. That is set by ProofThumb's `onChecked(true)` via ChatProof. A proof that is unchecked, gone, refused or fails to decrypt gives `unavailable`. `none` only when there is no buyer payment-proof line at all. |
| M4: merge hazard | Fixed | No `setProofSource` outside App.tsx (`git grep`). One flag function, `proofUploadOn`, used by both BuyerPay and `chatProofState`. The cap is 66 -> 67 with both reasons; the `not-a-refusal` greps are 67 at fdc5d83d. `sendProof` goes through `post(..., { secured: true })`, which also closes upload-review M4. `postProofToChat` publishes the returned snapshot. |
| M5: refetch per poll, unbounded body | Fixed | The effect is keyed on `[tradeCode, proofId, sha256]`; key and kind come from a ref. `readCapped`: a `content-length` over PROOF_MAX_CIPHERTEXT is refused unread, and a streamed body is cancelled the moment it passes the cap. |
| I3: tripwire weak | Improved, still partial (R3) | A decrypting file may not mention `postMessage`, `sendBeacon`, `WebSocket`, `EventSource` or `body:`. The header comment is updated. |
| I4: key crosses postMessage | Documented | The `serve.ts` header now says proof keys cross both ways (same origin, not stored, strings not zeroable). The `payDetailsFeed.snapshots` comment says it holds keys until the last listener goes. Accepted residual. |
| I5: plaintext not zeroed | Fixed (R4) | `plain` ref: zeroed after ProofThumb's verdict, on cleanup, and when a fetch resolves after unmount. `key.fill(0)` after decrypt. |

Tests weakened? No.
- The removed assertions are the old "evidence refused for good" test, replaced per the lead's M2 call
  with held/shown/reload tests, and the old `'attached'` cases, replaced per M3.
- The API proofs.test.ts change is the stricter "no payment proof while securing" rule (wip/lead-proof-store
  9280dcc8): `securing` moved from the 204 list to a new 409 test.
- The blurEditor wiring test now asserts that the slot does not override the chat's proof source.

## New points

**R1 (minor). A proof this page just sent reads `unavailable`, not `attached`, unless the chat panel is open.**
The `chatProof.ts` doc says "or this page sent it (`checked`)". But nothing in the send path calls
`noteProofChecked`: `git grep` finds only ChatProof's two calls.
- Scenario: the buyer sends a proof from the pay card with the chat panel closed, then taps Mark paid.
  The state is `unavailable`, so "Mark paid without proof?" is not asked. That is the right outcome,
  but for the wrong reason, and an `attached`-dependent UI (a "Proof sent" mark on the paid card,
  later) would never show it.
- Fix: `noteProofChecked(proofId, true)` after `sendProof` resolves. The bytes are the device's own
  cleaned copy. Or correct the doc.

**R2 (minor). A proof that was stored but whose read-back failed publishes the snapshot from *before* the send.**
`post(..., { proof: true })` returns `s.snap` (the pre-post sync) when the sync after a stored post
throws. `postProofToChat` publishes it as the newest snapshot.
- Scenario: the buyer's first proof goes through, but the read-back times out. The published snapshot
  has no buyer proof line, so the state is `none` (flag on) until the next 15 s feed poll. Mark paid in
  that window asks "Mark paid without proof?" while the proof is with the seller.
- Fix: don't publish when the snapshot doesn't contain the new proof id. Or have AddProof
  `noteProofChecked` the id (R1) and have `proofStateOfSnapshot` answer `attached` for a sent id even
  before its line arrives.

**R3 (info). The I3 regex is still easy to step round.**
- `\bbody\s*:` misses the shorthand `{ method: 'POST', body }`.
- `XMLHttpRequest#send(bytes)` and writes to `localStorage`/`indexedDB` are not caught.
- The rule only applies to the file that calls `decryptProof`, so a helper in another file receiving
  the bytes is not checked.
- Fine for now, since ChatProof itself is clean. A stronger guard would be a lint that ChatProof's
  decrypted value flows only into `<ProofThumb bytes>`.

**R4 (info). The zeroed plaintext stays referenced as ProofThumb's `bytes` prop.**
If ProofThumb's effect ever re-runs while ChatProof stays mounted (a `deps` prop that changes per
render, or a key added around it), it would check zeroed bytes. That gives a refusal plus
`noteProofChecked(false)`, so it fails closed, but a good proof would flip to refused. Nothing does
this today: `deps` is undefined in the app. Also, `checks` is keyed by proofId only, not trade + id.
A buyer reusing one proof id across two trades only affects their own prompt (info).

## Tests run (worktree fdc5d83d, fresh npm ci, `flock ~/x2f-comms/check.lock timeout 900 npx vitest run --project <p> <file>`)

RESULTS_PLACEHOLDER

Worktree and its node_modules removed after the run.
