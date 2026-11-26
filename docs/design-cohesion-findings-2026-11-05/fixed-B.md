# Fixed B (resumed run, 5 Nov)

## Boards changed
- Main: (killed run) root grown to show all rows, "/ XMR" unit in monero-ink. Verified, no further change.
- BuyMain: (killed run) same as Main. Verified.
- BuyOffers: (killed run) "0.1% above market" in escrow, "Releases in about 8 min", Nudge pill 44h. Verified.
- SellOffers: (killed run) "Pays in about 6 min", Nudge pill 44h. Verified.
- BuyQuote: (killed run) You-pay input 48h/6, "30 min". Verified.
- TradeFund: timer "28 min 42 s" + 64px caution ring + meaning line; dot trios replaced with 16px stroke icons (check / undo / scales); network-fee XMR unit 600 monero-ink; footer "1.250000 XMR"; Chat pill added; root 1246.
- BuyerPay: "[SELLER ZELLE ID]" → masked example "•••-•••-4471" with an OPEN box in a new Design notes section below the app (app wrapped in its own 1076px block so the sheet scrim stays off the notes); tooltip digits "90 min", "10 times, about 20 min" in mono; root 1291.
- BuyerPaidWaiting: hero = chip + mark + lead (16/24 muted, "14:05 UTC" / "2 h" in mono) + timer, 24px headline dropped; "Open dispute" ×3; disabled dispute 56h first in the footer, Nudge secondary under it; "30 min" (was minutes); "Zelle gets 2 h"; XMR unit monero-ink in step 2; Zelle ID masked + OPEN box; nav n/a; root 1597/1559/1595.
- BuyerPaidWaiting-Wide: six-item nav rail; same hero/lead/dispute/XMR/Zelle-ID fixes as the phone; chat panel now has two example messages, a real "Message satoshi_ghost" input and a 48×48 Send button (aria-label="Send"); OPEN box; root 1410/1384/1408.
- SellerConfirm: chip "PAYMENT SENT"; hero = chip + mark + lead ("Check your bank account for $412.50 sent via Zelle.") + "TIME TO CONFIRM" label, timer, meaning line ("Zelle gets 2 h · ends 1 Nov 2026, 16:05 UTC"); hold button 56h with one line "Hold to release 1.250000 XMR" (Keep holding… / Released 1.250000 XMR to mira.k); hints as markup with mono "1.5 s"; tooltip "2 h / 24 h"; root 1142/1160/1190.
- SellerRefund: "1.250000 XMR" ×3 with the unit in monero-ink; "15 min"; primary "Cancel and get refund".
- Warn-Release: chip "PAYMENT SENT"; sheet XMR unit monero-ink.
- Warn-Release-Wide: six-item nav rail; chip "PAYMENT SENT"; XMR unit monero-ink.
- CancelRequest: "for 1.250000 XMR" unit monero-ink (also in the sheet); Zelle ID masked; OPEN box for the Zelle ID added to the notes; NOTES_H 499.
- CancelRequest-Wide: six-item nav rail; app wrapped in its own position:relative block so the scrim/dialog no longer dims the notes (notes moved below the app, full width, margin-left 240); XMR unit monero-ink; Zelle ID masked + OPEN box; root 1197/1271.
- Warn-IvePaid: Zelle ID masked (no notes section on this dialog board; the OPEN box lives on BuyerPay / BuyerPaidWaiting / CancelRequest).
- Warn-IvePaid-Wide: six-item nav rail; Zelle ID masked.
- Refunded: no change needed (prose "Open a dispute and add…" is a sentence, not a button).
- Refunded-Wide: six-item nav rail only.
- Feedback: no change.
- Feedback-Wide: six-item nav rail only (current = Profile).
- Review: compact header added (back 44, "Buying from satoshi_ghost" 15/20 600, trade context 13/16 muted; "Draft copy" row kept above); XMR unit monero-ink 600 in the headline and all three rows; the rating card replaced by Reviews' four form cards verbatim (stars with "4 of 5", "What stood out?", "Describe this trade" badges, "In your own words" textarea) and footer "Submit review" / "Skip review"; APP_H 2016.
- Reviews: selected "What stood out?" chips = 2px ink ring on surface-raised (tone on text only); 44px back added above the write header's context line; XMR unit monero-ink; appH write 1473.
- Reviews-Wide: six-item nav rail (current item still follows the view: Trade for write, Profile for profile); write view header = back 44 + two-line context ("Review the trade" / "Trade complete · You bought 1.250000 XMR ($412.50) from satoshi_ghost · Zelle"), chip and 28px h1 dropped; selected chips ink ring; appH write 1016.
- ProofBlur: stepper (Escrow done, You pay current) under the editor's compact header; context line "You pay · Zelle" (step count dropped, the stepper shows it); "[SELLER ZELLE ID]" masked; "[SELLER NAME]"/"[YOUR NAME]" on the receipt → example names Sam Ortega / Alex Rivera (note bullet says they are examples); notes "email addresses" → "other contact details"; app block 880 so the editor no longer scrolls; both "Decided · owner, 2 Nov" boxes and the add-only default kept.
- ProofBlur-Wide: six-item nav rail; stepper under the header row (both views); same context, placeholder and notes fixes as the phone.
- OfferAd (resumed run, 6 Nov): escrow row tile = neutral shield (key mark removed); Currency / Pay with = §11 fields (label above, 48h radius 6); toggle + amount input + conversion line + fee line moved into a last "Start a trade" card; footer = primary + "Message satoshi_ghost" tertiary, with a one-line disabled hint on invalid amounts; "/ XMR" and row "XMR" units in monero-ink 600; duplicate "Draft copy" in the notes heading removed; notes 7 and 8 rewritten; SCREEN_H re-measured (selling 2412/2282/2314/2240, buying 2400/2344/2270), $preview 3897.
- OfferAd-Wide (resumed run, 6 Nov): nav rail already six items (verified); escrow row tile = neutral shield; Currency / Pay with = §11 fields (label above, 48h radius 6); design notes moved out of the right grid column to below the grid, full width (max 944) with the 1px line border-top, dashed box and duplicate "Draft copy" dropped, key-mark bullet rewritten, "Names, prices and terms are examples." caption added; "/ XMR" and row "XMR" units in monero-ink 600; height now follows the left column per side/currency (MAIN_HS selling 1837/1787/1839/1765, buying 1951/1929/1877), $preview 1837.
- FlexOffer-Quote (resumed run, 6 Nov): first available Trade (best price, satoshi_ghost) = 56h monero primary, the rest stay 48h outline; "You pay" input 48h radius 6 with the USD suffix, "Pay with" select 48h radius 6; "Releases in about <mono>8</mono> min" (rel number per offer, digits mono); card "/ XMR" unit in monero-ink 600 (context line stays muted); "Tier" → "Band" (card line, "No band for this amount", sheet "· band …"); root still 2084.
- FlexOffer-Quote-Wide (resumed run, 6 Nov): nav rail already six items with "Post offer" (verified); satoshi_ghost's Trade = 48h monero primary (120 wide), others outline; input/select 48h radius 6; "Releases in about <mono>N</mono> min"; column header "Band and methods", "Band …" / "No band for this amount", dialog "· band …"; $preview 1173.

