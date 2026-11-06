# Review: wip/lead-docs-owner-1029 @f69c2a5 (base 0e92cb6), docs only

Reviewer: helper (read-only), 2026-10-29.
Source of truth: `~/x2f-comms/owner-answers-2026-10-28.md` (113 lines, including the lead calls written at 05:45, after the branch's last commit at 05:44).

## Verdict: APPROVED WITH MINOR

All owner answers are in the spec, the plans, HANDOFF and R36–R38. Quoted owner wording is exact: the buyer warning, the thank-you text, the ban notice, the appeal notice and the "leave feedback" line. No Important findings. The minors below are cleanups. M1 is the one to do before or right after merging.

## Checks

1. **Every owner answer is there.** Q1 (30 days / 90 days from the dispute button / no early delete), the 48 h rule (goal 24 h), Q3 (no stub, revenue ledger, second tier later, revenue ideas, running totals marked as waiting for the owner), Q4, Q5, permanent reviews and review disputes, Q6 (push, alarm, custom sound, Jabber only, News, "don't show again" undecided), Q7, Q8 (bans and blocks), Q9, Q10, Q11 (lawyer), Q12, Q13, Q14 (flexible offers, 2 per side per currency, 20 in total, the limit popup), Q15, Q16, feedback (link on every popup, anonymous option), the warnings, battery, refund reasons, appeals, lien and repayment trade, the conflict-of-interest rule, and lead decisions 1–7. All are recorded.
2. **Old text that still contradicts:** see M2–M4. Most old text now sits under a later "Revision 2026-10-29" note that wins (Plan 3 l.1030/1043, Plan 5 l.752–754, Plan 4 l.1094–1112, Plan 6 l.1110–1111/1135).
3. **Task IDs:** no clashes. Plan 3 adds Tasks 34–38 (old max 33). Plan 4 adds 24–32 (old max 23). Plan 5 adds 19–21 (old max 18). Plan 7 adds 16–18 (old max 15; Task 7 is struck through, not reused). The main line's coordination.md at eb34dad claims none of these numbers. The repeated "Task 7/8/19/31" headings in Plan 3 are the old revision headings, not new tasks.
4. **Merge with the main line:** `git merge-tree --write-tree eb34dad f69c2a5` gives a clean tree (ae2a612), with no conflicts. The main line changed only `docs/coordination.md` (+12) and `docs/dev-setup.md` (1 line) since 0e92cb6; the branch touches neither. No worktree was needed. `~/x2f-worktrees/rv-docs` was never created.
5. **Style:** plain and short, matching the rest of the docs. Two places run long: the Appeals bullet in spec 2.3 (spec l.154) and spec 11.1 item 1. Item 1 was already long before this branch.

## Minor findings

**M1. The lead calls in the source file are not applied (the file was written after the branch).** The branch still says "Open" where the lead has now decided:
- `docs/superpowers/plans/2026-10-15-plan-4-staff.md:55` and `:1127`: A1 "Open, not decided here". The lead dropped A1: coins move at the ruling. If this is not fixed, the Task 13 gate rule at plan-4 l.785 (pay out only after `appealWindowH`) stays live. A Task 24 or Task 13 worker would then build a 72-hour payout hold, which goes against the 48 h rule and the lien model.
- `plan-4-staff.md:1124`: "Open: what the trader is told while it waits, and whether the 48-hour rule applies to appeals". Decided: the trader is told it is waiting for an independent reviewer, and appeals aim for 48 h. Task 24 (l.1151) should add the trader message and test it.
- `plan-4-staff.md:1204` and `:1211`: `moderator_contact_url` is "Telegram or Matrix". The lead's call is Matrix preferred (no phone number). Spec l.437 says the same and needs the same change.
- `docs/superpowers/plans/2026-10-24-plan-5-reputation.md:766`: "Open … Proposed: keep the last 20 action durations". Decided: keep them.
- Plan 3 l.335/1052 already match the lead call on caps (3/20 until Task 34). Nothing to do there.

**M2. The roadmap was not updated and still contradicts the answers.** `docs/superpowers/plans/2026-10-15-roadmap.md:13` (Plan 7 row: self-delete 1 h/1 d/1 w/1 m, whole trade 1 w/1 m), `:20` ("Self-delete settings | Plan 7 Tasks 1–4"), `:21` ("Encrypted alerts (Nostr, PGP email) … D23 mail route"). The branch does not touch this file. Plan 7 Task 15 Step 3 updates it only at the end of Plan 7. A reader starting from the roadmap gets the old features.

**M3. Old numbers in task bodies have no pointer to the new revision.** Plan 3 put short "Revision 2026-10-29" pointers under Tasks 4, 6, 25 and 27. These bodies have none, so a worker who reads only their own task sees the old rule:
- `plan-4-staff.md:237` `RULING_DEADLINE_H = 24` (Task 2); `:528` `appeal_window_h … default 48` (Task 8); `:1109–1112` `DISPUTE_KEEP_DAYS` 30 after close, and tests about a "bare record" (Task 23).
- `plan-5-reputation.md:617` and `:625` (Task 14 `purgeProofs`: 90 days after close; 30 days after the dispute closes).
- `plan-3-trading.md:734` and `:743` (Task 20 `purgeChats`: 90 days).
Fix: one line under each task, as Plan 3 already does.

**M4. HANDOFF self-delete sub-bullets are not struck through.** `HANDOFF.md:197` strikes the heading only. Lines 198–201 (1 hour/1 day/1 week/1 month, "deletes the whole trade 1 week or 1 month", "all trades auto-delete after 90 days") still read as live rules.

**M5. Rules the owner did not give (lead additions, not marked as assumptions).** All are sensible. Each should be marked "lead default, owner to confirm" or put in the assumptions lists:
- `plan-3-trading.md:1143`: a blocker also can't take the blocked person's offers. `:1142`: the profile answers 404 to the blocked person. `:1147`: staff see blocks only in a dispute between the two. The owner listed offers, takes, messages and online status only.
- `plan-7-…-public-site.md:48` (P7-A12) and `:150`: account deletion is also refused during an appeal window, a lien or the dispute-after-refund window. The owner said "blocked while a trade or dispute is open". The lien case is clearly in his spirit; the other two are additions. The P7 gap table (l.~427) quotes only the owner's version.
- `plan-4-staff.md:1173`: the repayment trade has "no X2F fee". The owner did not say this. It is the same open question as "1% fee on dispute payouts", which the lead has asked the owner.
- `plan-3-trading.md:1085`: `minTrades: 0|5|10|50` narrows the owner's "buyer must have X completed trades" to four values.
- `plan-3-trading.md:1165–1168`: the warnings show "once per trade". The owner said "before major actions" and gave no frequency.
- `docs/superpowers/rulings-and-lessons.md:106` (R37) and `plan-4-staff.md:1124`: "involved" is any activity-log entry (assigned, opened the case or chat, asked for a proof). The owner said "decided, assisted, or commented". This is stricter and carries over the old A4's "no log entry". It is fine, but say it is the lead's reading of "assisted".

**M6. Retention exceptions vs R36 and the Privacy copy.** R36 (`rulings-and-lessons.md:105`) says nothing may "keep it longer". Yet `plan-4-staff.md:1133` keeps a dispute still open at day 90 "until it closes", with an appeal or lien named as reasons. A lien is an account record, so it should not keep the trade (Task 25 l.1171 says so too). `plan-7-…:85` keeps a refunded trade until `refundDisputeWindowEndsAt`. The Privacy copy at `plan-7-…:133` then promises "Nobody can delete a trade early or keep it longer, not even X2F". Once the dispute-after-refund question is answered, line these up: either R36 names the automatic exceptions, or the copy drops "or keep it longer". Also remove "or a lien" from plan-4 l.1133.

**M7. Small wording slips.**
- `plan-7-…:359`: "Task 3 needs Task 2's `deleteAt`". `deleteAt` comes from Task 1's `tradeDeleteAt` and is exposed by Task 3 itself (l.~129). It should read "Task 1".
- `plan-3-trading.md:1068`: "`appeal_until` = ruling time + 72 hours". `plan-4-staff.md:1149`: "`appealEndsAt` = publish time + `appeal_window_h`". Use one name and one anchor. The owner said "computed from the decision".
- The spec Revision (l.13) says running totals include "lost disputes". That is a lead addition, used for the Clean record badge (Plan 5 l.765). Fine, but the owner's pending item was only "ratings/completed counts".

## Not findings (checked)
- Old Nostr, email, self-delete and stage-drop text in Plan 3 l.1030/1043, Plan 5 l.752–754, Plan 6 l.1110–1111/1135 and Plan 4 l.1094 sits under a later 2026-10-29 revision that supersedes it by name.
- Spec 5.1 keeps "stars from 1 to 5" next to the owner note "1–5 or 1–10, not decided". That is acceptable.
- The labelled defaults (`TICKET_KEEP_DAYS` 90, `NAME_REUSE_DAYS` 90, alarm 80% and 1 MiB, the example badge names) are all marked owner-to-decide or `// COPY-UNSIGNED`.
