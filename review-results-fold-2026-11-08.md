# Independent review: design results and fold follow-ups, 8 Nov 2026

Read-only review against origin/main. No code changed, and no tests were run: there was no `npm ci` on this machine, and every finding below was checked by reading the code and running trial merges.

| Branch | Tip | Merge base with main | Ahead / behind main |
|---|---|---|---|
| origin/wip/lead-design-results | 6bd7c655 | 687ae821 | 61 ahead / 82 behind |
| origin/wip/second-fold-followups | 2855529d | cbf8e50e | 14 ahead / 120 behind |
| origin/main | 5c4c8773 | | |
| origin/wip/lead-trade-rules-p1 (for the merge check) | fde037d9 | | |

## Verdicts
- **lead-design-results: CHANGES REQUIRED.** Every item from the 6 Nov review is fixed (list below). Four Important problems remain: a wrong amount and a breach of the device-amount rule in the paid room, a 10-minute nudge line where the rule is 15, a seller dispute rule that goes against p9-4, and a timeline whose rows break the build once trade-rules-p1 lands. Its dispute-wait model also clashes with trade-rules-p1's. Someone has to pick one model before either branch lands.
- **second-fold-followups: CHANGES REQUIRED. Most of it is already superseded by main.** It doesn't merge with main (5 conflicts, one of them modify/delete). Main's Job 1 already does Q12 in the room, and does it differently. The branch's new `releasable` gate on the glance goes against main's lead default of 7 Nov. Land only the quote-pane fixes (m1, m2) and the m3 glance fallback, and take main's side everywhere else.

## Prior review (review-fold-results-lead-2026-11-06.md): status
- Results I1 (co-sign line): fixed. PaidWaiting.tsx:215-216 now reads "When they release, X goes to your wallet once your app co-signs. Keep this page open…", marked COPY-UNSIGNED.
- Results m1 (30 min): fixed. The header and the comments now say the wait comes from the server's `disputeOpensAt`. A search finds no stale "30 min" in the trade, dispute or test files.
- Results m2 (pausedAt): fixed. `roomClock` (PaidWaiting.tsx:58-62) stops both clocks at `pausedAt`.
- Results m3 (Refunded over-promise): reworded. Refunded.tsx:214 now says "a moderator can rule that they owe you…", COPY-UNSIGNED.
- Results m4 (TimerCard data-fold-glance): fixed. `glance="timer"` is set at PaidWaiting.tsx:130 and on the rule at :197.
- Fold I1 (glance warnings lost): fixed. TradeGlance.tsx:57 gates on `state === 'secured' && paidAt === null`, and a table test covers `releasable` true and false (fold.test.tsx).
- Fold m1 (m2 reopens after Back): fixed. OffersRoute's `forgetQuote` plus a fresh key clears the pane's quote on Back. It is skipped while a take is in flight.
- Fold Q12 room ask (no "Send exactly" card and no "I've paid" until releasable): done on the branch, but main's Job 1 has since done Q12 another way. PayWarning is deleted, the payment details show as a locked card, and `paySecured` reads the state, with a lead default that top-ups never lock paying again. See F-I1.

## lead-design-results findings

### R-I1 Important: the paid room states the buyer's payout from the API, and gets it wrong for a poster buyer
- PaidWaiting.tsx:106 builds `xmr` from `view.amountAtomic`, the API's trade amount. Step 2 at :216 then says "When they release, {xmr} goes to your wallet".
- Scenario: the buyer posted a buy ad (p10-1: "Poster buying XMR: the taker escrows the trade amount; the poster receives it less 1%"). They trade 1.250000 XMR, and the room promises 1.250000 when they will actually receive 1.237500.
- It also breaks the binding rule that screens show only the amount this device accepted (review 2026-10-27 I3; release/view.ts `amounts`; Released.tsx:19-35). A tampered API could put any figure in the buyer's "goes to your wallet" line. The "For" row at :239 has the same source.
- Fix: pass the escrow into PaidWaitingBody and use `amounts(view, escrow)?.buyerReceives` (release/view.ts). With no device amount, word it with no amount, as Released does. Add a test with `poster: 'buyer'` and the fee shown.

