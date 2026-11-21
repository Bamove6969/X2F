# Review: wip/lead-fix-monero-worker at bd4e62dc (against origin/main 0910dc62)

Independent security review of three things:
- Gap 1: serving monero-ts's own wallet worker at `/monero/monero.worker.js`, pinned and hash-checked.
- The lead's 20 Nov call: a CSP of its own for every trader-app worker (escrow, monero, OCR, sw.js), with one shared `exactOrigin`.
- Gap 6: `SellerFundLapsed`.

Reviewer worktrees: `.claude/worktrees/rev-monero-worker` (the branch head) and `.claude/worktrees/rev-monero-regtest` (a scratch merge with origin/wip/lead-p3t31-regtest-e2e 0dc70076). 20 Nov 2026, about 14:25 to 15:30 BC time.

## Verdict

**APPROVED WITH FOLLOW-UPS.** There are no blockers.
- The four policies are what the branch says, and the probes found no way round them from inside any worker.
- The monero worker file is the pinned 0.11.16 build. A mismatch fails the build.
- The regtest release e2e passes with the stack's worker-copy workaround removed.

M-1 is a pre-existing way to escape the **page** CSP. This branch is the natural place to close it, and the fix is a few lines. It is not a regression.

| # | Sev | Finding |
|---|-----|---------|
| M-1 | M | Any other same-origin script (for example `/assets/index-*.js`) started as a worker runs under **no CSP**. Page code can use one to get round the page's own `connect-src`. Pre-existing. |
| m-1 | m | The escrow worker is cached `immutable` for a year, with its CSP stored alongside it. Tightening `X2F_ORIGINS` (or any origin in that policy) never reaches a browser that already holds it. |
| m-2 | m | The escrow worker's `script-src 'self'` and `connect-src 'self'` are wider than it needs. The regtest e2e passes with `script-src 'wasm-unsafe-eval'` and `connect-src <site>/v1/ relay node`. |
| m-3 | m | The file-name pinning is checked at test time only. serveWeb would serve a renamed escrow worker with no CSP, and nothing would fail. |

## Answers to the brief

1. **Is the escrow worker's policy minimal?** It is minimal on everything except `script-src` and `connect-src` (`serve.ts:196-208`). `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src <site>/monero/monero.worker.js …; connect-src 'self' <relay> <node>`.
   - **worker-src is exactly right.** It names one exact path on each site origin, and a path without a trailing slash is an exact match. Probe results inside the real escrow worker (Chromium 1243, production build, under the lock):
     - Blocked, each with a `worker-src` violation: blob: and data: workers, `/monero/..%2Fsw.js`, `/ocr/worker.min.js`.
     - Allowed: `/monero/monero.worker.js?probe=1` and `/%6Donero/monero.worker.js`. Both are the same file, and it carries the monero CSP. serveWeb decides the CSP by the resolved file, not the URL, so `?x`, `%2D` and `%6D` variants all get the right policy.
   - **eval and `new Function` are blocked** (`script-src eval`). Fetches of data: and blob: URLs are blocked (`connect-src`).
   - **script-src `'self'` is not needed.**
     - The built worker (`escrow-worker-CzS2KofQ.js`, 3.6 MB) is one IIFE. It has no `import()`, and `importScripts` appears only in `typeof` checks.
     - It is started as a module worker (`useEscrow.ts:70`), so `importScripts` throws a TypeError anyway. My probe confirmed this.
     - `'self'` would still let a dynamic `import()` load any same-origin script. See m-2.
   - **connect-src `'self'` is wider than `/v1/`.** See m-2.
   - Allowing the relay and node proxy is unavoidable, and it is the only route out to a third party.
