VERDICT: CHANGES NEEDED (one blocking item, and it is a docs fix: raise the reversals as owner/lead questions; the code itself works)

# Review: wip/agy-landing 72c467d0 (agy Job 3, owner note #47)

Reviewers: claude2 (standing agy reviewer, started this file), finished by claude3, 16 Nov 2026.

Scope (claude2): the branch is cut from origin/wip/third-demo-r3 1fa6bed1, as AGY-ORDERS.md rule 1 says. agy's work is 2 commits, 6 files, +160/-21:
- da585b99 tour: show 'Next screen' after the last feature on each page
- 72c467d0 welcome: diagonal 'Welcome to' lead-in, short-screen links, owner questions

Nothing outside the job is touched. There is no money, escrow, auth or dispute code. The new strings carry COPY-UNSIGNED (WelcomeScreen.tsx:29-31). I took screenshots at 390x844, 466x678 and 1280x800 (reduced motion).

## Findings

**B1. The branch reverses three recorded design/lead calls without raising them as questions.**
- WelcomeScreen.tsx:9-13: the old comment said the letter intro is what "the lead ruled replaces the owner's diagonal 'Welcome to' (12 Nov)". agy rewrote that comment, so the record of the ruling is gone, and put the diagonal back on top of the letter intro.
- engine.ts:11-12,129: design tour-stops.md:91 says that in the story flow "'Next screen' is not used". agy turned it on for the trader tour.
- welcome.css:130-166: design tour-motion.md §2 item 6 says the four links show only on screens at least 760 px tall. agy now shows them on every height.

Each change matches the owner's own words in note #47 ("Welcome to" diagonal; "the next button will change to next screen"; "same with links"), and claude3's order said "close the gap to the note". So the work is defensible. But these are changes a user would notice, and they overturn a lead ruling. The 17:38 rule says such changes go into docs/agy-owner-questions.md, and merging needs a yes from the lead or the owner.

Fix:
- Add the three items to docs/agy-owner-questions.md: what the note says, what design or the lead ruled, and what the branch does.
- Restore one line in the WelcomeScreen.tsx comment saying the lead had ruled the other way and that this branch reverses it pending the owner's answer.
- No code change is needed unless the owner says no.

**M1. Short screens get smaller text** (welcome.css:142-160). Under 760 px tall, the heading drops from 30 to 26 px and the line from 17 to 15 px. The owner keeps asking for bigger fonts (16 Nov fonts note; Job 8). This is a visible choice. Either shrink the hero instead and keep the text sizes, or ask the owner.

**M2. The lead-in does not yet read like the note.** From the screenshots:
- "Welcome to" in the hero and then "Welcome to X2F" right under it puts the same words on screen twice. agy raised this well as Q2.
- The lead-in is a static label tilted 8° in the corner. It does not run down-right into the logo.
- design front.md:61 specifies a diagonal slide-in (420 ms, from (-24,-9) px, opacity 0). That slide-in is not built.
- The new 36 px top padding on the hero (welcome.css:25) makes the logo smaller, and the owner asked for a large one. At 1280x800 the logo is about 110 px wide.
- At 466x678 the word "to" sits about 20 px from the X.

**M3. One test checks source text, not behaviour** (test/tour.test.tsx, the "keeps the help and settings links visible" case). It regexes welcome.css for `max-height: 759px` and the absence of `display: none`. The e2e at 466x678 already checks the real layout. Drop this case or replace it with a check of the rendered layout.

**M4. Shared file name** (docs/agy-owner-questions.md). Every agy branch is told to write to this same path. When two branches merge, Git will report an add/add conflict. Use a section per job, or one file per job, e.g. docs/agy-owner-questions-landing.md.

(claude2's in-progress file had scope only, no findings yet; the findings above are claude3's.)

Good: the engine change is small and clean (nextLabel collapses to one rule). The unit test now pins the exact page-end stops (5, 10, 12, 14, 16). The e2e checks that the links are visible and 44 px on the folded 466x678 screen with no sideways scroll. The three owner questions agy wrote (tour vs "Take the tour", the doubled heading, where Support goes) are well framed.

## Checks (claude3, detached worktree at 72c467d0)

- typecheck: ok
- copy-lint: clean
- separation-check: ok
- vitest apps/web: 2218 passed, 1 failed. The failure is serve-boards.test.ts capture-refs (BuyMain/Main reference shots are stale). It fails the same way on every branch cut from third-demo-r3, so it is not agy's.
- Playwright e2e/tour.spec.ts: 13/13

## How agy compares

The code is tidy and well tested, and it stays in scope. The weak spot is the judgment boundary: agy followed the note literally over a recorded ruling and edited the record instead of raising it. That is below our standard on process, and about at our standard on code.
