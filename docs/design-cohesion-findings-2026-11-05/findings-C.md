# Findings C

## Cross-board (same problem on several boards in this group)
- [P2] Toggle "on" colour differs per board: MyOffers = ink, Team / MemberPermissions = `var(--team)`, ProfileVisibility = `var(--escrow)` — boards: Team, Team-Wide, MemberPermissions, MemberPermissions-Wide, ProfileVisibility — fix: in each board's switch `track` string replace `(on ? 'var(--team); background: var(--team);` / `'var(--escrow); background: var(--escrow);` with `'var(--ink); background: var(--ink);` so every switch matches MyOffers (selection is never a tone colour; `--team` is for member identity only).
- [P2] "two-factor method you've already set up: a passkey, security key or PGP key" / "two factors" / "Two-factor method set up" is jargon and drifts from the agreed phrase — boards: Team (lines 31, 86, 168, 193), TeamRefusal (32, 71), MemberPermissions (109), MemberPermissions-Wide, BecomeVendor, BecomeVendor-Wide — fix: say "needs a passkey, security key or PGP key" everywhere; Team intro → "Each member has their own login with a passkey, security key or PGP key. There are no shared passwords."; BecomeVendor requirement title → "A passkey, security key or PGP key".
- [P2] Same weak-login state named three ways: TeamRefusal chip "THIS DEVICE'S LOGIN IS WEAK" / tile "Weak", HoldChange chip "LOW SECURITY LOGIN" / "That's low security", HoldChange banner "Team lead · logged in with just a username and password" — boards: TeamRefusal, HoldChange, HoldChange-Wide — fix: one chip word "WEAK LOGIN" on both sheets and the banner; body "You logged in with just your username and password." (drop "low security").
- [P2] "Team lead" vs "owner" vs "account holder" for the same person — boards: BecomeVendor (+Wide) "The account holder (team lead) needs…", HoldChange (+Wide) banner "Team lead · …", Team "for you, the owner" — fix: "owner" everywhere: BecomeVendor → "The owner needs a passkey, security key or PGP key."; HoldChange banner → "Owner · logged in with just a username and password".
- [P2] Wide nav rail differs per board: MyOffers-Wide and FlexOffer-Post-Wide show Trade · My offers · Wallets · Profile; TeamChat-Wide adds Settings; BecomeVendor-Wide, Team-Wide, MemberApproval-Wide, MemberPermissions-Wide, HoldChange-Wide show Trade · Post offer · Wallets · Profile · Settings · Help — fix: one rail on all wide boards (Trade · Post offer · Wallets · Profile · Settings · Help); settings screens mark Settings current; MyOffers-Wide and FlexOffer-Post-Wide mark "Post offer" current (rename the "My offers" item to match Refunded-Wide).
- [P2] Wide settings header drawn three ways: BecomeVendor-Wide = back + two-line "Settings / Account type"; Team-Wide = back + underlined "Settings" link + title below; MemberPermissions-Wide = back + breadcrumb "Settings / Team" links — boards: Team-Wide, MemberPermissions-Wide — fix: match BecomeVendor-Wide (back 44 + 13/16 muted context "Settings" or "Settings · Team" + 28/32 title, no underlined links).
- [P2] "tier" vs "band" for the same thing: FlexOffer-Post says "Price bands" / "Band 1", MyOffers says "2 tiers · follows the market", FlexOffer-Post method cards say "Tier price" — boards: MyOffers, MyOffers-Wide, FlexOffer-Post, FlexOffer-Post-Wide — fix: MyOffers `priceSub` → "2 bands · follows the market" / "1 band · …" / "3 bands · …"; FlexOffer tag `'Tier price'` → "Band price".
- [P2] Example-data notes sit inside the app root ("Addresses are examples." Wallet line 84; "Reviews are examples." Profile line 82; the "DECIDED · OWNER" aside inside `<main>` of ProfileVisibility ~line 72) — boards: Wallet, Profile, ProfileVisibility — fix: move each into the Design notes section below the app (ProfileVisibility: move the `<aside aria-label="Decided…">` after `</main>`; Wallet and Profile: delete the `<p>` and add the sentence to the notes).
- [P3] "More ▾" currency chip uses a text glyph for the chevron — boards: PostOffer (line 53), FlexOffer-Post (49), FlexOffer-Post-Wide (57) — fix: "More" + 16px stroke chevron-down SVG, `aria-hidden`.
- [P3] Inner "borders" drawn as `box-shadow: inset 0 0 0 1px var(--line)` / `inset 0 0 0 2px var(--ink)` — boards: PostOffer, FlexOffer-Post, FlexOffer-Post-Wide, BecomeVendor (`inset 0 2px 0 var(--ink)`) — fix: `border: 1px solid var(--line)` / `border: 2px solid var(--ink)`; the only allowed box-shadow is the nav inset.

## PostOffer
- [P2] Board shows a single "Your price" ± % and one range per currency, while FlexOffer-Post (same title "Post an offer") is the decided model with bands per currency; two live "Post an offer" boards contradict each other — fix: add the superseded banner (dashed `var(--line)`, "Replaced by FlexOffer-Post, 2 Nov 2026") at the top of PostOffer, or replace the price card with the bands section from FlexOffer-Post.
- [P2] Two hero-size mono numbers on one screen: "+0.5%" (stepper) and "$331.55" in the preview box — fix: preview price at Amount-secondary 28/32 mono; the stepper stays the one big number.
- [P3] No "Draft copy" label although helper copy ("Whole units only. Each currency has its own range; nothing is converted.") is unsigned — fix: add the 12px mono `var(--ink-muted)` "Draft copy" label top-right of the header row, as on MyOffers.

## FlexOffer-Post
- [P2] "Buyer must have at least [5] completed trades" wraps so "completed trades" drops to its own line under the checkbox (both themes) — fix: `flex-wrap: nowrap` with shorter copy "Buyer needs" + input + "trades", or stack as a label line + input row.
- [P2] Phone lacks the fee sentence the wide board has ("You pay the 1% X2F fee only when a trade on this offer completes.", Wide line 225) — fix: add the same 13/18 muted line under the footer primary, or drop it from the wide board; confirm the 1% fee is an owner fact before it ships on either.
- [P3] Band stepper numbers (+0.8%, +0.4%) are hero size inside every band card, so a 5-band screen has five "hero" numbers — fix: Amount-secondary 28/32 for band steppers.
- [P3] Selected payment-method cards get the 2px ink ring on `var(--surface)` — fix: ring on `var(--surface-raised)` per CONVENTIONS.

## FlexOffer-Post-Wide
- [P2] Primary "Post offer" sits in the right column above the preview, not inline under the form column (§18) — fix: move the primary (48h, min-width 160) under the "Who can trade with you" card in the 720 column; keep the preview box on the right.
- [P3] Same selected-card ring on `--surface` as the phone board — fix: as above.

## MyOffers
- [P1] Mono on words: `{{o.price}}` renders "+0.4% to +0.8%" inside one mono span, so "to" is mono (line 66) — fix: split the data into `priceFrom`/`priceTo` and render `<mono>+0.4%</mono> to <mono>+0.8%</mono>`.
- [P3] Toggles are ink here (correct); use this as the reference for the cross-board toggle fix.

## MyOffers-Wide
- [P1] Same mono-on-words "+0.4% to +0.8%" (lines 154, 157) — fix: as MyOffers.
- OK otherwise (nav current item, selection ring, one primary).

## BecomeVendor
- [P2] Duration digits in body text in the comparison table: "2, 4, 6 or 12 h", "2, 6, 12 or 24 h" ("1%" is already mono) — fix: wrap each digit group in the mono span, units stay body: `<mono>2</mono>, <mono>4</mono>, <mono>6</mono> or <mono>12</mono> h`.
- [P2] "Two-factor method set up (passkey, security key or PGP key)" requirement title + "NOT MET" chip — fix: title "A passkey, security key or PGP key", lead "The owner needs one. A username and password alone isn't enough."
- [P3] "Trader" column highlight is only a 2px top line (`inset 0 2px 0 var(--ink)`) on `--surface-raised` — fix: full 2px `var(--ink)` border on the column block, radius 12, like every other selected tile.

## BecomeVendor-Wide
- [P2] Same table digits and "Two-factor method" title as the phone board — fix: as BecomeVendor.
- [P3] Disabled primary "Switch to a vendor account" floats between two right-column cards — fix: place it under the left column with its helper line, per §18.

## Team
- [P2] Member switches use `var(--team)` for "on" (track string `on ? 'var(--team); background: var(--team);`) — fix: `var(--ink)`, as MyOffers.
- [P2] "Team members are for Vendor accounts only." is a bare `--surface` strip without the §12 callout treatment — fix: info callout: `--surface-raised`, radius 12, padding 12 14, 18px info icon `--ink-muted`.
- [P3] "During a 24-hour hold…" / "start a 24-hour hold": digits in body — fix: `<mono>24</mono>-hour hold`.

