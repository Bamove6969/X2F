# Review: wip/lead-proof-stack (integration and security), 12 Nov 2026

Reviewed `origin/wip/lead-proof-stack` at 73fb96a4 against main 8246e64b. Then 5b42f262 (a change to a test fixture only) on top of that. The stack merges six branches: proof-store, proof-upload, proof-ocr, proof-chat-receive, proof-check and proof-code. Each branch's head is an ancestor of the stack: store 1e2599dd, upload ce6057b7, ocr 622e0751, chat-receive a547aa4f, check 0de4e081, code b3d64bf1. This review covers only what the integration adds. Each branch's own findings stay with its own review.

Method: I read every `--cc` resolution in the twelve merge commits, the seams commit 084dd79f and the tripwire commits f5615b8f, 030f90ae and 40190024. I recounted the cantDoThat pragmas on my own. I inspected a real production bundle. I ran the suites in a detached worktree after a fresh `npm ci`, each run under `flock ~/x2f-comms/check.lock`, with the timeout inside the flock.

## Verdict

**Mergeable. No blocking findings.** Neither side of any merge lost a security check. The three seams are wired the way the commit messages say. The tripwire exception is narrow in intent, but its test leaves one gap (S-M1). `isStoredProof` can only report whether a proof exists. The cap of 68 is correct. The flag is off in production. Every suite passed.

## Test runs (detached worktree, fresh npm ci, under the shared lock)

