# Review: wip/lead-job1a-paid-gate (owner Q12 paid gate), 2026-11-07

Scope: `cbf8e50e..cd657166` (the head I found after pulling; it includes the cleanup commit 43c91bc3 that deletes PayWarning, `escrowConfirming` and the pay warn mark, and the READY commit cd657166). Six commits: f57dfda8 (machine), 375d97e7 (web), a57eebd6 (e2e), 074e04d5 (READY), 43c91bc3 (cleanup), cd657166 (READY). Read-only in worktree agent-a5adefbff3f91a89f.

Verdict: **APPROVED WITH CHANGES.** One Important finding (the buyer's own paid screen loses the payment details and shows wrong copy) and some Minors. The server side and the pre-secured gate itself are correct.

## Test runs (at cd657166)

- `@x2f/trade`: 332 passed.
- `@x2f/web`: 88 files, 1254 tests passed.
- `@x2f/api` `apps/api/test/events-route.test.ts`: 8 passed (includes the new 409 too-early test).
- `e2e/pay.spec.ts` (Playwright, `--workers=1`): 21 passed. My first run was at 074e04d5 and also gave 21. The run at cd657166 waited for port 4317, which the lead-land worktree was holding, then passed 21.

## Findings

### 1. Important: after "I've paid" the buyer's screen locks the payment details again, with copy that isn't true

- Where: `apps/web/src/screens/trade/payModel.ts:153-155` (`paySecured` = `secured || refund_requested`) and `apps/web/src/screens/trade/BuyerPay.tsx:279-285` (`PaymentCard`). BuyerPay is the buyer's screen in `paid` too (`BuyerPay.tsx:51`, states `['securing','secured','paid']`), and both layouts render `PaymentCard` with no state check (`:586` wide, `:608` phone).
- Scenario: the buyer taps I've paid and the trade moves to `paid`. `paySecured` is now false, so the "Send exactly" card (total, the seller's details, the memo, the own-name warning) is replaced by the locked card. In `paid`, `escrowChip` returns `{bar: null}` (SECURED_ON), so `etaMin` is null and the card reads "Payment details / They appear when the escrow is secured." The escrow is already secured, and the buyer just paid. The buyer also loses the details and memo they paid to, which they need for checking their transfer or for a dispute. Before this branch the card showed in `paid`. The fold glance contradicts it too: `TradeGlance.tsx:149` still shows "Send exactly" with the details in step `paid` on a tabletop, while the phone and desktop rooms show the locked card.
- No test covers the card in `paid`. Every new assertion is for securing or secured.
- Fix: show the details from `secured` on, `paid` included. Either make `paySecured` true for `paid` as well (safe: `payBlock` isn't used for the button in `paid`, and PaidFlowSheet opens only when `!paid`), or give `PaymentCard` its own test, `view.state !== 'securing'`. Add a unit test that `paid` shows `[SELLER ZELLE ID]` and no "They appear…" line. The fallback string "They appear when the escrow is secured." (no minutes) then only shows when the ETA is unknown during securing, which in practice is never (see 5).

### 2. Minor: the "Opens once the escrow is secured." line uses the error style, and the board shows it as a muted caption under the button

- Where: `BuyerPay.tsx:540`. The `not-secured` block renders in the shared `notices` as `p.x2f-room__error`, and `pay.css:384` colours that `var(--x2f-danger)`, above the timer card. On the board (`wip/design-brief:docs/design-boards/BuyerPay.dc.html:144`) the same sentence is a muted caption directly under the disabled I've paid button, tied to it with `aria-describedby="pay-when"`.
- Scenario: every buyer in securing sees red "error" text for the normal waiting state, and a screen-reader user hears the disabled button without its reason.
- Fix: for `not-secured`, render the sentence as the button's muted caption with `aria-describedby`, matching the board, and keep the red notice for the real blocks. The tests select it by `[data-pay-block="not-secured"]`, so the attribute can move along with it.

### 3. Minor: the locked card's copy is missing the board's full stop, and the lock icon is missing

- Where: `BuyerPay.tsx:285`, `` `They appear when the escrow is secured, in about ${etaMin} min` ``. The board (line 99) reads "They appear when the escrow is secured, in about 14 min." with a full stop, and shows a padlock tile beside "Payment details". The unit and e2e tests match the string without the full stop, so they need updating too.
- Fix: add the full stop and the padlock icon. Update `buyerPay.test.tsx` and `pay.spec.ts`.

### 4. Minor: the parity exceptions are justified, but they live in the wrong place for the long run

- Where: `apps/web/e2e/parity.ts` `KNOWN_EXCEPTIONS.BuyerPay` (8 texts, one shared reason).
- Assessment: they are narrow enough. BuyerPay parity runs only on the securing variant (`pay.spec.ts` "BuyerPay board at 390x844: securing, 3 of 10"), and the secured Desktop parity still requires "Send exactly" and the rest. A stale exception throws (`parity.ts:325-333`). The real cause is that `design/x2f-app/BuyerPay.dc.html` is the old board, while design's newer one on wip/design-brief already shows the locked card. Because the old board doesn't have them, parity never checks the locked card's texts ("Payment details", "They appear…", "Opens once…"). Only the hand-written assertions in pay.spec cover them.
- Fix: import the newer BuyerPay board into `design/x2f-app` (or queue that) and then drop the 8 exceptions, so parity checks the locked card text. Until then this is acceptable.

### 5. Minor (note for the lead, no change asked): `secured` with coins not all unlocked still lets the buyer pay

- Where: `machine.ts:494-495`, `payModel.ts:153`. The cleanup also deleted `escrowConfirming` (which covered `secured && !releasable`), and `buyerPay.test.tsx` now asserts that I've paid opens in `secured` with `releasable: false`.
- When it happens: a top-up sent after `secured` (more coins arriving, still locked), or a deep reorg. `onChain` never moves a trade from `secured` back to `securing`.
- Assessment: I think this is right as built. The trade's own funds already have 10 of 10 confirmations and are unlocked. If the gate also required `releasable`, a seller could send dust top-ups to keep the buyer from paying while `payBy` runs (the pay timer is running in `secured`), and then ask for a refund. The owner wrote "10 of 10 confirmations, coins unlocked", so the lead should confirm this reading with the owner, or record it as a lead default.

## Confirmed safe

- **The machine, state by state** (`packages/trade/src/machine.ts:490-512`): `mark-paid` is recorded only in `secured`, or in `refund_requested` before finalAlertAt + 15 min. It returns too-early in `securing`, and wrong-state everywhere else: funding, setup, settling (including a buyer-cancel started from securing, which goes back to securing on tick), disputed, paid, lapsed and closed. Maintenance doesn't open a gap. `WHILE_PAUSED` lets `mark-paid` past the pause check, but the state checks still run, and `refund_requested` uses `base(t, now)` (frozen at the pause). `refund_requested` can only be reached from `secured` (`request-refund` requires `s === 'secured'`). A dispute can't produce paid. `onChain` moves securing to secured only when `funded && releasable`, which is 10 of 10 and every coin unlocked. The machine test covers 0, 9, and 10-but-locked as too-early, then secured as paid.
- **Every server writer of paid** goes through `apply`. `paid_at` is written only by `applyEvent`'s generic column update (`apps/api/src/trades/store.ts:173`, `:342-355`). The only `mark-paid` source is `POST /v1/trades/:code/events` (`routes.ts:42-45`, `:198-211`, TradeRuleError → 409 with its code, so `too-early` → 409 `too-early`). The disputes route sends only `open-dispute`, and cancelReturn sends only `return-confirmed` and `escalate`. No other SQL touches `state` or `paid_at`. Team members go through the same route and audit. No moderation-service path writes paid.
- **Seller side and timers**: neither depends on an earlier mark-paid. `payBy` is set only at `secured`. SellerWaiting is registered only for `secured`. TradeTimeline and the auto-refund guard (`request-refund` needs `secured` and no `paidAt`) don't change. The `trade.paid` escrow signal is sent only after the API accepts `mark-paid` (BuyerPay → PaidFlowSheet), so a too-early refusal sends nothing. The new e2e checks `escrowCalls` is `[]`.
- **Web gating before secured**:
  - BuyerPay, phone and wide: `PaymentCard` shows the locked card, and `usePaymentDetails` is never called because the hook lives in `SendExactlyCard` (the unit test asserts the source is not called).
  - The locked card carries no detail, total or memo. Its only attributes are `data-fold-glance="pay"` and `data-locked=""`.
  - I've paid is disabled through `payBlock` → `not-secured`, `onIvePaid` returns early, and a forced click opens no sheet and posts nothing.
  - TradeGlance (tabletop and cover) shows "Send exactly" and the details only in step `pay` (`secured && paidAt === null`) or `paid`, never in securing. It does show "Amount $412.50 USD" in securing, from this device's own total. That is the trade sum, not the seller's payment details, and it was there before this branch.
  - FinalAlert (`refund_requested`) is after secured.
  - No notification or push text carries payment details.
  - There is no server source for payment details yet (`paySeams.ts:8-9`, "No API carries them yet. GAP for the lead"). So for details, the "server" half of Q12 is moot today. Whoever builds that source must gate it on the server (state secured or later), not only on the web.
- **Stale secured view vs server too-early**: PaidFlowSheet treats 409 `too-early` like `wrong-state`. It closes the sheet, re-reads the trade and sends no escrow signal (covered by the new e2e).
- **E2E and unit rewrite**: no test was weakened outside the superseded warning. The removed tests are all Task 38 pay-warning behaviour, which is now deliberately gone (lead decision, 43c91bc3). The release warning's `warned` plumbing is untouched (`release.spec.ts`, design-shots `x2f.warned.release`). The old tests' securing assertions on "$412.50" and "[SELLER ZELLE ID]" moved to the secured test, and new negative assertions were added for securing, 10-locked and the phone sizes. Shot 37 was dropped with its board, and 38-39 now start from secured.

## User-facing strings added or changed

| String | Where | Source |
|---|---|---|
| "Payment details" (card title and section aria-label) | BuyerPay.tsx:283-284 | Board BuyerPay escrow=securing, line 99 |
| "They appear when the escrow is secured, in about N min" | BuyerPay.tsx:285 | Board line 99, which ends with a full stop (finding 3) |
| "They appear when the escrow is secured." | BuyerPay.tsx:285 (fallback, no ETA) | **Not on the board.** Derived by the helper. Today it shows only in the `paid` bug (finding 1). |
| "Opens once the escrow is secured." | PaidFlowSheet.tsx:78 (`not-secured`) | Board line 144 (finding 2 is about where and how it's shown) |
| Removed: "Before you pay", "Wait until the XMR is fully in escrow", the owner's two PayWarning sentences, "I'll wait", "I've already paid", the warning's confirmations bar | PayWarning.tsx (deleted) | Superseded by Q12 (lead decision) |

No API error copy was added. `too-early` from mark-paid isn't shown as text, because the sheet closes and re-reads the trade.

## Re-verify 333b7748 (fix 1593e842), 2026-11-07

Verdict: **APPROVED.** I reviewed the diff of 1593e842 and its tests. 333b7748 is the READY commit and changes no files.

- Finding 1, fixed. `paySecured` now also returns true in `paid` (`payModel.ts`), so the buyer keeps "Send exactly" with the details and the memo after paying, in both the phone and wide rooms. This matches the fold glance, which already showed them in step `paid`. It is safe: in `paid` the button is "Marked as paid" or "Finish", and PaidFlowSheet only opens when not paid. There is a new unit test for `paid` in both layouts, plus `paySecured` tests for every state.
- Finding 2, fixed. When the block is `not-secured`, the disabled I've paid button gets a muted caption, `p.x2f-pay__caption`, with `data-pay-block="not-secured"`, linked by `aria-describedby` through `useId`. The red notice now skips `not-secured`, and the other blocks keep it. A stopped or refused escrow still shows its own notice first. The unit test and pay.spec both assert that the button's describedby matches the caption id and that there is exactly one `data-pay-block`.
- Finding 3, fixed. The card text is now the board's sentence, "They appear when the escrow is secured, in about N min." with the full stop. It has the padlock tile (a new `lock` icon, the same paths as the board). The fallback with no minutes is marked COPY-UNSIGNED.
- Finding 5. The lead default is recorded at `paySecured`, as asked.
- Runs: `@x2f/web` 88 files and 1256 tests passed (1254 before, plus the 2 new tests). `pay.spec.ts` 21 passed (run under `pw.lock`).
- Finding 4 (parity exceptions until the newer BuyerPay board is imported) is still open. It is Minor and was not part of this fix.
