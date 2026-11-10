# Build spec: J-31 trade room (helper j31a, 9 Nov 2026). COPY-UNSIGNED.

Ids: T-034, T-039, T-044, T-049, T-079, T-080. Boards in $S/canvas/project. Every string below is exactly what's on the board. Apostrophes are straight (').
All new copy is COPY-UNSIGNED (the owner signs it on the wording pages).

## 1. "What applies to you" card: one list per role (T-034, T-080)
Boards: BuyQuote, SellQuote, SellQuote-Wide, OfferAd, OfferAd-Wide. The `WA_DATA` constant is now **byte-identical** on all five. It matches docs/trade-terms-by-role.md except for the changes listed below.
Where it's reached: the quote screens (BuyOffers / SellOffers / FlexOffer-Quote → BuyQuote / SellQuote) and the offer page (OfferAd), above the Request button.
Layout is unchanged: the card has 3 group headers with counts. Collapsed, it shows the first line of each group and a "Show all N" button, which toggles to "Show less". The role comes from the viewer: a taker on a sell ad is `buyer-taker`, a taker on a buy ad is `seller-taker`. The two poster roles are for when the ad owner looks at a trade on their own ad.

Rules for the builder:
- A role sees only its own list. The fee lines ("You escrow the trade plus 1%…", "You receive the XMR less 1%…", "No fee on a full reversal…") are in the two poster lists only. No taker list has any X2F fee line.
- The courtesy line ("Opened trades with several people…") is in the two taker lists only.
- The nudge line is in all four lists, under Your options (T-034).
- Numbers render in Atkinson Hyperlegible Mono: the board splits on /\d+(?:[.,]\d+)*%?/.
- "[lead writes the wording]" is a placeholder for the lead's first-month privacy-tool check line (p9-8, Q47). It is not design copy. Do not ship it as-is.

Changed vs. 8 Nov:
- Nudge line. Old: "Nudge the buyer/seller if they go quiet: it often helps. It's optional, at most once every 15 minutes." New: "Buyer gone quiet? Nudge them: it often brings them back and saves starting over. Optional, at most once every 15 minutes." / "Seller gone quiet? …" (owner p6-1: encourage it with an unresponsive partner, it saves restarting with someone else).
- "blurred" → "our privacy tool" (3 lines: see the lists).
- SellQuote / SellQuote-Wide were behind. They had no payment-details card line, no own-name line, no "neither of you can cancel" lines, no courtesy line, the dispute times as "90 min, 24 h or 48 h to 4 days", the old nudge and cancel lines, the buyer's removed "Post the payment details in the trade chat." line, and "You pay 1% when the trade completes." for both posters. They now carry the shared lists.
- OfferAd (+Wide) had its own variants of the own-name line ("…It's never required, and X2F keeps your identity private.") and the seller's time-to-pay line ("…cancel at once, no nudge needed…"). These are replaced by the shared lists.
- OfferAd (+Wide), start-a-trade card: "No X2F fee for you." now shows only in the taker roles (`waTaker = role.endsWith('-taker')`). In the poster roles the line is removed.

### Exact lists

#### role `seller-taker` — subtitle "You're selling to a buy ad · information only"

- **Your responsibilities** (4)
  - Fund the escrow in full.
  - Send your payment details from the card in the trade chat: it asks for that method's fields and posts them as one message.
  - Pick the currency, then the payment type, on the ad.
  - Gift card: check it within 45 minutes of getting its details.
- **What affects you** (14)
  - The buyer only sees "Pay now" once your escrow is secured.
  - The buyer can cancel until they tap "I've paid"; your XMR comes back.
  - After "I've paid", the buyer waits for the payment method's transfer time before a dispute (Zelle: 90 min). It's shown where the method is picked.
  - Once the buyer taps "I've paid", neither of you can cancel.
  - After the time to pay, the buyer can still pay until you cancel. If they paid and you cancel, they can dispute at once.
  - Before the XMR is released, a pop-up asks you to confirm the payment arrived. You can turn it off.
  - Proofs show the trade code, amount and time; our privacy tool hides names and account numbers.
  - [lead writes the wording]
  - You're warned if a proof has no readable date.
  - Maintenance pauses the trade timers.
  - On hold, you can both still enter, chat and reach a moderator; no coins move until a moderator decides.
  - In a dispute, a moderator steps in within 24 hours at most.
  - A ruling moves the coins at once; a lien covers a reversal.
  - Feedback and your totals follow the final outcome.
