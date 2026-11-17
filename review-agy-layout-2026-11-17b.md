# Re-review: wip/agy-layout @950834b2 (agy Job 2, fix round) — 17 Nov 2026, claude3

Branch: `origin/wip/agy-layout` 950834b2 (3 commits on wip/third-demo-r3 1fa6bed1; the fix commit is 950834b2 on 110ec56e).
Order: AGY-ORDERS.md Job 2; round-1 review review-agy-layout-2026-11-17.md (B1-B3, M1-M6); agy's FIXED line to-lead.log 07:04:45.

## VERDICT: APPROVE WITH MINORS

All three blockers and all six minors are fixed as written. Nothing outside apps/web UI, its tests and the questions doc is
touched; no money/escrow/keys/auth/fees/liens/disputes code.

## Round-1 items

| Item | Status | Where |
| --- | --- | --- |
| B1 font sizes | FIXED. The whole `[data-screen='session-length']` block is gone from screens.css; `font-size: 15px` / `font-weight: 600` gone from `.x2f-help-links__link` (ui.css:2752-2761); the #43 test case is deleted and the describe renamed "/buy spacing (owner #48)"; questions doc §4 says #43 is left to claude2. A full diff against 1fa6bed1 has no font-size/weight/line-height/family line left. | screens.css, ui.css, ownerLayout.test.tsx:143, docs/agy-owner-questions-layout.md:24-25 |
| B2 help links behind the door | FIXED. `<HelpLinks />` again (SessionLength.tsx:177); `SIGNED_IN_HELP_LINKS` and the `signedIn` prop removed; the lead's 12 Nov header comment (HelpLinks.tsx:4-9) matches the code again; doc §3 option 1 is the lead's call (current state), option 2 notes the team-member Settings problem, Status "not built; waiting for the owner or the lead". | HelpLinks.tsx, SessionLength.tsx:177, doc:14-22 |
| B3 Idle reminder name | FIXED. | ScreenHeader.tsx:35, ownerLayout.test.tsx:44 |
| M1 §1 answered | FIXED (one line pointing at 16 Nov #7 / Job 27). | doc:5-6 |
| M2 §2 owner of screen | FIXED. | doc:13 |
| M3 #38 quote | FIXED (#38 quoted for "move everything down", #42 for the links). | doc:17-18 |
| M4 DESIGNER-REVIEW marker | FIXED. | setup.css:969-970 |
| M5 DesktopShell told | FIXED (comment above PRE_LOGIN, and in the FIXED line). | DesktopShell.tsx:35-36 |
| M6 rendered-page checks | FIXED. setup.spec.ts:790 (pgp textarea > 480 px at 1280x800) and shell.spec.ts:214 (2x2 grid, each link >= 44 px, no sideways scroll at 360x800); both run and pass here. The pgp-width regex test was dropped as allowed. | e2e |

## Minor

**M1. Two stray blank lines left at the end of screens.css** — apps/web/src/screens/screens.css:403-404 (the diff against
1fa6bed1 is now only `+` two empty lines). Fix: delete lines 403-404 so the file is unchanged from base.

**M2. The FIXED line's Playwright count is only the two new tests** — to-lead.log 07:04:45 "Playwright 2/2 passed" (the
vitest "ownerLayout 12/12" is right). The touched specs (setup, shell) have 100+ tests between them. Fix: in your next
READY/FIXED line run and report the whole touched spec files (`setup shell`), not only the new tests.

**M3. Merge note for the lead (no agy action)** — merging this branch with claude2's wip/second-owner-ui-17nov (afbe8098)
conflicts in apps/web/src/screens/setup/setup.css (the welcome checklist item rule, ~line 986): claude2 sets
`padding: 14px 0; border-bottom ...; font-size: 17px`, this branch the surface card with `font-size: 16px` (the base value).
When resolving: keep agy's card (padding, border, radius, background) and claude2's `font-size: 17px` (fonts are claude2's).
It merges cleanly with origin/wip/third-demo-r3 94337781.

Note (not a finding): the help links are now ink-on-surface cards instead of orange text links (round-1 change, ui.css:2741-2769).
Under the owner's 17 Nov black+orange rule /login and /session-length still show plenty of orange (logo, primary button,
lead-in: 20k+ orange pixels in the orange audit), so nothing to change; claude2's orange audit owns that call.

## Checks (fresh detached worktree /home/user/rv4-layout, Node 24, `npm ci`)
- typecheck: all workspaces, 0 errors
- copy-lint: clean
- separation-check: ok
- web vitest, touched + related (ownerLayout, goodToken, sessionLength, idleReminder, frontDoor, wideShell, devicesBoards,
  ownerCopy1, pgpKeyFacts, signupV2, task28-units, logout-tripwire): 12 files, 233/233 passed
- Playwright (shell, owner-copy, login, setup, signup-v2, fold): 109 passed, 1 skipped, 0 failed (includes the 2 new tests)

After M1 (and M2 in your next line) this is done; landing still waits on the owner/lead for doc §2-§3.
