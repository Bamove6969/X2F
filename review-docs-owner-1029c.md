# Review: origin/wip/lead-docs-owner-1029c @fa9a250 (base 6b4c590), docs only

Reviewer: helper (read-only). Date 2026-10-29. Main line: origin/claude/compassionate-johnson-k95ssr @6b4c590 (= base).
Source of truth: the OWNER lines at the end of ~/x2f-comms/owner-answers-2026-10-28.md, from "OWNER 12:30 BUYER CANCEL = B with a seller confirm" through "OWNER 13:45 FEE OWED".

## Verdict: CHANGES REQUIRED (1 Important, 6 Minor)

- **Merge:** `git merge-tree --write-tree 6b4c590 fa9a250` is clean (tree f54917d).
- **IDs:** none collide.
  - Plan 2 already ends at Task 17 (rewritten here); new Task 18 is at plan-2:720.
  - Plan 3 new Task 42 is at plan-3:1288 (the last was 41).
  - Plan 4 new Task 33 is at plan-4:1354 (the last was 32).
  - R39-R44 are at rulings:110-115 (the last was R38).
- **72 h:** no 72 h appeal remains.
  - Every hit is struck through or historical: spec:17, spec:153, plan-3:1205, plan-3:1280, plan-4:1329, HANDOFF:242.
  - spec:312 and spec:600 now say 48.
  - plan-4:535 "first response 1–72 h" and plan-6:1055 "monitoring 72 hours" are other rules.
- **Faithful to the owner:**
  - B with the seller's confirm, the greyed button, the 48 h auto-close and the "Your input is needed" notice.
  - A cancel can't be disputed; a wrongly sized refund can.
  - Appeal window 48 h.
  - Liens: immediate on restitution, suspended during an appeal, on whoever received the coins after an overturn.
  - Fees: the poster pays; cancels pay nothing; settled disputes pay; the fee owed is stated on the ruling and deducted from future trades.
  - Weak and strong logins as the owner listed them; the new phone with nothing to approve it waits.
  - Staff pay: clock-out only, senior per-dispute pay plus a large-trade %, the first-login screen, clawback option A from future pay.
  - Team members: at launch, up to 3, the Offers and Trades roles, the audit log, the exact chat label.
  - The owner's question about the tech note (the escrow key) is kept as OPEN.