## Findings skipped and why (this run)
- OfferAd(-Wide) nav current item kept as "Trade": the viewer is a buyer opening a vendor's ad from the offers list (back goes to SellOffers), so it lives under Trade, not Post offer.
- FlexOffer-Quote(-Wide) "Sellers and prices are examples." caption stays inside the app: the boards have no Design notes section and the sheet/dialog scrim is `inset: 0` on the root, so moving it would need a wrapped app block (the CancelRequest-Wide treatment); not a one-line change.
- FlexOffer-Quote(-Wide) "340 trades", "Seen 40 min ago" digits in body text inside the stats string: not in the findings; left.

## COPY-UNSIGNED (this run)
- OfferAd: "Start a trade" (card heading, phone; already on the wide); "Enter an amount in the range above to send a request." (disabled-primary hint).
- OfferAd-Wide: "Names, prices and terms are examples." (notes caption, copied from the phone).
- FlexOffer-Quote(-Wide): "Releases in about 8 min" (was "Releases in ~8 min"); "Band $500.01 – $1,500", "No band for this amount", "Band and methods", "0.6% above market · band $500.01 – $1,500" (was "Tier").

## Open questions for the owner (this run)
- "Band" replaced "tier" on FlexOffer-Quote(-Wide) per the shared standard; FlexOffer-Post may still say "tier" in its own copy (not in group B) and should follow.
- OfferAd escrow row now uses a neutral shield tile; if the owner wanted the key mark there, system v2 §1 would need a fourth placement.
