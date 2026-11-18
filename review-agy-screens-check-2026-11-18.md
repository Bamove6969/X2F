# Review: wip/agy-screens-check @ 0c0f04ed (Job 13, owner screenshot pack)

Reviewer: the lead's dedicated agy reviewer, 18 Nov 2026.
Base: wip/third-demo-r3 94337781 (the branch holds one agy commit on top of it; main b6f9cf0e does not contain 94337781).
Scope of agy's commit: `apps/web/e2e/capture-demo-r3.ts` (new, 1184 lines), `apps/web/e2e/debug-welcome.ts` (new, 13 lines), 36 PNGs under `docs/screenshots/demo-r3/`.
Lane: UI/docs/test tooling only. No money, escrow, keys, login security, disputes, liens or payouts code is touched.

## Verdict: CHANGES NEEDED

The commit message calls this "partial", and that is accurate. But the head breaks `npm run typecheck` (the first step of `npm run check`), several of the committed shots are empty, and the index the job asks for is missing.

## Findings

### Blocking
- **B1. The typecheck fails: 11 errors in `apps/web/e2e/capture-demo-r3.ts`.** `npm run check` stops at its first step. The web tsconfig includes `e2e/`, so the script is type-checked:
  - (87,39) and (88,43): `exactOptionalPropertyTypes` errors when `undefined` is passed into `capture()`.
  - (113-117): `Participants` are built from `Uint8Array`. `@x2f/protocol`'s `PublicKeys` takes hex strings.
  - (145, 149, 154): `channelFor()` returns `Promise<string>`. `const channel = channelFor(tradeCode, 'chat')` is never awaited, so a Promise is passed where a channel string is needed (`channels.chat`, `seal({ trade })`).

  The errors at 113-154 sit in the chat and dispute helper (`stubChat`). That helper builds the shots for screens 29-32, so those shots could not have been taken with this code. Fix the types (hex-encode the keys and await `channelFor`), and run `npm run typecheck` before posting READY.
- **B2. Some committed shots are blank or show a loading state.**
  - `09-welcome-screen-phone.png` (7 KB) and `09-welcome-screen-desktop.png` (19 KB) are a plain dark page with nothing on it.
  - `08-signup-welcome-phone.png` shows "Loading your account." and no welcome content.

  These would mislead the owner and design. Each shot needs to wait for the screen's own `data-screen` or `data-part` before it is taken. Re-check every PNG by eye before committing. The leftover `debug-welcome.ts` (B3) suggests this was being debugged and never finished.
- **B3. A debug leftover is committed.** `apps/web/e2e/debug-welcome.ts` prints page HTML and hard-codes `executablePath: '/usr/bin/chromium'` and port 4333. Delete it.
- **B4. The deliverable is incomplete against Job 13.**
  - No `docs/screenshots/demo-r3/index.md` is committed. The script would write one, but the run stopped after shot 18.
  - Only 18 of the 48 scripted screens are captured: sign-up, welcome/tour, help, browse and two quotes. Post offer, every trade room state, dispute, settings, devices, alerts, news, profile and the front door are all missing.
  - Job 13 asks to "run the demo". The script drives a private Fastify `serveWeb` on port 4333 with stubbed API routes and fixtures. That is a reasonable way to get repeatable shots, but the index must say they are fixture shots, not the live demo.

### Minor
- **M1.** `capture-demo-r3.ts` hard-codes `executablePath: '/usr/bin/chromium'`. Use `process.env.X2F_CHROMIUM_PATH`, as `playwright.config.ts` does, so it runs on the reviewers' box (`/opt/pw-browsers/chromium`) and on the owner's PC.
- **M2.** The output folder is `resolve('docs/screenshots/demo-r3')`, which is relative to the current directory. Run from `apps/web`, it writes to the wrong place. Resolve it from `import.meta.url`, as `playwright.config.ts` does for `repo`.
- **M3.** `capture()` swallows a failed `scrollIntoViewIfNeeded` with an empty `catch`. A missing anchor then gives a wrong shot silently. Fail the shot, or at least log it.
- **M4.** The branch sits on wip/third-demo-r3, not main. Say so in the READY line. The PNGs are around 5.8 MB for 36 files, and the full pack of about 96 will be roughly 15 MB in git history. The lead should decide whether the PNGs go on a docs/shots branch or comms rather than a code branch. claude3's caps review (M3) raised the same point.
- **M5.** Index titles such as "Escrow Securing", "Release Warning Notice" and "Moderator Ruling Resolved" are agy's own labels. They are fine in a docs index, but they are not product copy.

### Info
- No user-facing app copy is changed, so the COPY-UNSIGNED rule does not apply. No "half" anywhere in the diff.
- No test is changed, skipped or deleted.
- The quote shots I opened (`17-offer-buy-quote-phone.png`) look right: DM Sans/DM Mono (fonts option D), orange on the "Enter XMR" / "Max" / "Add another wallet" links and the XMR unit.

## Checks run at 0c0f04ed (under the shared lock)
- `npm run typecheck`: **FAIL**, 11 errors, all in `apps/web/e2e/capture-demo-r3.ts` (B1). Every other workspace is clean.
- `npm run copy-lint`: ok.
- `npm run separation-check`: ok.
- `npm test` (all vitest projects, Docker up): 396 files: 395 passed, 1 failed. Tests: 7305 passed, 1 failed, 1 todo. The one failure is `apps/web/test/serve-boards.test.ts` (capture-refs: every board has a reference shot), the known baseline red (BuyMain/Main refs), not agy's.
- `npm run semgrep`: 0 findings (113 rules, 1372 files).
- `npm run audit`: 0 vulnerabilities.
- Playwright: not run. The commit changes no app source or spec. `capture-demo-r3.ts` is not a `*.spec.ts` file, and with B1 it would not run anyway.

Counts: 4 blocking, 5 minor, 3 info.
