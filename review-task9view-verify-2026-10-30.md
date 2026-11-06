# Verify: Task 9 view Minors M1-M5, wip/second-p3-task9-view @99ba09f, 2026-10-30

Reviewer: helper, read only. This is a verification, not a full review. It checks the branch against `~/x2f-comms/review-task9view-2026-10-30.md`. The base is task9-io 7346fc0 (merge ae14794; 7346fc0 is an ancestor).

## Verdict: MATCHES the review

M1-M5 are fixed as the review asked, both clash fixes are sound, and nothing outside scope slipped in.

## (1) M1-M5

- **M1 (done).** `apps/web/src/screens/trade/refundRules.ts:76` now reads `date(v.releaseClaimedAt ?? null, ...)`, with a comment. The test is at `apps/web/test/refundRules.test.ts:205`: it deletes the key from the view, expects no throw, and checks that `sellerRefundOpen`, `canExtend` and `canRequestRefund` give the same answers as with the full view (canRequestRefund is true). Commit d53a3b0.
- **M2 (done).** `apps/web/src/escrow/policy.ts:96` adds `signsIn(kind, role)`, derived from `ROUTE`. In `settleWait.tsx`, a trader who signs sees "N min left to sign" and anyone else sees "Being signed, N min left".
  - The test checks all 7 role×kind cases (`settleWait.test.tsx:55`). Seller × buyer-cancel and buyer × auto-refund get the neutral line.
  - "Refund sent" is kept for every refund kind, as the review recommended.
  - Commit 14b8fa3.
- **M3 (done).** `settleWait.tsx:48-50` computes `Date.parse(settleBy)` and returns null when it is NaN or `<= serverClock()`. The test covers `at(-1)`, `NOW` and `'not a date'`, and expects empty text with no timer.
  - Note, not a finding: the check runs at render time. `Countdown` ticks on its own, so a card that stays mounted across `settleBy` can still show "0 min" until the room re-renders (it polls). This is cosmetic.
- **M4 (done).**
  - (a) A `// COPY-UNSIGNED` marker is on both lines (`settleWait.tsx:40`, `:53`).
  - (b) Each item is rewritten to the main-line routing table:
    - the header comment (`settleWait.tsx:9-16`);
    - the test `describe` ("kinds no Task 23/24 screen owns", `settleWait.test.tsx:84`);
    - the coordination.md (2) bullet, which also says the release branch is unreachable in the room and closes the settling-screen decision as not needed.
- **M5 (done).** `apps/api/src/trades/view.ts:182` reads `releaseClaimedAt: t.state === 'settling' ? iso(t.releaseClaimedAt) : null`, and the field's doc comment says why. The test (`apps/api/test/view.test.ts:126`): settling → `release-claimed` → `escalate`; the stored claim is not null, and both roles see `releaseClaimedAt: null`. Commit 29b5f17.

## (2) Clash fixes

- **1796ed8** (`packages/trade/test/machine.test.ts:856`). "A new settling episode starts unclaimed" used to start from `paid`. It now starts from `secured` with `paidAt: null`. This is right: Task 39 forbids a buyer cancel in `paid`. The local main 45ebad1 makes the same fix and also sets `confirmBy: null`. That field does not matter to the assertion.
- **99ba09f** (`apps/api/src/trades/timers.ts`).
  - The timer loop query adds `or (state='refunded' and settling='buyer-cancel' and cancel_confirmed_at is null and dispute_by is null and paid_at is null)`. That is exactly the `awaitingCancelConfirm` predicate from coordination.md Task 38-39 M2.
  - The tripwire file `cancel-timer-tripwire.test.ts` is deleted.
  - A new test in `timers.test.ts` checks: no close at exactly 48 h, a close at 48 h + 1 ms, and nothing more after that.
  - The SQL is byte-identical to local main's 36e728a. Only the comments and the test differ.
- **The two merges.** I checked both with `git show --remerge-diff`:
  - **ae14794:** TradeRoom keeps Task 40's `<Panes>` and the `SettleWait` import, and its `main=` fallback is `<StatusCard view serverClock={clock}/>`. It also adds `releaseClaimedAt: null` to payBoard.ts and buyerPay.test.tsx. This is exactly the review's guidance.
  - **7359af1:** the merge of the main line 5c4d35b. Each conflict is resolved correctly:
    - schema.test.ts has 113 and 116;
    - `policy.ts` keeps `signsIn` and main's `BUYER_CANCEL_STATES` without `paid`;
    - `machine.ts` takes the union: SYSTEM_EVENTS has both `release-claimed` and `return-confirmed`; escalate allows `settling` and keeps the `awaitingCancelConfirm` exception; `nextDeadline` keeps the claim rule and adds `case 'refunded'`;
    - coordination.md was rewritten correctly.

