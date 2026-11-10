# Review: wip/lead-proof-receive @ 50c9ff3d (security), 2026-11-09

Reviewer: independent helper, read-only on code. Base origin/main 0c6f3f16, one commit.
Files: packages/proof/src/receive.ts, apps/web/src/proof/receive.ts, apps/web/src/screens/proof/ProofThumb.tsx (+ tests).

**Verdict: APPROVE, nothing blocking.** The parser is sound against the attacks asked about. Four low or medium follow-ups and one owner question are below. ProofThumb is not used anywhere yet (only its CSS references it), so the "original bytes never reach an <img>" guarantee holds for this component, and Task 15's wiring must keep it (see F4).

Tests run (serialised runner, 2 of my 3 runs):
- `npx vitest run --project @x2f/proof packages/proof/test/receive.test.ts`: 25/25 passed.
- `npx vitest run --project @x2f/web apps/web/test/proofThumb.test.tsx`: 10/10 passed.

## What I checked, and how it held up

**Integer overflow, negative lengths, lying chunk lengths.**
- Every u32 is read with `>>> 0`, so no value is negative. JS numbers do not wrap at 2^32, so `at + 8 + len` cannot overflow.
- PNG: `at + 12 > b.length` is checked before the length is read. Then `len > b.length - at - 12` rejects any length that runs past the end. The CRC is checked over type + data for every chunk, so a lying length that still lands in bounds also fails (unless the attacker also forges the CRC, which only gives a well-formed file).
- JPEG: a segment length below 2 is refused, and so is `at + 2 + len > b.length`.
- WebP: `size > b.length - data`, and `next > b.length` after padding.
- VP8: the first-partition size is checked against the chunk. VP8L: the version bits are checked.
- No loop can stall: every iteration moves `at` forward by at least 2 (JPEG fill bytes) or 12 (PNG).

**Polyglot rule (bytes after the end marker).**
- PNG: `IEND` must have length 0 and `at === b.length`.
- JPEG: `EOI` must sit at `b.length - 2`, after at least one scan. The entropy-coded walk stops at the first 0xFF that is not 0x00 or RST0-7.
- WebP: the RIFF size must equal `length - 8`. Odd-sized chunks are stepped over with their pad byte (`size & 1`, line 232), and the total length must be even.
  - **RIFF padding is handled.** The test fixtures pad odd chunks (`webpChunk`), and the valid `vp8l(4,4)` chunk is 5 bytes, so the pad path runs in the passing tests. `webpGrown` (a RIFF size that covers appended script bytes) is refused because the tail does not parse as a chunk.
  - Nit: the pad byte's value is not checked to be 0. That is a 1-byte covert channel with no effect, because the bytes are redrawn.
- Polyglot bytes inside ancillary chunks (PNG tEXt, JPEG COM or APPn, WebP EXIF or XMP) pass the walker on purpose. They never reach the screen, because only the redrawn PNG is shown. This is the right design.

**The original bytes never reach an <img> or a URL.**
- `receiveProof` hands `bytes.slice()` only to `deps.decode`, which is `createImageBitmap(new Blob(...))`. No object URL is made.
- The only `src` is `data:image/png;base64,` of `cleanImage(out)`, where `out` is the canvas's fresh PNG. It is re-walked by `readImageHeader` (same size) and reduced to IHDR/PLTE/IDAT/IEND.
- No path falls back to the received bytes.

**No decode exception can leak out of the component.**
- `showableProof` is async, so even a synchronous throw from `browserReceiveDeps()` (no OffscreenCanvas, for example) becomes a rejection.
- `ProofThumb` uses `.then(ok, fail)` and maps every rejection to `refused`.
- `bitmap.close?.()` sits in a `finally` with its own try/catch. If decode resolves `null`, that line throws a TypeError, but the catch swallows it and the earlier `undecodable` wins.
- Error messages carry the code only, never bytes.

**CSP.** `img-src 'self' data:` is in `apps/api/src/static/serve.ts` `cspFor` and is pinned by `apps/api/test/headers.test.ts`. A data: URL is allowed, and no CSP change is needed.

**WebP refused upstream.** Confirmed. `packages/proof/src/payloads.ts` has `ProofMime = 'image/png' | 'image/jpeg'`, and `parseProofPayload` refuses any other mime (`MIMES`). So no `proof.attached` envelope can declare WebP, and the receiver's WebP walker is unreachable in production. The owner question stands (Q1 below).

