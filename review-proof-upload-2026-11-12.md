# Review: wip/lead-proof-upload (bde8310f, base 6ebed537), the buyer's payment-proof upload

Reviewer: independent adversarial privacy/security pass, 12 Nov 2026. Detached worktree at bde8310f,
fresh `npm ci`, tests one file at a time under `flock ~/x2f-comms/check.lock`. Not committed.

## Verdict

**Mergeable behind the flag: no blocking finding.** I could not get unblurred pixels, the original
bytes, Exif/GPS/XMP/ICC or any other metadata, the filename, or the decryption key in clear off the
device through any path in this branch. Every send goes through `finishProof` (redact on a copy, fresh
canvas encode, `cleanImage` + `assertClean`, no fallback). The preview is the same `redact` on the same
regions. The header check runs before any decode. Only the buyer can seal a `kind: 'proof'`. The flag
is off in every build in the repo, the demo included, unless the operator's shell exports it. The
cantDoThat cap 65 -> 66 is used by exactly one new pragma (PROOF_CANT_USE); no other test was weakened.

There are 6 minor and 8 info findings, listed below. M1 (pixels and file bytes are not zeroed on unmount)
and M2 (an ambiguous failure tells the buyer "Couldn't send" when the proof may already be with the seller)
are the ones to fix before the flag goes on.

## What I tried (and what held)

| Attack | Result |
|---|---|
| Unblurred pixels in the PUT body / envelope | Held. `sendProof` -> `finishProof` always redacts a copy of `prepared.rgba` with the regions passed in; encoder sees only the redacted copy (test checks `encoded`). Body is XChaCha ciphertext. |
| Original bytes | Held. Decode goes through canvas `getImageData`; nothing from `file.arrayBuffer()` reaches encode/put/post. |
| Exif, GPS, XMP, ICC, text chunks, incl. JPEG fallback | Held. Canvas output only; `cleanImage` allowlist (PNG: IHDR/PLTE/IDAT/IEND; JPEG: SOI/DQT/DHT/SOF0-2/DRI/SOS/EOI, every APPn and COM dropped, so the JFIF APP0, any APP2 ICC and APP14 go) then `assertClean`. Only `photoTakenAt` (a UTC minute) leaves, which owner G16 allows. |
| Filename / declared type / lastModified | Held. Never read (`grep .name/.type/lastModified` in proof/ and screens/proof/: none). PUT is octet-stream with no Content-Disposition. |
| Key in clear | Held for "off the device". The key goes page -> worker as base64 over postMessage (same origin), then is sealed to buyer/seller/mod. It is never in the PUT, the URL, a log or the snapshot. The buyer's own sync records a refused receipt, so the key is not stored in clear. |
| Send without blur burned in: Choose another, retry, errors, edit/send races | Held. Choose another is disabled while busy. Send is disabled while busy or drawing. The region buttons are disabled while busy. A retry re-runs `finishProof` on the kept, unzeroed `prepared` with the editor's current regions. The popup's Send uses the current render's regions. The editor keeps its state across the error re-render because it stays at the same child position. |
| Preview equals what is sent | Held for PNG (byte-identical pixels). The JPEG fallback is lossy (I2). |
| Decode bombs | Held for size: 20 MiB file cap, then `readInputHeader` (40 MP, one frame, no APNG/animated WebP, no trailing bytes, VP8X canvas = image), all before `photoTakenAt` and `createImageBitmap`. CPU-only bombs are not covered (I4). |
| Seller posts a payment proof via sendProof | Held in this client. `sealProofAttached` refuses `kind: 'proof'` unless `role === 'buyer'`, and the role comes from the engine's record, not the page. A modified client is not stopped here (I1). |
| Bypass the worker re-check | Held. `serve.ts` parses with `parseProofPayload`, which wants exact keys, a plain object and a fresh copy. The engine parses again, and so does `sealProofEnvelope`. Extra fields such as a filename are refused. The check covers shape and role only. It cannot know whether the ciphertext was blurred (I3). |
| Flag off by default | Held. `proofUploadOn()` is true only for `VITE_X2F_PROOF_UPLOAD === '1'`. There is no `.env*` file in the repo. `tools/demo/demo.ts` on wip/lead-demo does not set the flag, but it passes `...process.env` through (I5). |
| Weakened tests | None. Base had 66 `not-a-refusal` greps in apps/web/src and head has 67: the one new one is PROOF_CANT_USE, so the counted total goes 65 -> 66 and the cap is exactly used. The other test edits only add `sendProof` to mocks. |

## Findings

### Minor

