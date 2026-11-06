# Review: origin/wip/lead-docs-design-1029 @207087c (base 990affe), docs only

Reviewer: helper (read-only). Date 2026-10-29. Main line checked: origin/claude/compassionate-johnson-k95ssr @047b4f3.

## Verdict: CHANGES REQUIRED (2 Important, 8 Minor)

Checks:
- (3) Task IDs: no collision. Plan 2 ends at Task 15, new 16-17; Plan 3 ends at Task 38, new 39-41. The main line @047b4f3 has no Task 39-41 or Plan 2 Task 16-17 anywhere in docs/.
- (4) `git merge-tree --write-tree 047b4f3 207087c` is clean (tree a8cf924, exit 0).
- (1) Most owner answers are faithful: seller can't cancel after Fund escrow; two-step I've paid with the owner's question; at least two factors = no wait, single weak way = 24 h; new-device approval from the logged-in device; 3 devices and "One device at a time" marked "not contested"; bans with a general reason and end date; silent block; anonymous reviews and immediate "Under review"; the News bell; My offers select/Select all; burned names; lead calls (Task 5 price lock, Starter cap, blocked take, anonymous feedback, R38). Lead defaults are labelled (weak = password/TOTP, approval expiry, wrong number = block, 4th device refused, staff exempt, review month/year, Under-review reviews not counted, ban reason list, fund-started). OPEN is marked for: buyer cancel A/B, team members, recovery code alone, training copies, stars, staff pay (Plan 4).

## Important

