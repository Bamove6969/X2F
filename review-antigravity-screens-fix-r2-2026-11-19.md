# Re-review: wip/antigravity-screens-fix @ b2f334a7 (round 2, against review-antigravity-screens-fix-2026-11-18.md)

Reviewer: the lead's standing ANTIGRAVITY reviewer, 19 Nov 2026 (about 16:00 BC time).

Delta reviewed: 9e8c0bd0..b2f334a7. ANTIGRAVITY added one commit, which touches 99 files:
- `.gitignore` (+3 lines);
- `apps/web/e2e/capture-demo-r3.ts` (56 lines changed);
- `docs/screenshots/demo-r3/index.md` (the date);
- the deletion of all 96 PNGs.

The base is unchanged: wip/third-demo-r3 94337781, then agy's 0c0f04ed, d15d6b57 and cfd3475d, then 9e8c0bd0.

Lane: test tooling and docs only. No app source is touched.

## Verdict: CHANGES NEEDED

All 5 round-1 B1 shots are fixed, and the round-1 minors are dealt with. I re-ran the capture myself and looked at all 96 PNGs.

One shot still shows an in-progress state: 23, desktop (B1). That is the same class of problem as round-1 B1. The fix is one line.

Separately, landing on main is not a clean cherry-pick in practice. The files apply cleanly and typecheck, but the script does not run on main (M1). The lead should know that before choosing a landing route.

## Findings

### Blocking
- **B1. `23-trade-buyer-marked-paid-desktop.png` shows a disabled "Marking as paid…" button** under the PAID card.
  - Where the button comes from:
    - BuyerPay.tsx:543-547 renders it while `escrow.paidRecorded` is false;
    - the shot's fixture (capture-demo-r3.ts:647, `BUYER_PAID`) never marks the tap as recorded.
  - In the real flow, that button is gone once the device has recorded the tap. So the owner would see a mid-action state on a screen titled "Buyer Marked as Paid".
  - On phone the button is below the fold, so only the desktop shot shows it.
  - Fix, before the shot at :652, either of:
    - `await p.evaluate(() => window.__x2fSetFixtureEscrow?.({ paidRecorded: true }))` (the fixture hook at apps/web/src/fixtures/index.ts:30); or
    - wait until `button:has-text("Marking as paid")` is detached.
  - The round-1 review listed this screen as fine; it was missed then.

### Major
- **M1. The script does not run on main as it stands, so landing "just the script" needs a port, not only a cherry-pick.** Details are under "Landing on main" below. In short, on main + the three files:
  - typecheck, copy-lint and separation-check are clean;
  - but the capture stops at shot 02, because the Terms tick is disabled (`terms-stale`). The script hard-codes `/v1/terms` → `{ version: '2026-11-14' }` (capture-demo-r3.ts:281). That is the third-demo-r3 Terms version; main's `TERMS_TEXT_VERSION` is `'2026-11-12'`.
  - In my scratch worktree I imported `TERMS_TEXT_VERSION` instead of hard-coding it. That got the run to shot 04. It then stops at 05 (`#pw` never appears): main's setup login flow differs from third-demo-r3's.
  - So the script is written against the third-demo-r3 UI and needs real porting work on main. The lead decides whether it should land on main before or after third-demo-r3.
  - Recommendation: import `TERMS_TEXT_VERSION` in any case, since that is pure engineering. Leave the port to whoever lands third-demo-r3.
- **M2. index.md is committed, but its 96 links now point at gitignored files, and it does not say how to make them (docs/screenshots/demo-r3/index.md).**
  - On a fresh checkout every link is dead, and nothing in the file says "run `npx tsx apps/web/e2e/capture-demo-r3.ts` to generate these (needs `X2F_CHROMIUM_PATH` or Playwright's browser)".
  - Also, the script rewrites index.md with today's date on every run (capture-demo-r3.ts:1187-1222), so each regeneration dirties a tracked file.
  - Suggestions:
    - add a short "How to regenerate" line and a "PNGs are not in git" note;
    - either stop writing the date into the tracked file, or gitignore the generated index and commit a short README instead.
  - Which of the two is a lead call (see m5).

### Minor
- **m1. `05-signup-password` (phone and desktop) shows "Strength: Checking…"**, the strength meter's loading line. The shot should wait for the strength verdict. It is a small loading state, not an error, but it is the same class as B1.
- **m2. Wall-clock values make shots differ from run to run:**
  - the market rate's `at: new Date()` (capture-demo-r3.ts:527) prints "Market rate · updated 22:25 UTC" in shots 14 and 16;
  - the chat attestation's `issuedAt` was changed to `new Date()` (:159);
  - the index date (:1187).
  Fixed times would make the pack repeatable. The chat one may need to be "now" for an attestation freshness check; if so, add a comment saying why.