## Team-Wide
- [P2] Header: back + underlined "Settings" link, title "Team" on the next row — fix: BecomeVendor-Wide pattern (13/16 muted "Settings" context, 28/32 title beneath, no underline).
- [P2] Same `--team` switches — fix: `var(--ink)`.

## TeamChat
- [P2] Header is neither pattern: a 2-line 16px bold title "Buying 0.500000 XMR from satoshi_ghost" squeezed between the back arrow and "Draft copy", context line under it — fix: compact header (15/20 600 "Chat with satoshi_ghost", 13/16 muted "Trade K7M2-9QXA-4FTR-8WPN · Zelle · $165.00"), matching the wide board's `chatTitle`.
- [P3] Send is an icon-only button here and a text "Send" button on the wide board — fix: same control on both (icon button with `aria-label="Send"` is fine; make wide match).

## TeamChat-Wide
- [P3] Stepper runs the full content width across both grid columns; on BuyerPay it sits within the content column under the title — fix: constrain it to the 560 column so hero and stepper align.
- OK otherwise: hero (PAID chip, caution key mark, one hero amount), 560+360 grid, nav current.

## TeamRefusal
- [P2] "This device's login is Weak:" capital W mid-sentence, and the current-device tile is marked only by a caution border (tone standing in for selection) — fix: "This device's login is weak:"; current tile gets the 2px `var(--ink)` ring with a small caution chip "THIS DEVICE" inside.
- [P3] "Armored vault" tier name is unexplained jargon on this sheet — fix: "Strongest (passkey + security key)" or drop the third tile; the sheet only needs Weak vs Strong.

