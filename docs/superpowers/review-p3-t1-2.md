# Second review brief: Plan 3 Tasks 1–2 (packages/trade)

Reviewer rules: adversarial, read-only (probe only in a scratch copy, delete it), evidence as file:line, run `sg docker -c 'npm run check'` in your own worktree. Output APPROVED or CHANGES REQUIRED with findings ranked Critical/Important/Minor (file:line, failure scenario, minimal fix).

Read: Plan 3 (docs/superpowers/plans/2026-10-15-plan-3-trading.md) incl. Revisions 2026-10-18 and 2026-10-20; spec 2.x, 3.x, 11.1; rulings file; packages/escrow/src/verify.ts (checkTxSet rules payouts must satisfy).

Under review: origin/wip/p3-t1-2, fix commit 9c9c110 (+ merge bdfffed). First review findings it had to fix:
- I1 `settled` must be accepted from any open funded state (secured, settling, disputed, paid, refund_requested, lapsed) — a chain fact; mark-paid in refund_requested refused `too-late` once now >= finalAlertAt + 15 min. Tests for: buyer-cancel times out to secured then the refund lands; release lands in disputed; buyer marks paid at minute 200 then auto-refund lands.
- I2 while paused, every client event except mark-paid and buyer-cancel refused.
- Minors: resume shift by now − max(pausedAt, set-time) and >= pausedAt; escalate needs funds from every state; empty lapse sets closedAt + lapsedAt; rateFor > 0 and margin cap ±50%; payoutsFor refuses duplicate addresses; newTrade refuses fiat 0 and confirmWindowMin > 1440; stronger clock-skew test; mark-paid clears the seller's pending cancel.
Owner rule 2026-10-20 (new): extra XMR before mark-paid and within the offer max → trade grows at the locked rate (seller-poster: largest A' with A' + feeFor(A') <= received, remainder to seller; buyer-poster: A' = received), fee/fiat recalculated, fee exact, `trade.grown` flag; over max or after mark-paid → surplus to the seller; every refund/cancel → everything to the seller.
Look hardest at: grow() vs a late surplus in secured before unlock; `settled` accepted with a kind that doesn't fit the state (e.g. lapse-refund landing in paid) — judge; onResume's finalAlertAt shift; amountForFunds loop (termination, off-by-one, fee floor); that payouts always sum to the balance and fee output stays exact after growth; bigint edge cases.
