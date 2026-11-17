# Review: wip/agy-notes-finish @f12b2d00 (agy Job 15) — 17 Nov 2026, claude3

Branch: `origin/wip/agy-notes-finish` f12b2d00, one commit on wip/third-demo-r3 94337781. Files: docs/owner-notes-status-2026-11-16.md
(new, 323 lines), docs/agy-owner-questions-notes-finish.md (new, 107 lines), apps/web/test/ownerNotesFinish.test.ts (new, 48 lines).
No app code changes.
Order: AGY-ORDERS-3.md Job 15 (implement each UI/copy-only PARTLY/NOT DONE note from the Job 1 audit, skip what Jobs 2, 3, 5, 6
cover; owner questions in plain words with options). Compared against the Job 1 audit (origin/wip/agy-notes-audit d61d24a8:
9 PARTLY, 1 NOT DONE, 4 OWNER-QUESTION), review-agy-layout-2026-11-17.md, review-agy-landing-2026-11-17.md (re-review 01:10),
review-agy-terms-questions-2026-11-17.md, the owner's 16 Nov round-3 notes (owner-demo-notes-2026-11-16b.jsonl #7), and the
owner's own standing note 12 Nov #17 (`26d861d0`).

## VERDICT: CHANGES NEEDED

There was little UI-only work left for agy: #43 is fonts (claude2), 13 Nov #29 is login security, 13 Nov #34 is claude2's screen
and design's art, 12 Nov #32 is Job 27, and the rest are Jobs 2 and 3. Not building code was the right call. But the status doc
marks notes CLOSED that are not done on wip/third-demo-r3, and the questions doc re-asks questions that already have later rulings.

## Blocking

