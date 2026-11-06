# Findings E

## Cross-board (same problem on several boards in this group)
- [P1] Usernames set in mono (mono is for digits/IDs only; BuyerPay/Refunded/Desktop set satoshi_ghost in body) — boards: StaffList (Name column), StaffLog (Who column incl. "system"), StaffPerformance (Name column, and `<h2>` "dmitri_k, last 8 weeks" line 68), ModQueue (Assigned to "sarah.v"), ModCase (Traders card "harbor_lin"/"quietfox", chat sender names), OwnerSetup (username input value) — fix: remove `font-family: 'Atkinson Hyperlegible Mono'` from every username span/cell/input; keep 600 weight body text, as the rail footer "lumen.k · Owner" already does.
- [P1] Same trade state, four different chip words and two tones for "escrow is secured, buyer must pay" — boards: Desktop ("ESCROW SECURED", escrow tone), Fold-Trade ("YOU PAY BY ZELLE", caution), Fold-Tabletop ("WAITING FOR YOUR PAYMENT", caution), Fold-Cover ("PAY NOW", caution) — fix: one chip + tone for this step on all four: caution tone, label "Pay now" (Fold-Trade line 253, Fold-Tabletop line 196, Desktop chip label line 52); Desktop hero wash/border/key mark to `--caution` to match.
- [P1] XMR amounts without 6 decimals in running text — boards: StaffLog ("release 1.80 XMR" lines 90 and 119, "Funded the escrow with 1.25 XMR" line 96), ModCase ("quietfox funded the escrow with 4.00 XMR" line 72) — fix: "1.800000 XMR", "1.250000 XMR", "4.000000 XMR", digits in mono, unit in body.
- [P2] Header bottom border under pane headers (v2 §5: no bottom border; cards give structure) — boards: Fold-MyOffers (lines 19, 85), Fold-Trade (line 177, right pane), Fold-TriFold (line 134, chat pane) — fix: delete `border-bottom: 1px solid var(--surface-raised)` from those `<header>` styles.
- [P2] Same trade code K7M2-9QXA-4FTR-8WPN belongs to satoshi_ghost on BuyerPay/Desktop/StaffLog but to nightowl_44 on Fold-Cover, Fold-Trade, Fold-Tabletop — fix: change the seller to satoshi_ghost on the three Fold boards (or give the Fold trade a different code).
- [P2] Upload row copy differs from BuyerPay ("Add payment proof" / "Private details are blurred for you to check next. Location and device info are removed.") — boards: Desktop ("Drop payment proof here" / "...It's best-effort, so please double-check before sending..." lines 91–92), Fold-Trade (row missing entirely) — fix: Desktop uses BuyerPay's two strings; Fold-Trade adds the same dashed upload row under the "Send exactly" card.
- [P2] Chat timestamp placement differs: Desktop puts "satoshi_ghost · 14:03" above the bubble, Fold-Trade/Fold-Tabletop/Fold-TriFold put it below — fix: Fold boards move the meta line above the bubble like Desktop.

## OwnerSetup
- [P2] Form column is 560 wide; wide forms sit in a 720 column (§18) like StaffSettings — fix: content `max-width: 720px`.
- [P2] Username input value "lumen.k" in mono (see cross-board) — fix: input `font-family: inherit`; keep the setup-code input mono (it is an ID).
- [P3] "Add PGP key" is an underlined orange link inside an outline card while every other inline action in the group (Refunded "Open dispute", StaffOverview) is a non-underlined link with chevron — fix: `text-decoration: none`, keep the chevron.

## StaffList
- [P2] "Senior moderator" chip has an extra `outline: 1px solid var(--mod)` (line 150); Moderator/Owner chips are plain fills — chips are fill-only per §7 — fix: drop the outline/outline-offset so it matches the MODERATOR chip.
- [P2] Login-hour inputs render 12-hour "09:00 AM / 05:00 PM" while the table shows "09:00–17:00 UTC" — fix: force 24-hour display (`lang="en-GB"` on the inputs or an attribute the renderer honours), so both read 09:00 / 17:00.
- [P3] "Add staff member" secondary button top-right duplicates the already-open "Add a staff member" form with its own primary — fix: remove the top-right button, or make the form a collapsed state it opens.

