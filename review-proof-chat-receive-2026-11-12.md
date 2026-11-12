# Review: wip/lead-proof-chat-receive (a547aa4f, from wip/lead-proof-store 6bbadbbf), the seller opening and showing proof.attached

Reviewer: independent adversarial privacy/security pass, 12 Nov 2026. Detached worktree at a547aa4f,
fresh `npm ci`, each test file run as `flock ~/x2f-comms/check.lock timeout 900 npx vitest ...`.
Not committed.

## Verdict

**Mergeable: no blocking finding.** Every attack in the brief failed:
- **A seller- or moderator-sent payment proof** is refused (`bad-message`), on the first read and on
  every re-read.
- **Evidence outside a dispute** is refused for good.
- **The key** never reaches the IndexedDB store.
- **Decrypted bytes** go only to ProofThumb.
- **A ciphertext for another trade, proof or kind** fails the AEAD binding, and a wrong picture fails
  the sha256 check.

"Mark paid without proof?" fails closed in this branch: it says `unavailable` unless the upload is
built, and in a few edge cases it can be wrong (M3, M4). The tripwire still covers ChatProof. No test
was weakened: the cap 65 -> 66 is exactly the one new pragma.

There are 5 minor and 6 info findings, plus one **merge hazard with wip/lead-proof-upload** (M4) that
the lead should settle when both land.

## What I tried

| Attack | Result |
|---|---|
| Seller- or mod-sent payment proof shown | Refused. `openChatMessage`: `kind 'proof' && from !== 'buyer'` is bad-message. `from` is the verified signer, cross-checked with the server's `senderRole`. `reopen` uses the same function, so a cold re-read refuses it too. Tests: chatProofReceive, chatEngine. |
| Evidence outside a dispute | Refused. `evidenceAllowed` is the API's `disputeOpen`, and the refusal is for good. `reopen` passes no `evidenceAllowed`, so a re-read refuses as well (fails closed, but see M1). Evidence from the mod is always refused. |
| Key persisted | No. The payload is kept only in the worker's in-memory `sessions` (`Shown`). `StoredChatReceipt` has id, from, seq, sig, at and flags only (chatEngine test: the key is not in the store). The page holds it in React state and in `payDetailsFeed.snapshots`, in memory only. No storage API touches snapshots. |
| Decrypted bytes to anything but ProofThumb | No. `ChatProof` passes `state.bytes` only to `<ProofThumb bytes declared>`. The tripwire's "a file that decrypts a proof" rule applies to ChatProof and passes. No Blob, URL, data:, img or FileReader. |
| Ciphertext of another proof, trade or kind | Refused. `decryptProof` AAD = domain + normalised code + proofId + kind, then the sha256 of the plaintext. A wrong trade code in the URL or the binding fails. Then ProofThumb's receive check (type, header, caps, strip, redraw) runs on top. Tests in chatProof.test.tsx. |
| "none" when a proof exists / "attached" when none does | Fails closed in this branch, because `proofUploadBuilt()` is false, so the answer is `unavailable`, never `none`. With the upload built there are edge cases: M3 and M4. |
| Tripwire guards ChatProof | Yes (ran green). It is a weak form of the guard (I3). |
| Weakened tests | None. The `not-a-refusal` greps go from 65 lines at base to 66 at head: CHAT_PROOF_GONE. No removed assertion other than the cap line. |

## Findings

### Minor

**M1. Evidence turns into a "missing" placeholder after any reload, even during the open dispute.**
`reopen` calls `openChatMessage` without `evidenceAllowed`, so it defaults to false. A cold read (a new
worker, which means any page reload) therefore cannot re-open evidence.
- I confirmed it with a probe test, since discarded. The steps: dispute open, seller evidence synced,
  then a fresh `engine()` on the same store. The result was `{ proof: false, missing: true }`.
- Scenario: the buyer reloads the trade room during the dispute. The seller's evidence shows as the
  gap placeholder for good. This is not a leak (it fails closed), but dispute evidence disappears for
  the counterparty.
- Fix: pass `evidenceAllowed: view.disputeOpen` into `reopen`, alongside `secured`. Add a reload test.

**M2. Evidence is refused for good when it races the dispute opening.**
`syncLocked` reads `getChat` (`disputeOpen`) before `listEnvelopes`.
- Scenario: the seller opens a dispute and posts evidence at once. The buyer's device fetched the view
  just before the dispute opened, then lists the envelope, and refuses it with a `refused` receipt.
  Later syncs never re-open it, so the evidence is lost on that device. The pay package solves the
  same problem by withholding instead.
- Fix: hold evidence that arrives while there is no dispute, the way `heldPay` is held, rather than
  refuse it for good. Or re-read the view after listing.
  **Owner question:** may evidence posted just before the dispute record exists be shown? I recommend
  holding it and showing it once a dispute is open.

**M3. "attached" means "a key line exists", not "a proof the seller can see".**
`proofStateOfSnapshot` counts any buyer `kind: 'proof'` line.
- Scenario: the buyer's proof is purged, never uploaded, or does not decrypt (another client's bug, or
  a malicious one). The seller sees "This proof is no longer stored" or the refusal. Meanwhile the
  buyer's "Mark paid without proof?" is skipped as `attached`, so the buyer marks paid with no usable
  proof and no warning.
