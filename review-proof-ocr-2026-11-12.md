# Review: on-device proof OCR (Plan 5 Task 13), 2026-11-12

Branch `origin/wip/lead-proof-ocr` at `aa0993e1` (green), red `ceef74e8`, base `bde8310f`.
Scope: security, privacy and supply chain. Independent reviewer, detached worktree at aa0993e1, fresh `npm ci`.

## Verdict

**Land, with the minor items below fixed or accepted by the lead or the owner.** I found nothing blocking. Off-origin fetches are blocked in three independent ways: explicit `/ocr/` paths, the patched defaults, and two CSPs. The served bytes match the published npm tarballs exactly, and the OCR fails closed. The main gaps are process ones: a red test was edited in the green commit without saying so, and two plan deliverables are missing (the resolved tree in the commit message and the recall number in `docs/security/plan-5-review.md`). There is also the expected recall gap for names with no label.

## What I verified (and how)

1. **The manifest really comes from the published tarballs.** I fetched `tesseract.js-7.0.0.tgz`, `tesseract.js-core-7.0.0.tgz` and `@tesseract.js-data/eng-1.0.0.tgz` straight from registry.npmjs.org. Their sha512 values equal the lockfile `integrity` values. I unpacked them and ran sha256 on the five served files. All five match `tools/ocr-assets.sha256` byte for byte. The `dist/ocr/*` of my own production build has the same five hashes.
2. **The build fails on a mismatch.** `copyOcrAssets` checks every source against the manifest before it writes anything. It then verifies the whole output folder: missing, extra or different files all fail. It runs in vite `buildStart`, and a rejected hook fails the build. `tools/test/copy-ocr-assets.test.ts` covers a tampered source, a tampered output, a missing file and an extra file, and passes.
3. **No off-origin fetch at runtime.** I read tesseract.js 7.0.0's source:
   - The jsdelivr defaults are used only when `workerPath`, `corePath` or `langPath` is falsy. That is `getCore.js` (`corePath || cdn`) and `worker-script/index.js` (`langPath || cdn`).
   - When a fetch or `importScripts` fails, the worker rejects. It never retries on the CDN.
   - `ocr.ts` always passes `/ocr/` for all three paths, and `resolvePaths` turns them into same-origin absolute URLs.
   - In my build, the main-thread defaults are patched out: `jsdelivr` and `unpkg` appear nowhere under `assets/`, `index.html` or `sw.js`.
   - The only CDN strings left are inside `dist/ocr/worker.min.js`, and the explicit paths make them unreachable (see I-1).
   - `cacheMethod: 'none'` means no IndexedDB read or write (`['write','refresh',undefined].includes('none')` is false).
   - `sw.js` has no fetch handler, so nothing sits between the worker and the network.
4. **Worker CSP.** `/ocr/*` responses carry `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'`.
   - It cannot be widened: it is a constant, set in `setHeaders` only when `resolve(path)` starts with `<root>/ocr/`. No later hook rewrites CSP.
   - It does not leak to other paths. The prefix check ends in a separator, so `assets/ocr-*.js` is unaffected (tested).
   - Defence in depth: suppose a browser ignored the worker's response CSP and let the worker inherit the page CSP instead. The page CSP's `connect-src` names only `'self'`, the relay and the node proxy, and its `worker-src 'self'` forbids `blob:` workers. So the CDN stays blocked either way.
5. **`gz` as a file extension.** This changes only the catch-all, not what gets served. `@fastify/static` runs with `wildcard: false`, so it serves only the files present in the root at startup; the extension list cannot expose a file. The only `.gz` in `dist` is the model. There is no pre-compression or `preCompressed` option, and the unit test confirms `content-encoding` is absent. See m-4 for the one side effect.
6. **Never a blob: worker.** `workerBlobURL: false` is passed explicitly, the patched defaults set it to `false`, and `spawnWorker` then does `new Worker(workerPath)`. The page CSP's `worker-src 'self'` would block a `blob:` worker anyway. The e2e test asserts the single worker URL.
7. **Fail-closed.** `ocr()` returns either the complete word list or `null`. There is no partial path: any throw, including from a malformed result in `wordsOf`, becomes `null`. `prepareProof` turns `null` (or a throw) into `ocrOk: false` with every region list empty, and the editor shows "We couldn't check this image automatically…". The best-effort line is always shown. A hung or failed `recognize` terminates the worker. Exceptions: m-2 and m-3.
8. **The bundle test guards the entry chunk.** My production build:
   - The entry `index-*.js` has no static imports and no `modulepreload` links.
   - `ocr.ts` is `assets/ocr-*.js` and the engine is `assets/src-*.js`, both reached only through `import()`.
   - The entry contains none of `createWorker`, `Legacy model requested`, `/ocr/worker.min.js` or `tesseract`.
   - `node-fetch` and `idb-keyval` are in no browser chunk.

   The test's markers would catch either module being inlined into the entry. Its "not preloaded" check is vacuous today because the app emits no preloads, but vite would emit one for any static dependency of the entry, so the check still catches a regression.
