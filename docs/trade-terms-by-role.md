**UNSIGNED: draft wording for the owner's sign-off. Every line below is COPY-UNSIGNED.**

# Trade terms by role (8 Nov 2026, owner answers p6–p10 applied)

Owner comment 6 (8 Nov): each person sees only what applies to them, line by line: their responsibilities, what affects them, and their options. This is information only. There is no agree step on a trade: people agree once, at signup (owner comments 7 and 8, SetupTerms).

How to read it:

- One short line per point. The HTML comment after each line names the owner decision(s) it comes from.
- Ids: `Q`, `F`, `G`/`g`, `p4-`, `p5-`, `p6-`, `p7-`, `p9-`, `p10-` are from `owner-decisions-2026-11-06.md` on `origin/comms`. `p5-nudge` is the owner's 7 Nov chat note on nudges in that file ("no cap… one nudge per 15 minutes"). `C1`–`C12` are the owner's 8 Nov comments on the prototype (numbered as in the owner taste brief).
- The fee shows only to the person who pays it (the ad poster, g63, p10-1). Takers see no fee line.
- A line still waiting for the lead's wording says "[lead writes the wording]".
- Nothing here is invented. A point with no owner decision is left out and listed under "Not decided yet" at the end.
- Drawn as the "What applies to you" card on BuyQuote and OfferAd (+Wide), tweak `role`.
- p7-3 (8 Nov): the person receiving the fiat posts the payment details (the "Send your payment details from the card…" line on the seller lists). The buyer's old "Post the payment details in the trade chat" (F2) line is removed.

## (a) Seller taking a buy ad

### Your responsibilities

- Fund the escrow in full. <!-- G2, g66 -->
- Send your payment details from the card in the trade chat: it asks for that method's fields and posts them as one message. <!-- p7-3 -->
- Pick the currency, then the payment type, on the ad. <!-- F6, F7, Q5 -->
- Gift card: check it within 45 minutes of getting its details. <!-- G50 -->

### What affects you

- The buyer only sees "Pay now" once your escrow is secured. <!-- Q12 -->
- The buyer can cancel until they tap "I've paid"; your XMR comes back. <!-- g67, G2 -->
- After "I've paid", the buyer waits for the payment method's transfer time before a dispute (Zelle: 90 min). It's shown where the method is picked. <!-- F9, Q10, p9-4 -->
- Once the buyer taps "I've paid", neither of you can cancel. <!-- p9-4, g67 -->
- After the time to pay, the buyer can still pay until you cancel. If they paid and you cancel, they can dispute at once. <!-- p9-2 -->
- Before the XMR is released, a pop-up asks you to confirm the payment arrived. You can turn it off. <!-- p7-2 -->
- Proofs show the trade code, amount and time; names and account numbers are blurred. <!-- Q50, Q17 -->
- [lead writes the wording] <!-- Q47, p9-8: for the first month, the blur check asks both of you on every proof -->
- You're warned if a proof has no readable date. <!-- G16 -->
- Maintenance pauses the trade timers. <!-- g62 -->
- On hold, you can both still enter, chat and reach a moderator; no coins move until a moderator decides. <!-- G7, G33 -->
- In a dispute, a moderator steps in within 24 hours at most. <!-- Q38 -->
- A ruling moves the coins at once; a lien covers a reversal. <!-- Q37 -->
- Feedback and your totals follow the final outcome. <!-- Q40, Q41 -->

### Your options

- Opened trades with several people to see who answers first? Close the others once you've picked one, so they aren't left waiting. <!-- p9-7 (8 Nov: no penalty for a taker who never funds; design words the courtesy note) -->
- Nudge the buyer if they go quiet: it often helps. It's optional, at most once every 15 minutes. <!-- F10, p6-1 -->
- Before you fund: cancel at once. <!-- G2 -->
- If the time to pay expires with no "I've paid", the trade is still open. You can cancel for a full refund (it starts right away and is done at 10 confirmations), wait for them to reply, or nudge them every 15 min. <!-- G2, g66, p6-1, p9-2, owner 8 Nov -->

## (b) Buyer taking a sell ad

### Your responsibilities