**M1. Unredacted pixels and the picked file's bytes are not zeroed on unmount or on paths other than send/Choose another.**
`AddProof.drop` runs only after a successful send and on Choose another (and Redo, which calls it).
It does not run when AddProof unmounts during `edit`, for example when the trade moves on, the buyer
leaves the trade room, or the layout flips between wide and narrow (the two `<ProofSlot>` sites are
different tree positions, so a resize across the breakpoint remounts it). It also does not run when
`prepare` resolves after an unmount.
- Scenario: the buyer opens the editor on a banking screenshot and then taps the chat or another trade.
  The unredacted 2600 px RGBA buffer stays reachable until GC, and the step state is gone, so nothing
  can zero it later.
- Also left: the `Uint8Array(await file.arrayBuffer())` that `prepareProof` builds for the header check
  (the original file, Exif included) is never zeroed. The OffscreenCanvas from `decode` keeps the
  unredacted pixels until GC. On a resize, the remount also drops the buyer's edits.
- Not a leak off the device. But the code comment and coordination.md say "Once sent or dropped, the
  decoded pixels are zeroed", which reads as stronger than it is.
- Fix:
  - a `useEffect` cleanup in AddProof that zeroes the current `prepared` when not busy;
  - zero `prepared` in `pick` when the component is gone;
  - `bytes.fill(0)` after `readInputHeader`;
  - hold the step above the layout switch, or accept the loss on remount.

