# Re-review round 3: wip/lead-p3-task27 @9f6587a (Task 27, trader-side disputes): CHANGES REQUIRED (docs only) (helper reviewer, 2026-10-29)

**Scope.** fe8fdfb and 5dd1549 (the main-line merges), then ef9dde5, 99eb75a, 2b6d2f0, fae54d1 and 9f6587a. I checked them against the round-2 review (`review-task27-round2-2026-10-28.md`) and against the main line at 7c43bf0, which brings in the owner's 2026-10-29 docs: R36-R38 and the Plan 3/5/7 Revision 2026-10-29. Task 4 (`origin/wip/lead-p3-task4` @ed27ad3) is **not** on the main line yet.

**Verdict.** The code is right:
- Every round-2 finding is fixed.
- The trade-room port is correct.
- Private evidence stays private.
- The merges are correct.

One Important finding remains. It is a landing contract in the docs that contradicts the main line's own 2026-10-29 plan text. The fix is a docs edit plus a lead decision. The code needs no re-review.

## What I ran

Trial merge of 7c43bf0 into 9f6587a, in my own detached worktree (since removed). Node 24, `npm ci` (npm 11.21.0), every run under `flock`.

| Check | Result |
|---|---|
| tsc api / web / auth-client | 0 errors each |
| api vitest: disputes, schema, purge, logs, identity, events-route, view | 7 files, **125/125** |
| web vitest (full project) | 57 files, **788/788** |
| Playwright `dispute.spec.ts` + `dispute-room.spec.ts` | **22/22** |

**Merge.** There are no code conflicts. Two doc files conflict:
- `docs/superpowers/specs/2026-10-14-x2f-design.md` (starter-limits bullet, about line 160): both sides state R38. Take the main line's line ("~~…~~ *Superseded 2026-10-29 (owner):* … recommend account limits …"). Task 27's ef9dde5 sentence is then redundant.
- `docs/coordination.md`: keep both sections (Task 27's and Task 28's).

## Round-2 findings

| # | Status | Evidence |
|---|---|---|
| I1 dispute identity | **Fixed** | 108: PK `(code, seq)`. Rulings use `(code, seq, round)` and appeals `(code, seq)`, both with FKs to `disputes(code, seq)`. `openSystemDispute` (disputes/store.ts:15-19) only inserts `NEXT_SEQ`; it never deletes or updates. GET and appeal read the highest seq; the appeal locks it `for update`. `NEXT_SEQ` is serialised by applyEvent's `FOR UPDATE` on the trade row. Covered by test disputes.test.ts:341 (old ruling, appeal and note kept; GET shows the new open dispute). |
| I2 retention | **Fixed (option A)** | `purgeDisputes` and its file are gone. The FKs restrict (108:17 and the two composite FKs; test :442). `closed_at` and its check are kept (110). The `dispute-exists` guard runs on `prev.dispute !== null` in `within` (routes.ts:221), and a TradeRuleError maps through `trades.dispute_by` (routes.ts:228-232). Test :405 covers a refunded trade with no dispute rows left. NEEDS_PLAN_4_TASK_23 tripwire is in place. The footer is neutral: "This ruling and its evidence are kept with the trade." (rules.ts:248). |
| M1 two EventSources | **Fixed** | DisputeScreen uses `useTradeLive` (one `liveFanOut`) plus `POLL_MS`. DisputeSlot opens no stream at all. |
| M3 rollback test | **Fixed** | disputes.test.ts:384 |
| M2, M4 | Left to Plan 4, as recorded in coordination.md. Accepted. | |

## The Task 22 port

- **Disputed slot** (DisputeSlot.tsx:26-69):
  - It reads only `GET …/dispute`, again on every new `view` the room hands it (live event, POLL_MS, `refresh()`).
  - A request still in flight is aborted on re-render.
  - A failed re-read keeps the last dispute on screen. A failed first read falls back to `disputeScreenFor`, so a disputed trade never gets the open form.
  - It never calls `getTrade` or `useEscrow`, so the escrow stays the room's.
  - After an appeal it calls `refresh()`.
  - Test disputeSlot.test.tsx:75 checks that the trade is never fetched.
