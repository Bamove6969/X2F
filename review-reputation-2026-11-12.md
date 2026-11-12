# Review: wip/lead-reputation 917695b9 (R-042 Fast, R-011 feedback, R-012 totals, J-21 F1), 2026-11-12

Reviewer: independent reviewer, read-only on code. Branch head `917695b9` (one commit) on main
`6ebed537`; worktree `.claude/worktrees/reputation` (left as found). 21 files, +616/-161. Migration
`326_fast_payments.sql` (no other branch uses 326; the runner applies missing names in order, so a
number below main's highest is fine).

## Verdict

**CHANGES REQUESTED: one Major engineering fix (M1, lock ordering in the ruling transaction) before it
lands.** The outcome logic itself is right and well tested: the sale/reversal split, the counted →
reversed → sale bookkeeping, idempotent erasure under the purge role, the appeal hold and % positive
all hold. The changed old tests follow the rule changes (C12 → R-011, R38 totals → R-012, R-037 → R-042)
and none is weakened. Two Minors and two owner questions follow.

## Tests run (serialised runner, single files, Node 24.22.1, on 917695b9)

| File | Result |
|---|---|
| apps/api/test/traderTrust.test.ts | 10/10 passed |
| apps/api/test/reviews.test.ts | 27/27 passed |
| apps/api/test/tradedTotal.test.ts | 17/17 passed |
| apps/api/test/reviews-tripwire.test.ts | 4/4 passed |
| apps/api/test/disputeRecord.test.ts (new) | 1/1 passed |
| apps/api/test/finalOutcome.test.ts (new) | 1/1 passed |
| apps/api/test/schema.test.ts | 77/77 passed |
| apps/api/test/reviews-gate.test.ts | 14/14 passed |
| apps/api/test/disputes.test.ts | 27/27 passed |
| packages/reputation badges.test.ts + stats.test.ts | 66/66 passed (2 files) |
| `tsc --noEmit` apps/api, packages/reputation | exit 0, exit 0 |

Not run: web tests (Badges, OfferCard), Playwright, full projects. dockerd was not touched.
Red-first cannot be checked from history: tests and code are in one commit.

## Findings

### M1 (Major, engineering): the ruling transaction now takes trade and totals row locks after the site-wide log lock, and in the opposite order to the settle path

`withDispute` (disputes/store.ts) locks the dispute row, runs `fn` (which calls `appendLog`, taking the
site-wide advisory lock `pg_advisory_xact_lock(7240001)`; the timers' `window-closed`, the staff
routes and the appeal all append inside `fn`), and only then calls `saveDispute`. On every decided
save (`final`, `complying`, `closed`) `saveDispute` now runs:
- `eraseReversedReviews` → `select ... from trades where code = $1 for update` (trade row lock), and
- `countTradeTotals` → upserts/updates `account_traded_totals` rows of both parties.

`applyEvent` takes the opposite order: trade lock → `countTradeTotals` (the same totals rows) →
`appendLog` last (M2). Two real deadlocks follow:
1. **Log lock vs totals row, across different trades.** T1: the timer makes trade A's ruling final
   (a sale) and holds the log lock, then wants seller S's totals row. T2: S releases another trade B,
   holds trade B and S's totals row, and waits for the log lock. Postgres aborts one after
   deadlock_timeout: a user's release fails, or the timer pass fails and retries.
2. **Dispute vs trade.** The internal settle callback (`internal/routes.ts` ~l.304, a refund landing
   on a disputed trade) locks trade → dispute `for update`; `saveDispute` now locks dispute → trade.

Also, while T1 waits for any trade or totals row it holds the log lock, so every append on the site
stalls. This breaks append.ts's N3 rule: after the first append, keep the tail short and take no new
contended locks. Before this branch the only such statement was the overturn erase, which was rare;
now it runs on every decided save.

Recommended fix (engineering, no product effect): in `withDispute`, lock the trade row *before* the
dispute row (the same trade → dispute order as applyEvent and the settle path). Then run the
outcome work (erase + count) before any `appendLog`. For example, have `fn` return the next state, then
let `withDispute` save it, run erase/count, and append last. Or keep the work in `saveDispute` but make
`withDispute` call it before `fn`'s log entry. Add a test that runs a timer finalisation and a release
by the same seller at the same time.

### m1 (Minor, accuracy of a claim and a test gap): finalOutcome does not match rulingFee on an appeal that overturns a ruling whose coins already moved

`finalOutcome.ts` says its split is "the same split as rulingFee" and `finalOutcome.test.ts` checks
only round-1 shapes. Take round 1 `release-to-buyer`, then an appeal decided `refund-to-seller`:
- `rulingFee` (round 2, escrow moved, outcome changed) gives `poster-pays`, a lien (owner Q37).
- `disputeOutcomeSql` reads the round in force and gives `reversed`. It erases the feedback and
  takes the trade off the totals. tradedTotal.test.ts "an appeal that reverses a counted trade" pins
  this result.

For reputation the branch's reading looks right: D-006 says a won appeal fixes the record, and R-011
says reversed means no feedback. But the two rules legitimately differ here, so the comment is wrong
and the case is unpinned in finalOutcome.test.ts. Fix: correct the comment ("same split as rulingFee for
round 1; an appeal that overturns moved coins is a fee lien but a reputation reversal") and add the
round-2 case to finalOutcome.test.ts. Confirm with the owner only if you read D-006 differently.

### m2 (Minor): a trade with a pending dispute is in the totals but out of the completed count

`countTradeTotals` leaves a counted trade as it is while a later dispute is pending. `FINAL_SALES_SQL`
(the public completed count and the badges) drops it at once (`isFinalSaleSql` is false while
pending). So during a late-funds escalation or appeal, the XMR total still includes the trade but
"N completed" does not. Both settle the same way once the dispute is decided. Pick one (recommend:
the count also keeps a previously counted trade while pending, matching the totals and "until the
result decides") or document the difference. Not a security issue.

### n1 (Nit): Fast is not taken back if a released trade is disputed later

`countFastPayment` counts at the seller's release when `dispute_by is null`. A released trade that
late funds escalate and that is later reversed keeps its fast payment (and the `trade_totals_counted`
'fast-payment' mark). One payment in 30. Accept, or remove it when `countTradeTotals` reverses the trade.

### n2 (Nit): a trade that goes reversed → sale makes both sides review it again

The reversal erases reviews *and skips*. If a later after-refund dispute ends as a sale
(`seller-sends-xmr`), the trade becomes reviewable again and the gate asks both sides to rate or skip
it. Probably intended ("whatever the decision is will determine the outcome"). Listed for the owner
only if he wants the earlier feedback restored instead (it is gone, by design).

### n3 (Nit): three copies of Fast's meaning differ in case and full stop

The three copies are in `packages/reputation/src/badges.ts`, `apps/web/src/ui/Badges.tsx` and
`OfferCard.tsx`. All are COPY-UNSIGNED, so design will reword them anyway.

## The checks asked for

1. **Sale vs reversal split.** `SALE_OUTCOMES = release-to-buyer, seller-sends-xmr`;
   `REVERSAL_OUTCOMES = refund-to-seller, seller-returns-fiat, no-action`. Together they cover every
   `RulingOutcome` once, and they match `OUTCOME_FEE` (poster-pays vs none) for a single round,
   tested. A decided dispute with no ruling follows the trade's state; an undecided one (any seq) is
   `pending`; the latest seq decides. Round 2 differs from rulingFee in one case, see m1.
2. **Counted → reversed → sale.** The add step (`isFinalSaleSql`) and the take-back step
   (`= 'reversed'`) are mutually exclusive in one call. Adding inserts the 'completed' mark with
   `on conflict do nothing`; taking back deletes it in the same statement and subtracts exactly the
   stored `usd_cents`/`amount_atomic`, floored at 0. So a re-sale counts again exactly once, and
   repeated calls change nothing (tested, including a replay). Pending leaves the totals as they are.
   Disputed trades are no longer counted before a decision (old R38 rule removed). No double count
   found. Undercount risk: totals counted under the old rule are not re-evaluated, which matters only
   if live data exists. Note for the lead.
3. **Erasure.** `eraseReviewsOfTrade` locks the trade, sets `local role` to `PURGE_ROLE` for the two
   deletes and puts the caller's role back; the app role still cannot delete (tested). Idempotent:
   a second call deletes 0 (tested). Called from `saveDispute` (decided) and from `applyEvent` on a
   released/refunded transition (before its append, fine there).
4. **Lock ordering.** See M1: dispute → trade (new, on every decided save) against trade → dispute
   (settle), and row locks taken after the global log lock.
5. **The hold.** `reviewHeldSql` = trade has a dispute with `appealed`, or round 2
   `awaiting-approval` (`appealPendingSql`, shared with `rulingCountsSql`). GET
   `/v1/trades/:code/review` returns `theirs: null` and `held: true` and keeps `mine` for the writer
   (tested both sides). `traderSummaries` leaves held reviews out of positive/negative, so they are out
   of % positive and the badges that read it (tested: positivePct null while the only review is held).
   Round 1 inside its appeal window, before an appeal is filed, is not held; that matches the owner's
   "if an appeal happens".
6. **Public leaks.** The only readers of `reviews` are the participant GET (masked), the summary
   aggregate (filtered), the gate (existence only, own side) and the erase. No public list of reviews
   exists. No leak found.
7. **Changed old tests.** reviews.test.ts: a refund after a dispute is no longer reviewable, and a
   reversal with no appeal now erases (R-011 replaces C12's overturn-only rule). reviews-tripwire:
   follows the renamed seam. tradedTotal.test.ts: a disputed refund no longer counts (R-012 replaces
   R38). traderTrust.test.ts and badges.test.ts: Fast moves from the median to the count (R-042
   replaces R-037); the old "both lists" test is replaced by stricter count tests (boundary at exactly
   half, own pay window, once per trade, release times never count, disputed trades never count). Each
   change follows a register row; none loosens an assertion beyond its rule.
8. **J-21 F1.** `LOST_DISPUTES_SQL` uses `rulingCountsSql`: round 1 counts, an appealed dispute
   counts for nobody, round 2 decides (disputeRecord.test.ts). J-21's won count must use the same helper.

## Owner questions

- **Stage count (R-012 vs D-048).** As built, the stage keeps R38's count and the public count
  follows R-012; the builder already flagged this. Recommendation: the stage follows the final
  outcome too (one meaning of "completed"), with no automatic drop for the trade being disputed.
- **R-042 measurement (register "lead reading: confirm").** Fast is measured from escrow secured to
  the "I've paid" tap, strictly under half of the trade's own pay window, never on disputed trades.
  Recommend confirming as built.
- m2 (count vs totals while pending) and n2 (re-review after reversed → sale) if the lead does not
  settle them as engineering.

## Re-verify: dd7668c2 (fixes for M1, m1, m2, n1, n3), 2026-11-12

One commit on top of 917695b9. 10 files, +242/-21. It changes `withDispute`, adds
`lockPartyTotals`, changes `FINAL_SALES_SQL`, adds the fast-payment take-back and unifies the Fast
copy. It adds reputationLocks.test.ts and extends finalOutcome, tradedTotal and traderTrust.

### Verdict

**APPROVE.** M1, m1, m2, n1 and n3 are closed. One new Minor (m3, below) is cheap to fix in the same
pass and is not a blocker.

### M1: locks taken up front in withDispute

- **Deadlock safety.** `withDispute` now locks, in this order: the trade row (`for update`), the
  dispute row (`loadDisputeRecord ... lock`), and then both parties' `account_traded_totals` rows
  (`lockPartyTotals`: missing rows are inserted, then locked `order by account_id for update`). All of
  this happens before `fn`. So by the time `fn` takes the site-wide log lock, every row
  `saveDispute`'s decided-save work touches is already held:
  - the trade row (`eraseReversedReviews`);
  - the totals rows (`countTradeTotals`, including the new fast-payment take-back);
  - `reviews`, `review_skips` and `trade_totals_counted` for this trade, which every other writer
    reaches only through the trade lock.

  Nothing after the append waits on a contended lock, which satisfies append.ts N3. For the cases
  that matter this is equivalent to moving the work before `appendLog`. It also fixes the dispute-
  versus-trade inversion: the order is now trade, then dispute, the same as `applyEvent` and the
  settle path's `before`/`within`. The other dispute-row writers (`staffRoutes` moderator-name and
  proof-request updates) take only the dispute row and then the log lock, so they cannot form a cycle
  with a holder of trade plus dispute.
- **R37 log ordering.** Unchanged. `fn` still writes its entries in the same order, under the dispute
  lock, and R37's involvement check still reads the log under that lock. Taking the trade lock
  earlier only serialises a dispute change behind a running trade event on the same trade. It adds,
  drops and reorders no entries.
- **The two concurrency tests really reproduce the deadlock.** I copied reputationLocks.test.ts into a
  scratch worktree at the old head 917695b9 and ran it: both tests fail with Postgres
  `deadlock detected` (2/2 failed). On dd7668c2 both pass. Test 1 holds a release of trade B, owning
  B and the seller's totals row, inside `within`, before its append, while the timer finalises trade
  A for the same seller: that is the totals-row-versus-log-lock cycle. Test 2 holds trade C, then
  locks its dispute in `before`, as the settle path does, while the timer finalises C: that is the
  dispute-versus-trade cycle. The 400 ms sleep only makes sure the timer is blocked before the gate
  opens. A false pass would need the timer to finish first, which it cannot, because it needs the row
  the gated event holds. The scratch worktree is removed.
- **Empty totals rows.** `lockPartyTotals` creates an all-zero row for any party of a disputed trade
  (on every `withDispute` call, decided or not). Every reader coalesces a missing row to 0:
  `tradedXmrSql`, the summary's `fast` and `buyer_cancels`. `own_usd_cents` has no reader outside
  tradedTotal.ts. No reader tests whether a row exists. The FK to `accounts` has no cascade, but the
  only hard account deletes are team-member login accounts and the setup owner, and neither is ever a
  trade party. account_traded_totals is listed as not an account change, so no Jabber notice. **No
  public answer or count changes.** The tradedTotal test now reads "0 or no row", which matches this
  and is not a weakening.

### m1, m2, n1, n3

- **m1:** the comment now says the fee split and the reputation split part on an appeal that
  overturns moved coins. finalOutcome.test.ts pins both on a real round-1 release → appeal → round-2
  refund: `rulingFee` = `poster-pays`, `disputeOutcomeSql` = `reversed`, and `pending` throughout the
  appeal. Correct.
- **m2:** `FINAL_SALES_SQL` now also counts a trade whose outcome is `pending` when it already has its
  'completed' mark. That matches `countTradeTotals`, which leaves a counted trade alone while pending.
  A reversal deletes the mark, so the trade drops from both together, and a sale keeps both. A
  never-counted pending trade stays out. Tested ("completed 2 while the appeal is pending, 1 after
  the reversal"). Correct.
- **n1:** `countTradeTotals` now deletes the trade's 'fast-payment' mark when the outcome is reversed,
  and only then decrements the buyer's `fast_payments`, floored at 0. So the take-back happens once.
  It runs in both callers. Its buyer row is among the rows locked up front. A later reversed → sale
  does not re-add the payment, because `countFastPayment` requires `dispute_by is null`. That is
  conservative and fine. Tested (2 → 1, mark gone). Correct.
- **n3:** all three copies now read "Paid in under half the time allowed, 30+ times" (COPY-UNSIGNED).

### New

**m3 (Minor, engineering):** the order in which a trade event locks the totals rows still differs
from `lockPartyTotals`. `countTradeTotals` called from `applyEvent` upserts the two parties' rows in
buyer-then-seller order. `withDispute` locks them in account-id order. Two trades between the same
two accounts, one taking a dispute action while the other settles, can still deadlock on the two
totals rows. The same pair trading in opposite roles can also deadlock between two `applyEvent`
calls, which is pre-existing on main. Postgres resolves it by aborting one transaction. It is rare,
and the log lock is not involved. Fix: call `lockPartyTotals(q, code)` at the top of
`countTradeTotals`, which is idempotent with the locks `withDispute` already holds, so every path
takes the totals rows in id order.

### Tests (serialised runner, single files, on dd7668c2)

| File | Result |
|---|---|
| apps/api/test/reputationLocks.test.ts (new) | 2/2 passed (on 917695b9: 2/2 failed, `deadlock detected`) |
| apps/api/test/finalOutcome.test.ts | 2/2 passed |
| apps/api/test/tradedTotal.test.ts | 17/17 passed |
| apps/api/test/disputes/staff.test.ts | 27 passed, 1 todo (28) |
| apps/api/test/disputes/trader.test.ts | 18/18 passed |
| apps/api/test/reviews.test.ts | 27/27 passed |
| apps/api/test/traderTrust.test.ts | 11/11 passed |

dockerd was not touched.
