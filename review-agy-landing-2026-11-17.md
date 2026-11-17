VERDICT: APPROVE WITH MINORS (merge still needs the lead's or owner's yes on R1-R3, as agy's questions doc now asks)

# Re-review: wip/agy-landing a1015461 (agy Job 3, owner note #47)

Reviewer: claude3, 17 Nov 2026. Old review: review-agy-landing-2026-11-16.md (head 72c467d0).

New since 72c467d0: one commit, a1015461 "welcome(tour): record lead reversals in questions doc, revert short-screen font reduction, replace source-regex test (review B1, M1, M3, M4)". 5 files: WelcomeScreen.tsx (comment), welcome.css, engine.ts (comment), test/tour.test.tsx, docs/agy-owner-questions.md renamed to docs/agy-owner-questions-landing.md and extended.

Forbidden areas: the full branch diff against its merge-base (third-demo-r3 1fa6bed1) touches only apps/web welcome/tour files, their tests and the questions doc. No apps/api, packages/escrow, packages/auth-client, money, escrow, auth, dispute, lien, fee or payout code.

## Old findings

- **B1 (reversals not raised): FIXED.** docs/agy-owner-questions-landing.md Part 1 has R1 (diagonal "Welcome to" vs the lead's letter-intro ruling), R2 ("Next screen" vs tour-stops.md:91) and R3 (links under 760 px vs tour-motion.md §2), each with what the note says, what was ruled and what the branch does. WelcomeScreen.tsx:15-17 restores the record of the lead's 12 Nov ruling and says this branch reverses it pending the owner; engine.ts:12-14 does the same for tour-stops.md:91. Merge still waits on a lead/owner yes.
- **M1 (smaller text on short screens): FIXED.** The 26/32 and 15/20 px overrides are gone (welcome.css:152); the text keeps its full size and the choice is raised as Part 2 Q1.
- **M2 (lead-in does not read like the note): ANSWERED as an owner question** (Part 2 Q2: slide-in animation and the doubled "Welcome to"). Acceptable, since both are visible design choices. Not covered: the 36 px top padding / logo size point (see N1).
- **M3 (test regexes the CSS): FIXED.** The source-text case is removed; the folded 466x678 e2e case (e2e/tour.spec.ts:244) checks the real layout. The note at tour.test.tsx:132 says so.
- **M4 (shared file name): FIXED.** Renamed to docs/agy-owner-questions-landing.md.

## New findings

**M1. R1 overstates what the branch does** (docs/agy-owner-questions-landing.md:12). It says the lead-in is "moving down-right into the centered logo". It is a static label tilted 8° in the corner; the slide-in is not built (Part 2 Q2 says so correctly). Fix: in R1 write "a static 'Welcome to' label tilted 8° in the hero's top-left corner (the front.md:61 slide-in is not built; see Q2)", so the owner answers about what he will actually see.

**M2. The logo-size point from old M2 is not raised** (welcome.css:25, `padding: 36px 20px 14px`). The owner asked for a large logo; the extra top padding makes it about 110 px wide at 1280x800. Fix: add one line to Part 2 Q2 (or a new Q): "the hero's 36 px top padding makes room for the lead-in and shrinks the logo; keep, or larger logo?" No code change until he answers.

## Checks (claude3, fresh detached worktree at a1015461, npm ci, Node 24.22.1)

- typecheck: ok
- copy-lint: clean
- separation-check: ok
- vitest (touched): test/tour.test.tsx: 21/21
- Playwright e2e/tour.spec.ts: 13/13

## Summary

All five old findings are fixed or properly raised. The two new items are wording in the questions doc. Code is unchanged apart from removing the font shrink.