I1. "No logged-in device" is presented as decided in the spec, but it must be OPEN.
- docs/superpowers/specs/2026-10-14-x2f-design.md:29 (end of the "A new device must be approved" bullet): "If no logged-in device is available (for example the only one was lost), the backup-login rule above applies." This is stated as a rule.
- docs/superpowers/specs/2026-10-14-x2f-design.md:464 (6.3): "With no logged-in device, the backup-login rule applies." Also stated as a rule.
- HANDOFF.md:233 and plan-2-accounts.md:96 say OPEN (design, not confirmed), and Plan 2 says "until then a login with no logged-in device works as today". The spec wins over the plan (Plan 2's own authority line), so an implementer who reads the spec will build the 24 h wait for a password-only trader on a new phone, which is the case Plan 2 warns about.
- Fix: mark both spec lines OPEN and say "works as today until decided", as Plan 2 does.

I2. The branch missed the design's final owner answers, and it settles the 72 h / 48 h appeal window against them.
- The design branch added "Remaining open questions, answered (owner, 2026-10-29)" at 48fc80d (15:37 UTC) and b0190d5 (15:46 UTC). The docs head 207087c is from 15:43 UTC. That section reports owner answers that this branch still lists as open, or decides the other way:
  - Appeal window **48 hours**: "The brief's 72 h is dropped, and DisputeRuling and StaffSettings stay at 48."
  - Stars 1-5 only. The 6-month training copy dropped. Dispute records kept 90 days for training, auto-blurred.
  - Review disputes: free text only, with no reason list. Flexible offers: percent only, and a method out of range shows greyed, never hidden.
  - Site ban: the user gets in only while something is unfinished. Maintenance: planned and emergency versions. Jabber: OMEMO only, with the fingerprint shown, the three apps, and the battery tip on Android only. Deleted accounts: records kept to their normal delete date.
- The branch says the opposite on the appeal window:
  - spec:78 "72-hour appeal versus 48 hours on DisputeRuling: not a conflict ... The DisputeRuling board's appeal line must say 72 hours (design fix)."
  - plan-4-staff.md:1327 says the same.
  - HANDOFF.md:241 "Brief versus spec, resolved".
  - spec:96 and plan-4:1335 say "(the appeal window is 72 hours, so this needs correcting)".
- The owner's recorded words (owner-answers-2026-10-28.md:92-94) say 72 h, and owner words win over a design summary. But now the two sources really conflict. Writing "not a conflict" and telling the design to change its board hides that from the lead and owner.
- The "Still open with the owner (from the design ...)" lists also describe these items as unanswered questions, which is no longer true of the source: spec:85-94, HANDOFF.md:242, plan-7:395-397, plan-4:1324 (Wallets during a site ban), plan-4:1334 (maintenance) and plan-5:850 (dispute reasons).
- Fix:
  - Re-read the design docs at b0190d5.
  - Record the appeal window as a source conflict for the lead or owner (owner words of 10-28: 72 h; the design reports the owner chose 48 h on 10-29).
  - Relabel the other items "design reports owner answer X; not in the owner's recorded words; lead to confirm" (the same treatment staff pay already gets). They can stay OPEN, as the brief asks.

## Minor

M1. Stale text that contradicts the new cancel rules:
- plan-3-trading.md:182 (global constraints): "Who may cancel after funding: the buyer alone at any time ..." There is no 2026-10-29b note, and it contradicts "no cancel after I've paid".
- plan-3-trading.md:822 (Task 23 test): "The post-paid cancel shows the warning first and does nothing until confirmed." Line 814 above it is struck through, but this test line is not.
- Plan 3 Task 10 (plan-3:509) signs a buyer `trade.cancel` from any state. Task 39 changes only the API machine and the web app, not the moderation guard. Under option B the "no cancel after I've paid" rule then holds only at the API, while the mod service co-signs from its own signals. Task 39 Step 0 (option B) should add: the mod refuses a buyer cancel once it holds a valid `trade.paid` (as plan-3:515 already does for the auto-refund).

M2. HANDOFF.md:224 still lists "News 'don't show again'" under **Undecided**. It is settled (HANDOFF:237, spec:46).

M3. Weak-login details are labelled "Lead default" (spec:27, HANDOFF:232, plan-2:91), not OPEN, but the brief lists them as OPEN. The label is honest, but add "OPEN" so the owner sees it. Also, plan-2-accounts.md:93 calls what the cooling-off blocks "the design's rule, not contested". The owner's rule explicitly replaced the design's point 4, so this is a lead default, not uncontested (spec:27 already files it under the lead default).

M4. "Cancelled only once the return has all confirmations" comes from the owner's description of **option B** (owner-answers:118). The branch states it for both options and attributes it to A as "Claude Design's version" (spec:15 "official once the XMR is back with all confirmations"; plan-3:1183 "Both options"). It is also built in Task 39's "decided" steps (plan-3:1211, `returnConfirmations`, Step 1). The design summary does not say it for A. Label it a lead default for A.

M5. Staff pay: plan-4:1335 says OPEN, but spec:96 and HANDOFF:242 only say "lead confirms / lead to confirm". Use the word OPEN there too, as the brief asks.

M6. Reviews:
- plan-5:842 names the column `reviewer_account_id`, but Task 3's table (plan-5:266) calls it `reviewer_id`.
- The lead default "date as month and year only" (plan-5:841) is not carried to P5-A10 (plan-5:76, "2 days ago", "3 weeks ago") or `PublicReview.age` (plan-5:276). These are different rules, and the in-place lines win for an implementer reading Task 5.
- plan-7:150 "keep reviews by and about the account with the name shown as 'Deleted user'": a review *by* someone shows no name now, so drop "by".

M7. spec:18 "The link's name follows the choice" (it stays "Cancel trade" under B) is a lead inference. The design renamed it regardless, and the owner said nothing about it. Label it a lead default.

M8. Style: plain and mostly short. The spec revision block (spec:5-97, about 90 lines) repeats most of its content in the in-place edits (for example the I've-paid sheet is written out in full at spec:13-22 and again at 2.2 step 7). This is acceptable, but a pointer would be shorter.

## Not findings (checked)
- Other grep checks: buyer cancel alone (only inside struck or OPEN text), "Cancel trade" (only the A/B text), old backup hold (plan-6:179/814 is the D18 security-key mode, consistent), unlimited devices (none), reviews with reviewer or trade code (only P5's internal columns, nulled at purge), News without a bell (Plan 4 Task 28 is revised; spec:147 emergency text is fine).
- No buyer-cancel conflict in `refund_requested`: that state is reached only when unpaid (plan-3:264), so the cancel there is still before "I've paid".