## StaffLog
- [P1] Search input placeholder "Type or paste a trade code" is in mono (line 44) — fix: input `font-family: inherit`; mono only once a code is typed (or body throughout).
- [P2] Filter select shows "Active disputes (2)" while the status line says "Showing everything, newest first." (line 116) — fix: default the select to "All entries", or make the summary read "Showing 2 active disputes, newest first." when that option is chosen.
- [P2] "Today 09:50" / "Yesterday 22:10" omit the zone; conventions format is "6 Nov 2026, 15:00 UTC" — fix: "Today, 09:50 UTC" with the time in mono, or the full date format.
- [P3] Two ways to say the same rule: "Mon to Fri, 09:00 to 17:00 UTC" (line 97) vs StaffList "Mon–Fri, 09:00–17:00 UTC" — fix: use the StaffList form.

## StaffOverview
- [P2] Two Familjen headlines on one screen: page title "Overview" (28) plus hero headline "X2F is live. New trades are open." (28) — rule: no display headline + screen title together — fix: set the hero line to section heading 18/24 600 Atkinson with "Emergency stop" as the 13/16 uppercase label above it, or drop the "Emergency stop" heading and keep the Familjen line at 24/30.
- [P3] "Pause all new trades" is a 48h danger outline button; §10 has no outline danger (danger tertiary, or danger confirm in a sheet) — fix: danger tertiary "Pause all new trades ›" that opens a confirm sheet with the 56h danger-confirm button.
- OK otherwise (day theme readable, one primary, selection rings correct).

## StaffPerformance
- [P1] Heading "dmitri_k, last 8 weeks" (line 68) sets the username in mono inside an Atkinson heading — fix: remove the mono span around `{{who}}`; keep "8" in mono.
- [P3] Callout says "the 4-hour deadline"; durations are "4 h" with a mono digit — fix: "the 4 h deadline".
- OK otherwise: stat strip matches ModQueue's; selected row uses the 2px ink ring; charts stay in `--mod`.

## StaffSettings
- [P2] Undecided amounts shown as "[RATE]" in mono inside live inputs (lines 65, 78, 83) while the lead says "Amounts to be decided; check with the lawyer" — conventions: open owner decisions get an "OPEN · owner to choose" box — fix: empty inputs with placeholder "Not set", plus one dashed-caution OPEN box above the Staff pay fields: "Per-case and monthly rates — owner to decide with the lawyer".
- [P2] Placeholder "No limit" in mono (Most per case input) — fix: `font-family: inherit` on the placeholder; mono only for a typed number.
- [P3] "Large-trade bonus" inner block floats right of the Senior moderator field, leaving a ~180px empty gap under it before "Moderator, per case" — fix: put the bonus block full-width between the Senior and Moderator fields, or after Helper.

## ModQueue
- [P2] "sarah.v" in Assigned-to column is mono 600 (see cross-board) — fix: body 600.
- OK otherwise: matches the staff look (title 28, lead, stat strip, filter ring, 48h secondaries, one orange primary).

## ModCase
- [P1] Chat line "Nothing in my Zelle. Are you sure you sent it to the right email?" (line 76) mentions email; no email anywhere — fix: "Nothing in my Zelle. Are you sure you sent it to the right account?"
- [P1] "quietfox funded the escrow with 4.00 XMR" (line 72) — fix: "4.000000 XMR" with the digits in mono.
- [P2] Compact header title is the raw code "7RWD-3MXE-KQ84-HN2T" with "All disputes" under it; Desktop/Refunded-Wide put words on line 1 and the mono code on line 2 — fix: line 1 "Dispute · harbor_lin and quietfox" (15/20 600), line 2 "Trade 7RWD-3MXE-KQ84-HN2T · Zelle · All disputes" (13/16 muted).
- [P2] Hero uses two chips (caution "Above the 1,000 USD limit" left, mod "Assigned to you" right) where the hero row is chip left + key mark right (§6) — fix: keep the caution chip left, move "assigned to you" into the meaning line ("…opened by the buyer 2 h 40 min ago · assigned to you"), leave the right slot empty (not a trader trade screen, so no key mark).
- [P3] "MOD ONLY" tags on cancel rates are 11px mono uppercase; labels are 13/16 600 Atkinson uppercase — fix: label style in `--mod`.
- [P3] "Release to buyer" / "Refund to seller" option cards show no selected state in the shot; the chosen one should get the 2px ink ring on `--surface-raised`, same as StaffList role tiles.