9. **Fixtures contain no real personal data.**
   - Cards are the standard test numbers 4111…1111 and 5555…4444.
   - The IBAN is the documentation IBAN `GB82 WEST 1234 5698 7654 32`.
   - Emails are on `example.com`, `example.org` and `example.net`.
   - Phones are in Ofcom's drama range (07700 900xxx) and the NANP fictional range (555-01xx).
   - Names are made up: Avery Quinlan, Sasha Whitcombe, Rowan Ellis and Devon Marsh.
   - The images are rendered from HTML (`make.ts`). The PNGs have no `tEXt`, `iTXt`, `zTXt` or `eXIf` chunks, and the JPEG has only JFIF and ICC segments: no EXIF, GPS or comment.
10. **Install scripts and pins.** `tesseract.js` has a `postinstall` (`opencollective-postinstall || true`). `.npmrc` has `ignore-scripts=true` and `min-release-age=14`, both unchanged. No other new package has an install script; the lockfile's `hasInstallScript` set is argon2, esbuild, fsevents (all existing) and tesseract.js. Every new package is exact-pinned in the lockfile with integrity, and `tesseract.js-core` is also pinned by a root `overrides` entry. Publish dates: tesseract.js and tesseract.js-core 2025-12-15, eng 2023-09-04. The newest transitive packages are wasm-feature-detect 1.9.0 (2026-08-11) and idb-keyval 6.3.0 (2026-07-08). All are older than 14 days. `npm audit --omit=dev` reports 0 vulnerabilities.

## Findings

### Blocking

None.

### Minor

**m-1. A red test was changed in the green commit, and the commit message does not say so.** `apps/web/test/bundle.test.ts` is from red `ceef74e8`; `aa0993e1` edits it. The changes:
- (a) `bundleText` now skips `dist/ocr/`, so the `jsdelivr|unpkg` scan no longer covers `worker.min.js`.
- (b) The "no tesseract-core or traineddata file" check is narrowed from all of `dist` to `dist/assets`, with a positive listing of `dist/ocr` added.
- (c) The entry check `not.toContain('createWorker')` is replaced by four other markers.

As written, (a) and (b) contradicted the plan's own design: upstream `worker.min.js` contains jsdelivr strings, and the plan puts the core files in `dist/ocr`. So the red test could never pass. In practice, the hash manifest and the CSP now carry what the scan covered for `dist/ocr`. (c) is a net strengthening, although `createWorker` is not in the entry today and the old line could have stayed.

Scenario: a later reviewer reads the green commit, sees "tests pass" and does not notice that the CDN scan no longer covers the one file that still contains CDN URLs. A future upstream bump would then rely on the manifest regeneration alone. Fix: say so in the commit message, and keep `createWorker` in the entry markers. If the lead wants it, add an assertion that `dist/ocr/worker.min.js` is byte-identical to the manifest entry, which ties the excluded file to the check that replaces the scan.

**m-2. A worker whose load hangs or fails is never terminated.** `discard(w)` does `w.then(x => x.terminate())`, and `w` is the `createWorker` promise. That promise has two failure modes:
- It never settles. The e2e case "a model that never arrives" stalls the model fetch.
- It rejects, for example when the core returns 404. tesseract.js does not terminate its `Worker` on a load reject.

Either way, the real `Worker` thread created by `spawnWorker` is unreachable and is never terminated. Each later proof spawns another one, and with `cacheMethod: 'none'` each re-downloads the model if the HTTP cache is cold.

Scenario: a buyer on a captive-portal or very slow network retries a proof 5 times. That leaves 5 idle or stalled tesseract workers (each holding a WASM heap once the core loaded) for the life of the tab. This is resource-only: no image has been sent at that point (`recognize` runs only after load resolves), so nothing leaks to privacy.

Fix: tesseract.js does not expose the raw `Worker` before `createWorker` resolves. Options are to give `ocr.ts` its own timeout around `createWorker` that tears down through a patched `spawnWorker` (the vite plugin already replaces one tesseract module), or to accept and document. The unit test "terminates the worker (a load that never finishes)" only covers a load that does finish late, so it overstates the guarantee.

**m-3. `blocks: null` is treated as "checked, nothing found".** `wordsOf(null)` returns `[]` (tested as intended), so a `recognize` that resolves with `data.blocks === null` gives `ocrOk: true` with no regions. The editor then does not show "We couldn't check this image automatically". tesseract.js 7 returns `null` for blocks only when `output.blocks` is falsy or `skipRecognition` is set, so this cannot happen today.

Scenario: a future tesseract.js bump renames or moves the `blocks` output (it changed between v4, v5 and v6). Every proof then silently reports "checked" with zero automatic blurs, and only the best-effort line warns the user. Fix: in `createOcr`, treat `result.data.blocks == null` (or a non-array) as failure and return `null`. Keep `[]` meaning "nothing read".

