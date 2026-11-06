# Review round 2: origin/wip/lead-design-fold @e02c1e9 (design review item 7, foldables)

Reviewer: RV1 helper (read-only), 2026-11-06. Range: `git diff e7636c7...e02c1e9` (41 files, +1333/-163; fold fixes 98f87e0, 2a888ba, e85ebd9, 32f963f, shot 54 reshoot, two main-line merges, e02c1e9 test helper).
Round 1: ~/x2f-comms/review-lead-design-fold-2026-11-01.md.

## Verdict: APPROVED WITH MINOR

Every round-1 item is fixed, with tests. The money flow did not change: the take call, `payBlock` and BuyerPay's gate are as before. The glance now uses BuyerPay's own gate, so it never says "Pay now" or "Send exactly" while the pay screen blocks paying. I found no Important issues. Four Minors and three nits follow. One of the Minors (m1) is a copy/product call for the lead.

## Checks run

All runs were under `flock ~/x2f-comms/check.lock`, one at a time, in my own detached worktree `~/x2f-worktrees/rv-fold2b` @e02c1e9 after `npm ci` with npm 11.21.0. I removed the worktree at the end.

| Check | Result |
|---|---|
| `tsc --noEmit -p apps/web` | pass (exit 0) |
| `vitest run` fold, quoteScreen, browse, myOffers, kit-selection, loginApproveV2 + 1 reviewer probe (uncommitted) | **7 files, 128/128 passed** |
| Probe rerun with assertions (glance while the escrow still confirms, m1) | 2/2 passed: confirms the behaviour described in m1 |
| api / trade / Playwright | not rerun: the api and trade packages are not touched by this diff (web only), and the reported PW 454 green covers fold.spec's new two-pane, tabletop and cover cases. I had no specific doubt there. |

Note: `~/x2f-worktrees/rv-fold2` already existed (from an earlier reviewer, with an untracked `zz-reviewprobe.test.tsx`). It is not mine, so I left it alone and used `rv-fold2b`.

## Round-1 items

| Item | Status | Evidence |
|---|---|---|
| **I1** glance says pay while the device says don't | **Fixed** | TradeGlance.tsx:54-58: for the buyer's `pay` step, the warning is `payBlockText(payBlock(view, escrow))`, the same gate as BuyerPay (payModel.ts `payBlock`: stopped, refused except amount-out-of-range, not ready, no amount, amount-differs, total-wrong). The pill is null beside a warning (:85). The cover's "Send by …, then tap I've paid" is null beside a warning (:123). PayFacts is gated on `warning === null && total !== null` (:149). Tests: fold.test.tsx "TradeGlance follows the pay gate": 7 blocked cases × 2 layouts, no "Pay now", "Waiting for your payment", "Send exactly" or "then tap I've paid", and the warning is shown. |
| **I2** tabletop hides the own-name and gift-card lines | **Fixed** | TradeGlance.tsx:242-249: PayFacts carries the own-name line and `GIFT_CARD_WARNING` (danger). fold.css:172-176: the PaymentCard is hidden only while the glance renders `[data-glance-pay]`, so "No total yet" keeps the card in the bottom half. Tests: own-name and gift-card on tabletop. |
| **M1** fold remounts the quote: double take, lost refusal | **Fixed** | quoteKept.ts (new): a per-offer module store for busy, error, closedError, back, blockedPoster, chatHint and amount, with a mount count. Entries are dropped on a deferred unmount (setTimeout 0), so the remount in a fold's same commit keeps them, and are kept while a take is in flight. useTake.tsx:84 guards on `readQuote(offerId).busy`. Tests: quoteScreen.test.tsx "a take in flight stays in flight across an unfold" (1 take only; the refusal reaches the new quote and survives folding back) and "You're back stays across an unfold". |
| **M2** typed amount follows to other offers | **Fixed** | Kept per offerId and dropped when no quote for that offer is mounted (quoteKept.ts:53-57, :76-83). Test: "on a phone a typed amount stays with its offer … starts empty". |
| **M3** no layout-switch test | **Fixed** | quoteScreen.test.tsx "unfold and fold back keep the amount, its unit, the wallet and the picked offer, with one quote mounted" (phone → two → phone → two, with 1 `[data-screen=quote]` each time). e2e fold.spec.ts Fold-Offers: pick, fold to phone, same quote, Back to the list. Not covered: "the list is not refetched" (acceptable). |
| N1 empty side pane | Fixed | OffersRoute.tsx:59 (`shown !== null ? … : null`). |
| N2 bare "62 min" on the cover | Fixed | TradeGlance.tsx:181 (the label is dropped only when `timer.left`). |
| N3 no Back on a tabletop | Open (question 2) | fold.css:172 still hides `[data-fold-glance='header']`. |
| N4 pick row drops badges | Noted, unchanged | OfferCard.tsx:161-179. |
| N5 pick row's accessible name | Fixed | MyOffers.tsx RowText: `aria-labelledby` = title + methods; `aria-describedby` = status (+ why). Tested. |
| N6 detail switch | Fixed | MyOfferDetail.tsx uses the kit `Switch`; the test checks the same class as the list's. |
| N7 design-shots add/add | Resolved by the main-line merges | — |