- **Lead readings and defaults labelled** (the writer's 8):
  - Refund-dispute window: OPEN at spec:15, plan-3:1279, plan-7:402 and HANDOFF:256.
  - 24 h hold mechanics: partly labelled (see I1).
  - Restitution: labelled in plan-4 Task 25, not in the spec (m3).
  - Staff pay gaps: OPEN for abandoned shifts and the payroll wallet; the large-trade share is a lead reading (plan-4 Task 33).
  - Repayment-trade fee: OPEN (plan-4:1188).
  - Fee-owed mechanism: lead default (spec:29, plan-3:1281, plan-4:1349, R41).
  - Member escrow keys: OPEN (spec 6.7, plan-3 Task 42, R44).
  - Mutual-cancel confirmations: "Proposed by the docs pass, lead to confirm" (plan-3:1220).

## Important

**I1. The 24-hour hold's blocked actions and "a strong login ends the hold" are credited to the owner, but the owner never said them.**
- The owner's 13:23 lines say only these things:
  - Strong logins: no wait, never punished.
  - One weak way that changes the password or security waits 24 h.
  - A new phone with nothing to approve it, plus one weak way, waits 24 h.
  - The real owner finds a thief through the approval prompt, the alerts and the Devices list.
  - The owner agrees with the lead's proposals. Those proposals (owner-questions-open-2026-10-29.md item 3 a-c) cover only weak vs strong, a recovery code alone, and a new phone. They name nothing that is blocked during the hold and nothing that ends it.
- The branch states these as owner rules:
  - spec:35 "During the hold: no new trades, no payout-wallet changes, and no approving new logins or devices." spec:37 then says "(the owner named the three above)".
  - spec:38 "A strong login by the real owner ends the hold." (unlabelled)
  - plan-2:26 says "(the owner named only the three above)".
  - plan-2:27 "A strong login by the real owner ends the hold" (only the which-method detail is labelled).
  - HANDOFF:252 (the 24-hour hold bullet).
  - R42 (rulings:113) is binding for code and states the blocks and "A strong login by the real owner ends it" as owner rules.
- **Failure scenario:** a trader on a password alone changes their password. Under R42 the whole account (every session, every member) can't take a trade for 24 h. The owner's words only say that login "waits 24 h", which could mean the change waits, not a freeze of all trading. Implementers and reviewers will treat R42 as the owner's ruling and won't ask.
- **Fix:** label these as a lead reading or lead default (the three blocks come from the design's point 4 and the 29b lead defaults; "a strong login ends it" is a reading of "never punished"), in R42, spec:35-38, plan-2:26-27 and HANDOFF:252. Or confirm them with the owner and cite that.

## Minor

- **m1. Plan 2's 29b block (plan-2:91-96) adds "Decided 2026-10-29c" but keeps the old text after it, which now contradicts the decision:**
  - plan-2:91 still lists "PGP ... strong". 29c (plan-2:23, 29) says PGP alone is neither (a lead reading).
  - plan-2:92 still says "Task 17 keeps today's behaviour behind one constant (`RECOVERY_CODE_ALONE_WAITS = false`) until the lead or the owner decides". The constant is dropped.
  - plan-2:93 still says "(… so it is not settled)" and lists the old block set.
  - plan-2:96 still says "Not built until the lead or the owner confirms; until then … works as today".
  - Strike the leftover text, not just the marker.
- **m2. The auto-close anchor "48 hours after the button became available" is a lead reading.** The owner said "drops off within 48 hours". It is unlabelled at spec:13, R39 (rulings:110), plan-3:1220 and plan-3:1278, and in HANDOFF. Label it a lead reading (the other possible anchor is the buyer's cancel tap).
- **m3. spec:21 "Restitution means the ruling orders the loser to pay something the escrow can't pay …" is unlabelled** in the spec and in R40. plan-4 Task 25 labels it "lead reading of the owner's word, owner may change". Label it in the spec and R40 too.
- **m4. Task 39 Step 0 (plan-3:1220) adds a state `cancelling` and the events `confirm-cancel` (seller) and `cancel-timeout` (system), and Task 2's interfaces don't list them:**
  - `TradeState` (plan-3:249), `CLIENT_EVENTS` and `SYSTEM_EVENTS` (plan-3:252).
  - What happens to today's `settling`/`buyer-cancel` → `settled` → `refunded` path (plan-3:52, 265), and to `refund_reason 'buyer-cancel'`, now that a buyer cancel ends as `cancelled`.
  - The Task 2 and Task 6 implementer has no rule for `settled` arriving in `cancelling`. Name the type changes and the transition (for example: `settled` in `cancelling` keeps `cancelling` and sets `confirmCancelAvailableAt` at 10 confirmations).
- **m5. plan-4:696 Task 12 outcome option "`hold`: a hold until the appeal window closes" is not struck.** plan-4:1331/1347 say the lien replaces that ModCase option. Strike it or point it to Task 25.
- **m6. Profiles "Disputes: N won, M lost" and "the footer stays" are recorded as "(owner)"** at spec:49, HANDOFF:254, plan-3:1283 and plan-4:1352. The source line (owner-answers:145) says "owner leans to showing … (asked lead; lead recommends showing it and keeping the footer line)". Plan 5's revision words it accurately ("owner leans …, confirmed in the lead's brief"). Use that wording elsewhere, or record the owner's confirmation if there is one.

## Checked, not findings
- **Fee owed:**
  - dispute-buyer is unchanged.
  - dispute-seller with a poster seller is `[seller: balance − fee, fee]`.
  - dispute-seller with a poster buyer is `[seller: balance]`, and the poster owes. This is consistent with "always the poster" and the owner's example.
- **Owner text quoted exactly:** the ruling-screen sentence and the chat label match the owner's words.
- **Team members:** the after-launch-to-at-launch change follows the owner's 13:41 and 13:42 lines. The lead defaults (owner-only actions, two-factor members) are labelled.
- **Mod guard:** refusing a buyer cancel after `trade.paid` is now built into Task 39 Step 0 and R39.