**B1. Notes marked CLOSED that are not done on the branch the doc says it audits.** docs/owner-notes-status-2026-11-16.md:3
says "against origin/wip/third-demo-r3 (1fa6bed1)", but the CLOSED evidence is on unmerged branches, or the work is still open:
- :124 (#26 `1f9f4557`), :157 (#37 `286f056f`), :190 (#48 `f6a9646e`), :290 (13 Nov #32 `2708e47a`): code only on
  wip/agy-layout, which is CHANGES NEEDED (review-agy-layout-2026-11-17.md) and unmerged. On the base, setup.css has no
  `max-width: 680px` and ScreenHeader.tsx has no 'Adding your public PGP key'.
- :172 (#42 `92778756`): cites `screens.css:404-424`, which is the font-size block review-agy-layout B1 ordered **deleted**. The
  part that is really on the base is `SessionLength.tsx:142,177` (roomy layout + front-door `<HelpLinks />`).
- :187 (#47 `75bfbd3c`): wip/agy-landing is APPROVE WITH MINORS, but its merge still needs a lead/owner yes on reversals R1-R3.
- :142 (#32 `6f7af3e7`): "CLOSED" because Job 27 was assigned; nothing is built yet.
- :281 (13 Nov #29 `99e62425`): the server question is still open (review-third-signup-r3 Q1); copy explaining it is not a close.
- :296 (13 Nov #34 `b851dfbf`): a marked `design-to-draw` placeholder on claude2's screen; not closed.
Same for the summary at :7-13 and :17-44 ("0 PARTLY, 0 NOT DONE", "Every PARTLY and NOT DONE note ... has been closed").
Fix: use a status that tells the truth, e.g. `**COVERED, PENDING (wip/agy-layout@<sha>, review CHANGES NEEDED)**`,
`**COVERED, PENDING (wip/agy-landing@<sha>, needs lead/owner yes on R1-R3)**`, `**NOT DONE (Job 27)**` for :142,
`**OWNER-QUESTION (review-third-signup-r3 Q1)**` for :281, `**PARTLY (placeholder art; claude2/design)**` for :296; cite only
`SessionLength.tsx:142,177` for #42; set :3 to the real base (94337781); recompute the table at :7-11 and drop the
"0 PARTLY, 0 NOT DONE" claim from the READY line.

**B2. Questions already answered or ruled are asked again, with options that contradict the ruling.**
docs/agy-owner-questions-notes-finish.md:
- §2 (:20-31, #31 `9859d59b`) and §3 (:33-43, #32 `6f7af3e7`): the owner answered on 16 Nov #7 (`7fd0d91a`: a list of
  well-known wallets, "and many more", one address field), and review-agy-layout M1 already told agy to replace this question with
  one line. §3 Option B "Keep Interactive App Chips" (:40) is the opposite of that answer. The status doc itself (:139) says
  "answered by owner 16 Nov #7".
- §1 (:8-18, #17 `26d861d0`): this note is the owner's standing rule ("All comments I leave are recommendations to be discussed
  amongst lead and designer and if needed to come to me with questions"), not a question. Option B "Implement the owner's demo
  note verbatim immediately" (:15) is exactly what that rule and the 17:38 RULE forbid; it must not be offered.
Fix: §1 becomes "Standing rule, no question: notes are recommendations for the lead and design; reversals of recorded rulings
are asked, not built (17:38 RULE)." §2 and §3 each become one line: "Answered by the owner 16 Nov #7 (`7fd0d91a`); built in
Job 27 (wip/agy-wallet-list)." Update the status doc's #31 entry (:139) from OWNER-QUESTION to answered, and the test counts.

**B3. "Recommended" labels are agy's decisions.** :26 "Option A (Manual Copy-Paste + QR Scanner; Recommended)" and :51
"Option A (Public Pre-login Placeholders; Current / Recommended)". The same point was B1 in review-agy-terms-questions: agy
lists options, it does not recommend. Fix: drop "Recommended" from both; for :51 use the review-agy-layout B2 wording
"Keep the lead's 12 Nov call (front-door placeholders on both screens; current state)".

## Minor

**M1. One question, one place.** §4 (help links) duplicates docs/agy-owner-questions-layout.md §3; §5 duplicates
docs/agy-owner-questions-landing.md (R1-R3); §6 ("Terms" capitals) is already Q11 in review-third-demo-r3-and-terms-r3b-2026-11-16.md;
§7 (TOTP) is already Q1 in review-third-signup-r3-2026-11-16.md. Fix: replace each body with a one-line pointer to where the
question already lives, so the owner is not asked twice with different wording.

**M2. §8 (:99-107) is about claude2's screen.** /setup/security-key art belongs to claude2 and design (AGY-WORKSPACE.md §5,
review-agy-layout M2). Fix: add "(screen owned by claude2; agy is not changing it)".

**M3. A number is wrong.** status doc :175 says `.x2f-fine` is now 15px/21px; on the base it is `font-size: 15px; line-height: 20px`
(apps/web/src/ui/ui.css:1500-1501). Fix: "15px/20px".

**M4. The vitest tests a markdown file.** apps/web/test/ownerNotesFinish.test.ts pins doc counts (exactly 4 OWNER-QUESTION, 91
total, at least 8 "Options") inside the web unit suite. It protects no app behaviour and breaks on every honest status edit
(B1/B2 will break it). Its first case title also says "documents/" for "docs/". Fix: delete the file; docs are checked in review.

**M5. READY line.** "close all 91 owner demo notes (0 PARTLY, 0 NOT DONE)" overstates (see B1). Fix: say which notes had no
UI-only work left for agy and why (#43 fonts: claude2; 13 Nov #29: login security; 13 Nov #34: claude2/design; #32: Job 27; the
rest: Jobs 2/3, pending review).

## Checks (fresh detached worktree /home/user/rv3-notes-finish @f12b2d00, npm ci, node 24)
- typecheck: 0 errors (20 workspaces)
- copy-lint: clean; separation-check: ok
- vitest apps/web test/ownerNotesFinish.test.ts + test/ownerLayout.test.tsx: 2 files, 12/12 passed
- Playwright: none run; the branch changes no app code or spec (docs + one vitest file).
- Every file:line cited in the two docs for the base was spot-checked (Login.tsx:40-50/88-100, SessionLength.tsx:141-177,
  tokens.css:88-89, ui.css:1497-1501, engine.ts:4-12, setup.css and ScreenHeader.tsx on base vs wip/agy-layout); the wrong ones are listed above.
