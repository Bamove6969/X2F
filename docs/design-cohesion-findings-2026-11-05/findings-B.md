# Findings B

## Cross-board (same problem on several boards in this group)
- [P1] XMR shown with 2 decimals ("1.25 XMR") — boards: TradeFund (footer helper "escrow address and 1.25 XMR filled in"), SellerConfirm (hold button "Hold to release 1.25 XMR to mira.k", plus `mainLine`/`btnLabel` strings "1.25 XMR is on its way…", "Released 1.25 XMR…"), SellerRefund (hero lead "Your 1.25 XMR is still safe", list items 2 and 4) — fix: every occurrence becomes `<mono>1.250000</mono> XMR` (§15: always 6 decimals).
- [P1] Key mark used outside its three allowed places — boards: OfferAd, OfferAd-Wide ("2-of-3 escrow" row: 40px tile holds the small key mark), TradeFund ("Escrow ready: 3 keys" card: three rows each lead with a 3-dot mini mark in escrow/caution/line colours) — fix: OfferAd(-Wide) row tile = neutral 40×40 tile, `--surface-raised`, 20px shield stroke icon; TradeFund rows = replace the dot trios with a 16px stroke icon (check / undo / scale) in `--ink-muted`, or plain text. §1: "Use it for nothing else."
- [P1] Username changed by an uppercase chip — boards: SellerConfirm, Warn-Release, Warn-Release-Wide (chip text "mira.k: Payment sent" renders "MIRA.K: PAYMENT SENT") — fix: chip label "PAYMENT SENT" only; the headline already names mira.k. Usernames are never transformed.
- [P2] XMR unit label not drawn one way — boards: Main, BuyMain, BuyOffers, SellOffers, FlexOffer-Quote, FlexOffer-Quote-Wide, OfferAd, OfferAd-Wide price heroes ("$329.90 / XMR", "$171.24 / XMR" with "/ XMR" in 13–14px `--ink-muted`); TradeFund rows ("0.000062 XMR" unit in `--ink`); CancelRequest ("for 1.250000 XMR" muted); Review hero headline and inner rows ("1.237500 XMR is yours", "Trade amount 1.250000 XMR", "−0.012500 XMR" all in `--ink`, only the "You receive" row orange) — fix: wherever "XMR" is the unit of an amount, `font-weight:600; color: var(--monero-ink)` as BuyQuote and the exemplars do. Keep "/ XMR" muted only inside the 13px context line.
- [P2] Hero carries both a headline and a hero number — boards: BuyerPaidWaiting, BuyerPaidWaiting-Wide (24px "Paid · waiting for satoshi_ghost to confirm" + 40px "1 h 58 min"), SellerConfirm (24px "Check your bank account for $412.50 sent via Zelle" + 40px "1 h 52 min") — fix: match BuyerPay: chip + key mark, then the timer as the one big thing; demote the 24px line to the 16/24 `--ink-muted` lead under the chip. The 28/32 screen title already names the trade.
- [P2] Form fields taller and rounder than §11 — boards: BuyQuote ("You pay" input 56h radius 12), OfferAd and OfferAd-Wide (Currency / Pay with selects 58h radius 12 with the label inside; footer amount input 56h), FlexOffer-Quote and -Wide ("You pay" input 56h, "Pay with" select 56h) — fix: `height: 48px; border-radius: 6px; border: 1px solid var(--line); background: var(--surface-raised); padding: 0 14px`, label 13/16 uppercase 8px above the field.
- [P2] Dispute button wording drifts — boards: BuyerPaidWaiting, BuyerPaidWaiting-Wide ("Open a dispute", 3 places each) vs BuyerPay, SellerConfirm, ProofBlur, Warn-IvePaid, Warn-Release ("Open dispute") — fix: button/link label "Open dispute" everywhere; prose may keep "open a dispute".
- [P2] Offer lists disagree on whether one Trade button is the primary — boards: BuyOffers, SellOffers (first online offer's "Trade" is the orange primary) vs FlexOffer-Quote, FlexOffer-Quote-Wide (every "Trade" is a 48h outline, no primary on screen) — fix: FlexOffer-Quote(-Wide): first available offer's Trade = primary (`--monero` bg; 56h phone, 48h wide), the rest stay secondary.
- [P2] Duration shorthand drifts — boards: BuyOffers, SellOffers, FlexOffer-Quote, FlexOffer-Quote-Wide ("Releases in ~8 min", "Pays in ~6 min") vs BuyerPay, Warn-IvePaid ("about 14 min") — fix: "Releases in about <mono>8</mono> min".
- [P2] Nav rail items differ — board: FlexOffer-Quote-Wide (Trade · My offers · Wallets · Profile) vs every other wide in the group (Trade · Post offer · Wallets · Profile) — fix: second item "Post offer" with the plus-circle icon.
- [P3] "Draft copy" label drawn twice — boards: OfferAd, OfferAd-Wide (top-right of the app and again in the DESIGN NOTES heading row) — fix: keep the one top-right of the app only.

## Main
- [P2] List is cut by the tab bar: root is fixed `height: 1180px` with `overflow-y: auto` on main, so rows 10–17 are hidden behind the bottom nav — fix: grow the root to fit all 17 rows (or render 9 rows plus a "Show all 17" secondary) and update `$preview`; root height = content.
- [P2] Hero price unit "/ XMR" muted (cross-board) — fix: `/ <span style="font-weight:600;color:var(--monero-ink)">XMR</span>`.

## BuyMain
- [P2] Same clipped list as Main: the "Revolut" row sits half under the tab bar in both themes — fix: as Main.
- [P2] Hero price unit "/ XMR" muted — fix: as Main.
- OK otherwise; header, Buy/Sell segmented (ink ring), sort chips, rows and tab bar match Main exactly.

## BuyOffers
- [P2] Trailing meta differs from SellOffers: "$0.10 above market" in `--ink-muted` here vs "0.4% above market" in `--escrow` on SellOffers — fix: use SellOffers' form on both ("0.1% above market", `--escrow` when above market, `--ink-muted` at market).
- [P2] "Releases in ~8 min" tilde (cross-board) — fix: "Releases in about 8 min".
- [P3] "Nudge" pill draws at 32px (hit box is 44, correct) while header pills are 44h — fix: draw the pill at 44h, padding 0 14, like the Chat pill.

## SellOffers
- [P2] "Pays in ~6 min" tilde (cross-board) — fix: "Pays in about 6 min".
- [P3] Same 32px Nudge pill as BuyOffers.
- OK otherwise; matches BuyOffers.

## BuyQuote
- [P2] "You pay" input 56h radius 12 (cross-board) — fix: 48h radius 6 per §11.
- [P3] "satoshi_ghost then has 30 minutes to lock the XMR" vs "min" everywhere else — fix: "has <mono>30</mono> min to lock".
- Otherwise the closest non-exemplar to the target: hero amount, inner rows, ink-ring wallet selection, callout and footer all correct.

## OfferAd
- [P1] Key mark in the "2-of-3 escrow" row (cross-board) — fix: neutral shield tile.
- [P2] Currency / Pay with selects 58h radius 12 with the label inside the box (cross-board) — fix: §11 field, label above.
- [P2] Footer stacks six things (segmented toggle, 56h input, conversion line, primary, tertiary, fee line; ~250px) where the exemplar footer is primary + one tertiary row — fix: move the You pay / You receive toggle, the amount input and the "You receive …" line into a last "Start a trade" card in main (as the wide already does); footer keeps "Request to buy XMR" + "Message satoshi_ghost".
- [P3] Duplicate "Draft copy" in the notes heading (cross-board).

## OfferAd-Wide
- [P1] Key mark in the "2-of-3 escrow" row (cross-board).
- [P1] Design notes rendered inside the app: the dashed "DESIGN NOTES" box sits in the right grid column under the escrow row, beside the terms card — fix: move the notes section below the grid, full width, with the `border-top: 1px solid var(--line)` separator ProofBlur-Wide and BuyerPaidWaiting-Wide use.
- [P2] Selects 58h radius 12 (cross-board).
- [P3] Duplicate "Draft copy".

## FlexOffer-Quote
- [P2] No primary on the screen (cross-board) — fix: first available "Trade" (satoshi_ghost) becomes the primary.
- [P2] "You pay" input and "Pay with" select 56h radius 12 (cross-board); the input also lacks the "USD" suffix the wide shows — fix: 48h/6 and add the USD suffix.
- [P2] "Releases in ~8 min" (cross-board).

## FlexOffer-Quote-Wide
- [P2] Nav rail "My offers" (cross-board) — fix: "Post offer".
- [P2] No primary (cross-board): the 48h outline "Trade" on satoshi_ghost's row should be `--monero`.
- [P2] 56h input/select (cross-board).
- OK otherwise: table reads well in both themes, unavailable rows dashed, lock callouts correct.

## TradeFund
- [P1] "1.25 XMR" in the footer helper (cross-board) — fix: "1.250000 XMR".
- [P1] Mini key-mark dot trios in the "Escrow ready" card (cross-board) — fix: icons or text.
- [P2] Timer drawn as "28:42" (mono 40); the group's timer format is digits + body unit with a ring (BuyerPay "90 min", BuyerPaidWaiting "1 h 58 min") — fix: `<mono>28</mono> min` with the 64px caution ring per §14 (or `<mono>28</mono> min <mono>42</mono> s` if seconds matter).
- [P2] "Network fee (fast) 0.000062 XMR" unit in `--ink` (cross-board) — fix: unit `--monero-ink` 600.
- [P3] No Chat pill in the header while BuyerPay, BuyQuote, SellerConfirm and SellerRefund have one — fix: add the Chat pill, or note that chat opens only after funding.

## BuyerPay
- [P2] "[SELLER ZELLE ID]" placeholder in uppercase mono (mono on words) — fix: show a masked example value in mono, e.g. "•••• 4471", as the conventions ask for example dates in place of placeholders.
- Otherwise ship-ready; this is the target the others should match.

## BuyerPaidWaiting
- [P2] Headline + hero number in one hero (cross-board) — fix: demote the 24px line to the lead.
- [P2] "You marked this trade as paid at 14:05 UTC." time in body text — fix: `<mono>14:05 UTC</mono>`.
- [P2] "Open a dispute" (cross-board) — fix: "Open dispute".
- [P3] Footer order: secondary "Nudge satoshi_ghost" sits above the disabled 48h dispute button; §10 puts the primary slot first — fix: disabled dispute button first (56h disabled style), then Nudge as secondary, then the helper lines.

## BuyerPaidWaiting-Wide
- [P2] Same headline + hero number, "Open a dispute" and body-text "14:05 UTC" as the phone.
- [P2] Chat panel is a wireframe: three empty grey bubbles, an empty input and an empty 48px square where the send button goes — fix: two short example messages in 15/22, a real `<input placeholder="Message satoshi_ghost">` and a 48×48 send button with a 20px arrow icon and `aria-label="Send"`.

## SellerConfirm
- [P1] Chip "MIRA.K: PAYMENT SENT" (cross-board) — fix: "PAYMENT SENT".
- [P1] "Hold to release 1.25 XMR to mira.k" (cross-board) — fix: "1.250000 XMR" (also in `mainLine` and `btnLabel`).
- [P2] Headline + hero number in one hero (cross-board) — fix: hero = chip, mark, timer; "Check your bank account for $412.50 sent via Zelle" becomes the lead.
- [P2] Hold button is 64h with a 13px uppercase label inside it ("PAYMENT RECEIVED" over "Hold to release…"); §10 primary is 56h, one 18/600 line — fix: 56h, label "Hold to release 1.250000 XMR"; move "Payment received" into the tick-box sentence or drop it.

## SellerRefund
- [P1] "1.25 XMR" ×3 (cross-board) — fix: "1.250000 XMR".
- [P3] Primary "Cancel & get refund" uses an ampersand — fix: "Cancel and get refund".
- OK otherwise: 24px headline (not display size) under the screen title, chip, mark, numbered list, escrow callout, secondary pair all per spec.

## Refunded
- OK. Exemplar; compact header, neutral tone three ways, timeline, outline card and footer per spec.

## Refunded-Wide
- OK. Exemplar; 560+360 grid, no header bar, inline primary + tertiary.

## CancelRequest
- [P3] Hero mixes tones: chip, wash and key mark are `--escrow` ("Escrow secured") while the "TIME TO PAY" label and ring are `--caution`; §6 allows a timer in its own tone, but BuyerPay keeps one tone — if the owner wants one tone, use `--caution` for the whole block while the clock runs.
- OK otherwise: sheet title 24/30, danger-confirm 56h with 14% tint + danger border, secondary "Keep trading", notes outside the scrim.

## CancelRequest-Wide
- [P2] Scrim covers the design notes as well as the app (`position:absolute; inset:0` on a root whose height = app + notes), so the notes are dimmed; the phone board keeps the notes outside the scrim — fix: wrap the app in its own `position: relative` div of app height and put the scrim/dialog inside it.
- OK otherwise: dialog 560 centred, Keep trading left, Cancel trade danger right.

## Warn-IvePaid
- [P3] Sheet copy is the longest paragraph in the group ("We strongly recommend that you do not send payment until all confirmations are complete and you've received confirmation that the XMR is fully in escrow.") — if these are the owner's words leave them; otherwise "Don't send payment until all 10 confirmations are in and the XMR is fully in escrow."
- OK otherwise: caution chip, title 24/30, confirmations block, primary "I'll wait" + secondary "I've already paid".

## Warn-IvePaid-Wide
- OK. Dialog centred over the dimmed app, primary right, secondary left; no header bar.

## Warn-Release
- [P1] Background hero chip "MIRA.K: PAYMENT SENT" (cross-board; same string as SellerConfirm) — fix: "PAYMENT SENT".
- OK otherwise: danger chip, 40px icon tiles, danger tile on the irreversible line, primary + secondary.

## Warn-Release-Wide
- [P1] Same chip string as Warn-Release.
- OK otherwise.

## ProofBlur
- [P2] Live-trade screen without the stepper: compact header ("Check your payment proof / Step 2 of 4, You pay · Zelle") and no four-bar stepper; §13 says every live-trade screen carries it — fix: add the stepper (Escrow done, You pay current in caution) under the header and drop "Step 2 of 4" from the context line (or keep it as `<mono>2</mono> of <mono>4</mono>`).
- [P3] "Step 2 of 4" count digits in body text — fix: mono digits (§4 counts).
- OK otherwise: tool strip, 56h primary, 48h secondary, lock/shield lines, notes and OPEN boxes per conventions.

## ProofBlur-Wide
- [P2] Same missing stepper and body-text "Step 2 of 4" as the phone.
- OK otherwise: 560+360 grid, "Blurred details" list with 48 rows, actions inline.

## Review
- [P2] No header: the board starts with "Draft copy" and the hero; every other key screen has a 44px back and a context line — fix: compact header per §5 ("Buying from satoshi_ghost" 15/20 600 over "Trade K7M2-9QXA-4FTR-8WPN · Zelle · Example" 13/16 muted), back `aria-label="Back to trades"`.
- [P2] Duplicate of Reviews' form with drift: "Submit rating" vs Reviews' "Submit review"; lead "Your review is visible right away." vs "Your review shows on satoshi_ghost's profile straight away."; 40px stars with no "x of 5" vs 48px stars with "4 of 5"; no "Describe this trade" badges; 120-char single-line note vs 200-char textarea — fix: one form. Recommend Review keeps its hero and takes Reviews' three cards and footer labels verbatim, or one board gets the dashed "superseded" banner.
- [P2] "XMR" in the headline and inner rows in `--ink`, only the last row orange (cross-board) — fix: `--monero-ink` 600 on all four.
- OK otherwise: escrow tone three ways, confirmations bar, ink-ring chips.

## Reviews
- [P2] Selected "What stood out?" chips use a 2px `--escrow` ring and escrow tint (`'border: 2px solid ' + tone`) while "Describe this trade" chips on the same board use the 2px `--ink` ring — fix: selected chip = `border: 2px solid var(--ink); background: var(--surface-raised)`; the tone may stay on the text only (as Review does).
- [P2] Write variant has no back button (context line + title only) — fix: 44px back above the context line, as Feedback does.
- [P2] Form duplicates Review with drift (see Review).
- OK otherwise.

## Reviews-Wide
- [P2] Same tone-ring selected chips as Reviews — fix: ink ring.
- [P2] No back control, and the "TRADE COMPLETE" chip floats above the title as a page label (chips live in heroes and rows) — fix: back 44 + two-line context per §5 wide; drop the chip or put the status in the context line ("Trade complete · K7M2-9QXA-4FTR-8WPN · Zelle").
- OK otherwise: 720 column, textarea per §11, inline primary + tertiary.

## Feedback
- OK. Header, 28/32 title, label 13/16, textarea, mono counter, ink checkbox row, pinned disabled 56h primary all per spec. Ship-ready as is.

## Feedback-Wide
- OK. Compact header with back, 720 form column, disabled 48h primary, current nav "Profile" with ink inset. Ship-ready as is.
