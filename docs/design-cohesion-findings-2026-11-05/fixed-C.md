# Fixed C (resumed 5 Nov after the killed run)

## Boards changed
- PostOffer: (done by the earlier run, verified) chevron SVG on "More", box-shadow rings → borders, preview price 28/32 mono, "Draft copy" label, OPEN box "which Post an offer model ships" in notes (no superseded banner per brief). check-board OK, night+day rendered.
- FlexOffer-Post: (done by the earlier run, verified) "Band price" tag, selected cards on --surface-raised, band steppers 28/32, "must have completed at least" + input row stacked, chevron SVG, fee sentence under the primary (owner fact), box-shadows gone. Preview height bumped 4140 → 4224 to match the rendered height. check-board OK, night+day rendered.
- FlexOffer-Post-Wide: six-item rail (Post offer current), currency chips/tabs box-shadow → borders, "More" chevron SVG, 'Tier price' → 'Band price', primary (48h, min 160) + blocked state + fee line moved under the form column (§18), fee "1" mono + "%" body, height 2700 → 2796.
- MyOffers: price split into priceFrom/priceTo so "to" is body text; "tiers" → "bands"; off-card dashed border → solid --line (std 17).
- MyOffers-Wide: same price/bands fix, six-item rail with Post offer current ("My offers" item renamed), off-row dashed → solid, note line updated.
- BecomeVendor: requirement title "A passkey, security key or PGP key", lead "The owner needs one…", "owner" instead of account holder/team lead, "1" mono + "%" body (3 places), current column top line via border-top (box-shadow gone), disabled hint 13/18, heights trimmed (2194 → 2152).
- BecomeVendor-Wide: same copy/ fee/ border fixes; primary + hint moved under the left column (§18); height now 852 + notes (1509).
- Team: switches on = ink; intro "Each member has their own login with a passkey, security key or PGP key."; "two-factor method you've already set up" → "a passkey, security key or PGP key" (list, sheet helper, invite bullet, verify text). Info strip already a callout.
- Team-Wide: same switch/copy fixes; header → BecomeVendor-Wide pattern (back 44 + muted "Settings" + 28/32 title, no underlined link).
- TeamChat: compact header title "Chat with satoshi_ghost" / "Chat with mira.k", context "Trade K7M2… · Zelle · $165.00" (no XMR digits in a body title).
- TeamChat-Wide: six-item rail (Trade current), stepper constrained to the 560 column, Send is now the same icon button (aria-label "Send message") as the phone, header title "Buying from satoshi_ghost" / "Selling to mira.k".
- TeamRefusal: chip "WEAK LOGIN", "weak" lower-case mid-sentence, "two-factor method…" → "a passkey, security key or PGP key", strength tiles now Weak (2px ink ring on --surface-raised + caution "THIS DEVICE" chip) and Strong (plain); "Armored vault" tile dropped.
- MemberApproval / MemberApproval-Wide: "or start a hold" → "or start a <mono>24</mono>-hour hold" (digits were already mono).
- MemberPermissions: switches on = ink, "Coming later" switches = off look + disabled (no dotted ghost), footer helper "Saving needs your passkey, security key or PGP key.", verify text likewise, "Reply to or dispute a review".
- MemberPermissions-Wide: same switch/copy fixes; Save + Cancel moved out of the hero card to sit inline under the left column; Disputes and Reviews moved to the left column (right keeps the member hero, the Coming-later group and "Always yours only"); header → back + "Settings · Team" context + title (no breadcrumb links); height 2472 → 2700.
- InviteInvalid: "Go to log in" is now the orange primary (56h, pinned); "Draft copy" label added to the header.
- InviteInvalid-Wide: "Go to log in" is now the primary (48h, min 160).
- HoldChange: chip "WEAK LOGIN", banner "Owner · logged in with just a username and password", "That's low security, so" dropped, callout ends "…or message a moderator." with an OPEN box (moderator contact) in the notes, every 24-hour / after 24 hours in the markup now mono digits + body unit; notes height grown (1775 → 1979).
- HoldChange-Wide: same copy, placeholder, OPEN box and mono fixes; height 1479 → 1633.
- Wallet: "Addresses are examples." moved out of the app into a new Design notes section; "Draft copy" label added; height 1193 → 1253 (Edge 1355).
- Profile: footer → full-width primary "Offers (3)" with a tertiary pair "Message" / "More ⋯" under it; "Reviews are examples." removed from the app (notes already say so); review times → mono dates "31 Oct 2026", "26 Oct 2026", "12 Oct 2026"; "~6 min" and "2%" tiles stepped down to 20/24.
- ProfileVisibility: DECIDED aside moved from <main> into the Design notes section; switch on = ink; straight quotes → “…”.
- BadgeSettings: "On hover" kept (owner decision); Design notes section added with an OPEN box (On hover vs On tap vs drop) and a "Draft copy" label; height 1393 → 1645.