- Fix: decide what `attached` should require.
  **Owner question:** should a proof the server no longer has, or one that is refused, count?
  I recommend counting it only once ChatProof's state is `ready`, or showing the buyer the same state
  on their own card.

**M4. Merge hazard with wip/lead-proof-upload (bde8310f): two proof sources, and a stale snapshot right after a send.**
1. The upload branch's `proofSlot.tsx` calls `setProofSource((code) => sent.has(code) ? 'attached' : 'unavailable')`
   after a send. That replaces this branch's `chatProofState` for every trade until reload, so every
   other trade reads `unavailable`.
2. Without that override, `chatProofState` reads `payDetailsFeed`'s last snapshot. A sent proof is not
   in it until the next 15 s feed poll, because `AddProof` never calls `publishPaySnapshot`. A buyer
   who taps Mark paid within 15 s of sending is asked "Mark paid without proof?" (`none`) while a proof
   exists.
3. There are two copies of the flag check (`proofUploadBuilt` here, `proofUploadOn` there).
4. Both branches raise the cantDoThat cap 65 -> 66 for different strings. Merged, the count is 67, so
   the merge needs 67 with both reasons, not "keep 66". The coordination.md edits also conflict.
- Fix on merge:
  - drop the upload branch's `sent`/`installSource`;
  - after `sendProof`, publish the returned snapshot through `publishPaySnapshot`;
  - keep a single flag function.
- Merge order matters too. Upload-branch builds refuse their own `proof.attached` lines for good
  (refused receipt). Any proof sent from such a build, flag on, never re-opens on that device after
  this lands, which reads `none`. Land this first or together.

**M5. ChatProof re-fetches, re-decrypts and re-checks on every chat poll, and reads an unbounded body first.**
- The `useEffect` depends on `proof`. Each `ChatSnapshot` comes through postMessage as a new object, so
  every 15 s poll (3 s while waiting) and every live push refetches the ciphertext. It also re-runs the
  decrypt and ProofThumb's decode and redraw, and flips the card back to "checking". That means server
  load, battery, and an access-log entry per poll.
- `res.arrayBuffer()` reads the whole response before `decryptProof`'s PROOF_MAX_CIPHERTEXT check.
- Scenario: a hostile or broken server answers with a multi-GB body, and the tab exhausts memory
  before the cap applies.
- Fix:
  - key the effect on `proof.proofId` + `proof.sha256`;
  - refuse `content-length > PROOF_MAX_CIPHERTEXT`, and read the stream with a running cap.

### Info

**I1. Evidence opened during a dispute stays on screen after it closes, for the rest of the session.**
The session's `shown` map keeps it until reload, after which it is refused. The rule "evidence only
while a dispute is open" is enforced at open time, not at show time.

**I2. The server is trusted for `disputeOpen`.**
A malicious API could flip it to make evidence open outside a dispute. The picture is still the
counterparty's own upload, sealed to this device, so the harm is limited. This is the same trust as
`modMayPost`.

**I3. The tripwire's decrypt rule is weak.**
It wants a decrypting file to name `ProofThumb` and to have no Blob, File, img or data:image. It does
not check that the bytes go only to ProofThumb: a `postMessage(bytes)` or `fetch(..., { body: bytes })`
in ChatProof would pass. Its header still says "Today nothing mounts ProofThumb".
- Option: in a file that calls `decryptProof`, also forbid `fetch(` with a body, `postMessage`,
  `sendBeacon` and `WebSocket`.

**I4. The proof key now crosses postMessage from worker to page, in every snapshot.**
The `serve.ts` header ("No key ... ever crosses postMessage") is out of date.
`payDetailsFeed.snapshots` keeps the last snapshot, keys included, for as long as a card listens. An
open panel's publishes without a feed listener are never deleted, so they last for the page's life.
- Option: give the page only `{ proofId, kind, mime, width, height, sha256 }`, and have the worker
  fetch and decrypt.

**I5. Decrypted plaintext stays in React state, not zeroed, until unmount and GC.**
This matches ProofThumb's own handling.

**I6. In a chat with no `tradeCode` (the pre-trade offer chat) a proof line renders nothing.**
It shows no placeholder, which is silent rather than a gap line.

## Tests run (worktree a547aa4f, fresh npm ci, `flock ~/x2f-comms/check.lock timeout 900 npx vitest run --project @x2f/web <file>`)

All 9 passed, 218 tests:
- chatProof.test.tsx 8/8
- chatProofReceive.test.ts 6/6
- chatEngine.test.ts 41/41
- proof-render-tripwire.test.ts 8/8
- cantDoThat-lint.test.ts 13/13
- chatPanel.test.tsx 31/31
- payDetailsFeed.test.tsx 6/6
- buyerPay.test.tsx 91/91
- proofThumb.test.tsx 14/14

Plus one probe (M1), which failed as expected and was then discarded with `git checkout`. Not run:
typecheck, Playwright, the API's proofs.test.ts (wip/lead-proof-store's).
