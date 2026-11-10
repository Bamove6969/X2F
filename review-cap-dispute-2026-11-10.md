# Money-path review: wip/lead-cap-dispute (D-060, owner g63), 10 Nov 2026

Branch wip/lead-cap-dispute, worktree .claude/worktrees/cap-dispute, on main d421706c:
- 386c83f0: cherry-pick of claude2 a99af200 (payoutsFor('dispute-seller') with no fee output; rulingFee in @x2f/staff; fee in the poster's dispute view)
- f04d4440: feeOutputAtomic('dispute-seller') = 0, so bookTradeRevenue books nothing on a full reversal

Reviewer: independent money-path reviewer. I did not change any code.

## Verdict

APPROVE, ready to land. I found nothing blocking. The money moves exactly as owner g63 / D-060 says: no fee on a full reversal, the poster pays 1% when the trade completes, and during an appeal the fee waits. Nothing strands coins in this tree, because the moderation service signs no ruling payout at all today (finding 5). Findings 5 to 7 are follow-ups for Plan 4 ruling execution and fees_owed. Finding 8 is an owner question that was already raised.

## Tests and typecheck run (all through the serialised runner, single files)

| File | Result |
|---|---|
| packages/trade/test/payouts.test.ts | 34/34 pass |
| packages/trade/test/machine.test.ts | 155/155 pass |
| packages/trade/test/watch.test.ts | 63/63 pass |
| packages/staff/test/rulingFee.test.ts | 8/8 pass |
| packages/staff/test/dispute.test.ts | 67/67 pass |
| apps/api/test/staff/revenue.test.ts | 29/29 pass |
| apps/api/test/store.test.ts | 11/11 pass |
| apps/api/test/disputes.test.ts | 25/25 pass |
| apps/moderation/test/buyerCancel.test.ts (includes verifyRuling) | 26/26 pass |
| apps/moderation/test/autoRefund.test.ts | 30/30 pass |
| apps/moderation/test/watcher.test.ts | 31/31 pass |
| apps/moderation/test/attest.test.ts | 9/9 pass |
| apps/web/test/policy.test.ts (trader co-sign guard) | 30/30 pass |
| apps/web/test/dispute.test.tsx | 47/47 pass |

`tsc --noEmit` passes for packages/trade, packages/staff, apps/moderation, apps/api and apps/web (exit 0).

I also wrote a probe script (scratchpad capd-probe/probe.ts; nothing added to the repo). It runs payoutsFor('dispute-seller') for both posters, 7 trade amounts from 1 to 10^15 atomic units, and balances from 1 unit up to the funded amount plus a surplus. In every case there is a single output, to the seller's refund address, for exactly the balance, and nothing goes to the fee wallet. dispute-buyer paid out exactly the balance with the exact fee output, and the fee output was missing only when the fee is 0 (for amounts under 100 units `out()` drops zero outputs, which is correct). The probe's 10 "FAIL" lines are all that case, not a bug.

## Findings

1. **Each ruling outcome gets the right fee: correct.** `OUTCOME_FEE` is at packages/staff/src/dispute.ts:307 and `rulingFee` at :315-328.
   - Release to buyer gives `poster-pays`.
   - An appeal that upholds completion (release, then release) gives `poster-pays` (:324).
   - A lien (`seller-sends-xmr`, or an appeal that overturns a round-1 escrow outcome after the coins moved, :323) gives `poster-pays`.
   - A full reversal (`refund-to-seller`, and `no-action` after a refund) gives `none`.
   - `seller-returns-fiat` gives `none`. That is the developer's reading, and the owner is asked to confirm it (finding 8).
   - A pending appeal (round 2 `appealed` or `awaiting-approval`) gives `waits`.
   - Before a ruling (`open`, a round-1 `awaiting-approval`, or no ruling) gives null.

   This matches D-060 word for word (owner-decisions-2026-11-06.md:82). Every branch is covered in packages/staff/test/rulingFee.test.ts (8 tests) and again over HTTP in apps/api/test/disputes.test.ts, block "owner g63".

2. **Payouts: correct, and the amounts add up exactly.** In packages/trade/src/payouts.ts:81-88, `dispute-seller` is now the refund case: the whole balance, surplus included, goes to the seller's signed refund address, for either poster, with no fee output. The output equals the balance, so no dust is lost or created. The Monero network fee comes off payout 0, as for every refund. `dispute-buyer` (:71-80) has not changed.

   The old throw for "underfunded, balance at or below the fee" is gone. A dispute-seller set now pays out any positive balance and still throws `nothing-to-pay` on an empty escrow (tested). That is the right result for a reversal.

   On a seller's ad, the trader's display (apps/web/src/screens/dispute/rules.ts:269) now shows `sellerFundsAtomic`, which is the amount plus the fee the seller funded. That is consistent.

3. **The ledger books once per completed trade and never on a reversal, retries included: correct.**
   - apps/api/src/staff/revenue.ts:41-49: `feeOutputAtomic` returns 0 for `dispute-seller` and for every refund kind.
   - `book` (:86) returns before any insert when the fee is 0. So a reversal leaves no `revenue_booked` marker and no ledger row, however many times it is called.
   - A completed trade is protected by the `revenue_booked` marker (`on conflict do nothing`). A second call or a replayed event books nothing; the test asserts `false` on the second `bookTradeRevenue(..., 'dispute-buyer')`.
   - The store books once, on the state change into `released` or `refunded` (apps/api/src/trades/store.ts:399-404).
   - The revenue tests cover reversals with both posters, under both the explicit `dispute-seller` kind and the row's own kind, and the monthly and total counts drop from 7 to 6 as expected.

4. **The fee in the dispute view is visible only to the poster: correct.** apps/api/src/disputes/routes.ts:215 adds the field only when `side === row.poster`. All three callers of `loadView` (GET, open dispute, appeal; :244, :282, :330) pass the requester's own side. Nothing else serialises `DisputeView`. The API test checks that the taker's view has no `fee` property. Small gap: that test only uses a seller's ad. A buyer's-ad case would also show that `fee` follows the poster and not the seller. This is optional.

5. **The moderation service accepts the new payout shape because it signs no ruling at all: no coins strand in this tree.** I grepped `payoutsFor` in apps/moderation/src. Its only call is desk.ts:378, which builds the `auto-refund` and `buyer-cancel` refunds. `verifyRuling` (apps/moderation/src/rulings.ts:7) refuses every input; the test is buyerCancel.test.ts "verifyRuling refuses every input in Plan 3". The watcher's sweep proof `sweepMinimums` (packages/trade/src/payouts.ts:113) takes only `SettleKind`, so the probe shows it throws "unknown settle kind" for both `dispute-seller` and `dispute-buyer`. The watcher catches that and does not count the sweep as proven (apps/moderation/src/watcher.ts:240-246).

   So in this tree a ruling's payout can only be co-signed on the trader side. The guard there is apps/web/src/escrow/policy.ts:175 behind `rulingAllowsCosign`. It accepts the new no-fee set for both posters and refuses a set that takes the 1% out of a reversal (policy.test.ts).

   Follow-up for Plan 4 ruling execution (not a blocker): `sweepMinimums` and the moderator's ruling verifier must add `dispute-seller` as "whole balance to sellerRefund" and `dispute-buyer` as the release minimums. Otherwise the moderator will refuse to prove or sign a ruling payout. This was already true before this branch, for both kinds.

6. **On chain, a `dispute-seller` payout now looks exactly like a refund (follow-up).** Before this branch, a seller's-ad reversal carried a fee output that set it apart. Now the payout is byte-for-byte the same set as `mutual-cancel` / `auto-refund` (payouts.test.ts asserts this). The open tripwire NEEDS_PLAN_4_RULING_PAYOUT (R-M2; packages/trade/src/machine.ts:536-540, apps/api/src/internal/routes.ts:298-299) therefore matters more: ruling execution must report its own `RulingKind`. No trade's settle kind can be inferred from the outputs. The fee result does not depend on this (both kinds book 0), but the dispute's after-refund flip in internal/routes.ts does.

7. **A lien on a round-1 refund books no revenue today (expected, depends on fees_owed).** Case: round 1 refunds (no fee output), then the appeal releases. `rulingFee` says `poster-pays`, the escrow output carried no fee, and fees_owed (Task 12) is not built, so the 1% is neither collected nor booked. The comment at dispute.ts:301-303 and the revenue.ts header say this. It is not a regression; it should stay on the fees_owed list.

   Hardening, optional: `bookTradeRevenue` (revenue.ts:119) still accepts a `refunded` row with a caller-supplied `kind`. A future caller that passed `dispute-buyer` for a refunded trade would book a fee that was never paid. Now that no refund kind carries a fee, the guard could accept `released` only. That is pure engineering, and the lead can decide.

8. **Owner question, already raised in the code: `seller-returns-fiat` reads as a reversal (no fee).** packages/staff/src/dispute.ts:299-300 says "the owner is asked to confirm". This ruling also puts a lien on the seller. D-060 says "a lien means the trade completes and the poster pays", but in this case the fiat goes back and the coins stay where they started. Recommendation: keep `none` (everything goes back to its original party), and have the owner confirm it on the next questions page. No other fee decision is open.

9. **326d9c6f (the nudge gate, owner g66) is absent.** `git merge-base --is-ancestor 326d9c6f HEAD` says it is not an ancestor. The branch diff (14 files) contains no nudge code, and there is no `seller_nudged_at` and no `/v1/nudges` change.

10. **Copy (not money).** The `fee` field is parsed by the web app but not displayed yet. The explanation is a TODO for design: rules.ts:296 and api.ts:82-86, as owner g63 asks. No new strings appear for users, so no `COPY-UNSIGNED` marker is needed yet.