2. **Bypasses.**
   - **blob: and data: workers** are refused at every level, all confirmed by violations in the probe:
     - The page's `worker-src 'self'` refuses both.
     - The escrow worker's exact list refuses both.
     - The monero worker has no `worker-src`, so `script-src` with no URLs applies, and it refuses nested `/monero/…` and blob: workers.
   - **importScripts.**
     - The escrow worker is a module worker, so `importScripts` throws TypeError.
     - The monero worker has `script-src` with no URLs, so `importScripts('/assets/x.js')` is a `script-src-elem` violation.
   - **Redirects.** Nothing under `/monero/` or `/assets/` redirects. The `/monero/` probe got 200 or 404 and never a Location header (`/monero/` itself is the app page; `/monero/x.js` and `/monero/..%2F…` are 404). A dedicated worker script cannot redirect cross-origin anyway.
   - **Service worker.** `apps/web/public/sw.js` has no `fetch` handler (only install, activate, push and notificationclick), so it cannot answer for a worker script. It now carries `default-src 'none'`, which is fine because nothing it does is governed by CSP. Playwright blocks service workers, so this rests on reading the code and on sw.test.
   - **A stale cached escrow worker with no CSP.**
     - Before this branch the escrow worker was a differently named hashed asset, cached `immutable` with no CSP.
     - index.html is `no-cache`, so a reloaded page names the new `escrow-worker-*.js`, whose first response is cached with its CSP.
     - What is left: a tab opened before the deploy and never reloaded keeps starting the old cached file, still with no CSP, until it reloads. That is a one-time transition, there is no way to add a policy to it after the fact, and I accept it.
     - The opposite case (a cached CSP that is out of date) is m-1.
   - **The bypass that does exist is M-1.** A page script started as a worker gets no policy.
