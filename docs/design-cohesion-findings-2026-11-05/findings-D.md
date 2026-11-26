# Findings D

## Cross-board (same problem on several boards in this group)
- [P1] Dates without year/UTC and with a weekday ("Fri 16 Oct, 10:14", "Thu 15 Oct, 14:30", "Sat 17 Oct, 14:30", "31 Oct, 14:05 UTC") — boards: DisputeRoom (line 43), DisputeRuling (lines 47, 76), Appeal-Notice-Wide (listStatus, lines 195–196) — fix: convention form "16 Oct 2026, 10:14 UTC", "29 Oct 2026, 14:30 UTC", "31 Oct 2026, 14:30 UTC", "31 Oct 2026, 14:05 UTC"; align the story with Appeal-Notice/Refunded (trade 29 Oct 2026, ruling 29 Oct 2026, 14:05 UTC, appeal until 31 Oct 2026, 14:05 UTC) so trade K7M2 does not carry three ruling dates.
- [P1] Who you contact is named four ways: "Ask a Helper / Helpers" (Support), "our moderators on Matrix (or Telegram)" (Ban-Notice line 53), "Questions? Ask the moderators" (Lien-Notice line 79), "senior moderator or the owner" (DisputeRuling line 76) vs "elena.t, independent reviewer" (Lien-Notice line 51) — fix: "team member" for support (Support title "Ask a team member", primary "Send to the team", callout "A team member will never ask for them"); "moderator" only for disputes; appeals go to "a senior moderator" on DisputeRuling and Lien-Notice ("Decided by elena.t, senior moderator").
- [P2] "Back" wording drifts: "Back to my trades" (Refunded), "Back to trades" (TradeTechIssue, Appeal-Notice line 119), "Not now, back to the trade" (DisputeOpen) — fix: "Back to my trades" on TradeTechIssue and Appeal-Notice; DisputeOpen shortens to "Not now".
- [P2] Appeal CTA drift: "Appeal this ruling" (DisputeRuling, 48h outline, no primary on screen) vs "File appeal" (Appeal-Notice, primary pinned) — fix: DisputeRuling uses the Appeal-Notice pattern: primary "File appeal" 56h pinned in the footer; the Appeal card keeps only the timer chip.
- [P2] "… are examples." captions inside the app: "Posts are examples." (News line 62, News-Wide line 76), "Addresses are examples." (Maintenance line 78, Maintenance-Wide line 80) — fix: delete from the app, add to DESIGN NOTES below the root, as Block does with "Names are examples."
- [P2] Wide nav rail differs: Alerts-Wide, Support-Wide, SelfDestruct-Wide show six items (Settings, Help added); Appeal-Notice-Wide, Lien-Notice-Wide, Ban-Notice-Wide, Block-Wide, TradeTechIssue-Wide, News-Wide, Maintenance-Wide, CantDoThat-Wide show four — fix: one rail for every wide board (recommend the six-item rail) copied verbatim.
- [P2] Moderator purple (--mod) outside a disputed trade room: Lien-Notice / Lien-Notice-Wide "The appeal decision" card (mod tint + border, mod icon tile, elena.t in --mod) — fix: plain primary card (`--surface`, no border), neutral icon tile (`--surface-raised` + `--ink`), "elena.t" in `--ink` 600. Appeal-Notice and DisputeRuling are ruling screens of a disputed trade and may keep it.

## DisputeOpen
- [P2] Over-claim "A moderator usually replies within 4 hours." (line 93) is not a product fact — fix: drop it, or "You'll get a reply here, in this trade's chat."
- [P2] Hero tone is caution (chip "SELLER'S TIME TO CONFIRM RAN OUT", caution key mark) and the chip is a reason, not a state — fix: chip "OPENING A DISPUTE" in `--danger` with danger wash and key mark (matches DisputeRoom); move the reason into the lead sentence.
- [P3] Textarea renders in the display face (`font-family: inherit`, line 61) — fix: `font-family: 'Atkinson Hyperlegible Next', sans-serif` on the textarea.

## DisputeRoom
- [P1] "ruling due by Fri 16 Oct, 10:14 (in 23 h)" (line 43) promises a ruling deadline that is not a product fact, wrong date format — fix: "Replied in 38 min · a moderator is reading the case." If a date must show: "16 Oct 2026, 10:14 UTC".
- [P2] The one primary ("Send unblurred proof to sarah.v", 56h orange) sits inside a chat bubble above the composer, not pinned in the footer — fix: keep the request as a `--mod` callout in the thread and move the primary into the pinned footer above the composer; or make the in-bubble button a 48h secondary.
- OK otherwise (--mod card, chip and bubble are in a disputed trade room; day contrast readable).

## DisputeRuling
- [P1] No primary action and no pinned footer (only a 48h outline "Appeal this ruling" inside a card, line 78) — fix: footer with primary "File appeal" and tertiary "Back to my trades".
- [P2] Hero pattern differs from Appeal-Notice for the same moment: chip "RULING: RELEASE TO THE BUYER" + headline, vs chip "DISPUTE DECIDED" + 13/16 label "REFUND TO THE SELLER" + headline — fix: chip "DISPUTE DECIDED", label "RELEASE TO THE BUYER", headline "The 1.250000 XMR goes to you".
- [P2] Moderator row "Thu 15 Oct, 14:30" (line 47) — fix: "29 Oct 2026, 14:05 UTC".
- [P3] "Evidence used" rows use bare 18px icons; §9 rows use 40px icon tiles — fix: 40×40 radius-12 `--surface` tiles, row min-height 64.

