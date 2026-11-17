VERDICT: CHANGES NEEDED

# Review: wip/agy-terms-questions 8500d014 (agy Job 10, note #4: six Terms sentences vs the product)

Reviewer: claude3, 17 Nov 2026.

Scope: 1 commit on origin/wip/third-demo-r3 1fa6bed1. It adds one file, docs/agy-terms-decisions.md (+181). It is docs only, with no code changes.

How I checked: every claim and every file:line was compared with origin/wip/third-demo-r3 b1172d63. Prettier is not set up in the repo, so this was a read-only review.

## What is right
- The six topics are the six listed in AGY-ORDERS-2.md Job 10.
- The termsText.ts line numbers are all correct: 20 (version), 65, 76, 87, 91, 100, 105, 115, 126, 129, 137.
- #1 is accurate:
  - request-refund is seller only (machine.ts:616-626, check at :623);
  - buyer-cancel is at machine.ts:628-633;
  - refunds go to sellerRefund (payouts.ts:81-88).
- #3 is accurate:
  - a late "I've paid" is allowed until the seller cancels (machine.ts:593-596);
  - the buyer may dispute while the trade is settling as auto-refund, and the refund usually lands in about 5 s (machine.ts:478-484);
  - the dispute window after a refund is 48 h (machine.ts:489-499);
  - seller-sends-xmr and seller-returns-fiat place a lien (intent.ts:9-12).
- #4 is accurate:
  - the chat is kept 30 days after close, or 90 days after the dispute closes (chat.ts:22-24, :197-199);
  - addresses are nulled at 90 days (purge.ts:5, :28-30);
  - the trades row stays.
- #5 is accurate:
  - senior or owner may review an appeal (appealReviewers.ts:55, appeals.ts:34);
  - involved staff are left out (appealReviewers.ts:28-39);
  - appeal_ends_at is used (appeals.ts:79-87).
- The doc changes no code and no Terms text.

## Blocking

B1. The doc makes a decision of its own. #1 Option A is headed "Change the Terms wording (Recommended, matches the app)" (docs/agy-terms-decisions.md:39). agy must not recommend product or wording choices. #1 Option B (line 43) argues the same way, saying keep the code "since ... would give the seller's XMR to the buyer". It is an argument against the option, not a description of it.

Fix:
- Line 39: change the heading to "Option A — Change the Terms wording to match the app". If a recommendation is wanted on the page, quote it with its source: "(claude3's 16 Nov review, Q3, recommends this.)"
- Line 43: say what the option would mean, with no verdict: "Option B — Change the product so whoever started the trade can cancel after the time runs out. Because only the seller puts XMR into escrow, the escrow would still have to go back to the seller; if you meant something else by 'whoever started the trade', say what."

B2. #2 is wrong about the product: after a release, the code allows no dispute at all (docs/agy-terms-decisions.md:18, :54-55).
- onDispute (packages/trade/src/machine.ts:462-504) handles only securing/secured, paid, settling and refunded. A `released` trade falls to `default: return fail('wrong-state')` (machine.ts:502-503).
- `released` is a closed state (machine.ts:202).
- The lien outcomes the doc cites are after-refund outcomes. Both order the seller to pay (intent.ts:8-12: "How a dispute after a refund can end"). They do not apply to a buyer who received XMR after a release.

So the real mismatch is bigger than "funds recovered": the Terms say "it can be disputed", and today it cannot. The only case where a release gets reversed is a moderator's Round 1 release-to-buyer that an appeal overturns. That leaves a lien (dispute.ts:321-323).

Fix:
- Rewrite "What the Code Does Today" for #2. Say: "once the seller releases, the trade is closed (released) and neither side can open a dispute (machine.ts:462-504, :202); the only reversal after coins moved is an appeal overturning a moderator's Round 1 release (dispute.ts:321-323), which puts a lien on the account that must pay."
- Make the options: (A) change the words, (B) add a dispute after release to the product. Spell out what B needs: a dispute window after a release, a "buyer returns XMR / buyer's payment was reversed" outcome with a lien on the buyer, and lead and security review, because this is disputes/liens code.
- Fix the summary row (line 18) the same way.