**Size checks.**
- The envelope's width and height are required, and `isSide` enforces 1..2600, so the "header size must match the declared size" check always runs in production.
- `ReceiveDeclared.width` and `height` are optional in the type, though, so a future caller that leaves them out would skip the check silently. See F3.
- The 2600-px cap is checked as soon as each header names a size, before any decode. Worst-case decode is 27 MB RGBA.

## Findings

- **F1 (medium, functional and availability): the data: URL has no size bound.**
  - A 2600x2600 PNG redrawn from a noisy photo can be roughly 15-27 MB, which is roughly 20-36 MB as base64.
  - Firefox caps data: URLs at 32 MB (my understanding; I did not test it in a browser). The `<img>` has no `onError`, so a too-big copy shows a broken image instead of the refusal notice.
  - Real proofs (bank-app screenshots) compress well, so this is an edge case, not a security hole.
  - Options (lead or owner choice):
    - (a) add `onError` → `refused`. This is pure engineering; I recommend it.
    - (b) cap `out.length`, for example at RECEIVE_MAX_BYTES, and refuse past it as `render-failed`.
    - (c) show it via `URL.createObjectURL` of the fresh PNG. This needs `img-src blob:`, which is a CSP change and needs owner or lead sign-off.
- **F2 (low): `imageOrientation: 'none'`.**
  - Newer spec text renamed this option to `from-image` / `flipY`, and some engines treat `'none'` as deprecated (I have not verified each browser).
  - If an engine applies Exif orientation anyway, a rotated JPEG decodes with swapped sides and is refused as `undecodable`. That fails closed. The sender strips Exif, so it is harmless today. Worth a comment, or a browser test when Playwright is allowed.
