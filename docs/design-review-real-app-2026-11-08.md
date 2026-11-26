# Real app vs boards — head designer review, 8 Nov 2026 — READY

Input: wip/lead-demo-shots @ddedee7f (6 screens × 390/1440, signed out). Side-by-side: `docs/design-review-real-app/phone-real-vs-board-{1,2}.png` (in each pair, real is on the left and the board is on the right).
Owner said "Frankly the previous demo was better." His reasons are still pending. Below are the gaps I'd expect him to feel, ranked.

## Ranked gaps (fix in this order)

1. **No front door, and everything is public.** `/` redirects to `/sell` and shows the whole marketplace signed out: methods, buyers, prices and the bottom nav. This breaks two owner rulings: "nothing visible before login / no free tours" and the Landing board (logo D large, "You'll need Fiat to believe it.", Create account / Log in). Fix: `/` = Landing (Landing / Landing-Wide). Every market route redirects to Landing when signed out.
2. **Wide is a stretched phone.** At 1440 the quote input runs about 1300 px wide, the content floats in empty space, and the Trade button sits below the fold. The boards use a left rail with logo D and the page name under it, and a two-column trade layout (Desktop, *-Wide boards). Fix: build the wide shell from Desktop.dc.html / any *-Wide board (rail 240 px, content max 720 px or two columns).
3. **No logo.** The header shows plain text "X2F". Fix: logo D SVG (docs/brand/svg/). On phone it reads "logo – page name"; in the wide rail the page name sits under the logo; before login, the logo is centred.
4. **Quote screen reads as broken.** It shows "0.081528828593 XMR" (12 decimals), which overflows the card on phone. Fix: 6 decimals (format used on every board, e.g. 1.250000). Also:
   - the focus ring is a hard white box inside the field; the boards use a soft 1 px focus border on the field;
   - "Which wallet gets paid?" (wallet picker with radio rows) is missing;
   - the board's Network fee / Deposit rows are reduced to one line.
5. **Offer cards lack the trust row.** Missing: trades · % positive, badges (Trusted, Veteran, +N), "Releases in ~8 min" / "Pays in ~6 min", and the Nudge pill on offline traders. These are the things that make the list feel alive. (Some of this is demo data: 0 trades.)
6. **Signup step 1 crams two fields into one screen.** Username and login name are both on step 1, with no availability check. Board: username only, live "juniper.oak is available" tick, then login name on its own step.
7. **Sell landing lists about 106 dead rows.** "No USD buyers right now · post an offer" repeats down the page. Board (Main): methods with buyers first, the rest collapsed under "All payment methods" with a search.
8. **Demo overlay hides the main buttons.** The orange "Comment" pill sits on top of Trade / I accept / Continue at 390. It's not the app, but it makes the demo feel broken. Move it to the top-right, or make it a small 40 px icon above the bottom nav.

## Smaller
- Terms: the board's checklist ticks became bullets. The scroll-to-end hint and "Already have an account? Log in" are fine.
- Signup header: the progress bar plus "Step 1 of 5" match.

## Not reviewed yet
BuyerPay, SellerConfirm and the proof (privacy tool) step: the helper accounts got stuck on approving a new device. ProofBlur is not built (it's in the gap list).
