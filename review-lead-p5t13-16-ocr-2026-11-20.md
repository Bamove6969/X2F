# Review: wip/lead-p5t13-16-ocr at 6c7b8d9b (against origin/main 54104057)

Independent security review of Plan 5 Task 13 (the rest of the OCR pipeline) and Task 16 (SmartProofCard on SellerConfirm, ModCase "look for" line). Reviewer worktree `.claude/worktrees/rev-p5t13`, 20 Nov 2026, about 08:40 to 10:05 BC time.

## Verdict

**APPROVED WITH FOLLOW-UPS.** There are no blockers, and the full `npm run check` passed at the branch head. M-1 should be fixed before or soon after landing: it is a one-line CSP change, and the builder's own stated goal ("cannot reach the API with the trader's cookies") is not fully met without it. The m findings are hygiene items.

| # | Sev | Finding |
|---|-----|---------|
| M-1 | M | The worker CSP's `script-src 'self'` still lets an `/ocr/` worker send cookie-bearing GETs anywhere on the origin (`importScripts`, nested `Worker`). Demonstrated in Chromium. |
| m-1 | m | The page CSP takes `;` `,` `'` `*` from X2F_RELAY_ORIGIN / X2F_NODE_PROXY_ORIGIN (pre-existing; builder flagged it). |
| m-2 | m | The `/ocr/` path narrowing assumes nothing in front of the server normalises `%2F` or `..`. |
| m-3 | m | The e2e worker probe tests only `fetch`. It should also cover XHR, WebSocket, EventSource, `importScripts` and nested Worker. |
| m-4 | m | X2F_ORIGINS is checked two ways: config.ts accepts what `ocrWorkerCspFor` refuses. |

## What I checked, and what holds

1. **OCR input: redrawn pixels only, and never for a refused proof. Holds.**
   - `showableProof` (`apps/web/src/proof/receive.ts:89-98`) runs `receiveProof` first. Only after that succeeds does it pass `out.png`, the PNG this device re-encoded from its own canvas (`receive.ts:51-58`, `packages/proof/src/receive.ts:470-509`), to `readWords`.
   - `browserReadWords` (`receive.ts:10-32`) decodes that PNG to RGBA on an OffscreenCanvas, checks the size, OCRs it and zeroes the pixels.
   - A refusal throws before `onWords` is reached. ChatProof (`ChatProof.tsx:136`) and ProofThumb (`ProofThumb.tsx:63`) send `null` on refusal, and ProofThumb guards `live`.
   - Reverts R1 and R2 below show the tests catch both regressions.
2. **Trust in OCR output: words feed checkProof only, and are never HTML. Holds.**
   - `SmartProofCard.tsx:80` passes the words to `checkProof` only.
   - `proofCardLines` (`packages/proof/src/check.ts:319-353`) builds its text from this device's own `total` and `code`, the buyer display name, and, for a mismatch, `formatMinor(seen)` where `seen` is a `bigint`. No raw OCR text reaches the DOM, and everything renders as React text nodes.
   - From the buyer, the card uses only `hidden` and `photoTakenAt`, as check.ts already allowed.
3. **Release safety. Holds.**
   - SellerConfirm receives the card as an opaque `proofSlot` node (`SellerConfirm.tsx:282`). The box (`:80`, `:294-301`) and the release button (`:310`) do not depend on it.
   - The card has no callback into the screen. `noteProofChecked` feeds only the buyer-side `proofStateOf` (PaidFlowSheet).
   - Revert R7 (start the box ticked when a slot is present) is caught by `smartProofCard.test.tsx:307`.
4. **Proof tripwire. Holds.** Its 3 new rules (`proof-render-tripwire.test.ts:972-1003`) pin:
   - receive.ts and ocr.ts imports (`@x2f/proof` only, one dynamic import each);
   - no network, storage, Blob URL or `postMessage` in either file;
   - the `onWords` type;
   - `readWords` named only in receive.ts.

   `DECRYPT_ALLOWED` is still only ChatProof. sellerProof.ts and SmartProofCard.tsx never name `decryptProof`, and revert R5 shows that adding one trips the tripwire. The rules are textual, so a deliberate rename defeats them. They are tripwires, not proofs, which is acceptable.