3. **monero worker `script-src 'wasm-unsafe-eval'` with no `'self'`: correct.**
   - The worker's own script is checked against the starting context's `worker-src` (the escrow worker's), not against this policy. This policy covers only what the worker loads afterwards, and it loads nothing: one 3.6 MB file with its WebAssembly inline.
   - In the probe inside the real monero worker:
     - `WebAssembly.compile` worked.
     - Blocked: `importScripts`, nested and blob: workers, eval, fetching this origin's `/v1/news`, a data: fetch, and the relay WebSocket.
     - Only the node proxy is allowed.
   - The file's one `new Function("return this")` is webpack's globalThis fallback. It runs only when `globalThis` is missing, which never happens in a worker.
   - The release e2e proves the wallets run under this policy.
4. **File-name pinning: holds at build and test time.**
   - `vite.config.ts:74-78` names the escrow worker `assets/escrow-worker-[hash:8].js` and any other worker `assets/other-worker-*`.
   - `ESCROW_WORKER_FILE` (`serve.ts:220`) matches only the first.
   - bundle.test pins that exactly one escrow worker is built, that no other worker is built, and that it names `/monero/monero.worker.js`.
   - `/monero.worker.js`, monero-ts's default path, is a 404, so nothing falls back to an unpinned path.
   - The gap is m-3: nothing checks this when the server starts.
5. **Can the monero worker file be swapped?**
   - Not through the supply chain. I re-ran `npm pack monero-ts@0.11.16`: `dist/monero.worker.js` hashes to `2e53c27e4518c5e59ae9f6378550cd00c68bb0221d8ee751bd0a12cc39263c3e`. That equals `tools/monero-worker.sha256` and node_modules, and the tarball's sha512 equals package-lock's integrity.
   - `copyPinned` (`tools/pinned-assets.ts`) checks the source before writing anything. `verifyPinned` refuses a missing, changed or extra file in `public/monero/`. It runs at every vite `buildStart`.
   - Not through another path. `worker-src` names only the exact URL, and the file is served `no-cache` with an ETag, so it is revalidated every time.
   - A swap at runtime would need write access to the server's dist, which is out of scope. That is the same position as every other static file and the OCR files.
6. **Lead default (clear-text .onion relay and node proxy refused without X2F_ALLOW_INSECURE_ORIGINS): holds.**
   - Site origins may be http on loopback or `.onion` (`clearTextAllowed`). Connect origins in clear text must be loopback unless the operator opts in (`exactOrigin`, `serve.ts:97-113`).
   - Revert G4 below is caught. It stays an owner question, as the builder flagged.
7. **Gap 6 (`SellerFundLapsed`, `TradeFund.tsx:551-575`).** This is a copy-only screen with no actions or funding address. It is COPY-UNSIGNED. "Keep this page open until it's sent" is the owner's copy call. I see no security impact.

## Findings

### M-1: a same-origin script started as a worker runs with no CSP, so page code can get round the page's own policy (pre-existing)

- **Where:** `serve.ts:347-348`. Every `/assets/*` file other than the escrow worker is served with `cache-control` only. headers.test:220 even pins "keeps no CSP".
- **Problem:** The page's `worker-src 'self'` lets the page start **any** same-origin script as a dedicated worker, and that worker takes its CSP from its own response.
- **Probe:** `new Worker('/assets/index-LEd4AZSJ.js', { type: 'module' })` from the page started a worker with no policy. Its fetch to `https://unlisted.x2f.invalid/x` went to the network, failing only on DNS, with no violation.
- **Impact:** Code running in the page (XSS, or a malicious page dependency) can open a worker that has no `connect-src`. That gives quiet background exfiltration or connections the page CSP was meant to stop. A top-level navigation can already carry data out, so the gain is silent, ongoing access rather than any access at all. This was already true on main for every asset, and for the escrow worker until this branch.
- **Fix (no behaviour change):** send `content-security-policy: default-src 'none'` on every other `.js` (and `.mjs`) response, under `/assets/` and anywhere else.
  - The browser ignores a response CSP on a script loaded by `<script>` or `import`, so the page is unaffected.
  - The only effect is on a file started as a worker, which then has no reach.
  - It also gives m-3 a fail-closed result: a renamed escrow worker would be served deny-all, its wallets would fail at once, and someone would notice.
- **Alternative:** narrow the page's `worker-src` to the exact worker URLs, but those change with every build.
- **Tests:** add a worker-csp case that starts `/assets/index-*.js` as a worker from the page and expects a `connect-src` violation.

### m-1: the escrow worker's CSP is cached for a year with the file

- **Where:** `serve.ts:344-346` serves `escrowCsp` with `public, max-age=31536000, immutable`.
- **Problem:** The CSP depends on runtime settings (`X2F_ORIGINS`, `X2F_RELAY_ORIGIN`, `X2F_NODE_PROXY_ORIGIN`), but the content hash covers only the bundle.
  - The relay and node proxy URLs are built into the bundle (`VITE_RELAY_URL`, `VITE_NODE_PROXY_URL`), so in practice changing them rebuilds the file and changes its name.
  - `X2F_ORIGINS` is not built in. Dropping a site origin, or tightening a policy without a code change, never reaches a browser that already cached the worker, for up to a year. Changes that would tighten the policy fail open.
- **Fix:** serve the escrow worker `no-cache`, as the monero worker already is. It has an ETag, so a repeat visit costs a 304. Or fold a fingerprint of the policy into the file name.

### m-2: the escrow worker's `script-src` and `connect-src` can be narrower

- **Change:** `script-src 'self' 'wasm-unsafe-eval'` becomes `script-src 'wasm-unsafe-eval'`, and `connect-src 'self' …` becomes `connect-src <site>/v1/ … <relay> <node>`.
- **Evidence:** In the scratch merge I made exactly that change (with `X2F_ORIGINS` as the site list) and re-ran the phone release tests both ways. Both passed (2/2, 3.3 min).
- **Benefit:** No same-origin script can be pulled into the worker that holds the keys, and its same-origin requests reach only the API.
- **Caveat:** The chat and news paths are already under `/v1/`. I did not run the whole regtest suite under the narrowed policy, so the lead should run the full release e2e before adopting it.
- **Value:** The escrow worker is where the multisig shares and chat keys live, so the narrowing is worth having. Its value is defence in depth.

### m-3: nothing checks the escrow worker's name at server start

- **Problem:** `ESCROW_WORKER_FILE` and `ESCROW_WORKER_FILE_NAMES` are tied together by bundle.test only. If a future Vite or rolldown change, or a second entry, emitted the escrow worker under another name, serveWeb would serve it with no CSP and no error.
- **Fix:** In `serveWeb`, when `<root>/assets` exists, refuse to start unless it holds exactly one file matching `ESCROW_WORKER_FILE`. With M-1 fixed, a mismatch would also fail closed in the browser.

## Guard reverts (each restored; worktree clean afterwards)

| # | Revert | Caught by |
|---|--------|-----------|
| G1 | the escrow worker served without its CSP (`serve.ts:344` condition false) | headers.test "the escrow worker is served with it…" (1 failed / 127) |
| G2 | the monero worker's `script-src` gains `'self'` | headers.test: 3 failed (policy, served headers, "policies stay as pinned") |
| G3 | the escrow worker's `connect-src` gains `https:` (escrow policy only) | headers.test: 2 failed (escrow policy, served headers) |
| G4 | clear-text .onion connect origins allowed without the flag | headers.test "site origins pass the same checks as X2F_ORIGINS…" (1 failed) |
| G5 | `installMoneroWorker()` removed from worker.ts | monero-worker.test "installs it before the escrow runtime can make a wallet" (1 failed / 3) |
| G6 | `copyPinned` stops checking the source hash | tools copy-monero-worker.test "a node_modules worker one byte off fails the build…" (1 failed / 4) |

## Tests run

- **Targeted vitest at bd4e62dc** (nice, outside the lock):
  - @x2f/api headers + schema: 209/209.
  - @x2f/web monero-worker, tradeFund and bundle: 93/93. bundle runs three production builds.
  - tools copy-monero-worker: 4/4.
- **worker-csp.spec under the lock** (`X2F_CHROMIUM_PATH=/opt/pw-browsers/chromium`): 3/3, plus my temporary probe spec, 1/1. I deleted the probe afterwards and did not commit it. Its results are quoted in the answers above.
- **Regtest release e2e under the lock.** Scratch merge of bd4e62dc with origin/wip/lead-p3t31-regtest-e2e, with the stack's copy into `dist/monero.worker.js` (tools/regtest/e2e/stack.ts:272) removed, so only the build's `/monero/monero.worker.js` exists.
  - `trade.e2e.spec.ts`, 5/5 passed (5.8 min):
    - "the production build serves monero-ts's wallet worker";
    - "taker seller, poster buyer";
    - "taker buyer, poster seller";
    - both release tests at phone and desktop sizes.
  - The API served the build through serveWeb, so all four worker CSPs were live.
  - A second run with the narrowed escrow policy from m-2: phone release both ways, 2/2.
- **Full `npm run check`:** not run, to keep the shared lock free for others. The touched suites and the regtest release e2e above pass. The lead should run it at the landing head as usual.

## Owner questions

- None from me. The builder already lists the lead default for clear-text .onion relay and node proxy origins as an owner question. The fixes for M-1 and m-1 to m-3 are engineering only.

---

## Addendum: f110c322 (`git diff bd4e62dc f110c322`), 20 Nov 2026, about 15:40 to 16:55 BC

**Verdict: APPROVE.** M-1, m-1 and m-3 are fixed. One small gap is left (n-1): it does not touch today's build and is a few lines to close. m-2 stays open, as the lead said.

### What holds

- **Deny-all on the other asset scripts (M-1).** `ASSET_SCRIPT_CSP` (`default-src 'none'`) is set on every `/assets/*.js` or `.mjs` file other than the escrow worker. In the production build those are the 5 page chunks; the rest of `assets/` is CSS and fonts.
  - **URL variants.** serveWeb picks the CSP from the resolved file, not the URL, so `?x`, `ind%65x-…`, `/%61ssets/…` and `escrow%2Dworker-…` all get the right policy. `%2e/`, `./` and uppercase variants are 404.
  - **A renamed escrow worker** inside `assets/` falls into the deny-all branch, so its wallets would fail at once (fails closed). The new worker-csp case passes: a page chunk started as a worker cannot fetch an unlisted host.
- **No-cache and ETag (m-1): the CSP cannot go stale.**
  - In a raw-socket probe, a conditional request with a matching ETag got a 304 carrying the new CSP. The ETag is size plus mtime, so a settings change alone leaves it unchanged, and `setHeaders` still runs on a 304.
  - Browser probe (Chromium 1243, a temporary spec, not committed):
    1. Load the escrow worker from a server with relay `wss://a.x2f.invalid`.
    2. Restart the server with relay `wss://b.x2f.invalid` and reload.
    3. The worker was revalidated with a 304 and enforced the **new** policy: `a` refused, `b` allowed.
- **`checkEscrowWorker` fails closed (m-3).** It refuses to start when:
  - there is no escrow worker (revert R3 is caught);
  - there are two;
  - `assets` is a file (ENOTDIR is re-thrown). There is no test for this case yet (n-2).

  Note for deployment: a deploy that keeps the previous release's hashed assets next to the new ones has two escrow workers, so the server will not start. That fails closed, but it belongs in the deploy notes.
- **A root with no `assets/` folder.** This is acceptable as "no app": index.html loads everything from `/assets/`, so nothing can start an escrow worker. This suits test roots and API-only use. What is left is n-1.

### n-1 (minor): scripts outside `/assets/` still get no CSP

- **Where:** `serve.ts`, the `setHeaders` chain.
- **Problem:** `.js`/`.mjs` files anywhere other than `/assets/`, `/ocr/`, `/monero/` and `/sw.js` match no branch and get no CSP. Probe: a root with no `assets/` started, and `/escrow-worker-AAAAAAAA.js` and `/other.mjs` at the root were served as JavaScript with no CSP.
- **Exposure today:** none. The build's root holds only index.html and sw.js.
- **When it would matter:** a future `public/*.js`, or a changed `build.assetsDir` (then there is no `assets/`, `checkEscrowWorker` returns early, and every script, the escrow worker included, is served with no policy).
- **Fix:**
  - Add a final `else if (/\.m?js$/i.test(path))` with `ASSET_SCRIPT_CSP`, so any script not matched earlier is deny-all.
  - Optionally, have `checkEscrowWorker` require `assets/` whenever `index.html` exists.

### n-2 (minor): the re-throw of non-ENOENT errors is untested

Revert R5 below (ignore every readdir error) passes the tests. Add a case where `assets` is a file and expect start-up to be refused.

### Guard reverts at f110c322 (headers.test, 129 tests; each restored)

| # | Revert | Result |
|---|--------|--------|
| R1 | no deny-all on other asset scripts | 4 failed |
| R2 | escrow worker back to the year-long `immutable` cache | 1 failed |
| R3 | zero escrow workers accepted (`> 1`) | 1 failed |
| R4 | `.mjs` dropped from the deny-all match | 1 failed |
| R5 | readdir errors other than ENOENT ignored | **0 failed** (n-2) |

### Tests run at f110c322

- **vitest** (nice, outside the lock):
  - @x2f/api headers + schema: 211/211.
  - @x2f/web monero-worker + bundle: 11/11.
- **`tsc -p apps/api`:** clean.
- **worker-csp.spec under the lock:** 4/4 on a clean tree.
  - An earlier run of it together with my 304 probe also passed 5/5. It overlapped in time with my guard-revert edits, so I re-ran worker-csp.spec alone.
  - The 304 probe's request log (a plain 200, then a conditional request answered 304) shows the `no-cache` path was the one in force during it.
- **Full set:** the lead's cloud runner.

---

## Addendum 2: wip/lead-fix-csp-followups 99ff0996 (`git diff e10aca29 99ff0996`), 21 Nov 2026, about 00:55 to 02:35 BC

**Verdict: APPROVE.** n-1, n-2 and m-2 are fixed.
- One new latent gap (n-3): the catch-all goes by file extension, so `.es` and `.ecma` slip past it.
- Mutual cancel is red in the regtest e2e. I checked it, and **m-2 is not the cause**: it fails the same way with m-2 reverted, and no CSP refusal was logged in any regtest test.

### n-1 / n-2: fixed

- **The catch-all is case-insensitive and does not depend on URL encoding.** It is keyed on the file's path on disk (`/\.m?js$/i`), so the request URL's spelling does not matter.
  - Probe against a root with `x.JS`, `lib/y.mjs`, `lib/Y.Mjs` and `lib/sw.js`: each was deny-all under `/x.JS`, `/x%2EJS`, `/%78.JS`, `/l%69b/y.mjs` and `?a=1`.
  - `/lib%2Fy.mjs` is a 404.
- **Start-up is refused** when index.html exists without `assets/`, and when `assets` is a file. Reverts R3 and R4 below are caught.

### n-3 (minor, latent): `.es` and `.ecma` are served as `application/ecmascript` with no CSP

- **Problem:** `@fastify/send`'s `mime` v3 maps `es` and `ecma` to `application/ecmascript`. That is a JavaScript MIME type in the HTML spec's list, so such a file can be started as a worker.
  - The catch-all only matches `.js`/`.mjs`, so in my probe `/z.es` and `/z.ecma` came back with no CSP.
  - These are the only other JavaScript-typed extensions in mime's tables. `.cjs` is `application/node` and `.jsx` is `text/jsx`; neither is runnable as a worker.
- **Exposure today:** none; the build has no such files.
- **Fix:** put deny-all on every static response that has no policy of its own, keyed on nothing. A subresource (CSS, font, image, script) ignores a response CSP, so this changes nothing for the page. Alternatively, widen the regex to `\.(m?js|es|ecma)$`.

### m-2: what the narrowed escrow policy still lets through

I read every network call in the built `escrow-worker-*.js`. Each one is still allowed:

| Call | Covered by |
|------|------------|
| API: `/v1/trades/…` and `/v1/chats/…` (`httpEscrowApi`, `httpChatApi`, `httpOpenTradeChat`), all relative, `credentials: 'same-origin'`, `redirect: 'error'` | `<site>/v1/` |
| relay: `new WebSocket(\`${relayUrl}/v1/trade/…\`)` | the relay origin |
| node proxy: `${daemonUri}/json_rpc` fee reads, and the in-process wallet's fetch, which refuses any URI that is not the configured daemon | the node proxy origin |
| WebAssembly: libsodium and monero-ts are inlined, so nothing is fetched | `'wasm-unsafe-eval'` |

- The bundle has no `import()`, and `importScripts` would throw in a module worker anyway.
- It has no EventSource or `sendBeacon`.
- Its XMLHttpRequest uses are library fallbacks that the live paths never take.
- `redirect: 'error'` on the API calls means a redirect cannot carry a request outside `/v1/`.

**Paths it now refuses that would matter in production:** none found.
- The page's relative URLs resolve against the page's origin. That origin must already be in X2F_ORIGINS for the API's Origin check and for `worker-src`, so an origin that is not listed was already broken before this change.
- A relay on the same origin is still matched, because an https source also allows wss to that host.

### Regtest e2e on a scratch merge (99ff0996 with origin/wip/lead-p3t31-regtest-e2e 0dc70076, the stack's worker copy removed)

I ran the no-show, lapse and cancel flows at both sizes, under the lock. Chromium was wrapped to log console output, which records CSP refusals from workers. Result: **9 passed, 2 failed** (24 min).

| Spec | Phone | Desktop |
|------|-------|---------|
| the build serves monero-ts's worker | ✓ (once) | |
| buyer cancel before "I've paid" | ✓ | ✓ |
| buyer cancel ignored (closes 48 h later) | ✓ | ✓ |
| buyer no-show, the seller's Cancel and get refund | ✓ | ✓ |
| lapse | ✓ | ✓ |
| mutual cancel after funding | ✘ | ✘ |

- **The failure:** "trade … is settling, not refunded/cancelled" (`tradeFlow.ts:192`).
- **Not m-2:**
  - **No CSP refusal was logged in the regtest run.** The same logging recorded 21 refusals in worker-csp.spec, so it does catch them.
  - **Control:** with m-2 reverted (escrow `script-src 'self'`, `connect-src 'self'`), phone mutual cancel fails the same way.
- **Not settled here:** whether mutual cancel is red on main plus the e2e branch with no worker CSPs at all. I did not run that third control. The e2e branch's commits are marked WIP, and the stack logs gave no hint. **Lead:** have Runner H, or whoever owns Task 31, run mutual cancel on main plus p3t31 before treating it as a CSP regression.

### Guard reverts at 99ff0996 (headers.test, 132 tests; each restored)

| # | Revert | Result |
|---|--------|--------|
| R1 | catch-all dropped | 1 failed |
| R2 | catch-all case-sensitive | 1 failed |
| R3 | index.html without `assets/` allowed | 1 failed |
| R4 | readdir errors other than ENOENT ignored | 1 failed |
| R5 | escrow `script-src` gets `'self'` back | 2 failed |
| R6 | escrow `connect-src` back to `'self'` | 2 failed |

### Tests run at 99ff0996

- **vitest** (nice, outside the lock):
  - @x2f/api headers + schema: 214/214.
  - @x2f/web monero-worker + bundle: 11/11.
- **`tsc -p apps/api`:** clean.
- **worker-csp.spec under the lock:** 4/4. This includes the new escrow cases: `/ocr/`, the worker's own file, and a dynamic `import()` of a page chunk, each refused.
- **Regtest:** as above.
- **Full set:** Runner H.
