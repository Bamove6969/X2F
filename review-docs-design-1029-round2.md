# Re-review (round 2): origin/wip/lead-docs-design-1029 @76b88af (fix round on 207087c)

Reviewer: helper (read-only, docs only). Date 2026-10-29. Main line: origin/claude/compassionate-johnson-k95ssr @047b4f3.

## Verdict: APPROVED WITH MINOR (0 Important, 4 Minor)

- **Merge:** `git merge-tree --write-tree 047b4f3 76b88af` is clean (tree 46ab808, exit 0).
- **Task IDs:** no change since round 1, still no collision.

## Round-1 findings, checked

- **I1 fixed.**
  - spec:32 (revision) and spec:469 (6.3) now say OPEN, and "until it is decided, such a login works as today".
  - This matches Plan 2:96 and HANDOFF.
- **I2 fixed.**
  - The design's later answers are listed as "The design session reports that the owner answered these later" (spec:70-94, HANDOFF:241, plans 3/4/5/7).
  - Three OPEN conflicts are listed in spec:96-99, HANDOFF:242, plan-3:1202-1203, plan-4:1327-1328 and plan-7:393: the appeal window (48 vs 72 h), the dispute window after a trade (48 h vs question A) and who gets a lien.
  - The "not a conflict" and "must say 72 h (design fix)" lines are gone. Grep finds no "not a conflict" or "resolved" wording left.
- **M1 fixed.**
  - plan-3:182 has a 2026-10-29b note.
  - plan-3:822 is struck through.
  - Under option B the mod guard refuses a buyer cancel after a valid `trade.paid`, with a test (plan-3:1182, plan-3:1218 Step 0).
- **M2 fixed** (HANDOFF:224).
- **M3 fixed:** the weak ways and the cooling-off scope are now "OPEN, lead default" in spec:28-31, plan-2:91/93 and HANDOFF:232. The "not contested" wording is gone.
- **M4 fixed.**
  - spec:16-17 and plan-3:1182-1183 say: B is the owner's description; for A it is a lead default.
  - `returnConfirmations` moved out of the decided Steps 1-5 into Step 0.
- **M5 fixed:** staff pay is OPEN in spec:101, HANDOFF:243 and plan-4:1338.
- **M6 fixed.**
  - `reviewer_id` (plan-5:842).
  - Month-and-year ages in P5-A10 (plan-5:76) and `PublicReview` (plan-5:276).
  - plan-7:150: only reviews *about* a deleted account show "Deleted user".
- **M7 fixed:** spec:18 labels the link name a lead default.
- **M8 fixed:** the revision block is trimmed (about 97 lines, mostly bullets) and points to the in-place sections.

## Grep for the three conflicts presented as decided

- **Appeal window.** 72 h still stands, unmarked, in older in-place text: spec:116, spec:255, spec:542 (the 6.6 setting), HANDOFF:55, HANDOFF:216, plan-4:1138, plan-4:1150, plan-4:1162, plan-4:1170 and plan-3:1070.
  - These are the owner's own words to the lead, and the revision says "this list wins".
  - plan-3:1203 and plan-4:1327 say the setting stays and only its default waits.
  - Acceptable, but see m1.
- **Dispute window after a trade.** The 90-day lines (plan-3:119, 171, 911; plan-4:609) were already covered by the existing "Open (not decided here)" at plan-3:1062. The new OPEN conflict is at plan-3:1202 and plan-7:393. Nothing presents 48 h as decided.
- **Lien.**
  - spec:118, plan-4:1139 and plan-4:1172-1192 (Task 25) give the owner's rule: lien after a won appeal.
  - The conflict is OPEN at spec:99 and plan-4:1328. Nothing presents "whoever loses gets a lien" as decided.
  - The ModCase "hold until the appeal window closes" wording is flagged as waiting (plan-4:1329).

## Minor (new)

- **m1.** Add a short "(OPEN conflict 2026-10-29b: design reports 48 h)" tag to the main 72 h statements: spec:116, spec:255, spec:542, HANDOFF:216 and plan-4:1138. A reader who jumps straight to section 2.3 or 6.6, or to Plan 4 Task 24, sees 72 h as settled with nothing pointing to the conflict.
- **m2.** HANDOFF:218 still says "stars 1–5 or 1–10 to be decided". HANDOFF:224 and HANDOFF:241 now say 1–5.
- **m3.** spec:565 (Training library) still says "X2F makes an anonymized copy (Buyer and Seller instead of usernames; ...)" before the 2026-10-29b note that the copy is dropped.
  - Plan 4:1330 now says the record is *shown* through masking and not copied.
  - Strike "X2F makes an anonymized copy" or reword it to "shows the record masked".
- **m4.** plan-4:1147 still has the bold lead-in "**Open, not decided here: anonymized training copies.**", with "dropped" appended at the end. Strike the lead-in or reword it so the line doesn't say both.

## Note for the lead (not a finding)

The round-1 brief listed stars and training copies as items that must say OPEN. This round records them, and the other design-reported answers that don't conflict with the owner's words, as **decided**, labelled "design reports the owner's answer". That is a lead call. It is labelled consistently and the source is cited (@b0190d5). Check that it is intended before telling the owner.