5. **Worker CSP.**
   - `connect-src` is `<site>/ocr/` for each origin (`apps/api/src/static/serve.ts:139-149`).
   - Chromium path-matches every `connect-src` API from the worker. The probe saw these all blocked with `connect-src` violations:
     - `fetch('/v1/…')`
     - XHR
     - `EventSource('/v1/…')`
     - WebSocket to `/v1/ws` and to `/ocr/ws`. A ws: URL against an http source with a path is refused in Chromium, which is stricter than needed and fine.
   - `importScripts` and nested Worker are governed by `script-src`, not `connect-src`. See M-1.
   - **Encodings and redirects:**
     - Browsers normalise `..`, `%2e%2e`, `.%2E` and `\` before the CSP check. The probe's `/ocr/%2e%2e/v1/…` was blocked.
     - `%2F` is not normalised, so `/ocr/..%2Fv1%2Faccount%2Fme` passes the CSP and reaches the server. But Fastify/find-my-way does not resolve dot segments or `%2F`. A raw-socket probe of these paths against serveWeb plus a `/v1/me` route found that every one returned index.html, and none reached the route:
       - `/ocr/../v1/me`
       - `/ocr/%2e%2e/v1/me`
       - `/ocr/..%2Fv1%2Fme`
       - `/ocr/%252e%252e/…`
       - `/ocr/..;/v1/me`
       - `/ocr/..%5Cv1…`
       - `/ocr//v1/me`

       (Note: `app.inject` does normalise `..`, so inject-based tests would mislead here.)
   - Nothing under `/ocr/` redirects. Tested with `/ocr`, `/ocr/`, `/ocr/sub`, `/ocr/sub/` and `/ocr/worker.min.js/`: no `Location` header in any response. `@fastify/static` uses `redirect: false`, and the catch-all serves the page or a 404.
   - No API route is registered under `/ocr` (grep of apps/api/src).
   - **X2F_ORIGINS parsing** (`serve.ts:163`, `:141-147`):
     - Entries are split on `,` and trimmed, then go through `origin()`, which requires an exact origin with `url.origin === value`.
     - The host-character regex at `serve.ts:146` then refuses `;`, space, `'`, `*`, uppercase and paths (headers.test covers `;`, `'unsafe-inline'`, `/` and `/ocr`).
     - An empty entry from a trailing comma throws.
     - IDN hosts arrive as `xn--` and pass.

     I found no injection.
6. **Engine and model integrity. Holds, and fails closed.**
   - I re-ran `npm pack` for tesseract.js@7.0.0, tesseract.js-core@7.0.0, @tesseract.js-data/eng@1.0.0 and @tesseract.js-data/rus@1.0.0 and hashed the six served files. All six match `tools/ocr-assets.sha256` byte for byte.
   - `copyOcrAssets` checks every source before writing and throws on a mismatch. `verifyOcrAssets` then refuses a missing file, a changed file or an extra file. The function runs on every vite `buildStart` (`apps/web/vite.config.ts:14-15`), so a mismatch fails the build.
   - There is no runtime check of the files. That is the same as every other static asset, and acceptable.
7. **ModCase: staff-web gets no proof bytes. Holds.** `ProofLookFor` (`apps/staff-web/src/ui/ProofCard.tsx`, `ModCase.tsx:440`) renders only `c.escrow.fiatCents`, the currency and `c.code`, all already on the case. It makes no new fetch, has no key and adds no `wasm-unsafe-eval`.
8. **Decision 16. Holds.** There is no diff under `packages/` (no proof or chat envelope change) and no change to how proofs reach staff-web. `NEEDS_P5_PROOF_ENVELOPE` is still in place.

## Findings

### M-1: the worker's `script-src 'self'` still reaches the API with cookies (blind GET)

- **Where:** `apps/api/src/static/serve.ts:149`.
- **Problem:** The fix narrowed `connect-src` but left `script-src 'self'`. Inside an `/ocr/` worker, under the served CSP, the reviewer probe (Chromium 1243, a temporary spec, not committed) found:
  - `importScripts('/v1/account/me?via=importScripts')` sent a credentialed GET. It then threw a NetworkError on the response, because a JSON response fails the script MIME check.
  - `new Worker('/v1/x?via=nested')` was constructed and its GET was sent.
- **Impact:** Responses are not readable, so this is not exfiltration. But a worker taken over through the OCR engine can still fire same-origin, cookie-bearing GETs at any path. A GET with a side effect, today or later, would be reachable, and the doc comment's claim (`serve.ts:132-136`, plan-5-review.md Task 16) is stronger than what holds.
- **Fix (pure engineering, no behaviour change):** emit `script-src <site>/ocr/ 'wasm-unsafe-eval'` per site origin, or keep `'self'` and add `worker-src 'none'`. Path-scoped `script-src` is the stronger choice. tesseract's worker only `importScripts` the core from `/ocr/` (`corePath: '/ocr/'`). The worker's own script is checked against the page's `worker-src 'self'`, not this policy.
- **Tests:** Add `importScripts` and nested-Worker cases to the proof-ocr probe, and update the expected strings in headers.test and proof-ocr.spec.

### m-1: page CSP injection via the relay and node proxy origins (pre-existing)

