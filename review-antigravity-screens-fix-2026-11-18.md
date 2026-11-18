# Review: wip/antigravity-screens-fix @ 9e8c0bd0 (fixes review-agy-screens-check-2026-11-18.md B1-B4, M1-M5)

Reviewer: the lead's dedicated agy/ANTIGRAVITY reviewer, 18 Nov 2026 (about 14:15 BC time).

**Base.** The branch sits on wip/agy-screens-check cfd3475d, which is agy's handoff commit on its 0c0f04ed. That sits on wip/third-demo-r3 94337781, which is not on main. ANTIGRAVITY added one commit, 9e8c0bd0, which touches 75 files:
- `apps/web/e2e/capture-demo-r3.ts`;
- the deletion of `apps/web/e2e/debug-welcome.ts`;
- 72 PNGs and `docs/screenshots/demo-r3/index.md` (96 shots, 48 screens).

**Lane.** Test tooling and docs only. No app source, API, money or key code is touched.

## Verdict: CHANGES NEEDED

The code side is now fixed:
- the typecheck is clean;
- the debug file is gone;
- the chromium path, output folder, scroll warning and index note are fixed;
- the pack is complete at 96 shots.

But 5 of the 48 screens in the owner pack show an error, the wrong screen or a loading or empty state (B1). That is the same class of problem as the earlier B2. The pack is for the owner, so it cannot go to him like this.

## Findings

### Blocking
- **B1. Five screens are captured in a broken state. I checked all 96 PNGs by eye; both phone and desktop are affected for each:**
  - `34-settings-security`: "Could not load your login methods." shows in red under Login methods. `baseSettingsApi` (capture-demo-r3.ts:888) does not stub `GET /v1/account/methods`.
  - `36-settings-jabber-events`: shows "That didn't work. Try again." The Jabber events GET is not stubbed (capture-demo-r3.ts:920-924).
  - `38-settings-session-length`: this is **the wrong screen**. It is the Sell list with "Payment methods could not be loaded right now". The cause:
    - `TRADER_ME.session.lengthHours` is 4 (capture-demo-r3.ts:48);
    - `/session-length` sends any session that already has a length straight on (SessionLength.tsx:100-103), so it lands on /sell, whose methods are not stubbed;
    - the index still labels it "Settings: Session Duration Preference".
    The fix is to stub `me` with `lengthHours: null` for this shot.
  - `29-trade-chat-sheet`: the chat shows "Opening the chat…" and no messages (capture-demo-r3.ts:735). Wait for a message bubble before the shot.
  - `42-news-announcements`: shows "No news yet". The seeded items in the `/v1/news**` stub at :1028-1033 have no `editedAt`. `isItem` (news-model.ts:76-84) needs `editedAt` to be null or a string, so it drops all three items. Add `editedAt: null` to each. Its `waitForSelector('main')` passes on the empty state.

  For every shot, wait for that screen's own content (`data-part`) rather than `main`, and look at each PNG before committing.

### Minor
- **m1. Debug logging was left in (capture-demo-r3.ts:273-275).** Every page logs its console, page errors and failed requests to stdout. Remove it, or put it behind an env flag.
- **m2. Fixed sleeps hide timing problems (capture-demo-r3.ts:427, :441, :686).** `waitForTimeout(1600 / 300 / 1700)` should be a wait on a state instead.
- **m3. The old hard-coded path is still the fallback (capture-demo-r3.ts:228).** `X2F_CHROMIUM_PATH || '/usr/bin/chromium'` falls back to the path the earlier M1 complained about. The `executablePath ? … : {}` guard can then never be empty. Let Playwright's own browser be the fallback instead.
- **m4. Some fixture content is invented and reads like real announcements.** Examples are the news items "Monero Regtest v0.18 Upgrade" and "Scheduled Network Maintenance", and the moderator "sarah.v". This is fine in a fixture, but the index should keep saying these are fixture shots. It does say so (index.md line 6).
- **m5. The PNGs add about 15 MB to git history.** The earlier M4 still stands: the lead decides whether the pack lives on a docs/shots branch or on comms.

### Checked and fine
- Earlier B1 (typecheck): fixed. The keys are hex via `chatIdentity()`, `channelFor` is awaited, and the optional types are widened.
- Earlier B3 (debug file): `debug-welcome.ts` is deleted.
- Earlier B4 (incomplete): 96 shots and index.md are committed, and the index has the fixture note.
- Earlier M2: `OUT` now comes from `import.meta.url`.
- Earlier M3: a failed scroll now warns.
- Earlier B2: the 08 and 09 welcome shots now have content. The empty card at the top of 09 is the welcome art placeholder.
- All the other 43 screens look right, both phone and desktop.

### Merge with origin/main 5c937ab9
`git merge-tree` reports 23 conflicts, for example apps/api/src/accounts.ts, auth/totp.ts, auth/webauthn.ts, App.tsx, chat/engine.ts and packages/auth-client.
- All of them come from the base wip/third-demo-r3. cfd3475d alone conflicts in the same way.
- None is in a file ANTIGRAVITY touched.
- This branch should not merge to main as it is. If the lead wants the pack on main, the e2e script and the docs need to be cherry-picked onto main, and the script re-checked there.

## Checks run at 9e8c0bd0 (worktree agyrev-code, under ~/x2f-comms/check.lock, Docker up)
- `npm run check` exited 1:
  - typecheck ok; copy-lint clean; separation-check ok;
  - `npm test`: 396 files, 395 passed and 1 failed. Tests: 7305 passed, 1 failed, 1 todo.
  - The one failure is `apps/web/test/serve-boards.test.ts` (capture-refs), the known red on the third-demo-r3 base (the same failure was recorded at 0c0f04ed). It is not ANTIGRAVITY's.
- semgrep and audit were run separately, because `check` stops at the red test: 0 findings and 0 vulnerabilities.
- Playwright web (full, `--trace off`): 576 passed, 52 skipped, 0 failed.
- PNG check: all 96 viewed as contact sheets; 5 screens are bad (B1).

Counts: 1 blocking, 5 minor.