### R-I2 Important: "You can send another in 10 min" contradicts the 15-minute rule
- PaidWaiting.tsx:42 has `NUDGE_AGAIN_MS = 10 * MIN_MS`, and :358 shows it. The rule is one nudge per 15 minutes: owner F10, p6-1, and the server's `NUDGE_GAP_MS = 15 * 60_000` in apps/api/src/nudge/routes.ts on main and on trade-rules-p1.
- Scenario: the buyer nudges, waits the 10 minutes the screen gave them, taps again, and gets the "too soon" CantDoThat.
- Fix: 15 minutes, ideally one constant shared with the server value. Update the comment at :41 and the test that pins "10 min".

### R-I3 Important: the seller may dispute at once in `paid`, against p9-4, and the branch's wait model clashes with trade-rules-p1
- machine.ts:445-448 lets only the buyer wait, "the seller at once", and dispute/rules.ts:93 returns `open` for the seller in `paid`.
- Owner p9-4, 8 Nov, in his own words: "you would be required to wait a full 12 hours after the seller or buyer … has clicked paid". The other side waits the method's full time. trade-rules-p1 builds exactly that: either side waits until `confirmBy`, which is the method's window (90 min for instant types, ZELLE 90).
- This branch keeps two clocks instead: a buyer wait (`buyerDisputeWaitMin`, 90) below a longer seller window (`confirmWindowMin`, 120), stored in a new migration 118 with new view fields `disputeOpensAt` and `disputeWaitMin`.
- Scenario: a Zelle trade marked paid at 10:00. Here the seller can open a dispute at 10:00 and the buyer from 11:30. Under trade-rules-p1 neither side can before 11:30.
- Merge impact: results with trade-rules-p1 conflicts in 30 files, the machine, profiles, data, view, store, rules and SellerConfirm among them. Each side's tests encode its own model.
- Fix: decide one model before landing either branch. trade-rules-p1's single `confirmBy` follows p9-4 and is simpler. If it wins, drop migration 118 (or keep it only as a no-op), have PaidWaiting read `confirmBy` as the dispute moment, and keep this branch's extra profiles (Interac, SEPA Instant, PayPal and the rest) at p1's timings. The "soft link while the window runs" state (PaidWaiting.tsx:372) then never happens, and the code for it can go.