- **F3 (low): make `ReceiveDeclared.width` and `height` required**, matching `proof.attached`, so the size match cannot be skipped by a careless caller.
- **F4 (note for Task 15's wiring): ProofThumb is not mounted anywhere.**
  - When ChatPanel or the paid card wire it in, the decrypted bytes must go only through `ProofThumb` / `showableProof`, never into a `Blob` URL or a download link.
  - `useEffect` depends on `deps`, so callers must pass a stable `deps` (or none), or the check re-runs on every render.
- **F5 (copy, COPY-UNSIGNED): the refusal body says "not a PNG, JPEG or WebP picture".** WebP cannot arrive (see above), and `too-large` also shows "damaged". This is for design or owner once Q1 is settled.

## Owner question

- **Q1: WebP.** The receiver accepts WebP, but the envelope parser (and so the sender) allows only PNG and JPEG.
  - Option A: keep it PNG/JPEG end to end. Remove the WebP branch from `receiveProof`'s allowlist (less parser surface) and drop "WebP" from the copy.
  - Option B: allow WebP uploads. This needs `ProofMime`, the sender's cleaner and the envelope changed together.
  - Recommendation: **A**. The sender re-encodes every proof anyway, so WebP buys nothing and adds roughly 60 lines of parser that only fuzz tests exercise.

## Re-verify f8c9fa78 (security, read-only), 2026-11-10

Branch `wip/lead-proof-wiring` at f8c9fa78: 130089c5 (F2), 880dc385 (F4), f8c9fa78 (F5), on main d421706c.

**Verdict: PASS, no blocker.** F2, F4 and F5 are fixed as described. Findings: 0 high, 1 medium, 1 low, 3 info, and 1 owner question (Q2). The medium is in the tripwire test, not in the receive path.

### What I ran

All runs went through the serialised runner, from the proof-wiring worktree.
- `packages/proof/test/receive.test.ts` and `clean.test.ts`: 2 files, 53/53 passed.
- `apps/web/test/proofThumb.test.tsx` and `proof-render-tripwire.test.ts`: 2 files, 20/20 passed.
- `tsc --noEmit` for `packages/proof` and for `apps/web`: both exit 0.
- **Tripwire plant run.** I planted each pattern in a temp file under `apps/web/src` (one also under `apps/staff-web/src`), ran the tripwire, then removed the file. `git status` was clean afterwards. 30 runs:
  - Baseline: passes.
  - **Every forbidden pattern turns it red.** Each of these failed exactly one `it`: `<img>` (web and staff-web), `<picture>`, `<object>`, `<embed>`, `<iframe>`, `srcSet`, `createObjectURL`, `revokeObjectURL`, `readAsDataURL`, `readAsBinaryString`, `download=`, `download:`, `data:image/`, `showableProof` outside the receive path, `receiveProof` outside it, and `decryptProof` without `ProofThumb`.
  - The 12 bypass probes all passed, so none was caught (F-R1).
- **Fuzz probe** (tsx scratch script; the repo is unchanged):
  - **WebP:** 20,000 random 1-4 byte mutations, plus every truncation, of an extended WebP carrying ICCP, 2x ALPH, VP8L, EXIF, XMP, an unknown `EVIL` chunk and an odd-sized chunk. 4,092 reached the decoder and 16,035 were refused.
  - **PNG and JPEG:** 20,000 single-byte mutations.
  - **Results:** 0 throws other than ProofReceiveError. In every WebP that reached the decoder: the RIFF size equals length - 8, the only chunks are VP8X/ALPH/VP8/VP8L, the VP8X flags have no bit set but alpha, there is exactly one image chunk, and the buffer is a fresh one. The whole WebP run took about 0.3 s.

### Checked, held

1. **The WebP cutter** (`packages/proof/src/receive.ts:325-353`).
   - It runs only after `webpHeader` has accepted the file (`:232-268`): RIFF size equal to length - 8, an even length, one image chunk, VP8X only at offset 12 with size 10, and the canvas equal to the image.
   - **Bounds are re-checked:** `:331` (header), `:333` (size), `:335` (`next`, padding included). `at` grows by at least 8 bytes each pass, so it cannot loop or read past the buffer.
   - **Allowlist:** only VP8X, `VP8 `, VP8L and ALPH are kept (`:336-341`). Unknown, EXIF, XMP and ICCP chunks are dropped.
   - **VP8X flags** are masked to 0x10 on a copy (`:337-338`), never on the caller's buffer.
   - **The RIFF size is recomputed** (`:346`).
   - **The copy is re-read** (`:428-429`). It must be the same mime, width and height, or it is `undecodable`.
2. **Animation is refused before any cut:**
   - WebP: ANIM/ANMF (`:253`) and the VP8X animation flag (`:256`).
   - APNG: acTL, fcTL and fdAT (`:144`).
   - Test: `receive.test.ts:453-458`.
3. **Exif orientation can no longer rotate the picture.**
   - JPEG: every APPn and COM segment is dropped (`clean.ts:206,214`).
   - PNG: eXIf, like every ancillary chunk, is dropped (`clean.ts:111-112`).
   - WebP: EXIF is dropped, and so is the Exif flag.
   - `createImageBitmap` is now called without options (`apps/web/src/proof/receive.ts:13`), so it uses `from-image`. No tag is left to apply.
   - The decoded size must still equal the header's (`receive.ts:439`).
   - Tests: `receive.test.ts` "only the picture reaches the decoder" (JPEG orientation 6, PNG/JPEG metadata, WebP), and `proofThumb.test.tsx` `browserReceiveDeps` (checks that options are undefined and that the Blob holds no eXIf/tEXt).
   - Width and height cannot change: the cut keeps the SOF/IHDR/VP8X+image chunks byte for byte, and `:429` re-checks the size.
4. **Reusing cleanImage on untrusted input.**
   - `cleanImage` is wrapped in a try/catch that turns any throw into `undecodable` (`receive.ts:365-371`). `webpPictureOnly` and `readImageHeader` throw only ProofReceiveError.
   - A JPEG the header walk accepts but `cleanImage` refuses is `undecodable`, and `decode` is never called. My probe confirmed this for SOF3 (lossless), SOF9 (arithmetic) and DAC.
   - The fuzz run gave 0 throws of any other kind.
   - `showableProof` is async, and `ProofThumb` maps every rejection to `refused` (`ProofThumb.tsx:28-32`). It sets `shown` only when the promise resolves, so a partial image is never shown.
5. **Strings.** The only new user-visible string is `PROOF_REFUSED_BODY` (`ProofThumb.tsx:16`), and it carries COPY-UNSIGNED. Every other added line is a comment, a test, or an error code.

### Findings

- **F-R1 (medium, test guard): the tripwire has easy bypasses.**
  - None of these is in either app today; I grepped both. Each passed the tripwire unnoticed when planted:
    - `document.createElement('img')`
    - React `createElement('img', ...)`
    - `new Image()`
    - `el.innerHTML = '<im' + 'g ...>'`
    - `dangerouslySetInnerHTML`
    - SVG `<image href>`
    - a style `backgroundImage: url(...)`
    - `<video poster>`
    - `<input type="image">`
    - `"data:" + "image/..."` (a split string)
    - a `.js` file (only `.ts` and `.tsx` are scanned)
    - JSX text holding `//`. The comment stripper (`proof-render-tripwire.test.ts:38`) deletes the rest of the line, so `<p>a //b <img src=x /></p>` hides the `<img>`.
  - Fix (pure engineering, mine to recommend):
    - Add patterns for `createElement\(\s*['"](img|image|picture|object|embed|iframe|video|source|input)`, `new Image\(`, `innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML|document\.write|DOMParser|createContextualFragment`, `<(image|video|audio|source)[\s/>]`, `poster=`, `type="image"`, `backgroundImage|url\(` (in TS/TSX), and `['"\`]data:`.
    - Scan `.js`, `.jsx` and `.mjs` as well.
    - Run the patterns on the source with only `/* */` and whole-line `//` comments removed, or strip comments with the TS scanner, so JSX text is not cut.
- **F-R2 (low): stripping before decode can change pixel values from what a standard viewer shows for the same attested bytes.**
  - These chunks are dropped before the decoder sees the file:
    - PNG: `tRNS`, `gAMA`, `cHRM`, `sRGB`, `iCCP` (`clean.ts:25`). My probe: a palette PNG with tRNS reaches the decoder without it, so its transparent pixels turn opaque.
    - JPEG: `APP14` (the Adobe colour transform).
    - WebP: `ICCP`.
  - **Honest proofs are not affected.** The sender's app redraws from a canvas: PNG comes out as RGBA (colour type 6, no tRNS) and JPEG has no APP14.
  - **A hostile sender** could hand-craft a file whose in-app look (the same for the receiver and for staff, since both go through one path) differs from how it looks in other viewers.
  - This changes what users see, so it is Q2, not an engineering fix.
- **F-R3 (info): the cutter passes some WebP odds through unchanged.**
  - It keeps VP8X reserved bytes 1-3 as they came. My probe kept `aa bb cc`; the spec says they MUST be 0, and readers ignore them.
  - It keeps every ALPH chunk: duplicates, ALPH beside a VP8L chunk (where it is meaningless), and ALPH after the image chunk. libwebp uses the first ALPH before the VP8 chunk and ignores the rest, so the picture does not change.
  - Optional hardening, pure engineering: zero the reserved bytes, and keep at most one ALPH, only before a `VP8 ` chunk (or refuse otherwise).
- **F-R4 (info): Q1 is still open.** WebP cannot arrive (the envelope allows PNG and JPEG only), yet this change adds about 40 lines of WebP cutting on top of the WebP header walk. Recommendation A from Q1 stands: removing WebP would delete both.
- **F-R5 (info): test gaps.** My probe passed in every case below, but no repo test covers it:
  - A JPEG that the header walk accepts and `cleanImage` refuses (SOF3/SOF9/DAC, CMYK `nf=4`) is `undecodable` before decode.
  - A fuzz or malformed-chunk test of `webpPictureOnly`.
  - An explicit check that the RIFF size equals length - 8. Today it is checked only through `readImageHeader(given)`.
  - Adding these is pure engineering.

### Owner question

- **Q2: should colour and transparency chunks be refused rather than stripped?**
  - Today a received PNG with `tRNS` (or gAMA/cHRM/sRGB/iCCP), a JPEG with Adobe APP14, or a WebP with ICCP has those chunks removed silently, so it is shown with possibly different pixels.
  - Option A: refuse such a file as `unsupported`. It fails closed, and an honest sender never produces one.
  - Option B: keep stripping (the current state).
  - Recommendation: **A, for `tRNS` and APP14 at least**, since they change which pixels show and not only their tint. gAMA/cHRM/sRGB/iCCP only shift colours, so stripping them is acceptable.