## Findings skipped and why
- PostOffer superseded banner: brief says keep both boards live, no banner; an OPEN box ("which model ships") in the notes stands in.
- BecomeVendor "Trader" column full 2px border (P3): a bordered column block inside a table needs a redesign; the box-shadow top line became a 2px ink border-top instead (box-shadow gone, which is the shared standard).
- BadgeSettings "On tap": owner decision, kept "On hover" with an OPEN box.
- FlexOffer-Post fee sentence: kept on both phone and wide (owner fact per the lead).
- TeamChat phone "Draft copy" label sits beside a two-line context; left as is (not in findings).
- "Review changes" underlined link in the HoldChange banner and "Click submit…" sentence: left (possible owner words / not in findings).

## COPY-UNSIGNED (new or changed sentences)
- "Each member has their own login with a passkey, security key or PGP key. There are no shared passwords." (Team, Team-Wide)
- "Adding a member or changing what they can do needs a passkey, security key or PGP key." (Team, Team-Wide)
- "This needs your passkey, security key or PGP key." (Team sheet helper)
- "When they open it, they set up their own login with a passkey, security key or PGP key." (Team invite sheet)
- "Adding desk_lee to your team needs a passkey, security key or PGP key." / "Switching desk_sam off needs a passkey, security key or PGP key." (Team verify text)
- "A passkey, security key or PGP key" (BecomeVendor requirement title); "The owner needs one. A username and password alone isn't enough."; "A passkey is set up for the owner."
- "Weak login" chip (TeamRefusal, HoldChange); "You logged in with just your username and password. Team changes need a passkey, security key or PGP key."; "This device's login is weak: you logged in with just your username and password. Adding team members and changing what they can do need a passkey, security key or PGP key."; tile text "Username and password", "Passkey, security key or PGP key", chip "This device"
- "Owner · logged in with just a username and password" (HoldChange banner); "You logged in with just your username and password, so changing your login methods or payout wallets starts a 24-hour hold."; "…or message a moderator."
- "Saving needs your passkey, security key or PGP key." (MemberPermissions footer and verify text); "Reply to or dispute a review"
- "or start a 24-hour hold." (MemberApproval)
- "Chat with satoshi_ghost" / "Chat with mira.k" (TeamChat title); "Buying from satoshi_ghost" / "Selling to mira.k" (TeamChat-Wide title)
- "2 bands · follows the market" etc. (MyOffers); "Band price" tag (FlexOffer-Post-Wide); "You pay the 1% X2F fee only when a trade on this offer completes." (both FlexOffer-Post boards)
- "More" (Profile tertiary button label); review dates are examples
- "Shows “Completed over $X in trades to date” on your profile and ads…" (quote marks only)

## Open questions for the owner
- Moderator contact address (Matrix / Telegram / both) for the HoldChange warning.
- BadgeSettings middle option: "On hover", "On tap", or drop it.
- Which "Post an offer" model ships (PostOffer vs FlexOffer-Post) — OPEN box on PostOffer.
- Confirm the 1% fee sentence wording on FlexOffer-Post (applied as an owner fact).