- **m3. Old m3 is fixed in effect, with a nit (capture-demo-r3.ts:228).** The fallback is now `/opt/pw-browsers/chromium`, used only if it exists, otherwise Playwright's own browser. That works. A path tied to this box is still baked into a repo script; `X2F_CHROMIUM_PATH` alone would do.

## Round-1 findings: status
- **B1 (5 broken screens):** all fixed. I checked them on my own re-run:
  - 29 (chat): messages are shown in both views;
  - 34 (Security): Login methods load;
  - 36 (Jabber events): three events are listed;
  - 38 (Session length): the right screen, "Choose a time";
  - 42 (News): three items are shown, with neutral fixture text.
  - The wait selectors now target each screen's own content: `[data-part="methods"]`, `[data-part="jabber-events"]`, `[data-screen="session-length"]:not([aria-busy="true"])` and `[data-part="news-item"]`. I checked that all of them exist in the app source.
- **m1 (debug logging):** fixed. It is behind `DEBUG_CAPTURE` (:273-277).
- **m2 (fixed sleeps):** fixed. The 3 `waitForTimeout` calls are replaced by state waits, and none is left in the file.
- **m3 (chromium fallback):** fixed in effect; see m3 above.
- **m4 (invented announcements):** the news items are now neutral ("Upgrade done", "Planned upgrade", "Welcome"). The moderator "sarah.v" stays, which is fine in a fixture. index.md:6 still says these are fixture shots.
- **m5 (PNGs in git):** the PNGs are untracked from b2f334a7 on.
  - The branch tree has no PNG under docs/screenshots/demo-r3/; only index.md is there. The 306 other PNGs in the tree are the existing design/x2f-app/refs.
  - **But the history still carries them:** 108 PNG blobs, 16.0 MB, from 0c0f04ed (agy, 36 PNGs), 9e8c0bd0 (72 PNGs) and b2f334a7 (which deletes all 96).
  - Merging or rebasing these commits as they are would put those 16 MB into main's history for good. Landing has to squash them (see below).

## All 96 shots
I re-ran the script myself at b2f334a7 (`npx tsx apps/web/e2e/capture-demo-r3.ts`, under the lock): exit 0, 96 PNGs, 48 screens. I viewed every PNG, as 8 phone and 12 desktop contact sheets.
- Apart from B1 (23, desktop) and m1 (05, both views), all screens show the intended state with content in both views. There are no error strings, no wrong routes and no empty states.
- Things that are app UI, not the script, noted for the design pass only:
  - 20 desktop shows "SECURING ESCROW" twice (header and body);
  - 35 and 36 have a lone small "‹" back affordance above "Settings";
  - 09 has the welcome-art placeholder card.

## Landing on main (tried in a scratch worktree from origin/main 54104057; nothing pushed)
- **Commits to take:** 0c0f04ed (the script's creation, plus debug-welcome.ts), 9e8c0bd0 and b2f334a7.
- **Commits to leave out:** d15d6b57 and cfd3475d. They only add and then delete AGY-READ-THIS.md.
- **How:** `git cherry-pick -n 0c0f04ed 9e8c0bd0 b2f334a7`, then **one** squashed commit.
  - The net result is 3 files: `.gitignore` (+3), `apps/web/e2e/capture-demo-r3.ts` (new, identical to the branch's) and `docs/screenshots/demo-r3/index.md` (new).
  - There are no PNGs, and debug-welcome.ts nets out to nothing.
  - Committing the picks one by one would carry the 16 MB of PNG history (m5).
  - The same 3 files can instead be taken with `git checkout origin/wip/antigravity-screens-fix -- <script> <index.md>`, plus the 3 `.gitignore` lines.
- **Conflict:** one trivial conflict, in `.gitignore`. Main added an `apps/web/public/ocr/` block at the same spot. Keep both blocks. There are no other conflicts.
- **On main + those files:** `tsc -p apps/web --noEmit` is clean, copy-lint is clean, separation-check is ok.
- **The capture fails** at shot 02 on main (M1). With the Terms version imported, it gets to 04, then fails at 05. **It does not apply in a working state; it needs a port.**

## Checks run at b2f334a7 (my own worktree agyrev-r3-shots, fresh `npm ci`, under ~/x2f-comms/check.lock, Docker up)
- `npm run check` exited 1:
  - typecheck ok; copy-lint clean; separation-check ok;
  - `npm test`: 396 files, 395 passed and 1 failed. Tests: 7305 passed, 1 failed, 1 todo.
  - The failure is `apps/web/test/serve-boards.test.ts:90` (capture-refs manifest), the known red on the third-demo-r3 base.
- semgrep (run separately, because `check` stops at the red test): 0 findings. `npm audit --omit=dev`: 0 vulnerabilities.
- Capture script: exit 0 on the branch, with 96 PNGs viewed. On main + the 3 files: exit 1 at shot 02, and at shot 05 with the Terms fix.
- Not run: Playwright web. It was not asked for this round, and the branch changes no app code or e2e spec.

Counts: 1 blocking, 2 major, 3 minor.