B3. #6 is inaccurate (docs/agy-terms-decisions.md:22, :148-152).
- Edge case 1 relies on "if the trade is later disputed after release (e.g. the buyer's bank transfer bounced)". That cannot happen (see B2).
- Edge case 2 is introduced as a case where "the code charges (or keeps) the 1% fee", and then says rulingFee returns 'none'. So it charges nothing (dispute.ts:311) and is not an edge case.

There are two real cases where the fee is charged although the trade did not simply complete:
- a Round 1 escrow ruling overturned on appeal (dispute.ts:321-323, 'poster-pays'), while the Round 1 release already paid the fee on chain (payouts.ts:71-77, dispute-buyer);
- `seller-sends-xmr` after a refund (dispute.ts:310, 'poster-pays'). Here the fee is owed by the poster with no escrow output carrying it ("fees_owed, not built yet", dispute.ts:301-303).

Fix: replace lines 148-152 with those two cases. Delete the post-release-dispute example and the seller-returns-fiat "edge case", or move the latter to a line saying it matches the Terms. Change the summary row (line 22) to match.

## Minor

M1. Wrong citations.
- docs/agy-terms-decisions.md:33 cites machine.ts:523-526 for "only the seller locks XMR". That is `setup-done`. Use termsText.ts:91 plus payouts.ts:60 (`sellerFundsAtomic`), or drop the machine.ts cite.
- Line 35 cites machine.ts:719 for 10 confirmations. It should be packages/trade/src/timers.ts:23 (UNLOCK_CONFIRMATIONS = 10).
- Line 79 cites timers.ts:27 for disputeAfterRefundHours. It should be timers.ts:19.
- Line 127 says "48 hours in appeals.ts:79-87". The 48 h is the default setting appealWindowH (12-168 h, dispute.ts:336, :375), not in appeals.ts. Say "the appeal window setting, 48 hours by default (packages/staff/src/dispute.ts:336)".

M2. #4 misses one mismatch and invents a "training copy".
- The Terms promise a disputed trade is "scrubbed with our internal privacy tool, and used for training moderators". No such tool or training copy exists in apps/api, apps/moderation or packages/staff. Add this as point 3 under "What the Code Does Today": "there is no privacy tool or training copy in the code today".
- Remove "training copy" from the Option A wording (line 109), or mark it "(not built)".
- Also, the 90-day clock is the later of trade close and dispute close (chat.ts:199), not dispute close alone. A one-word fix: "90 days after the dispute (or the trade, if later) closes".

M3. #5 overstates what is built (docs/agy-terms-decisions.md:21, :124-126). The moderator's chat read is not built yet. staffRoutes.ts:30-34 (NEEDS_P4_CHAT_MEMBERSHIP) says "nothing here returns chat text". Add "(the design gives them this access; the chat-reading part is not built yet, staffRoutes.ts:30-34)".

M4. #1 says "Either a buyer or a seller can post an ad" (line 33). Only a vendor posts offers (owner, 2 Nov; tools/demo/seed.ts:59, apps/api/src/routes/accountType.ts). Fix: "A vendor posts an ad to buy or to sell; another trader takes it."

M5. The appendix (line 163-181) says the review "also flagged five" questions. The review has 11, and Q4 (whether to keep "X2F keeps only what a trade needs.", s6 p1) is missing. Fix: add Q4 as item 6, or say "the remaining copy questions" and list Q4 too.

M6. #3 Option B (line 89) gives "e.g., 15–30 minutes". That is a product number agy chose. The owner removed the 15-minute delay on 8 Nov (p6-1). Fix: "would have to wait a grace period (the owner removed the earlier 15-minute delay on 8 Nov, p6-1; how long, if at all, is the owner's call)".