- **Refunded slot.** It is registered for buyer × `refunded` only; the seller gets nothing (test :65). It shows "Open a dispute" while `disputeEntry` allows it, and "Go to the dispute" once a dispute exists.
- **Refund reasons for each path** (rules.ts:97-119). None names the seller; every line says "the seller".

  | Path | Reason shown |
  |---|---|
  | buyer cancel | `buyer-cancel` |
  | payment timeout, seller cancels (`request-refund` → auto-refund) | `auto-refund` |
  | mutual cancel | `mutual-cancel` |
  | funding/setup lapse | `lapse-refund` |
  | moderator refund recorded as mutual-cancel | the "dispute decision" line, because `dispute !== null` |

  Two edge cases go wrong; see Minor 1.
- **Private evidence.** `loadView` never returns `note` or the appeal's `why`. The destination goes only to the side the ruling pays, and only as an ending. The trade view has only `dispute: {by, at}`. Ruling `evidence` lines are moderator-written for both traders.
- **Merges.**
  - App.tsx has `/trade/:code`, `/trade/:code/dispute` → `DisputeScreen` and `/wallets`, each exactly once (app-routes test passes).
  - screens.ts imports `../dispute/DisputeSlot.js`.
  - schema.test.ts has 108 and 110 in all three lists, including the legacy-names list (fae54d1).
  - `tradePublish` is still shared.
  - NEEDS_TASK_22 and NEEDS_FU_A are retired.
- **R38.** No code changes the count or the stage. But see Important 1 for what the contract text says about it.

## Important

### 1. The R38 landing contract tells Task 4 to keep `COMPLETED_TRADES_SQL` released-only, but the main line says a settled dispute counts whoever won, and puts that on Task 27

**Where:**
- docs/coordination.md:229 on the branch ("**Task 4 owes, at its merge with Task 27:** … keep `COMPLETED_TRADES_SQL` and `stageFor` as they are").
- Plan 3 :1022 ("Completed means every completed trade, including one whose dispute the account lost").

**What the main line says (7c43bf0):**
- Plan 3 Revision 2026-10-29, "**Task 27 (dispute counting)**": "A settled dispute counts toward completed trades, whoever won".
- Plan 5 :767 (P5-A13): "`completedTrades` = released trades **plus settled disputes, whoever won**".
- R38.

**What the code does.** On Task 4 @ed27ad3, `COMPLETED_TRADES_SQL` (stage.ts:109-110) counts only `state = 'released'`. A non-release `settled` sets `refunded` (machine.ts:410).

**Failure scenarios:**
- **(a)** The buyer disputes and the ruling is refund-to-seller. The moderator settles as mutual-cancel, so the trade is `refunded`. Neither the buyer (who lost) nor the seller (who won) gets a completed trade. That breaks "whoever won" for every refund ruling.
- **(b)** A released trade gets a late deposit. It is escalated (machine.ts:415-418, from `CLOSED`). The moderator refunds the extra coins, so it settles mutual-cancel and becomes `refunded`. A trade that really completed then drops out of both traders' counts for good, and can push an account back below Building or Graduated.

**Fix:**
- Correct coordination.md:229 and Plan 3 :1022 to say: at the Task 4 merge, `COMPLETED_TRADES_SQL` counts released trades plus refunded trades whose dispute settled, e.g. `t.state = 'released' or (t.state = 'refunded' and t.dispute_by is not null)`. `stageFor` stays unchanged.
- Add a Task 4 landing test for (a) and (b).
- Alternatively, the lead records a different reading of R38. Either way, the instruction "unchanged" must not land as it is.
- Note: Plan 4's FYI (round-2 Minor 4, no seller-side settle kind) would also fix (b) at the source if a refund of late coins on a released trade kept the trade `released`.

