# Review: origin/wip/lead-design-fold @a0552ee (design review item 7, foldables, shots 51-56)

Reviewer: subagent, 2026-11-01. Range `git diff 52b7a0e..a0552ee` (2 commits: cb0aac3 code, a0552ee shots).
Worktree `~/x2f-worktrees/review-fold-design` (detached at a0552ee, clean, nothing committed or pushed).

## Verdict: CHANGES REQUESTED

The structure is sound. OffersRoute stays mounted between the list and quote routes. A pick moves to the quote route, so folding back shows the same quote. The take call is unchanged. The offline seller is not pickable. Landmarks are right. One problem must be fixed before landing: the new cover and tabletop glance tells the buyer to pay while the device itself says "don't send any money yet" (I1). A second fix is close behind it: on a tabletop, the own-name and gift-card warnings are hidden (I2).

## Checks run (under `flock ~/x2f-comms/check.lock`)

| Check | Result |
|---|---|
| `tsc --noEmit` (apps/web) | pass |
| `vitest run --project @x2f/web` (full) | 1096 passed, **8 failed**: myOffers.test.tsx x7 and attestation-flow buyerCancel x1. These are the known flakes. Their fixes (30b1794, ae3a877) are on the main line, not in base 52b7a0e. The 5 s timeout of the 230-offer test cascades into the tests after it, the new fold test among them. Re-run alone, myOffers + attestation-flow + fold + browse pass: **4 files, 153/153 passed**. |
| Playwright `--workers=1`, `X2F_CHROMIUM_PATH=/usr/bin/chromium` | **442 passed, 44 skipped, 0 failed** (9.8 min). The name filter also matched the worktree path (`review-fold-design` contains "fold"), so this was the whole e2e suite, a superset of the fold/quote/browse-buy/browse-sell/myOffers/shell/pay/parity/chat specs. |
| `git merge --no-commit` of origin/claude/compassionate-johnson-k95ssr (0c0f9ac) | **clean** (8 files auto-merged; aborted, HEAD still a0552ee) |
| merge-tree vs origin/wip/lead-design-myoffers (54ab006) | conflicts: MyOffers.tsx, myoffers/model.ts, ui/ui.css, e2e/design-shots.spec.ts (add/add), both 54-fold-884-myoffers PNGs |
| merge-tree vs origin/wip/second-design-devices (9f23e55) | conflicts: ui/ui.css, e2e/design-shots.spec.ts (add/add) |

## Important

**I1. The glance says "Pay now" / "Send exactly" while the device says not to pay.**
apps/web/src/screens/trade/TradeGlance.tsx:130-135 (and `glanceWarning` at :41, `glanceTimer` :109)
- `glanceWarning` only knows `escrow.error` and `escrow.refusal`. BuyerPay's own gate is `payBlock(view, escrow)` (payModel.ts:162). That gate also blocks for:
  - `escrow-not-ready`: "Your device is still checking the escrow… don't send any money yet". This is the normal state at the start of every trade.
  - `no-amount`, `amount-differs` and `total-wrong`: each says "Don't send any money".
- In all of these, glancePill/glanceTimer/PayFacts get `warning === null`, so:
  - **Cover:** the card shows the caution pill "Pay now" and "Send by Zelle, then tap I've paid". The card is 100dvh (fold.css glance `min-height: 100dvh`), so the room's "don't send" notice is a scroll away, off screen.
  - **Tabletop:** the top half shows "Waiting for your payment" plus "Send exactly $X … To …" and the memo. The bottom half's notice says don't pay.
- The unit test fixture is always `phase: 'ready'` (test/fold.test.tsx:208), so this is not covered.
- Fix:
  - For the buyer before paid, take the warning from `payBlock`. For example, in `glanceWarning`, when `view.role === 'buyer' && view.state === 'secured'` and `payBlock(view, escrow) !== null`, return `payBlockText(block, escrow)`, keeping the `amount-out-of-range` handling. Then the pill, the cover note and PayFacts drop out on their own.
  - Add tests with `phase: 'confirming'` and with a total that differs from `view.fiatCents`, on both layouts: no "Pay now", no "Send exactly", and the warning shown.