## MemberApproval
- [P2] "Trade handler (9 of 19 allowed)" value: digits in body bold — fix: `Trade handler (<mono>9</mono> of <mono>19</mono> allowed)`.
- [P3] "or start a hold" vs Team's "start a 24-hour hold" — fix: "or start a 24-hour hold".

## MemberApproval-Wide
- [P2] Same body digits in "9 of 19 allowed" — fix: as phone.
- OK otherwise (dialog centred over dimmed app, Refuse danger outline + Approve primary).

## MemberPermissions
- [P2] Switches on in `var(--team)`; disabled "Coming later" switches are dotted ghosts — fix: on = `var(--ink)`; disabled = `--surface-raised` track, `--ink-muted` knob, `disabled` attribute (§10), no dotted outline.
- [P2] Footer helper "Changing permissions or adding a member needs a two-factor method you've already set up…" — fix: "Saving needs your passkey, security key or PGP key."
- [P3] "Reply to reviews / dispute a review" uses a slash — fix: "Reply to or dispute a review".

## MemberPermissions-Wide
- [P2] Primary "Save permissions" lives inside the right-column hero card; the left column ends ~700px above the right one — fix: Save + Cancel inline under the left column (§18), and move "Disputes" and "Reviews and people" to the left column so the columns end close together.
- [P2] Same switch colours and dotted disabled switches — fix: as phone.

