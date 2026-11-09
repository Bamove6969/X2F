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