## (3) Nothing else slipped in

In `git log 7346fc0..99ba09f`, the commits that are not main-line commits (5c4d35b and its ancestors) are:
- 5bb387c and fe96aab, which the first review already covered;
- d53a3b0, 29b5f17 and 14b8fa3, which are M1-M5;
- the merges ae14794 and 7359af1;
- the clash fixes 1796ed8 and 99ba09f.

Each diff touches only what its message says. The trial merge onto 36e728a changes these files relative to main: view.ts, view.test.ts, e2e fund/refund/refundViews, api/trade.ts, policy.ts (signsIn), payBoard.ts, TradeRoom.tsx, refundRules.ts and its test, settleWait.tsx and its test, buyerPay.test.tsx, tradeFund.test.tsx, and coordination.md. Each one is view work. The result's machine.ts is identical to main's.

## (4) Predicted conflicts

**View branch 99ba09f onto the local main line 36e728a** (`git merge-tree`): 3 textual conflicts. All three come from the same fix having been made twice, once on each side.

| File | What conflicts | Resolution |
|---|---|---|
| `apps/api/src/trades/timers.ts` | only the doc comment and the code comment; the query is identical | take main's (ours) |
| `apps/api/test/timers.test.ts` | two versions of the same 48 h auto-close test | take ours. Do not keep both: that would duplicate the test. Optionally take the branch's, whose boundary check is slightly stronger (exactly 48 h, then +1 ms) |
| `packages/trade/test/machine.test.ts:855` | the same `secured`, unpaid rewrite | take ours |

- coordination.md auto-merges. Its Task 38-39 M2 line then says "Done 2026-10-30 on `wip/second-p3-task9-view`". The lead may want it to name the main-line commit 36e728a instead. This is optional.
- I tried this exact resolution (all three files `--ours`) in my worktree:
  - the lockfile is unchanged;
  - tsc for web, api and trade: 0 errors;
  - api view.test + timers.test: 14/14;
  - web, 8 files (settleWait, refundRules, policy, tradeRoom, buyerPay, fold, tradeFund, copy-lint): 209/209.

**`origin/wip/second-p3-task10` @305124b.** It conflicts on the same 4 files whether or not the view branch has landed: main+view gives the same set as main alone, so the view adds no conflicts with Task 10.

| File | What conflicts | Resolution |
|---|---|---|
| `timers.ts` | comments only (Task 10 mirrored 99ba09f's text) | take either side |
| `timers.test.ts` | (a) the import hunk | keep Task 10's `readFileSync` and `fileURLToPath` imports |
| | (b) the duplicate 48 h test | keep one |
| `machine.ts:494` | escalate's state guard | take Task 10's line (adds `s !== 'refund_requested'`) and its comment. The `awaitingCancelConfirm` line below it is outside the hunk, so it is kept |
| `machine.test.ts:855` | the same `secured` rewrite | take either side |

Then run tsc for trade, api and moderation, plus trade machine, api timers and Task 10's moderation tests.

## Tests

All runs were in my own detached worktree, one at a time under `flock ~/x2f-comms/check.lock`, after `npm ci` with pinned npm. The worktree has been removed, and ~/x2f was not touched.

At 99ba09f:
- tsc `apps/web`, `apps/api`, `packages/trade`: 0 errors.
- vitest @x2f/web, 15 files: 322/322 passed. The files were settleWait, refundRules, policy, tradeRoom, tradeRoom-tripwires, tradeRoomEscrow, buyerPay, release, fold, tradeFund, copy-lint, cantDoThat-lint, refundFlow, sellerRefund and refund-tripwires.
- vitest @x2f/api `view.test.ts` + `timers.test.ts` (Postgres via sg docker): 14/14 passed.
- vitest @x2f/trade `machine.test.ts`: 146/146 passed.
- Playwright `refund.spec.ts` (apps/web, `-c e2e/playwright.config.ts --workers=1`, X2F_CHROMIUM_PATH=/usr/bin/chromium): 21/21 passed. This includes the claimed/unclaimed phone tests.

On the trial merge onto 36e728a: tsc 0 for all three; api 14/14; web 209/209 (above).
