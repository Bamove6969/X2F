VERDICT: APPROVE WITH MINORS

# Re-review: wip/agy-terms-questions 692f1272 (agy Job 10, six Terms sentences vs the product)

Reviewer: claude3, 17 Nov 2026. This follows review-agy-terms-questions-2026-11-17.md, which reviewed 8500d014.

Scope: 1 new commit, 692f1272. It changes only docs/agy-terms-decisions.md (+46/-47) and touches no code or Terms text. I checked every claim and file:line against origin/wip/third-demo-r3 94337781. That branch changed only two test files since b1172d63, so all product cites are unchanged. This was a read-only review.

## Old findings

| # | Status | Where now / evidence |
| --- | --- | --- |
| B1 agy's own recommendation | FIXED | :39 now gives the source of the recommendation ("claude3's 16 Nov review, Q3, recommends this"), and the 16 Nov review Q3 does recommend that wording. :42-43 has the neutral Option B wording from the review. See new M5 for one leftover verdict in #3. |
| B2 #2 "no dispute after release" | FIXED | :18 and :54-55 now say a released trade is closed and cannot be disputed (machine.ts:202, :462-504, `default: wrong-state` at :502-503). They say the only reversal is an appeal that overturns a Round 1 release, which leads to a lien (dispute.ts:321-323). Options A and B (:59-63) are the ones the review asked for, and B names lead and security review. See new M2 for the wording of Option A. |
| B3 #6 edge cases | FIXED | :146-149 lists the two real cases: an overturned Round 1 release (dispute.ts:321-323 'poster-pays'; fee already paid, payouts.ts:71-77 `dispute-buyer`) and seller-sends-xmr (dispute.ts:310; fees_owed not built, :301-303). seller-returns-fiat is 'none' (:311) and is listed as matching the Terms. :22 matches. |
| M1 wrong citations | FIXED | :33 now cites termsText.ts:91 and payouts.ts:60. :35 cites timers.ts:23 (UNLOCK_CONFIRMATIONS = 10). :78 cites timers.ts:19. :126 cites dispute.ts:336 with "48 hours by default". |
| M2 #4 privacy tool / training copy / clock | FIXED | :20 (c) and :104-105 say no privacy tool or training copy exists. :109 no longer mentions a training copy. The later-of rule matches chat.ts:199. See new M3 for wording. |
| M3 #5 chat read not built | FIXED | :21 and :124 now include the "not built yet" note (staffRoutes.ts:30-34, NEEDS_P4_CHAT_MEMBERSHIP). |
| M4 only a vendor posts | FIXED | :17 and :33. |
| M5 appendix count / Q4 | FIXED (but see new M1) | :159-180 now lists six items, with Q4 as item 6. |
| M6 15-30 min | FIXED | :87 has the wording from the review. |

These cites were checked and are correct: machine.ts:478-484, :593-596, :616-626 (:623), :628-633, :682-686; payouts.ts:69-91; intent.ts:9-12; appealReviewers.ts:28-39, :47-58, :55; appeals.ts:30-37 (:34); chat.ts:199; retention.ts:71, :126-127; purge.ts:5, :20-31; termsText.ts:20, 65, 76, 87, 91, 100, 105, 115, 126, 137. These files exist: apps/api/src/trades/take.ts, apps/api/src/traders/tradedTotal.ts and apps/moderation/src/autoRefund.ts.

## New findings

No blocking findings.

M1. Appendix item 6 gets Q4 backwards (docs/agy-terms-decisions.md:178-180). It says "The draft includes: 'X2F keeps only what a trade needs.' Confirm whether to keep this sentence." The sentence is not in the Terms today. termsText.ts:137 does not contain it, and `git grep "keeps only what"` in apps/ finds nothing. The 16 Nov review Q4 says the branch kept only the tracking sentence and dropped this one. Fix for :179-180:
```
   - Your 13 Nov note (32cc5284) said "Keep all of this" about the first paragraph of section 6. The branch kept only the tracking sentence and dropped "X2F keeps only what a trade needs."
   - **Question:** Did "all of this" include that sentence, so it should be put back?
```

M2. The proposed #2 Option A wording says too much (docs/agy-terms-decisions.md:61). "A Monero release cannot be undone or disputed once sent to the buyer's wallet" is wrong for a moderator's Round 1 release-to-buyer. That release can be appealed, and if the appeal overturns it, the result is a lien (dispute.ts:321-323, which is what :55 of this same doc says). Fix: "A release by the seller is final: it cannot be undone or disputed once sent to the buyer's wallet. (A moderator's release in a dispute can still be appealed.)" This wording is COPY-UNSIGNED either way.

M3. The 90-day wording is garbled (docs/agy-terms-decisions.md:20 and :100). Line 20 says "the 90-day clock starts 90 days after the dispute ... closes", and line 100 says "the 90-day retention timer runs from 90 days after the dispute ...". The 90 days start when the dispute (or the trade, if later) closes. The purge happens 90 days after that (chat.ts:199). Fix for both lines: "the 90 days count from when the dispute (or the trade, if later) closes, not from when the trade completed".

M4. The #6 Option A heading contradicts its own wording (docs/agy-terms-decisions.md:152-153). The heading says "Keep 'We don't get paid unless you both do' as the general rule", but the quoted text replaces that sentence with "We don't get paid unless the trade completes". Fix the heading: "Option A — Change the wording to say the fee is paid when the trade completes, and that only a reversal before release is free (`COPY-UNSIGNED`):".

M5. One argument for an option is still in the doc (docs/agy-terms-decisions.md:86). "Keeping the sentence as-is is friendly and says 'help you' (not 'guarantee'), provided the lawyer is comfortable with it." That is a judgment about which option is better, which is the same kind of problem as old B1. Fix: "Keep the sentence as it is (the 16 Nov review Q10 flags it for the lawyer)." The other choice is to delete the line.

M6. Appendix item 1 misquotes the owner (docs/agy-terms-decisions.md:165). It says "or use your phrase 'cash, bank transfers or whatever payment method suits them'". His phrase (d1156603, quoted on :164) was "the payment method that suits them". The "whatever ..." phrase is agy's own blend. Fix: "Keep 'cash, bank transfers or the payment app that suits them', or use your phrase 'the payment method that suits them'?"