- **Where:** `serve.ts:86-104` and `:107-124`.
- **Problem:** `origin()` only requires `new URL(v).origin === v`, and WHATWG URL keeps `;` `,` `'` and `*` in a host. Node 24 confirms that `wss://r.test;report-uri`, `https://a.test;sandbox`, `https://a.test,b` and `https://a.test'x` all round-trip. Form feed and whitespace are refused.
- **Impact:** The value cannot carry a space, so it can only add value-less directives (`;sandbox` breaks the app) or, with `,`, split the header into two policies. Browsers enforce both policies, and a repeated directive is ignored after its first occurrence, so the policy cannot be weakened. The result is a broken or odd CSP from an operator typo, not a bypass.
- **Fix:** Move the host-character regex from `ocrWorkerCspFor` (`:146`) into `origin()`, allowing the ws/wss schemes. Then every connect origin and site origin goes through one check, and the extra check at `:146` can go. Optionally assert in `cspFor` that the result splits into exactly 11 directives with no `,`.
- **Tests:** Add `;`, `,` and `'` cases for both env vars to headers.test.

### m-2: the `/ocr/` narrowing depends on the front proxy not normalising

- **Problem:** The browser leaves `/ocr/..%2Fv1%2Fx` alone, and the CSP allows it. serveWeb does not resolve it (shown above), but a reverse proxy that decodes and normalises would turn it into `/v1/x` before the API sees it. An example is nginx `proxy_pass http://up/;` with a URI part, or `merge_slashes` together with decoding.
- **Fix:** The repo ships no proxy config. Add a line to the deployment notes, next to the existing one on the X2F_ORIGINS requirement, saying that `/ocr/` must be passed with the raw request URI and that encoded slashes must not be decoded. M-1's fix narrows the blast radius as well.

### m-3: the e2e worker probe covers `fetch` only

- **Where:** `apps/web/e2e/proof-ocr.spec.ts:160-203`.
- **Fix:** Extend the probe to XHR, WebSocket, EventSource, `importScripts` and nested Worker, as in this review's temporary probe. With M-1 fixed, all five should be blocked. Today the probe would pass even if `script-src` were `*`.

### m-4: two checks of X2F_ORIGINS

- **Problem:** `apps/api/src/config.ts:113-127` accepts `https://a.test;x` and remote `http://` origins, while `ocrWorkerCspFor` refuses both, but only when the web app is served. This fails closed (startup error), so it is not a hole, just an operator surprise.
- **Fix:** Reuse one exact-origin helper (see m-1) in config.ts.

## Not findings (noted)

- A buyer can post many proofs, and each new newest proof starts an OCR run on the seller's device. Each run is capped at 30 s and at 2600 px a side, and the source dedupes by proof id and sha (`sellerProof.ts:28-35`). This is acceptable.
- Two site origins let a worker on origin A fetch origin B's `/ocr/`. The worker's fetches are cross-origin there and get no cookies, so this is harmless.

## Guard reverts (each restored afterwards; the worktree was clean before the full check)

| # | Revert | Caught by |
|---|--------|-----------|
| R1 | OCR the raw decrypted `bytes` instead of `out.png` (`receive.ts:95`) | smartProofCard.test "the board example" (1 failed / 83) |
| R2 | Read words before `receiveProof`, so a refused proof gets OCR'd | smartProofCard.test: board example, "reads the redrawn copy after the check", "a refused proof is never read", "not a word list" (4 failed) |
| R3 | Drop the site-origin host regex (`serve.ts:146`) | headers.test "refuses no site origin, a path, …" (1 failed / 89) |
| R4 | Worker `connect-src` back to `'self'` | headers.test: 5 failed |
| R5 | `decryptProof` re-exported from sellerProof.ts | proof-render-tripwire "a file that decrypts a proof hands the bytes to ProofThumb…" (1 failed / 68) |
| R6 | receive.ts POSTs the words with `fetch` | proof-render-tripwire "receive.ts loads only the OCR module, and sends nothing out" (1 failed / 68) |
| R7 | SellerConfirm starts with the box ticked when a proof slot is present | smartProofCard.test "an all-good card leaves the hold locked…" (1 failed / 15) |

## Tests run

**Targeted vitest at 6c7b8d9b**, with `nice -n 10` and outside the lock as the 18 Nov rule allows:
- `@x2f/web`: proof-render-tripwire, smartProofCard and release. 3 files, 140 passed.
- `@x2f/staff-web`: moderator.test. 23 passed.
- `@x2f/api`: headers.test. 89 passed.

**Playwright under `~/x2f-comms/check.lock`**, run with `X2F_CHROMIUM_PATH=/opt/pw-browsers/chromium` against the production build served by serveWeb: 18 passed, 0 failed (1.4 min):
- proof-ocr: 8
- proof-card: 4
- proof-pipeline: 4
- proof: 1
- the reviewer's temporary probe: 1, deleted afterwards

**Full `npm run check` under the lock** at 6c7b8d9b, 08:55 to 09:59 BC: exit 0.
- typecheck, copy-lint and separation-check: ok.
- vitest: 448 files, 8454 tests passed.
- semgrep: 113 rules, 0 findings.
- `npm audit --omit=dev`: 0 vulnerabilities.