**I2. Tabletop hides the payment card's safety lines.**
apps/web/src/styles/fold.css:174 (`[data-fold-glance='pay']` → `display: none`); BuyerPay.tsx:281 PaymentCard
- The hidden PaymentCard carries "Pay from an account in your own name … Use at your own risk" and, for gift-card methods, `GIFT_CARD_WARNING` (danger).
- `PayFacts` (TradeGlance.tsx, Fold-Tabletop "Send exactly"/"Memo") carries neither, so on a tabletop neither warning appears anywhere.
- It also drops the "No total yet" state, though PayFacts is skipped without a total.
- Fix: one of two ways.
  - Render the own-name note and the gift-card warning in PayFacts (top half, information only, fine for the board's rule).
  - Or move them out of the `data-fold-glance='pay'` section so they stay in the bottom half.
- Add a tabletop test for a gift-card method.

## Medium

**M1. Fold/unfold remounts the quote: the take's in-flight guard and the shown refusal are lost.**
apps/web/src/screens/browse/OffersRoute.tsx:39-56; screens/quote/useTake.tsx:74-86
- On the phone, the QuoteScreen is in the `main` slot. In two panes it is in the `side` slot (and keyed). A layout change therefore unmounts it and mounts a new one, contrary to Panes.tsx's contract ("a fold or unfold never remounts the screen") and Fold-Notes' "Folding never resets or cancels anything".
- The amount, unit and wallet survive through the URL and useKeptText. These do not:
  - `inFlight`/`busy`: a tap of Trade on the new instance while the first take is still pending sends a **second `takeOffer`**.
  - The refusal / CantDoThat.
  - "You're back. Check the total, then tap Trade."
  - `blockedPoster` and the chat hint.
- Picking another offer remounts by design, which is fine.
- Fix (minimum): make the take guard module-level, keyed by offerId, in useTake, and keep the last take error with it, so a remounted quote shows "busy" and the refusal. Add a test that unfolds during a pending take. If the API does not dedupe a repeat take by the same user, treat this as Important.

**M2. Phone behaviour change: a typed amount now follows the person to other offers and later visits.**
apps/web/src/screens/quote/Quote.tsx:127
- The kept-text key is `quote:<adSide>:<methodId>:<currency>`, deliberately not per offer. On a phone, typing 412 on offer A, going Back and opening offer B (or the same method again later in the page load) now pre-fills 412. Before this branch the field started empty.
- Picking between offers in two panes already carries the amount through the URL (`KEPT` in OffersRoute.tsx:14).
- Fix: key the kept text by offer (`…:${offerId}:${currency}`). It is then only the fold-carry the comment describes. Otherwise, ask the owner whether the carry-over is wanted on phones.

**M3. No test for the state kept across a layout switch on the offers.**
test/fold.test.tsx, e2e/fold.spec.ts
- The new tests cover each layout on its own. None switches layout under a mounted OffersRoute and checks what is kept:
  - the typed amount and unit
  - the picked wallet
  - the picked offer (pane → phone quote route → pane)
  - that the list is not refetched and its scroll is kept
  - that only one QuoteScreen exists after the switch (no double mount)
- These are the points the item claims. Add one unit test that flips matchMedia (phone ⇄ two) on `/buy/:m/:offer?amount=…`, plus the pane → fold → unfold round trip.

## Minor / Nits

- **N1** OffersRoute.tsx:56. With no online, open offer (`first === null`), the side pane is an empty `<div/>` inside `<aside aria-label="Quote">`. Leave the side out (`null`) or show a short line ("No seller is online right now", COPY-UNSIGNED).
- **N2** TradeGlance.tsx (cover branch of the timer fact). On the cover, `timer.label` is hidden and " left" is appended only for the buyer's pay step. A seller (or the buyer after paid, "Seller confirms within") sees a bare "62 min". Keep the label on the cover when `!timer.left`.
- **N3** fold.css:172. On a tabletop, TradeHeader is hidden, and with it the only "Back to trades" link and the method's "What is this?" explainer. This matches the Fold-Tabletop board (no back in the bottom half), but leaves no in-app way out. See the questions.
- **N4** OfferCard.tsx:161-180. The pick row drops `Badges`, the margin-vs-market line and the typical time that the phone card shows. Fold-Offers' row shows "seen · trades · positive", which posterLine covers, but the badges move to the pane on the board, and the quote pane doesn't show them. Acceptable for now. Note it for the board follow-up.
- **N5** MyOffers.tsx:333 (RowText → PickButton). The button's accessible name is the whole row: title, methods, status and the refusal line. Consider `aria-labelledby` = title + methods, with status and why as `aria-describedby`.
- **N6** MyOfferDetail.tsx:392. A Button with `role="switch"`. When origin/wip/lead-design-myoffers lands (kit `Switch`), use it here too, so the list's and the pane's switches are the same part.
- **N7** design-shots.spec.ts. All three design branches add this file (add/add). Land one copy first and have the others rebase onto it, rather than hand-merging three 900-line versions.

## a11y summary

- **Landmarks.** OfferList keeps its `<main>` in the first pane. The pane quote draws no `<main>` of its own (`Main = 'div'`) and sits in `<aside aria-label="Quote">`. My offers keeps `<main>`, and its detail is `<aside aria-label="Details: <offer title>">` with an h2. No duplicate `<main>`, and the static ids (`quote-amount`, `quote-chat-hint`) are not duplicated because only one QuoteScreen is mounted.
- **Pick rows.** Both are real `<button aria-pressed>`, as on the Fold-Offers board. They have a 44 px minimum, an ink focus ring and an ink (never orange) selected state.
- **Focus on select.** The list stays mounted, so focus stays on the tapped row. The pane updates without stealing focus. There is no announcement, which is fine given aria-pressed. When the layout switches, a focused card swaps between `<article>` and PickButton and loses focus (minor; part of M3's test).
- **Cover.** The cover's one live region is the answer to "Open on main screen". The warning has no role (the room's notice is the announcement), as before.

## PickButton vs SelectCard

They are different parts. **Neither should absorb the other.**

- **SelectCard** (lead-design-myoffers, ui/SelectCard.tsx):
  - an `<li>` layout container on a fixed grid: tick box 44 | body | control 60
  - its `selected` means **ticked for a bulk action** (multi-select, set by the Checkbox in its `select` slot)
  - not interactive itself
- **PickButton** (this branch, ui/PickButton.tsx):
  - an interactive `<button aria-pressed>`, a **single choice of what the next pane shows**
  - only exists in two panes

On My offers they compose: the SelectCard body (its `children`) is the PickButton in two panes and plain text on a phone, which is what this branch's `RowText` already does.

Two things to settle when merging:

1. **Visual clash.** Both draw "selected" as the same 2 px ink ring on surface-raised. With a PickButton inside a SelectCard, a ticked card and the shown card look the same, and a card that is both gets two nested rings.
   - Suggestion: SelectCard keeps the ring for *ticked*.
   - PickButton gets a `bare` look inside a card: no border of its own, and its pressed state draws the nav's "current" treatment (2 px ink inset line), or SelectCard takes a `shown` flag for it.
   - The owner/design lead should pick which state gets the ring (see the questions).
2. **One selection style.** SelectCard, PickButton and devices' `ChoiceGroup` (tile/card) now each define the 2 px ink selection in ui.css. Put that in one shared class or custom property in ui.css when the three branches meet, which also resolves the ui.css conflicts.

Suggested landing order:

1. Land lead-design-myoffers.
2. Rebase this branch on it, resolving MyOffers.tsx (wrap the SelectCard body in RowText; use kit Switch in MyOfferDetail) and model.ts.
3. Reshoot shot 54.
4. Land second-design-devices (ui.css and the design-shots spec only).

## Questions (for the owner/lead)

1. M2: should a typed quote amount carry over to other offers on a phone? (A user-facing rule. Today it doesn't on main.)
2. N3: on a tabletop, is it acceptable to have no in-app Back (header hidden, per the board)? Or should the bottom half keep a back link?
3. Fold-Offers lets the right pane show an offline seller with "Message". This branch keeps offline offers as phone cards, not pickable. Keep it that way, the conservative choice, until messaging an offline poster is built?
4. Ticked vs shown on My offers in two panes: which state gets the 2 px ink ring?