## Important

None.

## Minor

**m1. While the escrow is still confirming, the glance says "Pay now" and the room says "Wait until the XMR is fully in escrow".**
apps/web/src/screens/trade/TradeGlance.tsx:73-77 (`glanceStep`), :84-86 (`glancePill`), :123 (cover note); BuyerPay.tsx:450 (`warnOpen … escrowConfirming(view)`).
- The case: state `secured`, `releasable: false`. This is possible: machine.ts:317 sets `payBy` on securing, and the unlock follows later.
- What the buyer sees:
  - **Cover:** the pill "Pay now", "62 min left" and "Send by Zelle, then tap I've paid".
  - **Tabletop:** "Waiting for your payment" and "Send exactly $412.50 …".
- Meanwhile BuyerPay opens PayWarning, "Before you pay / Wait until the XMR is fully in escrow", with "I'll wait" as its primary. After "I'll wait" closes it, the glance keeps saying "Pay now".
- My probe confirms this: PAY_SECURED with `releasable: false` → `escrowConfirming = true`, and the cover text contains "Pay now" and "then tap I've paid".
- It is not a gate breach. Paying early is allowed after the warning, and BuyerPay itself still shows the payment card. But the glance's one instruction is the opposite of the device's advice.
- `releasable` is the API's field, and the glance deliberately leaves out the API's escrow chip (Task 40 I1). So which pill to show is a design/copy call. See question 1.

**m2. With nothing picked yet, a quote begun in the pane is lost on a fold.**
OffersRoute.tsx:42-46, :59; quoteKept.ts:53-57.
- Scenario, on an unfolded Fold at `/sell/ZELLE`:
  1. The pane shows the first offer's quote (`first`; the URL stays the list's).
  2. The person types 100 (or taps Trade), then folds.
  3. The phone branch has no `offerId`, so it shows the list. The quote unmounts and its entry is dropped.
  4. Tapping Trade on that same offer opens an empty quote: `onTrade` carries only the currency, though `amount` sits in the list URL.
- If a take was in flight, it goes on. A success still navigates to the trade. A refusal answers into a dropped entry, so it is never shown (dropIfLeft: mounted 0, busy false).
- No money risk: no second take, and nothing is taken without a tap.
- Fix: on the first input or Trade tap in the pane quote of `first`, `navigate(quotePath(...first...), { replace: true })`, the same as `onPick`. The pick is then in the URL and folding keeps it.

**m3. On a tabletop, with no seller payment details, "where to send" is gone.**
TradeGlance.tsx:229-233 vs BuyerPay.tsx:279.
- The case: `usePaymentDetails` returns null (details not loaded, or the seam not installed).
- PaymentCard falls back to "`<method>` to: Ask in the chat". PayFacts shows nothing in its place.
- On a tabletop PaymentCard is hidden (fold.css:174), so the buyer sees "Send exactly $412.50 USD by Zelle" and the memo, with no recipient and no pointer to the chat.
- Fix: the same fallback row in PayFacts (`details ?? [{ label: `${method.name} to`, value: 'Ask in the chat' }]`).

