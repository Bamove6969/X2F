# Re-review round 4: wip/lead-p3-task27 @31884f8 (Task 27, trader-side disputes): APPROVED (helper reviewer, 2026-10-29)

**Scope:**
- 99524ba: merge of main line d5b7fb9 (owner docs plus Task 4 offers API).
- 0f24e18: R38 count and the round-3 minors.
- 31884f8: auth-client `NOT_AUTH_CLIENT` list.

Checked against `review-task27-round3-2026-10-29.md` and against main line **1b2bb3a** (Task 23 landed after this branch's merge).

**Verdict: APPROVED.**
- Round-3 Important 1 is fixed as the lead decided.
- Every round-3 Minor is addressed.
- No new Important finding.
- Two new Minors, both lead calls and neither blocking: the counting side effects (Minor 1) and an untested window in (b) (Minor 2).

## What I ran

Trial merge of 1b2bb3a into 31884f8, in my own detached worktree (since removed). Node 24, `npm ci` with npm 11.21.0. Every run under `flock`, none nested.

| Check | Result |
|---|---|
| tsc api / web / auth-client | 0 errors each |
| api vitest: disputes, dispute-count, schema, purge, offers, view, store, tradePublish, retention | 9 files, **164/164** |
| web vitest, full project | 60 files, **866/866** |
| auth-client vitest | 5 files, **70/70** |
| Playwright `dispute.spec.ts` + `dispute-room.spec.ts` | **22/22** |

## Round-3 findings

| # | Status | Evidence |
|---|---|---|
| I1 R38 count | **Fixed (lead decision)** | `COMPLETED_TRADES_SQL` (stage.ts:110-112) is `state = 'released' or (state = 'refunded' and dispute_by is not null)`. `stageFor` is unchanged. Task 4's `stage-tripwire.test.ts` and the stage.ts header comment are deleted. dispute-count.test.ts covers: (a) refund-to-seller counts for both sides; (b) a late deposit refunded after a release still counts for both; a plain refund does not count; a lost dispute drops no stage (Building reached). |
| M1 refund reason | **Addressed** | `NEEDS_REFUND_REASON` tripwire (dispute-tripwires.test.ts) checks the local tree only: `refund_reason` in any migration, or `refundReason` in trades/view.ts. A coordination line says the task that adds the field switches `refundReason` to it. It is green on 1b2bb3a. |
| M2 stale comments | **Fixed** | 108:13-16, 110:11-13 (`closed_at` is not the purge clock; R36 counts from `opened_at`), disputes/store.ts:12-13, and the NEEDS_PLAN_4_TASK_23 comment (running totals replace the bare record). |
| M3 purge order | **Fixed** | 108 header and a coordination line: delete appeals, then rulings, then disputes, before the trade. |
| M4 lapse copy | **Fixed** | "The funding time ran out / The escrow wasn't fully funded in time…" (COPY-UNSIGNED). |
| Auto-refund wording | **Exact** | rules.ts uses the owner's text from Plan 3 Revision 2026-10-29, Decision 7, character for character: "Payment time ran out, the seller cancelled; everything in escrow went back to the original owner." The unit test and dispute-room.spec assert the full string. |
| auth-client | **Correct** | `GET`/`POST /v1/trades/:code/dispute` and `POST /v1/trades/:code/appeal` are added to the sorted `NOT_AUTH_CLIENT` list. The web calls them through its own `api()`. |

## Where the count feeds

There is one definition, and nothing else counts `'released'` anywhere in apps/api/src. It reaches:
- **Stage / cap:** `tradeCap` (stage.ts:121) to `stageFor`.
- **`TraderSummary.completedTrades`:** summary.ts:73/83. This is the public count on offer cards and the trade view counterparty.
- **Offer list sort "trades":** offers/routes.ts:431/437 (`ct.completed`).
- **`opensAt` greying:** offers/routes.ts:445 `markOpensAt`, via `tradeCap`.

## Merge 99524ba (main d5b7fb9)

Correct:
- schema.test.ts has 102, 108 and 110 in all three lists.
- App.tsx keeps `/trade/:code`, `/trade/:code/dispute` → `DisputeScreen` and `/wallets`, once each.
- The Task 4 coordination line is struck through and re-pointed.

## Minor (new)

### 1. The count also includes system escalations where no fiat moved

The builder flagged one side effect. There are more paths, all through stage.ts:110-112 together with machine.ts:414-418 (system escalation from `lapsed` or from any closed state).

- **Builder's case.** A `settling` trade is disputed after `settleBy`, then its pre-signed buyer-cancel or auto-refund lands. It counts for both traders. This is defensible under R38: a trader opened the dispute and it settled.
- **A lapse nobody refunded.** The seller funded late or short, the buyer never paid, and the buyer was never asked to. The system escalates, the moderator refunds, and the trade ends `refunded` with `dispute_by = 'system'`. It counts as a completed trade for **both** traders.
- **A cancelled trade gets a late deposit.** A buyer-cancelled (now `refunded`) trade receives a late deposit, which is escalated and refunded. That also counts, although the trade never completed.

**Why it matters:**
- R38's reason is "money likely changed hands". On these paths it did not.
- Two colluding accounts could farm completed trades this way. Each one costs a moderator settlement, so abuse is limited and visible, which is why this is Minor.

**Possible narrowing** (lead's call; Plan 5 P5-A13 should use the same definition):
- Count `refunded` only when a trader opened one of the trade's disputes: `exists (select 1 from disputes d where d.code = t.code and d.opened_by <> 'system')`.
- Or when the trade had been released before: a `settled` / `release` row in `trade_events`.
- This keeps (a) and (b) and drops the lapse and late-deposit-after-cancel paths.
- Test: lapsed, escalated, refunded must give 0.

### 2. Test (b) does not check the count while the trade is disputed again

Scenario (b) in dispute-count.test.ts shows that a released trade with a re-escalated late deposit counts after the refund settles. It does not check the window in between. While that trade is `disputed` (between `escalate` and `settled`), it counts for neither trader, and an account can briefly drop a stage.

This was round-2 "To land on Task 4" item 6, and no decision has been recorded. Either accept the gap and add an assertion that documents it, or count `disputed` trades that were released before.

## Flagged for the owner (unchanged, not required)

- The 90-day "Open a dispute" window (question A, P3-M10).
- The footer copy "It appears on your profile as a lost dispute".

## Landing against 1b2bb3a: exact conflict resolutions

- **Textual conflict:** only `docs/coordination.md`, in one hunk after the Task 4 "Owed (… Minor 1 …)" line.
  - HEAD has the whole `## Task 27 (trader-side disputes)` section. The main line has the new `## Task 23 (BuyerPay, SellerWaiting, the paid step)` section at the same spot.
  - **Keep both sections in full, Task 27 first, then Task 23, separated by a blank line.**
  - Nothing else conflicts. package-lock.json is unchanged.
- **Semantic check, clean.**
  - Task 23's BuyerPay links "Open dispute" to `/trade/:code/dispute` (BuyerPay.tsx:484), with its own `confirmBy` wait. That reaches Task 27's DisputeScreen, so it works as is.
  - Optionally, BuyerPay could later use `DisputeEntry` for one rule set. Not required.
  - TradeRoom slots do not collide: Task 23 has buyer × `paid` and buyer × `settling`; Task 27 has `disputed` and buyer × `refunded`.
  - The `NEEDS_REFUND_REASON` and `NEEDS_PLAN_4_TASK_23` tripwires stay green: "Task 23" there is Plan 4's purge, not Plan 3's BuyerPay.
- After the merge, run tsc api/web/auth-client and the same vitest and Playwright set. All of it was green on my trial merge.