## Desktop
- [P2] Hero chip/tone differs from the same step on Fold-Trade and Fold-Tabletop (see cross-board) — fix: caution tone, chip "Pay now".
- [P2] Upload row copy drifts from BuyerPay (see cross-board) — fix: use BuyerPay's two strings.
- OK otherwise: nav rail, 560+360 grid, inline primary 48 + tertiaries, no header bar — the staff boards already match it (same rail, 32/48 content padding, 28 title, card radius 16, 48h buttons).

## Fold-Cover
- [P2] Chip "PAY NOW" is the right word; the other three boards for the same step disagree (see cross-board) — fix: align the others to this label.
- [P2] Seller is nightowl_44 for trade K7M2… (see cross-board).
- OK otherwise: key mark caution, one secondary, amount per §15, no trade actions on the cover.

## Fold-Offers
- [P1] Callout says "Nothing changes after you tap Buy." (line 215) but the primary reads "Trade" — fix: "Nothing changes after you tap Trade."
- [P3] The fee sentence appears twice (left footer "You pay no X2F fee when you take an offer." and under the primary "Taking an offer is free. No X2F fee is added.") — fix: keep only the line under the primary.
- Hinge: panes measure 412 + 16 + 412 with nothing crossing; Chat pill, 2px ink selection ring and single pinned primary are correct.

## Fold-MyOffers
- [P1] Left-pane note "...You can have 2 offers per side (buying or selling) for each currency." (line 64) is clipped behind the pinned footer in both themes — fix: `padding-bottom: 16px` on the scroll area (or move the note above the last card) so the last line clears the footer.
- [P2] Off offers use a `1px dashed var(--line)` card (lines 189, 219); dashed is reserved for upload rows and OPEN boxes — fix: outline card (`1px solid var(--line)`, radius 16) with the muted title and "Off · hidden from everyone" meta already there.
- [P2] Header bottom borders (see cross-board).
- [P3] "Select all" checkbox card has a solid `--line` border while the offer cards have none — fix: `--surface` card, no border, same as the on-offer cards.

## Fold-Trade
- [P2] Chip "YOU PAY BY ZELLE" vs the agreed step label (see cross-board) — fix: "Pay now".
- [P2] Missing the "Add payment proof" upload row that BuyerPay and Desktop show at this step — fix: add the dashed upload row under the "Send exactly" card in the left pane.
- [P2] Seller name/trade code mismatch and chat meta placement (see cross-board).
- Hinge respected; stepper, hero, key mark, footer and dialog-free panes are correct.

## Fold-Tabletop
- [P1] Timer is "61:48" (line 205) as mm:ss in 88px mono; §14 is `<mono>61</mono> min` with digits 40/44 and the unit in body 18/24 600 — fix: timer "61" + unit "min" (as Fold-Trade "62 min"); if the top half needs a bigger read, go no larger than 56/60 and keep the unit in body.
- [P1] "of 90 min · ends 31 Oct 2026, 14:05 UTC" (line 207) renders the date in body text; dates and digits are mono — fix: wrap "90" and "31 Oct 2026, 14:05" in mono spans exactly as Fold-Trade does.
- [P1] Two hero numbers in the top half: the timer and "$412.50" at 40 mono (plus the memo at 28 mono) — fix: "Send exactly" amount down to secondary amount 28/32, memo to mono 20/24; keep the timer as the one big thing.
- [P2] No 44px back control in the header while Fold-Trade and the phone have one — fix: add the 44 back `<a>` before the context line.
- [P2] Chip "WAITING FOR YOUR PAYMENT" (see cross-board) — fix: "Pay now".
- Bottom half correctly holds every control (Copy memo 48 secondary, upload row, 56 primary, tertiary pair, chat input); nothing crosses the horizontal hinge.

## Fold-TriFold
- [P1] Same "after you tap Buy" vs "Trade" contradiction as Fold-Offers (line 270) — fix: "Nothing changes after you tap Trade."
- [P2] Chat pane header keeps a bottom border (line 134) — fix: remove it.
- [P3] Chat bubble meta sits below the bubble while Desktop puts it above (see cross-board).
- Three panes 412 + 16 + 412 + 16 + 412 with nothing on either hinge; middle-pane primary pinned; selection ring and badges correct.

## Fold-Notes
- OK (reference page: labels, mono for numbers and code only, stroke icons, both themes readable).