**m4. A ticked paused offer on My offers draws a dashed ink line plus a solid inset ring.**
ui.css:1576 (`border: 1px dashed` when off) + :1582-1585 (`border-color: ink; box-shadow: inset 0 0 0 1px ink`).
- Round 1 drew ticked as a 2 px inset shadow, which overrode the dashed look. Now the 2 px line is half dashed, half solid on paused cards, a phone change too.
- Fix: for `[data-selected='true']`, set `border-style: solid` (or keep the 2 px inset shadow). Design call if the dashed look is wanted.

## Nits

- **n1** MyOfferDetail.tsx:34: the switch's `aria-describedby` is the status only. The `why` line (:27) has no id and is not referenced, while the list's switch includes `-why` (MyOffers.tsx:277).
- **n2** Board drift (info, not a finding): Fold-Tabletop.dc.html on origin/wip/design-brief, changed 2026-11-06 in 88b90fa "cohesion pass".
  - Its pill now reads "Pay now" on the tabletop too, where the code has "Waiting for your payment". That copy is only in `design-boards-inprogress/`.
  - It adds a cancelled state, "Returning XMR to the seller".
  - The NEEDS_DESIGN_FOLD_GLANCE tripwire still holds: the boards are not in design/x2f-app/. When they land, match the glance to them.
- **n3** quoteKept.ts:81: the deferred drop relies on the new instance mounting in the same commit as the unmount. That holds for OffersRoute's two branches (one Panes element), and the tests pin it. A comment at OffersRoute that the phone and pane QuoteScreens must stay in one render tree would guard it against a later split (for example a Suspense boundary).

## Copy (COPY-UNSIGNED)

- These new strings are from the boards on wip/design-brief and need no mark:
  - Fold-Cover: "Open on main screen", "Open your phone to keep going.", "Send by …, then tap I've paid", "Left for … to check and release", "Pay now", "You paid", "Dispute open"
  - Fold-Tabletop: "Seller confirms within", "Put this in the … memo so … can match your payment.", "ends …"
  - Fold-MyOffers: "Who can trade", "Percent of the market price…", "A fixed price doesn't follow the market…"
- These are marked COPY-UNSIGNED: "Time left", "Amount", and the tabletop's use of the Cover line (TradeGlance.tsx:129-131 comment).
- "Waiting for your payment" and "Paid · waiting for …" (tabletop) are now only in the in-progress board (n2).
- The PayFacts own-name line and the gift-card warning reuse the signed PaymentCard text verbatim.
- No unmarked new user-facing copy found.

## a11y

- The cover's one live region is `role="status"` for its own button; the warnings have no role (tested).
- The pane quote draws no `<main>` (`Main = 'div'`) and sits in `<aside aria-label="Quote">`.
- Pick rows are `<button aria-pressed>` with a 44 px minimum and an ink focus ring.
- My offers: the shown row has an inset 2 px line, distinct from the ticked ring (round-1 question 4 answered this way).
- No duplicate ids: only one QuoteScreen is mounted (tested).

## Open questions (for the lead / owner)

1. **m1:** while the escrow still confirms (`secured`, not releasable), what should the glance show?
   - (a) Keep "Pay now". This matches the board, which draws no confirming state.
   - (b) A neutral pill such as "Escrow confirming" (COPY-UNSIGNED), and no "then tap I've paid" note.
   - (c) Ask design to add a confirming state to Fold-Cover and Fold-Tabletop.
   - **Recommendation:** (b) now, and (c) for the final copy. Using `releasable` for a pill is a view of the trade's state, not the API escrow chip that Task 40 I1 kept out.
2. **Round-1 N3, still open:** on a tabletop the bottom half has no "Back to trades" or method explainer (the header is hidden). The 6 Nov board still has no back link in the bottom half. Accept, or keep a back link? Recommendation: accept, per the board, and revisit with the board landing.
3. **n2:** the 6 Nov Fold-Tabletop pill is "Pay now" (the code has "Waiting for your payment"). Change now or wait for the boards to land in the canvas? Recommendation: wait (tripwire).