## InviteInvalid
- [P1] No primary on the screen: the only action "Go to log in" is a secondary outline (line 70, `border: 1px solid var(--line)`) — fix: make it the primary (`background: var(--monero); color: var(--on-monero)`, 56h, pinned), as Refunded's "Find another offer".
- [P3] No "Draft copy" label although "It ran out." and the invite copy are unsigned — fix: add the label next to the "Join a team" header.

## InviteInvalid-Wide
- [P1] Same: "Go to log in" (line 74) is an outline button, no primary on the page — fix: primary 48h, min-width 160.
- OK otherwise: result hero at 40/44, neutral chip, no nav rail while logged out.

## HoldChange
- [P2] Chip "LOW SECURITY LOGIN" + banner "Team lead · logged in with…" name the state differently from TeamRefusal ("Weak") — fix: chip "WEAK LOGIN", banner "Owner · logged in with just a username and password".
- [P2] "[address to come]" mono placeholder inside the callout is an undecided value shown as copy — fix: OPEN box in the notes ("Moderator contact: Matrix or Telegram address, owner to supply") and shorten the callout to "…or message a moderator."
- [P3] "24-hour hold" / "after 24 hours" digits in body — fix: `<mono>24</mono>-hour`, `after <mono>24</mono> h`.

## HoldChange-Wide
- [P2] Same chip, banner and placeholder as the phone board — fix: as HoldChange.
- OK otherwise: dialog centred over dimmed app, tertiary + primary order.

## Wallet
- [P2] "Addresses are examples." rendered inside the app above the footer (line 84) — fix: move to Design notes.
- [P3] No "Draft copy" label although "X2F never holds your coins…" and the 24-hour helper are unsigned — fix: add the label in the header row.
- OK otherwise: title 28/32, 64px rows with 40 tiles, escrow READY chips, ink selection ring, one pinned primary.

## Profile
- [P2] Footer is three buttons in one row ("Offers (3)" orange, "Message" outline, "…" icon): primary not full width, breaks the §10 footer pattern — fix: primary "Offers (3)" full width 56h; "Message" and "More" as a tertiary pair under it (space-between row).
- [P2] "Reviews are examples." inside the app (line 82) — fix: move to Design notes.
- [P3] Review times are relative ("2 days ago", "1 week ago") in body text while every other board shows "6 Nov 2026, 15:00 UTC" in mono — fix: mono dates "31 Oct 2026" (no time needed on reviews).
- [P3] Four stat tiles at 28px mono read as four hero numbers — fix: keep 212 and 99% at 28/32, drop "~6 min" and "2%" to 20/24.

## ProfileVisibility
- [P2] "DECIDED · OWNER" aside sits inside `<main>` (after the preview card, before `</main>` line 73) — fix: move it into the Design notes section.
- [P2] Switch on-colour is `var(--escrow)` — fix: `var(--ink)`.
- [P3] "Shows 'Completed over $X in trades to date'" uses straight single quotes — fix: curly quotes “…”.

## BadgeSettings
- [P2] Segment option "On hover" on a phone-first app (line 69; also "On hover. Only 2 badges can be featured." line 109) — fix: "On tap" (helper "Shows when someone taps your badges"), or drop to Featured / Hidden if tap-to-reveal isn't built.
- [P3] No "Draft copy" label although badge descriptions ("Usually pays or releases within 10 min") and the New-badge sentence are unsigned — fix: add the label.
- OK otherwise: ink ring on segmented control, 40px tiles, mono counts.
