# Re-verify: proof-upload fixes on wip/lead-proof-upload (09da5c11 → 5a3f3aec, then 8c56ca41), 12 Nov 2026

**Checked against:** review-proof-upload-2026-11-12.md (M1–M6, I1, I6).

**Commits re-verified:**
- **First set:** bf33bae4 (red tests) and 5a3f3aec (fix).
- **Head moved during the review.** It is now **8c56ca41**. That adds:
  - 77056565, a merge of wip/lead-proof-store, which brings in 4ad39e0f (red) and 9280dcc8 (fix);
  - 50106d96 (red) and 8c56ca41 (fix).

  Together these refuse a proof while the escrow is securing: the API answers 409 and the slot stays
  disabled. I re-verified those too.

**How I ran it:** throwaway detached worktrees with `npm ci`. Every test, build and Playwright run
went under `flock ~/x2f-comms/check.lock`, with `X2F_CHROMIUM_PATH=/opt/pw-browsers/chromium`. I
committed nothing. A scratch e2e spec was deleted afterwards, and the worktrees were removed.

## Verdict

**APPROVE. Every item is fixed at its cause, and each fix has a test that was red before it.**

- **"Uncertain":** it cannot hide a real refusal.
- **Flag:** it is off in a real production `vite build` with the environment the repo ships. I
  checked this in the bundle and in Chromium, both ways round.
- **Zeroing:** it now covers every exit from the screen. One small gap is left inside
  `prepareProof` (Z1, below). It does not block the flag staying off; fix it before the flag goes on.

## Red before, green after

| Run | Result |
|---|---|
| Red tests at 5a3f3aec with `apps/web/src` from 09da5c11 | **15 failed**, 69 passed (proofUpload, blurEditor, chatEngine). Every new M1–M6 test fails: the five AddProof zeroing paths, the M2 uncertain screen and engine cases (×3), M5's "can't use" screen, M4 engine and worker (×2), the M3 single read and zeroed bytes (×2), the M1 decode canvas, and the M6 flag. |
| Green at 5a3f3aec | 21 files, 587 passed. The 1 failure was `receive.test.ts`'s render-cap test hitting the 5 s timeout under load; it passed 42/42 with `--testTimeout=60000` and does not touch this code. |
| Files in the green run | web: proofUpload, blurEditor, chatEngine, cantDoThat-lint, buyerPay, chatPanel, payDetailsFeed, proof-render-tripwire. packages/proof: all. api: proofUploadWire. |
| Type checks | `tsc --noEmit` for apps/web and apps/api: clean. |
| Green at 8c56ca41 | buyerPay, blurEditor, proofUpload, chatEngine, api proofs, api proofUploadWire: 6 files, 198 passed. tsc clean. |
| Red for the new commits | The buyerPay "waits for securing" test fails with 77056565's proofSlot/BuyerPay. The API "no payment proof while the escrow is still securing" test fails with 4ad39e0f's routes.ts. |
| Tests changed by the fix commits | 5a3f3aec changes no test after bf33bae4. 8c56ca41 adds only the new `secured` prop to two existing ProofSlotLive renders. 9280dcc8 moves `securing` out of proofs.test's accept loop into its own refusal test, which is stricter, not weaker. |

## Item by item

- **M1 (zeroing). Fixed at the cause; see Z1.**
  - **AddProof:**
    - It holds the prepared proof in a ref and zeroes it on Choose another and after a send.
    - On unmount it zeroes the proof, unless a send is still in flight; in that case it zeroes when
      the send settles, whether it succeeded or failed.
    - A decode that finishes after unmount is zeroed as it arrives.
    - The OCR word list is emptied (the strings themselves cannot be zeroed, as the code says).
  - **`prepareProof`:** reads the file once and zeroes those bytes in a `finally`, so a refusal or a
    decode throw zeroes them too.
  - **`browserImage.decode`:** clears the canvas and shrinks it to 0x0 in a `finally`.
  - **Breakpoint remount:** a resize that remounts the slot zeroes the old proof (tested). Losing the
    buyer's edits on a remount is accepted and documented.
- **M2 (uncertain). Fixed.** A proof post that got no answer, or a 5xx, is `uncertain` in the engine,
  the worker, the client and the screen (PROOF_SEND_UNCERTAIN, COPY-UNSIGNED placeholder). A post the
  API answered counts as sent even if the read after it fails. The owner question on wording is still
  open.
- **M3 (one read). Fixed.** One `file.arrayBuffer()`. The decode and `photoTakenAt` both get
  `new Blob([bytes], { type: readInputHeader(bytes).mime })`, so they use the checked bytes and the
  sniffed type (tested: file read once, declared type ignored).
- **M4 (not before secured). Fixed.**
  - The engine's `sendProof` posts with `secured: true`, so it answers `not-ready` before securing,
    for evidence too (the lead's call). Nothing is sealed, posted or spent from the sequence (tested).
  - The worker answers `chat-send-proof` with not-ready.
  - Since 8c56ca41, the API refuses `PUT …?kind=proof` while securing (409 wrong-state), and with the
    flag on, BuyerPay keeps the slot disabled while securing (PROOF_AFTER_SECURED).
  - The review's optional suggestion was not taken up: gating the worker message itself on the build
    flag. The secured gate makes that unnecessary for privacy.
- **M5 (too large even as JPEG). Fixed.** A `ProofInputError` from the send now shows PROOF_CANT_USE,
  not the "check your connection" line. The fix took the review's second option (no step-down
  encode), which is acceptable.