**m-4. `gz` adds to the set of profile URLs that 404.** Display names match `^[A-Za-z0-9._-]{5,20}$`, so `alice.gz` is a valid name. `/u/alice.gz` (a shared profile link) is now a JSON 404 instead of the app page. This already happens for `.js`, `.json`, `.png` and the others, so it is pre-existing behaviour that now covers one more extension. There is no security exposure, since nothing new is served. Scenario: a user named `backup.gz` shares their profile link and it is broken. Fix (an owner or lead choice): scope `gz` to `/ocr/` only, for example by also requiring the path to start with `/ocr/`. Alternatively, reserve file-extension suffixes in `checkDisplayName`.

**m-5. Recall gap for names with no label (0/2), and the number is not recorded where the plan says.** The e2e annotates `name-recall`; per the lead's run, `top-name` and `avatar-caption` both scored 0/2. In those layouts the recipient's name sits alone, as on Zelle, Cash App, Revolut and Wise receipts or under an avatar, and `detectSensitive` finds names only after a label. Plan 5 (line 594) says the measured recall "is recorded in `docs/security/plan-5-review.md` as a number". That file does not exist on the branch.

Scenario: a buyer uploads a Cash App receipt with "Rowan Ellis" in 44 px at the top. Cards, IBANs, emails and phones are blurred, the name is not, and the buyer trusts the auto-blur and sends it. The always-shown "does its best… please double-check every detail yourself" line is the only mitigation. Also, `DETECT_MIN_RECALL_NAMES = 0.9` is measured over only 2 labelled names, so it really means 2/2.

Fix: record the numbers in `docs/security/plan-5-review.md`. **Owner question:** should a name-shaped line with no label be blurred by default (more false positives), or should the editor add a name-specific nudge such as "Check the recipient's name is blurred"? Recommendation: blur a prominent standalone Title-Case line of two to three words above the amount by default. Unblurring is one tap; a leaked name cannot be taken back.

**m-6. Plan deliverables missing from the commit message.** Plan 5 line 34 requires the resolved `npm ls --all tesseract.js` tree in the Task 13 commit message, and re-checking publish dates and `npm audit` at install. The commit message has neither. I re-did both (see point 10 of the verification section above): all versions are older than 14 days and audit is clean. Scenario: a later supply-chain audit cannot tell from history what was checked at install time. Fix: amend the message when landing.

### Info

**I-1. CDN URLs still ship inside `/ocr/worker.min.js`.** These are the defaults for `tesseract.js-core@v7.0.0` and `@tesseract.js-data/<lang>`. They are used only if `corePath` or `langPath` is empty, and both are always set. Even then, the worker CSP (`connect-src 'self'`, `script-src 'self'`) blocks them. That file cannot be patched without breaking the hash pin, so this is the right trade-off. It is why m-1(a) is acceptable.

**I-2. The manifest proves node_modules equals the registry, not that the registry is benign.** The tarball hashes and the lockfile integrity both trust what npm published. The manifest protects against a poisoned cache, mirror or local `node_modules`, and makes a version bump a deliberate two-file change. That matches the stated intent.

**I-3. Only the source folder is verified.** The verification runs on `public/ocr` at `buildStart`. `dist/ocr` (vite's copy) and what the server actually serves are not re-hashed, and there is no SRI on `importScripts`. Everything is same-origin, so this is low risk. If the lead wants it closed, running `verifyOcrAssets(<dist>/ocr)` in `closeBundle` would cover it.

**I-4. The worker CSP only applies where the API's `serveWeb` serves the app.** In `vite dev`, `/ocr/*` comes from `public/` with no CSP. That is dev only, and the explicit paths still hold there. Any future CDN or static host in front of the app must copy the `/ocr/*` header rule.

**I-5. The 30-second timeout covers load and recognition together.** On a slow first visit, the model is 2.95 MB, the relaxed-SIMD core is a few MB, and the HTTP cache is not guaranteed. If loading takes more than 30 s, every proof times out, the worker is discarded, and the next proof starts over. That fails closed ("couldn't check"), so this is UX, not a security issue.

**I-6. The e2e never exercises the CSP backstop.** It proves no off-origin request while the `/ocr/` paths work. It does not prove that the worker CSP blocks a cross-origin fetch. A small check would close that: in the fixture build, have the worker try `fetch('https://cdn.jsdelivr.net/')` and expect a `securitypolicyviolation`. Not required.

## Tests run

- `npx vitest run apps/web/test/ocr.test.ts tools/test/copy-ocr-assets.test.ts apps/api/test/headers.test.ts` (through `run-tests.sh`, under the shared lock): **3 files, 103 tests, all passed.**
- `tsc --noEmit` for `apps/web` and `apps/api`: clean.
- A manual `vite build --mode production` under the lock, then inspection of the output: entry, chunk graph, CDN strings, `dist/ocr` hashes. All as described above.
- `npm audit --omit=dev`: 0 vulnerabilities. Tarball integrity and hash comparison against the registry: all match.
- **Not run:** `apps/web/test/bundle.test.ts` (it does several full builds; the shared queue was about 15 deep, and I did an equivalent build and inspection by hand). Also not run: `apps/web/e2e/proof-ocr.spec.ts` (Playwright, not in my brief). The 0/2 recall figure comes from the lead's run, not mine.