**M2. An ambiguous failure says the proof was not sent when the seller may already have it.**
`post()` maps any `postEnvelope` error to `refused`, including a network drop after the API stored the
envelope. AddProof then shows PROOF_SEND_FAILED ("Couldn't send your proof. Check your connection and
try again."), with the editor and regions still editable.
- Scenario: the buyer sends, and the connection drops on the response. The buyer reads "Couldn't send"
  and notices their full name was not blurred. They add a blur and send again. They believe the first,
  less-blurred proof never went, but the seller and the mod have both proofs and both keys.
- Also, every retry uploads a new ciphertext under a new proofId. After a failure between the PUT and
  the post, the old ciphertext stays on the server with no key (I7).
- Fix: an engine-level check of whether the seq was stored (sync, then look for the own seq), or
  failure copy that does not claim it was not sent. Copy is the owner's.
  **Owner question:** the wording after an uncertain send.

**M3. Decode reads the File again instead of the bytes that were checked (TOCTOU, and type sniffing).**
`prepareProof` checks `file.arrayBuffer()`, then `photoTakenAt(file)` and `createImageBitmap(file)`
each read the File again.
- A File backed by a disk file (Android pickers, desktop) can change between the reads. Chromium
  usually throws NotReadableError, but not every engine guarantees it.
- The decoder also gets the File's own declared type, not the sniffed one.
- Scenario: a sync client rewrites the picked file between the header read and the decode. A 40 MP
  checked PNG becomes a 30000x30000 one, and the header cap is bypassed.
- Fix: decode `new Blob([checkedBytes], { type: header.mime })`, and read the photo time from the same
  bytes.

**M4. The worker accepts `chat-send-proof`, and the engine seals before the trade is secured, whatever the flag says.**
`serveChat` and `engine.sendProof` are live in every build, and `post(..., secured = false)` does not
apply the `tradeSecuredAt` gate that `sendPay` has.
- No privacy leak, because the payload is only a key and facts.
- Scenario: any page code, or a later caller, can put `proof.attached` lines into a chat while the flag
  is off or before the escrow is secured. Receivers (NEEDS_PROOF_RECEIVE) record them as refused
  receipts and leave the replay guard where it was.
- Fix: refuse `chat-send-proof` with `not-ready` until secured (pass `true`, as sendPay does). Also
  consider gating the worker message on the same build flag.
  **Owner question:** may evidence (`kind: 'evidence'`) go before securing? Recommendation: no.

**M5. Over-cap after the JPEG fallback shows a "connection" error and every retry fails the same way.**
`finishProof` throws `ProofInputError('too-large')` when the JPEG 0.85 is still over 4 MiB minus 40.
AddProof maps every send error to PROOF_SEND_FAILED ("Check your connection and try again").
- Scenario: a 2600x2600 noisy camera photo at JPEG 0.85 goes over 4 MiB (rare, but possible with
  sensor noise). The buyer retries forever.
- Fix: shrink or lower quality in steps, as `reencode.ts` does, or show PROOF_CANT_USE for
  ProofInputError.

**M6. No test reads `proofUploadOn()` itself.**
The "flag off (the default)" test passes `enabled={false}` by hand, so a change to `proofUploadOn`, for
example `!== '0'`, would ship the upload on with no test failing.
- Fix: a unit test with `vi.stubEnv('VITE_X2F_PROOF_UPLOAD', undefined / '0' / 'true' / '1')`.
- Optional: a bundle test that a default build's chunk has `VITE_X2F_PROOF_UPLOAD` resolved to
  undefined.

### Info

**I1. The seller-proof rule is enforced only by the honest sender.**
The API sees only `from`, because `type` is inside `ct`. A modified seller client can seal
`proof.attached kind: 'proof'` from `seller`, and the server stores it.
- Scenario: a scamming seller posts a fake "buyer's payment proof" into the chat.
- Needed (NEEDS_PROOF_RECEIVE): ProofThumb / the receive half must refuse `kind: 'proof'` unless
  `from === 'buyer'`, and show nothing. Recommend a tripwire test now, so the receive half cannot land
  without it.

**I2. The JPEG fallback preview is not byte-identical to what is sent.**
The preview is the redacted copy before JPEG. What is sent is the same pixels after JPEG 0.85. The
redacted areas cannot be restored, because the encoder input is already redacted, so this is only
compression fidelity. Worth one line in the copy only if the owner wants it.

**I3. The worker re-check covers shape and role only.**
It cannot tell whether the ciphertext behind the key was blurred: the page is trusted for redaction. A
compromised page (XSS, extension) could PUT anything. This is inherent; the CSP is the defence.

**I4. Decode bombs are bounded by pixel count, not CPU.**
- A progressive JPEG with thousands of tiny scans, or a 40 MP image (160 MB RGBA plus the canvas), can
  stall or crash a low-end phone tab.
- MPO and Ultra-HDR JPEGs (gain map after EOI) and HEIC are refused as unusable. That is a usability
  cost for camera photos, not for screenshots.
- Option: cap the number of SOS segments in `readInputHeader`.

**I5. The flag follows the build's environment.**
`vite.config.ts` and Vite read VITE_* from `process.env` and from `apps/web/.env*` (untracked, so not
visible from here). `tools/demo/demo.ts` passes `...process.env`. On the PC, a shell or `.env.local`
with `VITE_X2F_PROOF_UPLOAD=1` turns the upload on in the demo. Turned on, the PUT hits a missing
route (404), and nothing is posted.

**I6. The proof key crosses postMessage in clear, page -> worker.**
The serve.ts header still says "No key ... ever crosses postMessage". That is true for chat keys but
not for this proof key now. Update the comment. The `proofKeyToBase64` string cannot be zeroed (a
known residual).

**I7. The server sees more than the image.**
- Ciphertexts are orphaned on the server after a failed post, on Choose another after a failed send,
  or on not-ready. Task 14's retention should sweep proofs that no `proof.attached` references.
- Ciphertext length, plus `width`/`height` (inside the seal), give screen-size fingerprints, for
  example 1179x2556 for one iPhone model. This is inherent to the screenshot.

**I8. Small behaviours that touch the blur.**
- Tapping a region removes it at once, with no undo, and on touch devices an accidental tap is easy.
  The burned preview makes this visible.
- Add blur needs a pointer drag, so there is no keyboard way to blur (accessibility).
- The item 64 explanation is dropped (TODO p11-141), but the buyer may believe it was sent.
- `uploadPrompts` re-runs on every render: `manual` and `expected` are new each render.

## Tests run (worktree at bde8310f, fresh npm ci, under flock ~/x2f-comms/check.lock)

All 9 passed, 263 tests in all:
- apps/web/test/proofUpload.test.ts: 12/12
- apps/web/test/blurEditor.test.tsx: 12/12
- apps/web/test/chatEngine.test.ts: 42/42
- apps/web/test/cantDoThat-lint.test.ts: 13/13 (the `not-a-refusal` count passes at the new cap of 66; the grep diff, base 66 -> head 67 lines, shows exactly one new pragma)
- apps/web/test/buyerPay.test.tsx: 91/91
- apps/web/test/chatPanel.test.tsx: 31/31
- apps/web/test/payDetailsFeed.test.tsx: 6/6
- packages/proof/test/inputHeader.test.ts: 4/4
- packages/proof/test/receive.test.ts: 42/42

Not run: proof-render-tripwire.test.ts, a typecheck, and Playwright. The real browser path
(`browserImage.ts`: createImageBitmap, OffscreenCanvas, convertToBlob) has no automated test. Its
safety rests on code reading plus `cleanImage`/`assertClean` on the output.

Worktree and its node_modules removed after the run.
