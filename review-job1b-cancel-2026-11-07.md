# Review: wip/lead-job1b-cancel (Job 1 cancel rules), 7 Nov 2026

- Scope: `cbf8e50e...1260bc84` (7 commits: 0eadf1e4, d5db90dc, 94616ed1, a0b41e2a, 20f2da0e, 38601781, 1260bc84 READY). Reviewed head **1260bc840c2937f37249871dac98bdcacdb91482** (origin/wip/lead-job1b-cancel, which includes the per-pair nudge gap and the final-alert comment).
- Reviewer: independent, read-only (nothing in the worktree was changed).
- Typecheck (`npm run typecheck`): clean.

## Verdict: APPROVED WITH CHANGES

The money rules hold. The server refuses `request-refund` until `payBy` has passed and the seller has nudged since `securedAt`. Only the seller's accepted nudge, in that trade or its linked chat, while the trade is `secured`, writes the column, and no event or pause clears it. Two things should change before landing. First, the PayWarning retirement should go in only with, or after, Job 1a's Q12 gate (#1). Second, the nudge route takes its locks in the opposite order to the events route (#2).

## Findings

### 1. Important: the pay warning is retired before Q12's "no I've paid before secured" gate exists
- Where: `apps/web/src/screens/trade/BuyerPay.tsx:446-450` (onIvePaid opens the sheet directly; the PayWarning mount is gone). Tests changed to match: `apps/web/e2e/pay.spec.ts:261` and `apps/web/test/buyerPay.test.tsx:425` (the Task 38 warning tests are replaced by "never opens"). `design-shots.spec.ts` drops shot 37-trade-pay-warning.
- Scenario: this branch is on main cbf8e50e. On that base, BuyerPay is still the buyer's screen in `securing` (slot `states: ['securing','secured','paid']`). There, "I've paid" is gated only by `payBlock` (escrow phase/refusal/total), not by the trade state. With 1b alone, a buyer can open a still-confirming trade and tap I've paid → Mark as paid with no warning. Before, the owner-worded warning "Wait until the XMR is fully in escrow" would have opened. The owner's Q12 answer is "they cannot say paid until the full escrow has been funded". That gate is on `wip/lead-job1a-paid-gate` (375d97e7, 43c91bc3: hides I've paid before secured and deletes PayWarning), which is not in this branch or on origin/main.
- The brief lists this change only as "BuyerPay CancelFinalSheet". The warning removal and the deleted warning tests go beyond "the dropped FinalAlert-step assertions".
- Also: PayWarning.tsx is left as dead code, and buyerPay.test still imports `PAY_WARNING_LEAD`. 1a deletes that file.
- Fix: land 1a first, then rebase 1b onto it and drop 1b's own PayWarning changes, keeping 1a's. The alternative is to take the PayWarning hunks out of 1b. Expect conflicts with 1a in BuyerPay.tsx, buyerPay.test.tsx, pay.spec.ts, design-shots.spec.ts, parity.ts, machine.ts and machine.test.ts (all 7 files are changed by both branches).

### 2. Important (rare, self-resolving): the nudge route locks in the opposite order to the events route, so the two can deadlock
- Where: `apps/api/src/nudge/routes.ts:155` (locks both accounts `for no key update`) and then `:183` (`recordSellerNudge` → `update trades ...` takes the trade row lock). The events route's `applyEvent` (`apps/api/src/trades/store.ts`, `loadTradeRow(client, code, true)` = `for update`) locks the trade row first. Its `before` hook then calls `requireLiveSessionInTx` → `lockAccount` (`apps/api/src/auth/hold.ts:377-378`, `for no key update` on the actor's account). The documented convention is "trade row first, then account" (trades/take.ts wallet route comment; trades/routes.ts round-5 M2 comment).
- Scenario: the trade is `secured`. The seller taps Nudge just as the buyer taps "I've paid" (or Cancel trade). This is the moment the two actions are most likely to coincide, because the nudge is what prompts the buyer.
  - The events transaction holds the trade row and waits for the buyer's account.
  - The nudge transaction holds both accounts and waits for the trade row in the UPDATE. (The row matches `state = 'secured'` in its snapshot, so the UPDATE waits on it.)
  - Postgres reports deadlock 40P01 and aborts one of them, so the buyer's mark-paid or the seller's nudge gets a 500.
  - Nothing is corrupted: both are transactions, and the web retries. But it is a new failure path on the money route, and it did not exist before this branch, when the nudge route never touched `trades`.
- Fix: in the nudge transaction, lock the trade row before the accounts. The simplest way is to run `recordSellerNudge` straight after `begin`, before the accounts lock. A later 429 or any error still rolls it back, because it is the same transaction. If you prefer, do a `select ... for no key update` on the trade first instead. Add a comment naming the order. A test that runs a nudge alongside mark-paid would be welcome but is not required.