- **Your options** (4)
  - Opened trades with several people to see who answers first? Close the others once you've picked one, so they aren't left waiting.
  - Buyer gone quiet? Nudge them: it often brings them back and saves starting over. Optional, at most once every 15 minutes.
  - Before you fund: cancel at once.
  - If the time to pay expires with no "I've paid", the trade is still open. You can cancel for a full refund (it starts right away and is done at 10 confirmations), wait for them to reply, or nudge them every 15 min.

#### role `buyer-taker` — subtitle "You're buying from a sell ad · information only"

- **Your responsibilities** (7)
  - Pay only when "Pay now" shows; it never shows before the escrow is secured.
  - Pick the currency, then the payment type, on the ad.
  - Follow the payment instructions for the type you picked.
  - Tap "I've paid" once the money is sent.
  - We recommend paying from an account in your own name: it lowers the chance of the payment being frozen. We protect your identity either way.
  - Post proof with the trade code, amount and time visible.
  - Gift card: bought in the last 30 days, full written value, and a video of you logging into it before you send.
- **What affects you** (13)
  - Amounts can be shown with or without the vendor's markup.
  - The ad may need 5, 10, 25 or 50 completed trades from you.
  - Our privacy tool hides names and account numbers in your proof; the trade code, amount and time stay visible.
  - [lead writes the wording]
  - If our privacy tool hides the trade code, or there's no readable date, you're warned and can still post.
  - Once you tap "I've paid", neither of you can cancel.
  - After the time to pay, the trade stays open until the seller cancels: you can still message and pay. If you paid and they cancel, you can dispute at once.
  - Before "I've paid" goes through, a pop-up asks you to confirm. You can turn it off.
  - Maintenance pauses the trade timers.
  - On hold, you can both still enter, chat and reach a moderator; no coins move until a moderator decides.
  - In a dispute, a moderator steps in within 24 hours at most.
  - A ruling moves the coins at once; a lien covers a reversal.
  - Feedback and your totals follow the final outcome.
- **Your options** (5)
  - Opened trades with several people to see who answers first? Close the others once you've picked one, so they aren't left waiting.
  - Seller gone quiet? Nudge them: it often brings them back and saves starting over. Optional, at most once every 15 minutes.
  - Cancel until you tap "I've paid"; you're warned first that it's likely final.
  - After "I've paid", only a dispute, after the payment method's transfer time (Zelle: 90 min, shown where you pick the method).
  - Post proof even if the amount isn't detected; X2F logs it to improve.

#### role `poster-selling` — subtitle "A trade on your sell ad · information only"

- **Your responsibilities** (4)
  - Answer a trade request within 60 minutes, or it closes.
  - Fund the escrow in full.
  - Send your payment details from the card in the trade chat: it asks for that method's fields and posts them as one message.
  - Gift card: check it within 45 minutes of getting its details.
- **What affects you** (16)
  - You escrow the trade plus 1% (the X2F fee); the buyer gets the full amount.
  - No fee on a full reversal; during an appeal the fee waits for the outcome.
  - The buyer only sees "Pay now" once your escrow is secured.
  - The buyer can cancel until they tap "I've paid"; your XMR comes back.
  - After "I've paid", the buyer waits for the payment method's transfer time before a dispute (Zelle: 90 min). It's shown where the method is picked.
  - Once the buyer taps "I've paid", neither of you can cancel.
  - After the time to pay, the buyer can still pay until you cancel. If they paid and you cancel, they can dispute at once.
  - Before the XMR is released, a pop-up asks you to confirm the payment arrived. You can turn it off.
  - Proofs show the trade code, amount and time; our privacy tool hides names and account numbers.
  - [lead writes the wording]
  - You're warned if a proof has no readable date.
  - Maintenance pauses the trade timers.
  - On hold, you can both still enter, chat and reach a moderator; no coins move until a moderator decides.
  - In a dispute, a moderator steps in within 24 hours at most.
  - A ruling moves the coins at once; a lien covers a reversal.
  - Feedback and your totals follow the final outcome.
