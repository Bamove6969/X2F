# Review: wip/agy-handoff-notes @ 804a9717 (docs/agy-handoff/HANDOFF.md, AGY to Antigravity)

Reviewer: the lead's dedicated agy reviewer, 18 Nov 2026.
Base: main 8e7e63d5. The branch adds one file, `docs/agy-handoff/HANDOFF.md` (79 lines), and changes no code.
Asked by the lead: flag every branch where the handoff says READY, done or green and my check disagrees.

Also checked: the four `wip(handoff): delete AGY-READ-THIS.md` commits (seckey-art 2532f85a, web-tests ba03a92e, screens-check cfd3475d, rail-members eb30b47b). Each one only deletes the lead's note, and each tree is identical to the agy commit I reviewed (3c1c3dad, d7016989, 0c0f04ed, fa6d10ad). My verdicts carry over unchanged.

## Verdict: CHANGES NEEDED (the doc only; the status table needs correcting before Antigravity relies on it)

## Where the handoff disagrees with the reviews and checks

### Blocking (Antigravity would act on a wrong status)
- **H1. `wip/agy-stash-0` is shown as "READY, merge formatXmrExact".** The review says CHANGES NEEDED, and the lead has DROPPED it (review-agy-stash-0-2026-11-18.md).
  - It changes `@x2f/trade` money.ts and the escrow "send" amounts, which is outside agy's lane.
  - It sits on an 8 Nov base, 1778 commits behind main.
  - Main already has the same fix, and merge-tree reports conflicts.

  The cited "100 passed" was measured on that old base. Mark it: dropped, do not merge.
- **H2. `wip/agy-help-pages` says "`npx vitest run apps/web/test/helpPages.test.tsx` (passed)".** That is false at 5b15fd80. The file imports `@testing-library/react`, which is not in the repo. typecheck fails with TS2307, and vitest reports `FAIL test/helpPages.test.tsx` (the file fails to load, 0 tests run). "Abandoned" is fine, but the test claim must go. The content findings B1-B4 also stand, in case any of the text is reused for the lead's FAQ.
- **H3. `wip/agy-rail-members` says "READY ... Known problems: None; Review in progress".** The review is done: APPROVE WITH MINORS (review-agy-rail-members-2026-11-18.md).
  - The lead has sent M1 (members see the owner-only links flash while the session loads), M2 (the phone BottomNav still shows Wallets to members) and M3 to Antigravity as a fix job.
  - M3 is a lead call: members KEEP Settings; hide only the owner/staff sections inside it; blocked, jabber, idle and session-length stay visible to members.

  Section 2, item 3 of the handoff says Settings is excluded for members. That is now wrong. Update both places.
- **H4. `wip/agy-owner-ui-caps` (92e11455) and `wip/agy-orange-audit` (735d4784) are listed as "done ... Vitest passed".**
  - Both were reviewed CHANGES NEEDED (caps B1: an unguarded localStorage read blanks /post; orange-audit B1/B2: the READY overclaimed, and the branch sits on the caps commit).
  - The lead then DROPPED both in favour of claude2's accffc9b (agy's own check-in, 17 Nov 12:39 UTC).

  Mark them dropped.

### Minor
- **H5. `wip/agy-layout` cites the wrong test.** It cites `wideShell.test.tsx` (16 passed), which is rail-members' test; this branch does not touch it. claude3's 17b review used vitest (12 files, 233/233) and Playwright 109 passed. My full check of aadc5c93 is running and goes in review-agy-layout-2026-11-18.md.
- **H6. `wip/agy-seckey-art`.** The status and minors match my review. Two nits:
  - its only run was one file (3/3), while the READY line said "vitest 23/23";
  - my full check is green (tsc, copy-lint, sep, vitest 7133 with a proof timeout rerun 42/42 x2, semgrep, audit, PW 529/0).

  Say "full check green per review-agy-seckey-art-2026-11-18.md" rather than citing the single file.
- **H7. `wip/agy-screens-check` and `wip/agy-web-tests` match my reviews** (CHANGES NEEDED, with the right B1-B4 and B1-B2). One addition for web-tests: M1 (its helpTopicScreen test asserts placeholder bodies that wip/lead-owner-ui's HelpTopic also replaces) still applies, even though help-pages is abandoned.
- **H8. "done" hides open review minors.**
  - agy-landing: claude3's re-review said the merge needs a lead/owner yes on reversals R1-R3.
  - agy-notes-continuity 7192a7b8 was superseded by claude2's second-notes-continuity (bugs fixed there).
  - giftcards, flakes, demo-docs, terms-questions and recovery-copy were all APPROVE WITH MINORS.

  "Done" should say "reviewed, approved with minors / superseded", so Antigravity does not treat these as clean merges.
- **H9. `wip/agy-error-copy` is cut from wip/third-demo-r3 94337781.** The other new queue items work from main. Confirm the base with the lead before starting: cantDoCodes.ts and the API error codes differ between demo-r3 and main 8e7e63d5.
- **H10. Section 3 is PC-specific.** `/usr/bin/chromium`, `/home/flem/x2f-comms/check.lock` and the two node_modules symlink workarounds belong to agy's PC. Say so. On the cloud box the lock is `~/x2f-comms/check.lock` and Chromium is `X2F_CHROMIUM_PATH=/opt/pw-browsers/chromium`.

### Correct
- The not-started queue list (copy-list, error-copy, passkey-copy, orange-settings, demo-docs-2, fold-flake) matches the 18 Nov queue in WHO-DOES-WHAT.md.
- The lane, the single-orange rule and the fonts-D token note match the owner's rulings. No "half".

## Checks
Docs only: no code, test or config file changes, so no `npm run check` was run for this head. The branch counts above come from the checks recorded in each branch's review.

Counts: 4 blocking (H1-H4), 6 minor (H5-H10).