### 3. Minor: no API test runs the whole chain from a real nudge to an allowed refund
- Where: every API test that reaches `refund_requested` uses `markSellerNudged` (a direct SQL write; `apps/api/test/helpers/trades.ts:82-89`) in site, team and tradePublish. nudge.test.ts checks the column write, and machine.test checks the rule, but none chains them.
- Fix: add one test in nudge.test.ts or trades.test.ts. Drive a trade to `secured` and pass `payBy`, then POST events `request-refund` and expect 409 `too-early`. Then POST `/v1/nudges` as the seller with the trade code, POST `request-refund` again, and expect 200 `refund_requested`. Optionally, a nudge sent while `securing` should still leave the refund refused.

### 4. Minor (for the lead or owner): inside open trades nudges are now uncapped and ignore blocks, including in long-open states
- Where: `apps/api/src/nudge/routes.ts:143-145,178`. `'open-trade'` means `closed_at is null` (`nudge/wiring.ts:17-19`). That includes `disputed`, `lapsed` with funds, and `paid`, not only `secured`.
- Scenario: the trader is in a dispute with someone they blocked. The other side can nudge them every 15 minutes for as long as the dispute lasts (96 a day). Before this branch, the recipient cap limited this to 3 delivered nudges an hour from everyone together, block or not.
- This follows the owner's 7 Nov line ("one per 15 minutes, as many as needed"), and the per-pair gap is the lead's 7 Nov call, so this is not a defect.
- Outside open trades nothing new opens up. The 3-per-hour recipient cap still applies to delivered nudges, and a shared context is still required. The per-pair gap lets one sender reach several people in parallel, but each recipient stays capped.
- Suggestion: ask whether the no-cap rule should cover only the pre-paid states (`securing`/`secured`, where the refund rule needs it), with the 3-per-hour cap kept in `disputed`/`lapsed`. Otherwise, record it as accepted.

## Confirmed safe

- **A real nudge is required.** `recordSellerNudge` (routes.ts:113-123) updates the trade only when all of these hold:
  - the sender is the trade's `seller_account_id`, and the recipient is its `buyer_account_id`;
  - the trade is in `state = 'secured'`;
  - the context is that trade's code, or a chat whose `trade_code` is that trade.
  - So a nudge to a different buyer does not count, nor does one from the buyer, one before secured (state `securing`), or one through another trade's chat (that only marks the other trade, and only between the same pair).
  - A 429 (too-soon) or 403 rolls back before the write.
  - A replay needs a full trader session and is itself rate-limited, and the first time is kept (`seller_nudged_at is null or < secured_at`).
  - A nudge blocked by the buyer, or dropped (nudges off, quiet hours, disabled), still counts. This is required for privacy: if it did not count, the lock state would show the buyer's settings. The buyer still gets the 15-minute final alert before any refund.
- **The machine checks it again**, at `packages/trade/src/machine.ts:533-534`: `sellerNudgedAt >= securedAt` is required as well as `past(now, payBy)`. The `securedAt` comparison guards against stale values.
- **Nothing overwrites it.** `stateColumns` (store.ts:156+) does not include `seller_nudged_at`, so trade events never write it, and the machine test shows that extend and tick keep it. Every trade load uses `select *`, so the column is always read. `request-refund` loads the trade row `for update`, so it sees a committed nudge or waits for one.
- **Pause and maintenance.** Pause is a flag (`pausedAt`), not a state, so `request-refund` is refused while paused (machine.ts:457). `onResume` shifts `payBy` and leaves `sellerNudgedAt` and `securedAt` alone. A nudge during a pause still counts, which is correct: the seller did nudge. The 90 minutes are still `payBy = securedAt + 90` plus extensions, shifted by pauses.
  - Note: "from full funding" (g66) is implemented as "from secured" (funded and unlocked). That was true before this branch and matches the buyer copy ("The clock starts once the escrow has settled"). It is listed only for awareness.
- **Buyer cancel.**
  - The server refuses `buyer-cancel` once `paidAt` is set (machine.ts:539). That rule was already there before this branch.
  - The web side re-reads the trade before posting (`onCancel`) and does nothing if the fresh view is paid. The sheet opens only while `cancelMode !== 'none'`, so it closes if the view turns paid.
  - The sheet's Cancel button is disabled while busy. Keep trading has focus.