- **Your options** (3)
  - Buyer gone quiet? Nudge them: it often brings them back and saves starting over. Optional, at most once every 15 minutes.
  - Before you fund: cancel at once.
  - If the time to pay expires with no "I've paid", the trade is still open. You can cancel for a full refund (it starts right away and is done at 10 confirmations), wait for them to reply, or nudge them every 15 min.

#### role `poster-buying` — subtitle "A trade on your buy ad · information only"

- **Your responsibilities** (6)
  - Answer a trade request within 60 minutes, or it closes.
  - Pay only when "Pay now" shows; it never shows before the escrow is secured.
  - Tap "I've paid" once the money is sent.
  - We recommend paying from an account in your own name: it lowers the chance of the payment being frozen. We protect your identity either way.
  - Post proof with the trade code, amount and time visible.
  - Gift card: bought in the last 30 days, full written value, and a video of you logging into it before you send.
- **What affects you** (13)
  - You receive the XMR less 1% (the X2F fee).
  - No fee on a full reversal; during an appeal the fee waits for the outcome.
  - Our privacy tool hides names and account numbers in your proof; the trade code, amount and time stay visible.
  - [lead writes the wording]
  - If our privacy tool hides the trade code, or there's no readable date, you're warned and can still post.
  - Once you tap "I've paid", neither of you can cancel.
  - After the time to pay, the trade stays open until the seller cancels: you can still message and pay. If you paid and they cancel, you can dispute at once.
  - Before "I've paid" goes through, a pop-up asks you to confirm. You can turn it off.
  - Maintenance pauses the trade timers.
  - On hold, you can both still enter, chat and reach a moderator; no coins move until a moderator decides.
  - In a dispute, a moderator steps in within 24 hours at most.
  - A ruling moves the coins at once; a lien covers a reversal.
  - Feedback and your totals follow the final outcome.
- **Your options** (4)
  - Seller gone quiet? Nudge them: it often brings them back and saves starting over. Optional, at most once every 15 minutes.
  - Cancel until you tap "I've paid"; you're warned first that it's likely final.
  - After "I've paid", only a dispute, after the payment method's transfer time (Zelle: 90 min, shown where you pick the method).
  - Post proof even if the amount isn't detected; X2F logs it to improve.

## 2. Courtesy sheet after Request (T-039, owner p9-3) — SUPERSEDED 10 Nov
**Moved (lead msg 4, 10 Nov): the sheet now shows over the trade room the first time it opens (BuyerPay for a taker buying, TradeFund for a taker selling), tweak `courtesy: off|on`. The `opening` tweak is removed from BuyQuote / SellQuote / SellQuote-Wide and their Request buttons are plain links again (BuyQuote → BuyerPay, SellQuote(+W) → TradeFund). Build from $S/audit/spec-fix3.md §4; the copy below is unchanged. The text below is kept for history only.**

Boards: BuyQuote, SellQuote (phone bottom sheet) and SellQuote-Wide (centred dialog). New tweak `opening`: `none` (default) | `courtesy`.
- Trigger: the taker taps the primary "Request to buy XMR" / "Request to sell XMR". The trade request is sent, then this sheet shows before the trade room. On the board the primary is now a `<button>`, not a link.
- It shows on every trade a taker opens, until they tick "Don't show this again". That is a per-account setting. No owner decision yet on where to turn it back on, so it has no Settings entry. Posters never see it. There is no penalty for opening several trades (p9-3, T-038).
- The same sheet follows OfferAd's (+Wide) request button. It is not drawn there; reuse this spec.
- Copy:
  - Title: "Trading with more than one person?"
  - Body: "If you opened trades with several people to see who answers first, close the others once you've picked one. That way nobody is left waiting on you."
  - Tick: "Don't show this again" (unchecked by default)
  - Button: "Got it". It is the only action. BuyQuote → BuyerPay (waiting for escrow); SellQuote / SellQuote-Wide → TradeFund.