- **M6 (flag test). Fixed.** `proofUploadOn()` is now written as the literal
  `import.meta.env.VITE_X2F_PROOF_UPLOAD === '1'`. The test drives it with `vi.stubEnv` over
  undefined, '', '0', 'true', ' 1', '01', and so on.
  - The old cast form failed this test even with '1' set. So under Vitest the old flag could never
    have read as on.
- **I1 (seller proofs). Tripwire present.**
  - The chatEngine test "NEEDS_PROOF_RECEIVE tripwire" seals a `kind: 'proof'` from the seller and
    asserts that the receiver gets a refused receipt, shows nothing, and leaks none of the proof id,
    key or hash.
  - It passes today because every `proof.attached` is refused on receipt. It will catch a receive
    half that opens seller proofs.
  - The API still cannot enforce the rule (by design).
- **I6 (key over postMessage). Fixed.** The serve.ts header now says the proof key crosses
  postMessage in clear on the same-origin channel and cannot be zeroed.

## Can "uncertain" suppress a real refusal? No

In `engine.post`, `uncertain` is reachable only from the `catch` around `d.api.postEnvelope`, and
only for a proof. Everything else is decided first:

- **Before the post:** `not-ready` (no chat, or not secured), seal and validation errors (`bad-proof`,
  `bad-text`, `bad-details`).
- **Inside that catch, before `uncertain`:**
  - `stale-seq` → retry;
  - `too-large` or 413 → `too-large`;
  - 429 → `slow-down`;
  - any other 4xx → `refused`, including the 409/410/403 refusals; a 410 still purges the chat
    through `purging`.

Only an error with no status, or a status of 500 or above, becomes `uncertain`.

On screen, `uncertain` is a warning ("may have been sent, check the chat"). It keeps the editor
editable and never counts the proof as sent: no `onSent`, no attached state. The worst a lying API
can do with 5xx answers is make the buyer re-check the chat, which is the safe direction.

**Residual (info, U1).** If the post succeeded and the read after it throws a purge (the chat was
erased just then), the error propagates and the screen says "Couldn't send". That would be wrong in
that narrow case, but the chat is gone by then. Not worth a change.

## Does the zeroing cover every exit? Yes for the screen; one gap inside `prepareProof`

**Checked and covered:**
- send succeeds;
- send fails, which deliberately keeps the proof for the retry;
- unmount while editing;
- unmount mid-send, which zeroes when the send settles;
- late decode;
- Choose another;
- breakpoint remount;
- the header refusal, the photo-time throw and the decode throw, which zero the bytes;
- the decode canvas.

**Z1 (minor, before the flag goes on).** `prepareProof` leaves the decoded RGBA unzeroed when it
throws *after* the decode:
- the dimension or length check `throw new ProofInputError('undecodable')`;
- any throw from `amountBoxes`, `detectSensitive`, `padAndMerge` or `codeBoxes`.

The buffer is then unreachable, but it is not zeroed. Today the decoder is the browser's own, so the
dimension check should not fire, and the detectors are pure. Fix: wrap everything after the decode in
`try { … } catch (e) { rgba.fill(0); throw e; }`. When Task 13's OCR lands, also make sure
`deps.ocr` makes no copy of the pixels it keeps.

**Z2 (info).** BlurEditor's preview `<canvas>` is not wiped when the editor unmounts. It holds the
picture with the current regions burned in, which is what would be sent. That is the unblurred
picture wherever the buyer removed every region. It goes to GC with the detached element.
Optional: clear it in an effect cleanup, as browserImage now does.

## Is the flag off in a real production build? Yes

**In the bundle.** I ran `vite build` for apps/web (production mode) twice, from the same tree and a
shell with no `VITE_*` variables. There is no `.env*` file in the repo or in apps/web, and
`vite.config.ts` only merges `loadEnv(…'VITE_')` with `process.env`. The two output bundles differ
only in that one function:

| Build | `proofUploadOn` compiles to | Notes |
|---|---|---|
| Default | `function d1(){return!1}` | constant false |
| `VITE_X2F_PROOF_UPLOAD=1` | `function d1(){return!0}` | constant true |

The string `VITE_X2F_PROOF_UPLOAD` appears in neither bundle.

**In Chromium.** A scratch Playwright spec (deleted after) opened BuyerPay on a secured trade from a
real fixtures-mode `vite build` served by the API's `serveWeb`:

| Build | Live upload (`[data-part="add-proof"]`) | Board's disabled `input#proof` |
|---|---|---|
| Default environment | 0 (absent) | 1 (present) |
| `VITE_X2F_PROOF_UPLOAD=1` | 1 (present) | 0 (absent) |

Both runs passed.

**Still true (review I5).** The flag follows whatever environment builds the app, so the demo
script's passed-through `process.env` could still turn it on.

## Open items

- **Owner:** the wording after an uncertain send (PROOF_SEND_UNCERTAIN, ChatPanel's `uncertain`
  line) and PROOF_AFTER_SECURED. Both are COPY-UNSIGNED placeholders.
- **Before the flag goes on:** Z1. Z2 and U1 are optional.
- **Unchanged and still open** (as in the review): I2–I5, I7 and I8.
