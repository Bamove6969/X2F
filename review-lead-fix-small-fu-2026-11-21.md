# Review: wip/lead-fix-small-fu 1f6e711b (code + security), 21 Nov 2026, about 03:50 to 04:25 BC

Reviewer: independent helper, worktree `.claude/worktrees/rev-small-fu` (detached at 1f6e711b). Branch not changed.

**Verdict: APPROVE WITH MINORS.**
- **47568789 (ChatPanel one sync in flight):** correct. It cannot deadlock or apply a stale result in any way the old code could not. One minor: the property "a request that arrives during a sync runs after it" is not pinned by the branch's tests (guard G2 passes the whole suite).
- **d8237ed2 (deny-all on every other static file):** correct. Every built file now carries a CSP. The five own policies are unchanged, and nothing the page loads is affected. No findings.
- **Merge bf5b290e:** brings in exactly d293bb02's diff and nothing else.
- **1f6e711b (n-f1 test):** reads right. It is a regtest suite, so I did not run it.

## Findings

### m-1 (minor, test gap): a queued request is unpinned
- **Where:** `apps/web/src/chat/ChatPanel.tsx:149` (`again.current = true;`).
- **Problem:** delete that line, so that a sync asked for during an in-flight sync is dropped instead of queued, and all 35 chatPanel tests still pass.
  - The new test (`chatPanel.test.tsx:276`) passes either way, because the 3 s poll keeps asking.
  - In real use, a live event or a Block re-sync that lands during a sync would wait for the next poll: 3 s while waiting, 15 s when ready.
- **The code itself is right.** My probe P1 below passes at 1f6e711b and fails with the line removed.
- **Fix:** add a test, for example `.../scratchpad/rev-small-fu/chat-queue-probe.test.tsx`. It holds the first sync open, fires two live events, and expects exactly one more sync after it, whose lines show.

### n-1 (nit, no regression): a sync that never resolves holds every later request
- **Where:** `ChatPanel.tsx:148-152` and `173`.
- **Behaviour:** `inFlight` is cleared only in `finally`, so a sync that never settles parks every later request.
- **Why it is not new:**
  - The engine already runs one operation at a time per chat (`serial` plus the Web Lock, `engine.ts:326-333`). Before this change, later syncs queued behind a hung one anyway.
  - The chat API fetches time out at 15 s (`http.ts:35`, `AbortSignal.timeout`).
  - The worker RPC (`client.ts` `ask`) has no timeout of its own. That is unchanged by this commit.
- Unmount or a chat change still frees the panel: a fresh mount has fresh refs, and a new chat id does not match `inFlight`.

### n-2 (nit): the queued re-run uses the starting sync's closure
- **Where:** `ChatPanel.tsx:155-171`.
- **Behaviour:** if `tradeCode` changes while a sync for the same chat is in flight, the new `sync` returns early (`inFlight === chat`). The old loop then re-runs and publishes to the old `tradeCode`.
- A chat-A to B to A switch inside one A sync can also leave two A loops. The results are still guarded by `seq`, so the only cost is a duplicate read.
- Both cases are theoretical, since a trade's chat id goes with its trade code. No change needed.

## 47568789 (ChatPanel)

**What I checked:**
- **A sync that throws:** the inner catch sets `loadFailed`, the `finally` frees the slot, and a request queued meanwhile runs once. A failure does not set `again`, so there is no hot loop. (P2)
- **A sync that never resolves:** see n-1. (P3 pins that later requests are held.)
- **Unmount mid-sync:** `alive=false`, so the result is not applied and no re-run happens. `finally` clears `inFlight`, and a fresh mount syncs at once and shows its own result. (P4)
  - StrictMode's unmount and remount sets `alive` back to true before the await resolves, so the in-flight sync applies and runs the queued one. Fine.