## Appeal-Notice
- OK

## Appeal-Notice-Wide
- [P1] Right-column row "Appeal open until 31 Oct, 14:05 UTC" (lines 195–196) — fix: "Appeal open until 31 Oct 2026, 14:05 UTC".
- [P2] No back control on wide (phone has one); the Chat pill sits in a header-bar position — fix: per §5 wide, back 44 + two-line context at the top of the content column (margin-left -12), Chat pill on the same row, no bar.

## Lien-Notice
- [P2] Result headline runs five lines ("Your trading is paused until you repay 1.250000 XMR to mira.k (appeal decision)", line 29) — fix: headline "Trading paused until you repay mira.k"; amount into an inner `--surface-raised` block (mono 28/32 + XMR unit, fiat beside); "(appeal decision)" into the lead.
- [P2] "If you don't repay, your account will be suspended and may be banned for life." (line 60) contradicts Ban-Notice, which shows a ban that ends on a date — fix: "If you don't repay, your account can be banned." and settle the Ban-Notice question below.
- [P2] "elena.t, independent reviewer" (line 51) — fix: "elena.t, senior moderator".
- [P3] Tertiary "Questions? Ask the moderators" (line 79) — fix: "Questions? Ask the team".

## Lien-Notice-Wide
- [P3] "Decided by" value wraps to two right-aligned lines — fix: shorter value ("elena.t, senior moderator") and dd `flex: 1; text-align: right`.
- Same copy fixes as Lien-Notice.

## Ban-Notice
- [P2] Default shows "Ends: 14 Nov 2026, 14:05 UTC" for a ban whose reason is "three trades in a row were not paid"; product facts say the moderator freeze has no end time — fix: confirm with the owner; if bans are not timed, default the `timed` tweak to false ("Permanent"), drop the date row, lead "until a moderator lifts it".
- [P2] Account notices are drawn two ways: Ban-Notice is a bottom sheet over a dimmed app, Lien-Notice a full screen with an "Account notice" header — fix: make Ban-Notice a full screen like Lien-Notice (close 44 + "Account notice", danger hero, footer primary "OK").
- [P3] Row labels carry colons ("Ends:", "Reason:", lines 48, 50); other inner blocks use plain labels — fix: drop the colons.

## Ban-Notice-Wide
- Same three fixes as Ban-Notice (the centred dialog itself is fine).

## Block
- OK

## Block-Wide
- OK

## TradeTechIssue
- [P2] Tertiary "Back to trades" (lines 23, 153) — fix: "Back to my trades".
- [P3] Header context lacks "· Example" that sibling trade boards show — fix: add it, or remove it from the others.

## TradeTechIssue-Wide
- Same as TradeTechIssue; OK otherwise.

## Alerts
- [P2] Chip "RECOMMENDED FOR DE-GOOGLED PHONES" (line 99) is an escrow status chip used for a recommendation, and "de-Googled" is jargon — fix: replace the chip with a 13/18 muted lead under the heading: "Recommended on phones without Google services."
- [P2] Secondary buttons in cards are drawn two ways on phone: "Allow in Android settings" full width; "Play test sound" and "Send test" auto width — fix: all three full width 48h (§10 phone secondaries in cards).
- [P3] Toggle on-state is `--escrow` fill (line 173) while every other selection state is ink — fix: confirm with the lead; if selection = ink applies, track `--ink`, knob `--ground`.

## Alerts-Wide
- OK apart from the cross-board nav rail.

## News
- [P3] "Posts are examples." inside the app — see cross-board. OK otherwise.

## News-Wide
- OK (same caption fix).

## Support
- [P1] "Helper / Helpers" terminology (lines 30, 52; primary "Send to Helpers") — see cross-board: "team member", "Send to the team".
- OK otherwise.

## Support-Wide
- Same as Support.

## Maintenance
- [P2] Phone root shows a 4-tab bottom bar under the pinned footer; no other phone board in this group or the exemplars has one — fix: remove the tab bar; the pinned footer is the last element.
- [P3] "The system has been taken down for unscheduled but necessary maintenance." reads as jargon — fix (if not owner-quoted): "We took X2F down for urgent maintenance. It will be back as soon as possible."
- [P3] "Addresses are examples." inside the app — see cross-board.

## Maintenance-Wide
- [P3] "Addresses are examples." — see cross-board. OK otherwise.

## SelfDestruct
- [P2] The hero (COMPLETED) is not the top card; the "This trade self-destructs on 28 Nov 2026" callout sits above it — fix: hero first, then the callout (§12 info, `--surface-raised`).
- OK otherwise.

## SelfDestruct-Wide
- [P2] Same ordering (callout above hero) — fix: hero first in the left column.
- [P3] Wide title "Bought 1.250000 XMR from satoshi_ghost" differs from phone "Bought from satoshi_ghost" — fix: use the phone title on both.

## CantDoThat
- OK

## CantDoThat-Wide
- OK