### R-I4 Important: the Refunded timeline shows the retired final alert, and the build breaks once trade-rules-p1 merges
- Refunded.tsx:121-125: for `auto-refund`, the timeline adds "{seller} cancelled" at `view.finalAlertAt` and "Your final alert ended" at `finalAlertAt + TIMERS.finalAlertMin`.
- Owner p6-1 (8 Nov, a reversal): there is no 15-minute final warning; the refund starts at once.
- trade-rules-p1 deletes `finalAlertAt` from the web TradeView and `finalAlertMin` from TIMERS. Refunded.tsx is touched only by this branch, so it auto-merges and then fails typecheck. Checked in the trial merge tree fe2f4f9b, Refunded.tsx:123-124.
- Fix: drop the "alert-ended" row. Date "{seller} cancelled" from when the refund settlement started (p1's `auto-refund` settling; it needs a view field such as `settlingSince`, or else leave the row out).

### Minor
- R-m1: a maintenance pause makes the confirm window read longer than it is. `confirmWindow` (PaidWaiting.tsx:45-52) takes `confirmBy − paidAt`, and `resume` has already moved `confirmBy` by the pause, so "Zelle gets 2 h 47 min", "up to 2 h 47 min" and the ring total all include the pause. Fix: use the profile's or the trade's window length, not the difference of the two times.
- R-m2: during maintenance the room still offers a dispute the machine refuses. Once the wait has passed before a pause, `open` (PaidWaiting.tsx:368) shows the dispute link, and the ended hero (:172) says "You can open a dispute now". But apply() refuses every event outside WHILE_PAUSED with `wrong-state` (machine.ts:480), and the owner's G19 says disputes pause. Fix: when `paused`, show the locked button with "Available after the maintenance".
- R-m3: the copy treats confirmBy as a release deadline: the "Time left to confirm" timer, "Paid · not confirmed in time" (:153), "Their 2 h to check Zelle ended" (:161). Owner p9-7 says there is no release time limit, and after p1 that moment is only when either side may dispute. This is DESIGN wording: send it to design with p9-7.
- R-m4: the SellerConfirm tip (SellerConfirm.tsx:372) still says "Instant apps like Zelle get 2 hours". That's right on this branch, but wrong once p1's 90 minutes lands. Fix it in the merge.
- R-m5: the gift-card profile (`OTHER_GIFT_CARD`, window 120, wait 90) doesn't reflect owner G50: "the person holding the escrow has 45 minutes to check a card". The validator (profiles.ts, `confirmWindowMin < 120` throws) can't express 45 minutes. This is a lead question for the owner, not a code fix yet.
- R-m6: there is a stale comment at BuyerPay.tsx:560-561 ("In paid the buyer's opens at confirmBy"). On this branch the wait comes from `disputeOpensAt`.

### Merge with main
- Two conflicts.
  - apps/web/src/screens/dispute/rules.ts: keep main's new `xmrInTextExact` and its `formatXmrExact` import, together with this branch's `DurationPart` and dates imports. Take this branch's UTC-only `clockTime` and `dayTime`; no caller on main passes a time zone.
  - apps/api/test/schema.test.ts: the migration lists need main's `113_release_claim` and `122_chat_retention_disputes` plus this branch's `118_buyer_dispute_from`.
- The branch's other 120 changed files auto-merge.

## second-fold-followups findings

### F-I1 Important: the glance's `releasable` gate contradicts main's lead default and hides the pay step while the time to pay runs
- TradeGlance.tsx:80 (branch): `'pay'` only when `state === 'secured' && releasable`.
- On main, `secured` already means 10 of 10 confirmations and unlocked: the machine moves `securing` to `secured` only when releasable (machine.ts:335). Main's lead default of 7 Nov (payModel.ts:146-158, `paySecured`) says later top-ups never lock paying again. So `secured && !releasable` happens only after a top-up. Main's room then keeps "Send this payment" and "I've paid" on, while `payBy` keeps running.
- Scenario: the seller sends a small top-up after `secured`. The branch's cover glance loses "Pay now" and "Time to pay" (the fold.test case "secured but still confirming"), while the room below says to pay.
- Fix: keep main's `glanceStep`, which has no `releasable`, or gate it on `paySecured(view)`. Drop the "secured but still confirming" glance tests. The I1 change to `glanceWarning` then equals main's own condition and can be dropped too.

### F-I2 Important: doesn't merge with main or with trade-rules-p1
- Trial merges against main, against trade-rules-p1 and against lead-design-results all conflict in the same five files:
  - apps/web/e2e/parity.ts
  - apps/web/e2e/pay.spec.ts
  - apps/web/src/screens/trade/BuyerPay.tsx
  - apps/web/src/screens/trade/PayWarning.tsx (deleted on main, modified here)
  - apps/web/test/buyerPay.test.tsx
- The READY note ("main cbf8e50e merged") is 120 commits stale.
- Fix: merge main again, and take main's side in all five files. PayWarning stays deleted, along with the branch's `confirming` gate in BuyerPay and its tests (main's Q12 tests cover the room). Keep OffersRoute.tsx, Quote.tsx, quoteKept.ts, the PayFacts fallback (m3), and the fold e2e and quote tests.

### Weakened tests
- pay.spec.ts (branch): the "Not yet" test no longer switches to PAY_SECURING or asserts `data-trade-state="securing"`. That is moot once PayWarning goes: it was a test of the removed sheet.
- Nothing else was weakened. On lead-design-results, the removed expectations were replaced:
  - the payment details in paid are now behind the "Your payment" toggle (buyerPay.test.tsx:253-259);
  - the old 3-per-market and 20-total offer caps gave way to the owner's 3 buy + 3 sell (F8);
  - the buyer's 119/120-minute dispute tests moved to the per-type wait.

## Merge summary
| Merge | Result |
|---|---|
| results into main | 2 conflicts: rules.ts and schema.test.ts. Mechanical. |
| fold into main | 5 conflicts. Take main's side, see F-I2. |
| results with trade-rules-p1 | 30 conflicts, plus a semantic build break in Refunded.tsx (R-I4). Choose one dispute-wait model first (R-I3). |
| fold with trade-rules-p1 | The same 5 conflicts as with main. |
| results with fold | The same 5 conflicts (PayWarning was deleted through results' merge of main). |

Suggested order: trade-rules-p1 first. Then results, rebuilt on p1's model, with R-I1, R-I2 and R-I4 fixed. Then only the quote-pane part of fold, on top of main.

## Re-verify 99d80281 (lead-design-results rebuilt on trade-rules-p1 2199561a)
Read-only, in worktree agent-a2c4c2aba4e77494e (local `dr` = origin/wip/lead-design-results = 99d80281; 2199561a is an ancestor). Tests run: web buyerPay.test.tsx 85/85, web disputeSlot.test.tsx 17/17, api profiles.test.ts 43/43.

**Verdict: APPROVED.** R-I1 to R-I4 are fixed, and so are R-m1, R-m2, R-m4, R-m5 and R-m6. R-m3 goes to design, as planned. Nothing from p1 was reverted.

- **R-I1, fixed.** PaidWaiting.tsx:118-119 takes the amount from `amounts(view, escrow).buyerReceivesAtomic`, the escrow this device accepted. Step 2 ("When they release, X goes to your wallet") and the "For" row both use it. With no device amount, no amount is shown ("the XMR"). buyerPay.test:1009 covers a poster buyer: the API says 999 XMR and the device says 1.25, so the room shows 1.237500 XMR in both places.
- **R-I2, fixed.** `NUDGE_AGAIN_MS = 15 * MIN_MS`, the line says "15 min", and a test pins it to 15 * 60_000.
- **R-I3, fixed. One model: p1's `confirmBy`.**
  - Migration 118 is gone. Nothing anywhere mentions `buyer_dispute_*`, `disputeWaitMin` or `buyerDisputeWait`. `disputeOpensAt(view)` is just `confirmBy`.
  - `disputeEntry` lets either side open from `confirmBy`. The API view carries `confirmWindowMin` (the column exists, so no migration), and the screens use it for the window's length, never `confirmBy − paidAt` (R-m1).
  - The 10 new profiles against F1 with owner F9 and G50: Interac, SEPA Instant, PayPal, Venmo, PIX and UPI are each 90 (F9 instant). Faster Payments is 180 (F1: 3 h). Domestic wire is 1440 (24 h). SWIFT is 4320 (F1: 48-72 h, the top of the range). OTHER_GIFT_CARD is 45 (G50).
  - The 8 launch profiles fit too: Zelle, Cash App and Revolut 90; Wise, SEPA and Custom 1440; ACH 2880; cash by mail 5760. **No profile breaks F1 or F9.**
  - The 45-minute floor applies only when `method.giftCard`, and the loader enforces giftCard ⇔ group "Gift cards & vouchers". Every other method keeps 90. `tradeProfile()` picks the method's own profile, then OTHER_GIFT_CARD for any gift card, then CUSTOM.
  - p1's `newTrade` accepts anything from 1 to 5760, so 45 passes.
- **R-I4, fixed.** Refunded.tsx has no final-alert rows: for `auto-refund` it shows only "Time to pay ended" at `payBy`. Nothing in apps/web reads `finalAlert*`; the only matches are p1's retired-field tests and the desk migration.
- **R-m2, maintenance, fixed in the paid room.**
  - PaidWaitingActions' `open` needs `!paused`. While paused it shows "Available after the maintenance".
  - The ended hero says "once the maintenance is over" (:186-188).
- **"The seller" in results, done.** Refunded uses `N = 'the seller'` for the story, the timeline and the dispute card. The buyer's own cancel is p1's sentence. `refundReason` in rules.ts never names the seller either.
- **Merge check: no p1 reverts.**
  - `git diff 2199561a HEAD --stat` changes nothing in packages/trade.
  - In apps/api it changes 9 files (+199/−92), all explainable:
    - profiles.ts: the 10 new profiles, `tradeProfile`, the gift-card floor;
    - take.ts: uses `tradeProfile`;
    - view.ts: `confirmWindowMin`;
    - offers/routes.ts: C2-A1's 3-per-side cap, owner 1 Nov, which replaces per-market 3 and total 20;
    - the matching tests.
  - On the web, the changes against p1 are additions. BuyerPay's p1 inline dispute moved into PaidWaitingActions, which keeps the same `confirmBy` rule. SellerConfirm and DisputeLocked only rename their dates imports.

### Minor (none blocks landing)
- RV-m1: DisputeOpen.tsx:51-52 has a stale comment from the two-clock model: "may dispute from the trade's wait…, often before the seller's confirm window ends". With one window, `allowed` already implies `at >= confirmBy`, so the extra check is redundant but harmless. Reword the comment.
- RV-m2 (inherited from p1, not a regression): during maintenance, the seller's SellerConfirm (`confirmEnded`, :352-366) and the /dispute page (`disputeEntry` has no pause input) still offer Open dispute. The machine refuses it with `wrong-state`, so the user gets a refusal instead of a hidden button. Do it as a p1 follow-up: pass `pausedAt` into `disputeEntry`.
- RV-n1: the Refunded page header is still "Buying from <name>". That is the page title, the same as p1's, not result text, so it doesn't break the 29 Oct rule as worded. Flag it to the owner only if he wants the name gone from the whole page.