## Minor

1. **"Refunded by the dispute decision" is inferred from `dispute !== null`, so it misattributes two paths** (rules.ts:97-103, DisputeSlot.tsx:82).
   - **(a)** Scenario (b) above: the buyer of a completed, released trade sees a "Refunded" chip and "A moderator decided this trade's dispute and the XMR went back to the seller", although they received their XMR.
   - **(b)** A `settling` trade (buyer-cancel or auto-refund) is disputed after `settleBy`. Then the pre-signed set lands (`settled` is allowed from `disputed`, machine.ts:139). The view claims a moderator decided, when nobody did.
   - The main line's Plan 3 Revision 2026-10-29 ("Tasks 25 and 27 (refund reasons)") makes each refund path record `refund_reason` on the trade (`'no-show' | 'buyer-cancel' | 'mutual-cancel' | 'ruling' | 'lapse'`), with `toTradeView` returning it.
   - Fix: add a coordination line or a tripwire so that `refundReason` switches to `view.refundReason` once that field exists. Until then, consider showing the dispute line only for `settling === 'mutual-cancel'`. That fixes (b), not (a).
2. **Comments contradict R38 and R36:**
   - 108_disputes.sql:13 ("spec 2.1 stages") and disputes/store.ts:12-13 ("counts for the stage, spec 2.1") contradict R38.
   - 110:11 says `closed_at` is "the clock for the dispute purge". R36 says a disputed trade is deleted 90 days after the dispute button (`opened_at`).
   - coordination.md:228 and the NEEDS_PLAN_4_TASK_23 comment (dispute-tripwires.test.ts) ask Task 23 to keep a per-dispute "bare record". The main line has replaced that with running totals (Plan 5 Task 20, Plan 7 Task 2) and a whole-trade delete.
   - Fix: reword these when landing.
3. **Restrict FKs versus Plan 7 Task 2.** The main line says every table with a FK to `trades(code)` "needs `on delete cascade`, or the purge deletes children first". 108's restrict FKs fit only the second option. Add a coordination line saying that the Plan 7 Task 2 and Plan 4 Task 23 purge deletes `dispute_appeals`, then `dispute_rulings`, then `disputes` before the trade. Otherwise the trade delete fails on any disputed trade.
4. **Copy for lapse-refund** (rules.ts:115). "The setup time ran out / The escrow wasn't set up in time" describes a *funding* lapse: the seller funded late or short. The owner's list says "setup or funding lapse". COPY-UNSIGNED: an owner copy item.

## Flagged for the owner (not required)

- **"Open a dispute" window of 90 days** (`TIMERS.disputeAfterRefundDays`; RefundedSlot copy at DisputeSlot.tsx:93). The owner's question A may make it 30 days. The main line also records it as open (P3-M10: longer than the 30-day delete; Plan 7 Task 2 skips refunded trades still inside the window). If the window changes, both the copy and the TIMER change.
- **Footer "It appears on your profile as a lost dispute."** (rules.ts:249) is the board's line, and an owner copy question. Under R38 it is still true for Plan 5's lost-dispute count, but no profile shows it yet.

## Landing notes

- Merge the current main line: take main's spec line, and keep both coordination sections.
- Fix Important 1 in the docs before landing. Minors 2 and 3 are wording or coordination edits that can go in the same commit.
- **Task 4 (not on the main line, @ed27ad3).** When it merges with Task 27:
  - its `apps/api/test/stage-tripwire.test.ts` (NEEDS_TASK_27) fires on `108_disputes.sql` and must be deleted;
  - delete the stage.ts:8-11 header comment;
  - keep `stageFor` unchanged (no lost-dispute term, no stage drop);
  - change `COMPLETED_TRADES_SQL` per Important 1 rather than leaving it unchanged (lead's decision; the brief's "unchanged" conflicts with Plan 3 and Plan 5 Revision 2026-10-29);
  - add `102_offers.sql` to all three schema.test.ts lists.