- Phone: the bottom sheet copies BuyerPay's confirm sheet. Full width, padding 12/16/16, radius 16 16 0 0, `--surface`, top border 1px `--surface-raised`, gap 16. Drag handle 36×4 `--line`. Title Familjen Grotesk 24/30 700, margin-top 4. Body 16/24 `--ink`. The tick row is min-height 44 with padding 10×14, radius 12, `--surface-raised`, a 22 px checkbox and 15/22 text. The button is 56 high, radius 12, `--monero` / `--on-monero`, 18 px 600. The scrim is `--scrim` over the whole screen.
- Wide: a centred 480 px dialog with padding 32, radius 16, `--surface`, 1px `--surface-raised` border and gap 16. It has no drag handle (title margin 0). The rest matches the phone. The scrim covers the full 1280 width. On the board the dialog's top edge is at 120 px from the content top.
- On the board it is an absolute overlay, so it adds no height.

## 3. Buyer's Cancel confirmation (T-049, owner p5-2 + G56)
Boards: CancelRequest (bottom sheet) and CancelRequest-Wide (480 px centred alertdialog). Reached from "Cancel trade" in the trade room before "I've paid" (step `buyer-confirms`, sheet open by default on the board).
- Title, old → new: "Cancelling is final" → "Cancelling is likely final"
- Body, old → new:
  - Old: "The 1.250000 XMR goes back to satoshi_ghost and this trade closes. Don't send any money after you cancel. If you've already paid, don't cancel: tap I've paid instead."
  - New: "The 1.250000 XMR in escrow is returned and this trade closes. Be sure before you cancel. Don't send any money after you cancel. Already paid? Don't cancel: tap I've paid instead." ("1.250000" in mono, "XMR" 600 `--monero-ink`, "I've paid" 600.)
  - The body no longer names the seller.
- Buttons are unchanged: "Cancel trade" (danger outline, 56 phone / 48 wide) and "Keep trading".
- The design-note aside is now headed "Decided · owner, 7 Nov (G56) and 8 Nov (p5-2, T-049)".

## 4. BuyerPay
- T-079, no-proof confirm (`confirm: noproof`, escrow secured). The buyer taps I've paid with no screenshot attached.
  - Title, unchanged: "Mark paid without proof?"
  - Body, unchanged (the owner's words, as on the BuyerPay board): "You haven't added a payment screenshot. If this trade ever goes to a dispute, proof is usually what decides which side wins. It's your choice."
  - (Corrected 10 Nov, fix3: an earlier redraft here, "proof can be what wins it for you", was stale and is withdrawn. The board never changed.)
  - Buttons, unchanged: "Add proof" (→ ProofBlur) and "Mark paid without proof" (→ the p7-2 sheet, or straight to BuyerPaidWaiting if p7-2 is silenced).
  - It always shows while proof is missing: there is no "don't show again" (lead's default).
- T-044, own-name line: already right, not redrawn. The info callout (raised, muted info icon) in both the securing and live payment cards reads: "We recommend paying from an account in your own name: it lowers the chance of the payment being frozen. We protect your identity either way." The same line is in the buyer-taker and poster-buying lists (section 1).

## 5. Not changed (audited)
- FlexOffer-Quote (+Wide): there is no rules list on these boards. The only fee line is the taker's own "You pay no X2F fee when you take an offer." (no poster fee shown). Its "Request to buy XMR" goes to BuyQuote; the courtesy sheet then fires over the trade room (BuyerPay), see spec-fix3.md §4.

## Heights (default variant; canvas.json not touched)
| Board | Old | New |
|---|---|---|
| BuyQuote | 3352 | 4042 |
| SellQuote | 4165 | 4841 |
| SellQuote-Wide | 2608 | 2996 |
| OfferAd | 5609 | 6023 |
| OfferAd-Wide | 2965 | 3179 |
| CancelRequest | 2692 | 2726 |
| CancelRequest-Wide | 2121 | 2139 |
| BuyerPay | 3317 | 3317 |
All of these come from the design notes: two new asides per quote board and one per OfferAd board.