- **Purge or key wipe mid-sync:** the panel's change does not touch this.
  - A purge comes through the engine: `keep()` throws `chat-purged` when the record is gone, `purging` erases it and calls `forgetKey`, and ChatPanel shows `not-found` (closed, no composer). (P5: the queued re-run's not-found closes the chat, and nothing earlier is re-applied after it.)
  - The queued re-run goes through the same engine path, so it cannot bring a purged chat's lines back.
  - A result that was already in flight before a purge could land, as before the change. That is not new: `seq` never guarded purges, and the engine's lock orders the purge after the read.
- **Chat switch mid-sync:** the new chat syncs at once, and the old chat's result is dropped (`seq`). (P6)
- **A send during a sync:** `sent()` still bumps `seq`. The engine runs the send after the sync, so the sync's result lands first and the send's snapshot replaces it.
- **No dropped request:** `again` is reset before each await, and the check and the `finally` run synchronously after it, so no request can slip between them. Pinned only by my probe (m-1).
- **Does the new test catch the bug?** Yes.
  - With ChatPanel.tsx reverted to d8237ed2, the new test fails (G1).
  - With the old code, each 4 s result is dropped by the next 3 s poll's `seq`, and two syncs are in flight at once.
- **Page-cap read-on** (`s.more && grew`) still works: G3 and G5 are caught by the M8 tests.

**TradeRoom `useTradeView` (TradeRoom.tsx:199-236): no fix needed.**
- It uses the same newest-wins `seq`, but it is not affected in the same way:
  - `getTrade` is a plain parallel fetch. Nothing serialises it, so latency does not compound behind a queue.
  - The poll is every 15 s (`seams.ts:199`), not 3 s.
- It would starve only if every read took longer than the gap between starts, for ever. That needs reads over 15 s, or live events arriving faster than the latency without a break.
- **Optional hardening:** apply any result newer than the last one applied (`mine > applied`) instead of only the newest one started. Not needed now.

## d8237ed2 (serve.ts)

- **The own policies are exact and pinned.** index.html (and `/`, the catch-all, `/%69ndex.html`), `/sw.js`, `/ocr/*`, `/monero/*` and `assets/escrow-worker-<8>.js` each keep their own CSP. headers.test pins each of them, unchanged. My probe compared each response byte for byte, by GET and HEAD, including `?x=1` and encoded spellings (`/monero/monero.worker%2Ejs`, `escrow-worker-CzS2Ko%66Q.js`).
- **No CSP-less fallback for any file.** Probe root with `Page.HTML`, `x.htm`, `x.xhtml`, `x.svg`, `SW.JS`, `x.ES`, `.es`, `.wasm`, `.webmanifest`, `.json`, `.map`, `.txt`, `.cjs`, `.jsx`, an unknown extension and no extension:
  - Every file is deny-all, by GET and HEAD.
  - A nested `Sub/sw.js` gets SERVICE_WORKER_CSP, which is the same `default-src 'none'`.
- **Case and encoding variants of a URL:**
  - `/ASSETS/…`, `/Index.html`, `/OCR/…` and `//sw.js` are JSON 404s. A non-ok response cannot start a worker.
  - `/assets/./a-1.es` and `/assets/%2e/a-1.es` resolve to the file, with deny-all.
  - `/assets//a-1.es` and `/x.Es` fall to the app page: text/html with the page CSP, not a script.
  - The header is keyed on the path on disk, so how the URL is spelled cannot change it.
- **Nothing the page loads breaks.**
  - The build ships only index.html, sw.js, `assets/`, `ocr/` and `monero/`. `public/` holds only sw.js. There is no manifest, icon, font or SVG file (Logo is inline SVG).
  - CSS, fonts, images, scripts, wasm and JSON fetched as subresources ignore a response CSP.
  - The service worker keeps its own policy and scope (`/sw.js` at the root).
  - Playwright passed under the real serveWeb: worker-csp, chat, shell, security and proof-ocr.
- **The case-sensitive `.html` check** (`serve.ts:392`, `path.endsWith('.html')`):
  - `Page.HTML` or `.htm` now falls to deny-all. That fails closed: such a page would not run, but it is never under-policed. Before d8237ed2 it got no CSP at all.
  - Vite emits only a lowercase `index.html`, so nothing is affected today.
  - **Recommendation:** keep it case-sensitive. Making it case-insensitive would give the page's script-src 'self' policy to any HTML-named file.
- **Cache:** only `/assets/` files are immutable; others get the send default. The C4 and C5 reverts are caught.

## Merge bf5b290e and 1f6e711b

- `git diff 47568789 bf5b290e` is byte-identical to `git diff 770e0df5 d293bb02`: engine.ts, monero.ts, party.ts and incoming.test.ts, already reviewed. `--remerge-diff` is empty, so there was no conflict resolution and no extra change.
- **1f6e711b** only adds `followups.test.ts` (+33). The test:
  - refuses attempt 1's check (`checkRelease: n === 1`);
  - asserts that attempt 1's built save holds `txKey` and `txFee`;
  - asserts that attempt 2's first save (`waiting-funds`) holds neither;
  - asserts that the release settles (`done`).
- This matches `delete rel.txFee` at party.ts:683. I did not run it (regtest, monerod) and did not do the commit's own revert.

## Guard reverts (each restored; `git status` clean after)

| # | Revert | Suite | Result |
|---|--------|-------|--------|
| G1 | ChatPanel.tsx back to d8237ed2 (no queue) | chatPanel.test (35) | 1 failed (the new test) |
| G2 | a request during a sync is dropped (`again=true` removed) | chatPanel.test | **0 failed** (m-1); reviewer probe: 3 of 6 failed |
| G3 | no re-run loop (`while (false)`) | chatPanel.test | 2 failed (M8 read-on) |
| G4 | `finally` does not free `inFlight` | chatPanel.test | 6 failed |
| G5 | page-cap read-on not queued | chatPanel.test | 2 failed |
| C1 | serve.ts back to 770e0df5 | headers.test (133) | 2 failed |
| C2 | catch-all keyed on `.m?js` again | headers.test | 2 failed |
| C3 | deny-all only under `/assets/` | headers.test | 3 failed |
| C4 | `/assets/` immutable cache dropped | headers.test | 4 failed |
| C5 | immutable on every file | headers.test | 1 failed |

## Tests run at 1f6e711b

- **vitest** (nice -n 10, outside the lock):
  - @x2f/web chatPanel: 35/35.
  - chatEngine + dispute: 144/144.
  - @x2f/api headers: 133/133.
  - staff/web: 6/6.
- **Reviewer probes**, then deleted: chat P1 to P6, 6/6; serve probe, 1/1 (66 request checks).
- **`tsc -p apps/web` and `tsc -p apps/api`:** clean.
- **Playwright** under `~/x2f-comms/check.lock`, `--trace off`, `/opt/pw-browsers/chromium`:
  - worker-csp, chat, shell, security and proof-ocr: **53 passed, 0 failed** (1.3 min).
  - chat.spec, three more separate runs: 4/4 each.
  - `--repeat-each` is not usable for chat.spec: parallel repeats build into the same `dist-fixtures-chat` and leave two escrow workers, so `checkEscrowWorker` refuses to start. That is a harness limit, not this branch.
- **Not run:**
  - followups.test (regtest).
  - The full `npm run check`: the lead's runner, as for the other branches today.