- **Rate limit.** The gap is per sender and recipient (`from_id = $1 and to_id = $2`, routes.ts:156-159). It is 15 minutes with no count cap, and dropped nudges count toward it. The answer is the same `{ok:true}` 202 in every accepted case. The trade view's `sellerNudgedAt` goes only to the two parties and shows nothing about the buyer's settings.
- **Migration 119.** It only adds `alter table trades add column seller_nudged_at timestamptz` (nullable, no default). On Postgres that changes metadata only: there is no rewrite, and the lock is brief. The number is unique across all remote branches. It appears in all three expected lists in schema.test.ts.
- **Tests.** The machine tests' switch from `secured()` to `nudged()` keeps every earlier assertion and adds coverage for the lock. On the web, the FinalAlert steps moved to the RefundRequested screen (FinalAlertSteps) and are not deleted; refund.spec checks they are gone from the pre-tap screen. Nothing else was weakened, apart from #1 (the pay-warning tests).
- **Parity exceptions** (`e2e/parity.ts`, SellerRefund): the three FinalAlert step lines (owner G2; the G2 board on wip/design-brief drops them) and "Nudge mira.k" (the locked primary; the board's available state says "Nudge again"). They are narrow and justified.
- **The 15-minute final alert stays**, with a comment at machine.ts:533 (lead decision).

## Test runs (head 1260bc84)

- `@x2f/trade`: 334 passed.
- `@x2f/api` (full project): 76 files, 1824 passed, 1 todo. No flake this run, and identity.test passed.
- `@x2f/web`: 88 files, 1261 passed.
- `@x2f/moderation`: 11 passed.
- Playwright `e2e/refund.spec.ts` and `e2e/pay.spec.ts` (`--workers=1`): 40 passed (1.3 min). The parity-pixel notes were reported as non-blocking, as usual.

## User-facing strings added or changed

All of these are from the boards on wip/design-brief, and I found each one there. All are unsigned (the owner's P4 wording page has not signed them off yet).

| # | String | Where | Source |
|---|---|---|---|
| 1 | "Cancelling is final" (sheet title) | CancelFinalSheet.tsx | Owner G56 (the brief's rule) and the CancelRequest board |
| 2 | "The {X} XMR goes back to {seller} and this trade closes. Don't send any money after you cancel. If you've already paid, don't cancel: tap I've paid instead." | CancelFinalSheet.tsx | CancelRequest board (docs/design-boards/CancelRequest.dc.html) |
| 3 | "Cancel trade" / "Keep trading" (sheet buttons) | CancelFinalSheet.tsx | CancelRequest board |
| 4 | "Your {X} XMR is still safe in escrow. Nudge {buyer}, or give them more time." (locked lead) | SellerRefund.tsx:190 | SellerRefund G2 board |
| 5 | "Nudge {buyer}" as the locked primary (was a secondary) | SellerRefund.tsx:221+ | SellerRefund G2 board |
| 6 | "No word from {buyer}? After 90 min and at least one nudge, you can cancel and get your {X} XMR back." | SellerRefund.tsx:229 | SellerRefund G2 board |
| 7 | "Nudge again" | SellerRefund.tsx:241 | SellerRefund G2 board |
| 8 | "You can nudge again every 15 min, as often as you need. You can cancel now." | SellerRefund.tsx:245 | SellerRefund G2 board; the 15-minute rule is the owner's 7 Nov line |
| 9 | "You can nudge once every 15 minutes." (was "10 minutes") | ui/cantDoCodes.ts | Owner's 7 Nov line |

Removed from screens:
- (a) The three final-alert steps are gone from the pre-tap SellerRefund card (owner G2). They are still shown on the requested screen.
- (b) The PayWarning dialog: the owner's "Wait until the XMR is fully in escrow" text, "I'll wait" and "I've already paid". This rests on Q12 (see #1). The late-dispute paragraph is unchanged; it moved from a list item to a paragraph.

None of these strings needs flagging as off-source.

---

## Re-verify 687ae821 (8 Nov)

- Scope: what changed between `1260bc84` and `687ae821` (the combined Job 1: 1a 333b7748 merged, review fixes 00660f36, design refs 0ed7a406/b25fc37a/1c8e67f1, SellerRefund 088c9830, main 1d6979d0 via e98727a5, parity 87660993, boards-fixture 0bc3442e). Worktree fast-forwarded to 687ae821; nothing was edited.
- Ran: Playwright `refund.spec.ts`, `pay.spec.ts` and `parity.spec.ts` (`--workers=1`, under pw.lock): **93 passed** (3.0 min). I did not re-run the full Vitest suites, as you asked.

### Verdict: APPROVED

- **The 1a/1b merge in BuyerPay.tsx is correct.**
  - Q12 gate: `payBlock` returns `not-secured` before secured (payModel.ts:173). "I've paid" is then disabled, with the board's muted caption (BuyerPay.tsx:525-532).
  - The machine also refuses `mark-paid` in `securing` with `too-early` (machine.ts:503).
  - Cancel sheet: Cancel trade opens `CancelFinalSheet` (BuyerPay.tsx:550, 615-624), with the fresh re-read before `buyer-cancel` kept.
  - PayWarning.tsx is deleted. No `PayWarning` or `escrowConfirming` reference is left in src, test or e2e. `warned.ts` remains only for SellerConfirm's release warning, which is correct.
  - Finding 1 is resolved.
- **Finding 2 (lock order) is fixed.**
  - `lockTradeAndRecordNudge` runs straight after `begin`. It locks the open trade row (`for no key update of t`, the pair either way round, `closed_at is null`), and only then are the accounts locked (routes.ts:176-182). That is the events route's order: trade row, then account.
  - The `seller_nudged_at` write still requires all of: the sender is the seller, `state = 'secured'`, and the first nudge since `secured_at`. It is in the same transaction, so a 429 rolls it back.
  - The new test holds the trade row the way an events transaction does, takes the buyer's account while the nudge waits, and gets a 202 rather than 40P01.
  - Nit, not blocking: the wait loop does not assert that the nudge actually blocked, so the test would also pass if it never waited.
- **Finding 3 is fixed.** There is now an end-to-end test (nudge.test.ts):
  - a nudge while `securing` does not count;
  - `request-refund` past payBy gets 409 `too-early`;
  - a real `POST /v1/nudges` follows;
  - `request-refund` then gets 200 and the state is `refund_requested`.
- **Finding 4 is fixed.**
  - The 3-per-hour cap is lifted only for `secured`, `refund_requested` and `paid` (`UNCAPPED_STATES`).
  - It stays for `disputed`, `lapsed`, `securing`, pre-trade chats, and any context where no trade row is found (`trade === null`).
  - A block is still ignored in any open trade. That is unchanged (Task 37 N1).
  - There is one test per state.
- **SellerRefund now follows the refreshed G2 board** (design/x2f-app/SellerRefund.dc.html at HEAD). I checked each string against the board's text:
  - "If {buyer} paid after all" (card heading, was "If you cancel")
  - "Cancel and get refund" (was "Cancel & get refund"; only code comments in refundFlow.ts still say "&")
  - "You can nudge again every 15 min, as often as you need. You can cancel now and get your {X} XMR back."
  - "No word from {buyer}? After 90 min and at least one nudge, you can cancel and get your {X} XMR back."
  - "Nudge again"
  - "…or give them more time." / "You can take it back…"
  - Amounts now show six decimals ("1.250000 XMR", mono digits), and "Give 30 more min" has a mono 30.
  - `Xmr` uses `BigInt(atomic)`, as `xmrText` did, so a bad value fails the same way as before. CancelFinalSheet is unchanged since 1260bc84.
  - All of these strings come from the board and are still unsigned ("Draft copy" on the board).
- **The parity.ts harness change cannot hide a mismatch in real app copy.**
  - (a) Parity checks one way only: board text must be on the page. Dropping board text can only loosen the check for that text. It never stops a check of app copy, because app copy that is not on the board was never checked.
  - (b) The "Draft copy" filter drops only a sentence that is exactly "Draft copy". On the three boards it is a lone badge `<span>`.
  - (c) The `[aria-label="Design notes"]` removal: on BuyerPay, CancelRequest and SellerRefund that is a `<section>` of notes after the app frame (border-top). I read all three, and none holds app copy.
  - Optional hardening: limit the removal to a `section[aria-label="Design notes"]` that is not inside the app frame, so a future board cannot wrap real copy in that label.
- **The remaining exceptions are narrow.**
  - BuyerPay and SellerRefund: the trader-card tokens (kit Job 2, not built).
  - CancelRequest: the v2 pay-step tokens under the sheet (Job 4) and the masked "Zelle to" example (the owner's open question on the board).
  - Exceptions match only a board element's whole text exactly. The sheet's own paragraph ("The 1.250000 XMR goes back to…") is one element with its own text, so it is still checked in full even though "1.250000" and "XMR" are listed as exceptions.
  - The old SellerRefund final-alert exceptions are gone, because the refreshed board no longer has those lines. Stale-exception detection is still on.
- **The boards-fixture test** now compares the boards' text with tags stripped instead of the raw markup, because the refreshed boards put the code in a mono span. The assertion is the same string (`Trade <code> · <method>`), so it is not weaker.
- Outside this review: BuyerPay.tsx:122's securing tip ("…feel free to move the trade along now.") came in with 1a, so I did not review it here. With I've paid locked until secured it is harmless, but someone should check it against the BuyerPay board if 1a's review did not.