- Pay only when "Pay now" shows; it never shows before the escrow is secured. <!-- Q12 -->
- Pick the currency, then the payment type, on the ad. <!-- F6, F7, Q5 -->
- Follow the payment instructions for the type you picked. <!-- Q23, F2 -->
- Tap "I've paid" once the money is sent. <!-- g67 -->
- We recommend paying from an account in your own name: it lowers the chance of the payment being frozen. We protect your identity either way. <!-- p9-9 (owner's wording, 8 Nov; recommendation only) -->
- Post proof with the trade code, amount and time visible. <!-- Q50, F14 -->
- Gift card: bought in the last 30 days, full written value, and a video of you logging into it before you send. <!-- G50, G51, G52 -->

### What affects you

- Amounts can be shown with or without the vendor's markup. <!-- C11 -->
- The ad may need 5, 10, 25 or 50 completed trades from you. <!-- Q27, C12 -->
- Names and account numbers in your proof are blurred; the trade code, amount and time aren't. <!-- Q50, Q17 -->
- [lead writes the wording] <!-- Q47, p9-8: for the first month, the blur check asks both of you on every proof -->
- If the blur hides the trade code, or there's no readable date, you're warned and can still post. <!-- F14, G16 -->
- Once you tap "I've paid", neither of you can cancel. <!-- p9-4, g67 -->
- After the time to pay, the trade stays open until the seller cancels: you can still message and pay. If you paid and they cancel, you can dispute at once. <!-- p9-2 -->
- Before "I've paid" goes through, a pop-up asks you to confirm. You can turn it off. <!-- p7-2 -->
- Maintenance pauses the trade timers. <!-- g62 -->
- On hold, you can both still enter, chat and reach a moderator; no coins move until a moderator decides. <!-- G7, G33 -->
- In a dispute, a moderator steps in within 24 hours at most. <!-- Q38 -->
- A ruling moves the coins at once; a lien covers a reversal. <!-- Q37 -->
- Feedback and your totals follow the final outcome. <!-- Q40, Q41 -->

### Your options

- Opened trades with several people to see who answers first? Close the others once you've picked one, so they aren't left waiting. <!-- p9-7 (8 Nov: no penalty for a taker who never funds; design words the courtesy note) -->
- Nudge the seller if they go quiet: it often helps. It's optional, at most once every 15 minutes. <!-- F10, p6-1 -->
- Cancel until you tap "I've paid"; you're warned first that it's likely final. <!-- g67, G56 -->
- After "I've paid", only a dispute, after the payment method's transfer time (Zelle: 90 min, shown where you pick the method). <!-- g67, F9, Q10, p9-4 -->
- Post proof even if the amount isn't detected; X2F logs it to improve. <!-- Q43 -->

## (c) Ad poster selling (a trade on your sell ad)

### Your responsibilities

- Answer a trade request within 60 minutes, or it closes. <!-- Q11 -->
- Fund the escrow in full. <!-- G2, g66 -->
- Send your payment details from the card in the trade chat: it asks for that method's fields and posts them as one message. <!-- p7-3 -->
- Gift card: check it within 45 minutes of getting its details. <!-- G50 -->

### What affects you

- You escrow the trade plus 1% (the X2F fee); the buyer gets the full amount. <!-- g63, p10-1 -->
- No fee on a full reversal; during an appeal the fee waits for the outcome. <!-- g63 -->
- The buyer only sees "Pay now" once your escrow is secured. <!-- Q12 -->
- The buyer can cancel until they tap "I've paid"; your XMR comes back. <!-- g67, G2 -->
- After "I've paid", the buyer waits for the payment method's transfer time before a dispute (Zelle: 90 min). It's shown where the method is picked. <!-- F9, Q10, p9-4 -->
- Once the buyer taps "I've paid", neither of you can cancel. <!-- p9-4, g67 -->
- After the time to pay, the buyer can still pay until you cancel. If they paid and you cancel, they can dispute at once. <!-- p9-2 -->
- Before the XMR is released, a pop-up asks you to confirm the payment arrived. You can turn it off. <!-- p7-2 -->
- Proofs show the trade code, amount and time; names and account numbers are blurred. <!-- Q50, Q17 -->
- [lead writes the wording] <!-- Q47, p9-8: for the first month, the blur check asks both of you on every proof -->
- You're warned if a proof has no readable date. <!-- G16 -->
- Maintenance pauses the trade timers. <!-- g62 -->
- On hold, you can both still enter, chat and reach a moderator; no coins move until a moderator decides. <!-- G7, G33 -->
- In a dispute, a moderator steps in within 24 hours at most. <!-- Q38 -->
- A ruling moves the coins at once; a lien covers a reversal. <!-- Q37 -->
- Feedback and your totals follow the final outcome. <!-- Q40, Q41 -->

### Your options

- Nudge the buyer if they go quiet: it often helps. It's optional, at most once every 15 minutes. <!-- F10, p6-1 -->
- Before you fund: cancel at once. <!-- G2 -->
- If the time to pay expires with no "I've paid", the trade is still open. You can cancel for a full refund (it starts right away and is done at 10 confirmations), wait for them to reply, or nudge them every 15 min. <!-- G2, g66, p6-1, p9-2, owner 8 Nov -->

## (d) Ad poster buying (a trade on your buy ad)

### Your responsibilities

- Answer a trade request within 60 minutes, or it closes. <!-- Q11 -->
- Pay only when "Pay now" shows; it never shows before the escrow is secured. <!-- Q12 -->
- Tap "I've paid" once the money is sent. <!-- g67 -->
- We recommend paying from an account in your own name: it lowers the chance of the payment being frozen. We protect your identity either way. <!-- p9-9 (owner's wording, 8 Nov; recommendation only) -->
- Post proof with the trade code, amount and time visible. <!-- Q50, F14 -->
- Gift card: bought in the last 30 days, full written value, and a video of you logging into it before you send. <!-- G50, G51, G52 -->

### What affects you

- You receive the XMR less 1% (the X2F fee). <!-- g63, p10-1 -->
- No fee on a full reversal; during an appeal the fee waits for the outcome. <!-- g63 -->
- Names and account numbers in your proof are blurred; the trade code, amount and time aren't. <!-- Q50, Q17 -->
- [lead writes the wording] <!-- Q47, p9-8: for the first month, the blur check asks both of you on every proof -->
- If the blur hides the trade code, or there's no readable date, you're warned and can still post. <!-- F14, G16 -->
- Once you tap "I've paid", neither of you can cancel. <!-- p9-4, g67 -->
- After the time to pay, the trade stays open until the seller cancels: you can still message and pay. If you paid and they cancel, you can dispute at once. <!-- p9-2 -->
- Before "I've paid" goes through, a pop-up asks you to confirm. You can turn it off. <!-- p7-2 -->
- Maintenance pauses the trade timers. <!-- g62 -->
- On hold, you can both still enter, chat and reach a moderator; no coins move until a moderator decides. <!-- G7, G33 -->
- In a dispute, a moderator steps in within 24 hours at most. <!-- Q38 -->
- A ruling moves the coins at once; a lien covers a reversal. <!-- Q37 -->
- Feedback and your totals follow the final outcome. <!-- Q40, Q41 -->

### Your options

- Nudge the seller if they go quiet: it often helps. It's optional, at most once every 15 minutes. <!-- F10, p6-1 -->
- Cancel until you tap "I've paid"; you're warned first that it's likely final. <!-- g67, G56 -->
- After "I've paid", only a dispute, after the payment method's transfer time (Zelle: 90 min, shown where you pick the method). <!-- g67, F9, Q10, p9-4 -->
- Post proof even if the amount isn't detected; X2F logs it to improve. <!-- Q43 -->

## Not decided yet

Left out of the lists above because no owner decision covers them. Each needs an owner answer before it can be a line.

1. **Releasing the XMR** once the payment arrives (the seller's main step). The decisions cover escrow, cancels and rulings, but no decision states the release step or any time limit on it.
2. **When a seller (taker or poster) can open a dispute.** Only the buyer's wait after "I've paid" is decided (F9, Q10).
3. **Asking for more time.** No decision gives either side a way to ask for or grant extra time. Q11 only gives slow payment types a custom time from research, still with the lead.
4. **What moderators can see.** No owner decision says what a moderator can read (chat, proofs, files) or when. The design kit ruling (8 Nov, encryption note: "If a dispute is opened, a moderator can read this conversation") is design's, not the owner's.
5. **The buyer's time to pay** once "Pay now" shows. Q11's "90 minutes to say the transfer is sent" doesn't say which side it binds when the poster is the seller, and the timing table goes to the owner first (Q11).
6. **Q36: "that doesn't affect the poster's time"** during maintenance. It's unclear which poster clock keeps running; g62 says trade timers stop.
7. ~~"Was this blurred correctly?" (Q47).~~ Decided 8 Nov (p9-8): both of you, on every proof, for the first month. The line is on the lists with "[lead writes the wording]".
8. ~~Paying from an account in your own name.~~ Decided 8 Nov (p9-9): a recommendation only, never enforced. Now on the buyer lists in the owner's wording, and BuyerPay and Fold-Trade show it as an info callout ("Use at your own risk" is gone).
9. **The nudge sound** (F10): an original sound in the ICQ style unless one can be licensed. This isn't a line for traders, but the sound isn't final.
10. **The 10-confirmation detail.** For the seller's own cancel the owner confirmed it on 8 Nov (p9-2: "the trade is complete once the refund has 10 confirmations"), so it is on the seller lists. A buyer's cancel (G2) still waits for the lead to check it against the machine.
11. **Release time limit.** The owner said on 8 Nov there is none (the seller checks, marks complete, the XMR releases). Not added as a line yet: the boards still show "Time to confirm"; lead to confirm before both change.
