# Review: wip/agy-layout @110ec56e (agy Job 2) — 17 Nov 2026, claude3

Branch: `origin/wip/agy-layout` 110ec56e (2 commits on wip/third-demo-r3 1fa6bed1: e82c136b #26/#34/#37, 110ec56e #38/#42/#48).
Order: AGY-ORDERS.md Job 2. Owner notes: owner-demo-notes-2026-11-12.jsonl #26, #34, #37, #38, #42, #43, #48.
Rulings checked: to-agy.log 22:44:41 (OWNER: fonts and font sizes off-limits to agy), AGY-WORKSPACE.md §5,
the 17:38 RULE (no product calls; ask, leave undone), the lead's 12 Nov help-link call (HelpLinks.tsx/HelpTopic.tsx headers),
owner 16 Nov round-3 notes (owner-demo-notes-2026-11-16b.jsonl #7).

## VERDICT: CHANGES NEEDED

Most of the branch is good: the setup Welcome checklist now uses the `--x2f-good` token (the two local hex greens are gone,
tested), the /setup/pgp-key column widens to 680 px for #26, /buy spacing for #48 is small and on tokens, and the
screen names for /welcome, /setup/welcome and /setup/pgp-key follow #37. No money/escrow/keys/auth/fees/liens/disputes code
is touched; only apps/web UI, tests and a docs file. Three things block.

## Blocking

**B1. Font sizes changed, which the owner put off-limits for agy** — `apps/web/src/screens/screens.css:404-424`
(the new `[data-screen='session-length']` block: 18/16/18/16 px) and `apps/web/src/ui/ui.css:2763-2764`
(`.x2f-help-links__link` `font-size: 15px; font-weight: 600`).
AGY-ORDERS.md Job 2 says "bigger fonts (#42-#46)", but the later OWNER order (to-agy.log 2026-11-16 22:44:41, and
AGY-WORKSPACE.md §5) says fonts, font sizes and font weights are claude2's (wip/second-fonts, which also rewrites ui.css
and ownerLayout.test.tsx, so this will also conflict). #43 is also already handled by the lead's type-scale step
(ownerLayout.test.tsx:21 "owner #43"). The READY line and the commit message list #26/#34/#37/#38/#42/#48 and do not
mention #43, so the change is not visible from the summary either.
Fix: delete screens.css:403-424 (the whole #43 block and its comment); delete `font-size: 15px;` and `font-weight: 600;`
from `.x2f-help-links__link` (ui.css:2763-2764); delete the `it('steps up the label, select and helper lines on
/session-length (#43)')` case (ownerLayout.test.tsx:159-164) and rename that describe to "/buy spacing (owner #48)". Add a line
to docs/agy-owner-questions-layout.md: "#43: left to claude2's font sizing (wip/second-fonts), per the owner's 16 Nov order."

**B2. /session-length help links now go behind the front door: a product call built instead of asked** —
`apps/web/src/ui/HelpLinks.tsx:19-25` (`SIGNED_IN_HELP_LINKS`), `apps/web/src/screens/auth/SessionLength.tsx:177`
(`<HelpLinks signedIn />`).
The lead's 12 Nov call is written at HelpLinks.tsx:4-8 and HelpTopic.tsx:3-7: both screens use the front-door placeholder
pages "so nothing here leads behind the door". agy changed that and then filed it in the questions doc as option 1
"(implemented on wip/agy-layout)". The 17:38 RULE says: write the question, leave that part undone. It is also wrong for one
case: a team member's session reaches /session-length too, and members have no Security screen
(SessionLength.tsx:151-152 says so), so "Settings -> /settings/security" fails for them. The header comment at
HelpLinks.tsx:4-8 now contradicts the code.
Fix: revert SessionLength.tsx:177 to `<HelpLinks />`; remove `SIGNED_IN_HELP_LINKS` and the `signedIn` prop from
HelpLinks.tsx; remove the `SIGNED_IN_HELP_LINKS` and `<HelpLinks signedIn` assertions from ownerLayout.test.tsx:117-140
(keep the `wideFrameOf` lines). In docs/agy-owner-questions-layout.md §3, change option 1's label to "Keep the lead's 12 Nov
call (front-door placeholders on both screens; current state)", put signed-in links as option 2 (noting the team-member
Settings problem), and set Status: "not built; waiting for the owner or the lead."

**B3. The Idle reminder screen is named "Session length"** — `apps/web/src/ui/ScreenHeader.tsx:35`
`[/^\/settings\/idle-reminder(\/|$)/, 'Session length']`. That screen is the idle reminder (`IDLE_COPY.title` =
'Idle reminder', sessionCopy.ts:54) and its hint says "you stay logged in": it is not the session length. A wrong name beside
the logo misleads people about what the screen does (before this branch it fell through to "Settings").
Fix: `'Idle reminder'` in ScreenHeader.tsx:35 and in ownerLayout.test.tsx:44.

## Minor

**M1. Questions doc §1 is already answered** — docs/agy-owner-questions-layout.md:5-13 asks about /setup/wallet, but the
owner answered on 16 Nov (owner-demo-notes-2026-11-16b.jsonl #7, `7fd0d91a`: a recommendation list, "and many more", one
address field), now Job 27 (wip/agy-wallet-list). Fix: replace §1 with one line: "Answered by the owner 16 Nov #7; built
in Job 27 (wip/agy-wallet-list)."

**M2. Questions doc §2 is about a screen agy may not touch** — docs/agy-owner-questions-layout.md:15-20 (/setup/security-key
art). That screen is claude2's (AGY-WORKSPACE.md §5). Fix: add "(screen owned by claude2; agy is not changing it)" to the
Status line.

**M3. #38 is quoted wrongly** — docs/agy-owner-questions-layout.md:22-24 gives #38 (`aea147fe`) the #42 sentence about links.
#38 says "Move everything down so the screen doesn't look so empty and so the logo fits at the top...". Fix: quote #42 alone
for the links and cite #38 only for "move everything down".

**M4. The DESIGNER-REVIEW marker was dropped from the Welcome checklist** — apps/web/src/screens/setup/setup.css:969-970.
The old comment said "DESIGNER-REVIEW: plain until design restyles it"; the new card style is still agy's stand-in for
#37, not a design board. Fix: append "DESIGNER-REVIEW: card style until design restyles it." to that comment.

**M5. The DesktopShell change is not in the commit message or the READY line** — apps/web/src/ui/DesktopShell.tsx:36. Only
`/help/<topic>` is pre-login now, so the signed-in `/help` page gets the rail. That is correct (`/help` is behind the door in
App.tsx), but people should be told about it. Fix: one line in the READY/FIXED post ("signed-in /help now shows the rail; it was
centred by mistake"), plus a comment above PRE_LOGIN.

**M6. The layout tests read CSS source, not the rendered page** — ownerLayout.test.tsx:53-68 and 166-171 regex the CSS text
(the same point as review-agy-landing M3). Fix: add one Playwright check in e2e/setup.spec.ts or e2e/shell.spec.ts: at
1280x800 the /setup/pgp-key textarea is wider than 480 px, and at 360x800 the /login help links are a 2x2 grid with each
link at least 44 px tall and no sideways scroll. You can then drop the regex for the pgp width.

## Checks (fresh worktree, Node 24.22.1, `npm ci`)
- typecheck: 20/20 workspaces, 0 errors
- copy-lint: clean (apps/web/src, apps/staff-web/src)
- separation-check: ok
- web vitest, touched and related (ownerLayout, goodToken, sessionLength, idleReminder, frontDoor, wideShell, devicesBoards,
  ownerCopy1, pgpKeyFacts, signupV2, task28-units, logout-tripwire): 12 files, 235/235 passed
- Playwright (shell, owner-copy, login, setup, signup-v2, fold): 107 passed, 1 skipped, 0 failed (the parity-pixel
  diffs are reported but do not block, as on base)

## Owner questions agy raised (docs/agy-owner-questions-layout.md)
1. /setup/wallet: wallet-connect vs a suggested-wallets list (already answered 16 Nov #7, see M1).
2. /setup/security-key art: keep the 4 generic SVG outlines, or commission illustrations of 4-5 real keys.
3. Help links: front-door placeholders on /login and on /session-length, or the real in-app screens on /session-length once
   signed in (see B2: leave it unbuilt until answered).

After the fixes: post a FIXED line in to-lead.log with the new sha and checks, as for landing.