| Run | Tree | Result |
|---|---|---|
| `vitest run --project @x2f/api` (full) | 73fb96a4 | 112 files, **2628 passed**, 1 todo, 0 failed |
| `vitest run --project @x2f/web` (full) | 73fb96a4 | 140 files, **2147 passed**, 0 failed |
| `npm run build -w @x2f/web` (production, `VITE_X2F_PROOF_UPLOAD` unset) | 73fb96a4 | built; bundle inspected (item 5) |
| `playwright test proof-ocr` (pinned Chromium `/opt/pw-browsers/chromium`) | 73fb96a4 | **6/6 passed** (the lead's commit message says 5/5; the spec has 6 tests at this head, the Cyrillic one included) |
| `vitest run --project @x2f/proof` (full, receive.test included) | 5b42f262 | 14 files, **373 passed**, 0 failed |

## 1. Merge resolutions

- **`post()` options (engine.ts, merge 04c02708).** The resolved `post(chat, make, { secured, proof })` contains both sides' versions. The `secured` gate (`tradeSecuredAt === null` gives 'not-ready' before sealing, so no seq is spent) is the code's original check, unchanged. The proof side's 'uncertain' handling for no answer or a 5xx, and its "count a post the API answered as sent" logic, apply only when `proof` is true. Lines and packages behave exactly as on main: 'refused' on any other error, and a re-sync afterwards. The stale-seq retry, 413 'too-large' and 429 'slow-down' are kept for both.
- **`sendNotice` uses `{ secured: true }`.** This matches proof-code's old positional `true`. `sendPay` moved to `{ secured: true }` as well, and `sendProof` uses `{ secured: true, proof: true }`. No sender lost its secured gate.
- **The proof envelope path (chatCrypto.ts, serve.ts, client.ts).**
  - On the sending side, `sealProofAttached` re-parses the payload and refuses a payment proof from anyone but the buyer.
  - The worker's `chat-send-proof` branch runs `parseProofPayload` before the engine sees anything. The `chat-send-notice` branch refuses an unknown notice. Both are in the worker's allow-list of message types.
  - On reading, `openChatMessage` takes `proof.attached` before the chat-message branch. It accepts a payment proof only from the buyer, and evidence only from a trader while `evidenceAllowed` (`view.disputeOpen`) is set. Notices still require a trader, a known id and the exact wording. Packages still require `payAllowed`.
  - `shownOf`, the ChatLine mapping and ChatPanel all check proof, then notice, then pay. A line can match only one of them, so precedence cannot be used to smuggle anything.
- **The other conflicted files.** `errors.ts` declares `too-many-proofs` once. `RETENTION_JOBS` keeps both `purgeProofsJob` and `purgeBlurChecks`. `chatProof.ts` and `proofSlot.tsx`: the upload's old local `setProofSource` (which said 'unavailable' for a trade not marked as sent) was replaced by chat-receive's `chatProofState` plus `markProofSent`. That is correct. The upload screen still overrides only towards 'attached', and `proofUploadOn()` now replaces `proofUploadBuilt()` (the same flag, read in a way Vite can replace).
- **Cross-branch binding.** The proof AAD normalises the trade code (`seal.ts` `aad`), so the uploader's `a.code` and the receiver's `tradeCode` cannot disagree by format. `proofUploadWire.test.ts` proves the round trip from upload through the API to decrypt.

## 2. The seams

- **onPosted → proofPosted.** `tradeProofDeps().onPosted` POSTs only `{ blur }` to `/v1/trades/:code/proofs/:proofId/blur-check`. It runs after the PUT and after the chat post, so the stored row exists when the API checks for it. A failure is swallowed in `sendProof`.
  - The API now refuses with 404 any id that this side did not store for this trade as `proof` or `evidence` (`isStoredProof`, under the trade row lock). This closes proof-check's PC2: the uploader is no longer self-declared, and the site count and asks follow real proofs.
  - BLUR_CHECK_MAX_PROOFS (20) equals (5 proofs + 5 evidence) × 2 sides, so after this change the cap is a backstop only.
- **proofCodeNotice → sendNotice.** `sendCodeNotice` sends `proof-code-hidden` only when `proofCodeNotice(ownHidden)` returns it, after the proof is sent. A failed notice never fails the proof. The engine gates the notice on secured, and the slot is live only when secured. proof-code's N2 still applies (S-I2).
- **markProofSent and chatProofState.** These live in memory only. The code is normalised. They can only move the state towards 'attached', which hides "Mark paid without proof?" until a reload. They never produce 'none' on a guess. Without the flag, `chatProofState` never says 'none', so the prompt is not offered (as before).

## 3. The tripwire exception (staff.test.ts) and the blurCheck.ts comments

- `isStoredProof` runs `select 1 from trade_proofs where id=$1 and trade_code=$2 and uploader_role=$3 and kind in ('proof','evidence')` and returns `rows.length > 0`. It returns a boolean only. It reads no ciphertext and never reports an `unblurred` row. The side comes from the session (`sideOf`), so it is no oracle on the other side's proofs, and proof ids carry 128 random bits. **Confirmed: existence only.**
- The exception is justified. The alternative was the inline SQL that f5615b8f removed, which put `trade_proofs` in a file outside proofs/. Routing the check through the store is the better design.
- The rewording in 40190024 ("trade_proofs" became "isStoredProof", "ciphertext" became "image bytes") is accurate, and the comments still describe the code truthfully. It exists only because the test bans the words in the source text. See S-I1.
- **S-M1 (minor): the exception is narrower in its comment than in its test.** For `proof/blurCheck.ts` the test requires the line `import { isStoredProof } from '../proofs/store.js';` to be present, and bans `trade_proofs|proof_id_tags|readableProof|ciphertext`. It does not ban `proofs/store` for this file. So a second `import { insertProof, countProofs, claimProofId } from '../proofs/store.js'` would pass, as would `import * as s from '../proofs/store.js'` or a dynamic `import()`. `insertProof` is a write, which defeats the point. Fix (pure test engineering): also assert that `proofs/store` appears exactly once in the file, e.g. `expect(c.match(/proofs\/store/g)).toHaveLength(1)`, and that the file has no `import(`.

## 4. The cantDoThat cap of 68

I recounted with `tools/copy-lint.ts` `countPragmas` over `apps/web/src`, with the test's own exclusions (`cantDoCodes.ts`, `CantDoThat.tsx`). Main 8246e64b has **66** and the stack has **68**. The two new pragmas are exactly the ones the comment names:
- `proof/upload.ts` PROOF_CANT_USE, an input check on the chosen image;
- `screens/proof/ChatProof.tsx` CHAT_PROOF_GONE, a note about retention.

Neither is an X2F rule the user ran into. The cap sits exactly at the count, so it is a tight ratchet. Without the exclusions the total is 69, because `CantDoThat.tsx` has one; the test excludes it on purpose.

## 5. The flag is off in a production build

- No `.env*` file is tracked, and the vite config only reads `VITE_*` from the environment.
- In the bundle built with the variable unset (`dist/assets/index-*.js`), `proofUploadOn` compiles to `function w1(){return!1}`. Its two call sites are `enabled:w1()` on the BuyerPay slot and `F1(hv(e),w1())` in `chatProofState`. The variable name is not in the bundle.
- **Off.** S-I3 has a note on what still ships in the bundle.

## Findings

**Blocking:** none.

**Minor**
- **S-M1.** The tripwire's blurCheck.ts exception does not limit which names the file can import from `proofs/store`. Details and the one-line fix are in section 3.
- **S-M2 (lead or owner).** The quote screen now shows BLUR_CHECK_LINE ("For the first weeks we ask after every proof whether our privacy tool hid the right details. It takes one tap.") in all four role lists. The flag does not gate it. Two problems:
  - The line is COPY-UNSIGNED (page 11, not answered).
  - It promises an ask that the app cannot show yet: NEEDS_BLUR_CHECK_SCREEN, BlurCheck is not mounted.

  The neighbouring proof lines already ship ungated on main, so it is consistent. But once the flag goes on, asks will pile up with no screen to answer them. Recommendation: mount BlurCheck before the flag goes on, and get the owner's wording before landing, or keep the line out until both happen.
- **S-M3 (lead).** The two blur-check POST routes were classified as LIVE_SESSION_EXEMPT in the seams commit. Their reasoning matches the proof PUT next to them (R42, no new obligation), and I agree with it. Still, it is a security classification made inside a merge, and no branch review covered it. A quick explicit sign-off would settle it. Also, in `hold.ts` the new entries sit between the `// Plan 5 Task 14.` comment and the PUT that comment refers to. Move them below the PUT.

**Info**
- **S-I1.** The tripwire matches comment text, so the word "ciphertext" in a comment fails it. The rewording in 40190024 is honest. But this rule will keep forcing comment edits unless the check strips comments first.
- **S-I2.** proof-code's N2 is still open now that Task 15 has landed: the code notice names no proof (`proofId`), and one goes out per proof sent. Worth doing before the flag goes on.
- **S-I3.** With the flag off, the upload, blur editor and OCR wiring are still in the production bundle as dead code behind `w1()` (for example, "Add blur" and the `blur-check` path are present). The lazy OCR chunk and `/ocr/` assets ship as well. This is not reachable from the UI, but it is not stripped out.
- **S-I4.** The 409 `too-many-proofs` now means two things: the PUT cap and the blur-check cap. The web side swallows blur-check failures, so nothing confuses them today.
- **S-I5.** 5b42f262's subject says "a bit-by-bit CRC in the fixtures", but the change replaces the bit-by-bit CRC with a table-driven one. The diff itself is correct. I checked the new `crc32` against the old one and against `node:zlib` `crc32` on 2000 random buffers: 0 mismatches. The check value for "123456789" is `cbf43926`. So the fixture bytes are unchanged.
