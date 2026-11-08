# Design gaps: browse, offers, quote, profile, badges, fold

Build: main @ cbf8e50e (`apps/web/src`, paths below are relative to it). Boards: canvas v131 working copy + `shots/sweep/*.png`. Rules: `design-craft-brief-2026-11-07.md`, `design-visual-system-v2.md`. Read-only review.

## 1. Board → built screen

| Board | Built screen | Status |
|---|---|---|
| Main | `screens/browse/MethodList.tsx` (`/sell`) | partial — no market-price hero, no stat tiles, no Active trades, no icon tiles, no designed empty state |
| BuyMain | `screens/browse/MethodList.tsx` (`/buy`) | partial — same as Main |
| BuyOffers | `screens/browse/OfferList.tsx` + `OfferCard.tsx` (`/buy/:methodId`) | partial — no trader identity (avatar / dot / ring / Vendor tag), badges not the kit chip/seal, +N is a tooltip not a sheet, market row has no icon tile |
| SellOffers | same, `side="sell"` | partial — same as BuyOffers |
| BuyQuote | `screens/quote/Quote.tsx` + `BuyQuote.tsx` (`/buy/:methodId/:offerId`) | partial — no compact trader card, "You receive" is not the hero, wallet rows have no 40 px tile, section order differs |
| OfferAd / OfferAd-Wide | — (`/buy/:methodId/:offerId` opens the quote, no public ad page) | not built |
| PostOffer | `screens/PostOffer.tsx` + `post/PostOffer.css` (`/post`) | partial — no builder step heads, one currency not up to 5 chips, no per-currency size, preview card lacks eye icon / per-currency ranges; build ahead on Fixed price + gift-card country + My offers link |
| FlexOffer-Post / -Wide | — | not built (bands, per-method instructions, "N of 3 offers used") |
| FlexOffer-Quote / -Wide | — | not built (You pay / Pay with hero filter, band cards, "Not available to you" callouts) |
| MyOffers | `screens/MyOffers.tsx` (`/profile/offers`) | partial — no stat tiles, no currency chips, no Edit link, no side tiles |
| MyOffers-Wide | — (MyOffers.tsx:15 "tripwire NEEDS_DESIGN_MYOFFERS") | not built (table layout, Post an offer top-right, selection bar) |
| Profile | — (`/profile` tab → `App.tsx:196` redirects to `/sell`) | not built |
| ProfileVisibility | — | not built |
| Reviews / Reviews-Wide | — (`trade/Released.tsx:26` `reviewSlot` placeholder, Plan 5) | not built |
| Review | `trade/Released.tsx` (released part only) | partial — the rating/review cards under it are not built |
| Badges | `ui/BadgePill.tsx` + `ui.css:128` `.x2f-badge`; `OfferCard.tsx:97-145` `Badges` | partial — pill, not the seal + chip kit; no sheet, no "N more badges" card |
| BadgeSettings | — | not built |
| Desktop | `ui/DesktopShell.tsx` + `ui.css:514-556` | partial — top header with Buy / Sell / My trades / Wallets instead of the board's left rail (Trade, Post offer, Wallets, Profile, Settings, Help) |
| Fold-Cover | `trade/TradeGlance.tsx` (`cover`) via `ui/Panes.tsx` | partial — structure there; no avatar row, no "+N more trades", no 40 px clock tile |
| Fold-Offers | `screens/browse/OffersRoute.tsx` + `OfferCard.tsx:174-193` pick rows + `Quote.tsx` pane | partial — pick rows have no avatar / Vendor / badges; pane quote has no trader card / "Change" wallet line |
| Fold-MyOffers | `screens/MyOffers.tsx` + `myoffers/MyOfferDetail.tsx` | partial — detail pane lacks Last edited, currencies, tiers, per-method price, Open trades, Edit offer (MyOfferDetail.tsx:3-5 says so) |
| Fold-Trade | `trade/TradeRoom.tsx:350` Panes + `chat/ChatPanel.tsx` | partial — chat pane has no identity header row, messages are not the 32 px avatar bubble kit |
| Fold-Tabletop | `trade/TradeRoom.tsx` + `TradeGlance.tsx` (`tabletop`) | partial — glance exists; board's three-tile top row (timer / Send exactly / Memo with 40 px icon tiles) not drawn |
| Fold-TriFold | `OffersRoute.tsx:55-62` (two panes only) | partial — no third pane (pre-trade chat); `styles/fold.css:78-91` lays out three columns but no screen fills the third |
| Fold-Notes | `ui/fold.ts`, `styles/fold.css` | matches (rules board; layout thresholds 600/1000, segments, tabletop, gutter 16 all implemented) |

## 2. Gaps, priority order

### P1 — user-facing structure or state missing

- P1 · Main/BuyMain → `screens/browse/MethodList.tsx:83-135` · market price hero (MARKET PRICE label, currency select, 40/44 mono `$329.90 / XMR`, sentence, three stat tiles methods / buyers / best rate) · no market price anywhere on the screen; the header is wordmark, tabs, title, currency chips, search, sort.
- P1 · Main/BuyMain → `screens/browse/MethodList.tsx:83-135` · "Active trades" section (count on the right, one row per open trade with the small key-mark tile in the state tone, "Selling to mira.k / Waiting for payment · $412.50 · Zelle", chevron) · not built.
- P1 · Main/BuyMain → `screens/browse/MethodList.tsx:149-157` · each method row leads with a 40 px icon tile (phone / cash / bank / gift glyph by method group) and shows "up to $331.20" as a right-aligned mono value over a muted "up to" · row is name + one muted sub line + chevron, no tile, best rate folded into the sub text (`SellCopy.ts:40`).
- P1 · Main/BuyMain → `screens/browse/MethodList.tsx:145-147` · section head shows the row count on the right ("17", "62") · no count.
- P1 · Main/BuyMain → `screens/browse/MethodList.tsx:161-168` · empty search is the designed empty state: 56 px tile flanked by two small blocks, title `No method called "{q}" yet`, one sentence, a "Post an offer" secondary button · a centred muted paragraph with an inline underlined "Suggest it" text button.
- P1 · Main/BuyMain → `screens/browse/MethodList.tsx:106-115` · currency is a select inside the hero (USD / EUR / GBP / CAD / BRL / INR) · a row of radio chips under the title.
- P1 · BuyOffers/SellOffers → `screens/browse/OfferCard.tsx:214-228` · trader identity block: 40 px initials avatar on surface-raised, teal online dot bottom-right, teal ring when Trusted, name 600, VENDOR tag, one muted line "Online · 1,284 trades · 99.4% positive" · an 8 px dot + name text, no avatar, no ring, no Vendor tag (`browse.css:396-410`).
- P1 · BuyOffers/SellOffers → `screens/browse/OfferCard.tsx:112-141` · tapping a badge or "+N" opens a bottom sheet "satoshi_ghost's badges" (40 px seals, name, meaning, "Earned 12 Mar 2026"), hover on desktop opens a card titled "3 MORE BADGES" · "+N" opens a `role=tooltip` list titled "All of X's badges" with `label · meaning`, no seals, no dates; featured badges are not tappable.
- P1 · BuyOffers/SellOffers → `screens/browse/OfferList.tsx:92-102` · market price row is an icon row: 40 px activity tile, "Market price", mono price with "/ XMR" in orange · no tile; "/ XMR" muted not orange (`browse.css:333-360`).
- P1 · BuyQuote → `screens/quote/Quote.tsx:291-327` · compact trader card first under the header (48 px avatar, online dot, Trusted ring, VENDOR tag, "1,284 trades · 99.4% positive", badge chips + "+3", chevron to profile) · no trader card; the poster is only a name in the title.
- P1 · BuyQuote → `screens/quote/Quote.tsx:334-341` + `quote.css:281-317` · "YOU RECEIVE" is the hero (v2 §6 neutral gradient wash, uppercase label, 40/44 mono, XMR unit in orange) · a plain surface card; label is the 18/24 section title in sentence case, no wash.
- P1 · BuyQuote → `screens/quote/Quote.tsx:329-331` vs board order · order is trader card → You pay → You receive hero → Which wallet gets paid? → Add another wallet → notice → footer · build renders You pay → wallet picker → You receive card → notice; the hero sits below the wallet list.
- P1 · BuyQuote → `screens/quote/WalletPicker.tsx:47-56` · each wallet row has a 40 px wallet icon tile between the radio and the text; sub line "…k3Fz · gets payouts" / "· for large trades" / "· added today" · no tile; sub is `…k3Fz · <app>` only.
- P1 · BuyQuote → `screens/quote/WalletPicker.tsx:64-66` · "Add another wallet" with a leading "+" icon, 44 px · text link, no icon.
- P1 · OfferAd / OfferAd-Wide → no file · public ad page: escrow-tone hero (SELLING XMR chip, `$336.50 / XMR`, "2% above market", "Market $329.90 · updates live"), Currency and Pay with drop-downs with flags and "No rate right now", PER TRADE / TIME TO PAY tiles, vendor's terms quote card, "Every trade is accepted by the vendor" callout, 2-of-3 escrow row, "Start a trade" card with You pay / You receive toggle, "Request to buy XMR" + "Message satoshi_ghost" footer · not built; `/buy/:method/:offerId` opens the quote instead.
- P1 · PostOffer → `screens/PostOffer.tsx:247-419` · each card opens with a builder step head: 40 px icon tile (tag / activity / bars / people), "STEP N OF 4" uppercase, 18/24 heading ("What you trade", "Your price", "Trade size and terms", "Who can trade with you") · cards have no step head; cards 1 and 3 have no heading at all, 2 and 4 use a bare section title.
- P1 · PostOffer → `screens/PostOffer.tsx:281-289` · CURRENCIES is a chip row (USD EUR GBP CAD AUD JPY with flags, "More ▾"), pick up to 5, helper "Pick up to 5. You set the smallest and largest trade for each one." · a single `<select>` of one currency.
- P1 · PostOffer → `screens/PostOffer.tsx:376-390` · "TRADE SIZE IN USD" / "TRADE SIZE IN EUR" blocks, one SMALLEST / LARGEST pair per picked currency, helper "Whole units only. Each currency has its own range; nothing is converted." · one Smallest trade / Largest trade pair, no per-currency blocks, no helper.
- P1 · PostOffer → `screens/PostOffer.tsx:421-434` · preview card: eye icon + "HOW OTHERS WILL SEE IT" head, price `$331.55 / XMR` with the unit in orange, ranges per currency stacked right (`$50 – $2,000`, `€50 – €1,800`) · dashed card, no icon, one range line, no "/ XMR" unit after the price (`PostOffer.tsx:427`).
- P1 · PostOffer → `screens/PostOffer.tsx:239-244` · header carries "Draft copy" marker and the FlexOffer variant adds "2 of 3 selling offers used" under the title · no offer-count line.
- P1 · FlexOffer-Post / -Wide → no file · price bands per currency (Band N card: FROM / TO, Above market / Below market two-choice, PERCENT field with "%" inside, "Up to 50%.", price line, "Buyer must have completed at least N trades", trash, "+ Add a band"), per-payment-method instructions ("PAYMENT INSTRUCTIONS FOR ZELLE", "Same for all currencies", "PRICE WITH ZELLE"), "N of 3 selling offers used" · not built. (Owner still choosing between PostOffer and FlexOffer-Post; both are listed as live.)
- P1 · FlexOffer-Quote / -Wide → no file · offers list variant: YOU PAY amount + PAY WITH select at the top, "5 offers · best price first", cards show "You get 1.807886 XMR", "Band $500.01 – $1,500", "Takes Zelle · PayPal: up to $500 · Cash App +0.5%" method chips, lock callout "Not available to you. For $300.01 – $2,000, mira.k asks for at least 10 completed trades. You have 3. Up to $300 is open to you." · not built.
- P1 · MyOffers → `screens/MyOffers.tsx:184-196` · three stat tiles under the title (3 on / 3 selling / 2 buying) · none.
- P1 · MyOffers → `screens/MyOffers.tsx:301-320` · each card shows its currencies as small chips (flag + code), and an "Edit ›" link bottom-right · no currency chips; no Edit (MyOffers.tsx:14 "Not built yet").
- P1 · MyOffers → `screens/MyOffers.tsx:301-311` · card body: eyebrow "SELLING XMR · USD · CAD", title "Zelle · PayPal +2.0%", price line "+0.4% to +0.8% · 2 bands · follows the market", limits "$50 – $2,000 per trade" · build has one price and no bands / per-method adjustment (data model has none; API-level).
- P1 · MyOffers → `screens/MyOffers.tsx:244-250` · Select all card: 44 px tick, "Select all", hint "Some selected: 2 of 5." / "Pick offers to turn them on or off together." · built via `ui/SelectAll.tsx` (hint present) — ok; listed only because the board's stat tiles above it are missing.
- P1 · MyOffers-Wide → no layout · table: ON column with switches, 40 px side tile (arrow up-right selling / down-left buying), PRICE / PER TRADE / STATUS columns, Edit › per row, "Post an offer" top-right, selection bar with Turn on / Turn off / Clear above the table · build renders the phone list at every width (`MyOffers.tsx:15`).
- P1 · Fold-MyOffers → `screens/myoffers/MyOfferDetail.tsx:16-62` · detail pane: "Selling XMR · USD" + "Last edited 30 Oct 2026, 18:40 UTC", status card with switch + "Shown in the USD lists for Zelle and PayPal.", CURRENCIES chips, PRICE tiers block ("$50 – $500 +0.8%", "$500.01 – $2,000 · 10+ trades +0.4%"), PAYMENT METHODS block (Zelle Base price, PayPal +2.0%), facts block incl. "Open trades on it 1", "Edit offer" button in the pane footer · build: h2, status row + switch, Price, Payment methods text, three facts; no Last edited, chips, tiers, per-method price, Open trades, Edit offer.
- P1 · Fold-MyOffers → `screens/MyOffers.tsx:288-300` · the shown card carries a chevron on its right (board row 1) · build marks the shown row with an inset 2 px ink line (`ui.css:1611-1614`), no chevron.
- P1 · Profile → no file · trader profile: back + "Trader profile" compact header, 48 px avatar with online dot, "Online · member since Mar 2025", 2×2 stat tiles (212 completed trades / 99% positive (198 reviews) / ~6 min typical payment time / 2% trades cancelled), escrow-tone volume row "41.7 XMR traded to date", Badges card with 40 px seals + "Choose badges", Recent reviews (stars, date · method, tag line, text), "Account protected with PGP / Signed trade history available · Verify", "Offers (3)" primary, "Message" / "More ···" footer · not built; the Profile tab (`ui/BottomNav.tsx:15`) goes to `/profile`, which `App.tsx:196` redirects to `/sell`.
- P1 · ProfileVisibility → no file · Settings › Profile visibility: "Show my trade volume" switch with 40 px tile, "ON YOUR PROFILE AND ADS" preview card (avatar, two stat tiles, volume row, "Imported from LocalMonero: 120.0 XMR" row), totals block (Your X2F total so far / Imported / Shown as) · not built.
- P1 · Reviews / Reviews-Wide / Review → `screens/trade/Released.tsx:134` (`reviewSlot`) · "Review the trade": trader row (48 px avatar, VENDOR, "4 of 5"), "How was trading with satoshi_ghost?", five 56 px star seal tiles, "What stood out?" tag chips (Fast release, Friendly, Clear instructions, Would trade again, Slow, Went quiet, Asked for ID, Payment didn't match), "Describe this trade · 1 of 3 picked" badge chips with seals, "In your own words (optional)" textarea with "0 / 200", "Submit review" + "Skip review" · not built (slot is empty).
- P1 · Badges → `ui/BadgePill.tsx:6-12`, `ui.css:128-140` · badge = 30 px chip on surface-raised with a 22 px family-tone seal (teal reputation, amber speed, ink security / milestones, number glyph for 100 / 500), name 13/16 600 sentence case, no uppercase, no wash; chips and "+N" are wrapped in a 44 px transparent button · build pill: 1 px `currentColor` border, 12 px uppercase, 12 px stroke icon, whole pill in the tone colour, not a button.
- P1 · Badges → `screens/browse/OfferCard.tsx:97-145` · "+N" chip has a chevron and opens sheet (phone) / card (desktop) · "+N" is a plain pill with no chevron and opens a tooltip in both.
- P1 · BadgeSettings → no file · Settings › Your badges: "ON YOUR OFFERS" preview card, "Featured 1 of 2", Earned list (40 px seal, name, meaning, Since/Earned date, three-way Featured / When tapped / Hidden control), Next milestones with progress bars (500 trades 212 / 500, Clean record 88 / 100), "The New badge always shows…" · not built.
- P1 · Desktop → `ui/DesktopShell.tsx:7-12`, `ui.css:520-546` · left rail: wordmark top, items Trade / Post offer / Wallets / Profile / Settings / Help with 20 px icons, the current item on surface-raised with a 2 px ink inset line; content column to the right · build: a top header bar with text links Buy / Sell / My trades / Wallets (no icons, no rail); `/trades` has no route (`App.tsx:167-197`).
- P1 · Fold-Cover → `screens/trade/TradeGlance.tsx:151-200` · cover card: "X2F · +2 more trades" line, PAY NOW chip + three escrow dots, 32 px avatar with online dot before "Buying from satoshi_ghost", `$412.50 USD 1.250000 XMR` on one line, a surface-raised row with a 40 px clock tile "62 min left / Send by Zelle, then tap I've paid", "Open on main screen" button with a phone icon · no avatar row, no "+N more trades" (TradeGlance.tsx:154 "needs the API"), timer fact is text not a tiled row, button has no icon.
- P1 · Fold-Offers → `screens/browse/OfferCard.tsx:174-193` · list-pane row: 40 px avatar + dot + ring, name, VENDOR tag, muted stats line, badge chips, then a rule and a limits / price line (`$50 – $1,500` muted mono left, `$330.00` 28 px mono right); picked row has a 2 px ink ring · pick row: 8 px dot + name, price, stats line, limits; no avatar, Vendor tag or badges.
- P1 · Fold-Offers / Fold-TriFold → `screens/quote/Quote.tsx:105-110, 329-331` · pane quote: trader card first ("Online", three stat tiles, badges, "Sells $50 – $1,500 per trade. Releases in ~8 min."), the wallet is a "Change" link under the hero ("In Cake Wallet, address ending …k3Fz · Change"), no wallet list · pane quote renders the full phone wallet picker and no trader card.
- P1 · Fold-TriFold → `screens/browse/OffersRoute.tsx:55-62` · third pane: "Chat with satoshi_ghost / Ask before you buy. Nothing is locked yet." header (48 px avatar), encryption note, bubbles, composer · build passes no third pane (`Panes` has only `main` / `side`); pre-trade chat is off by lead decision (Quote.tsx:277-281), so the tri-fold shows two panes and empty space.
- P1 · Fold-Trade / Fold-Tabletop → `chat/ChatPanel.tsx:186-265` · chat pane header: 48 px avatar with online dot + Trusted ring, name 600, VENDOR tag, "Online · 1,284 trades · 99.4% positive", Trusted chip on the right; messages as 32 px avatar + bold name with mono time + bubble (12/12/12/4); lock icon before the encryption note · no header identity row; lines are `who: text` list items; the notice is plain text (ChatPanel.tsx:187).
- P1 · Fold-Tabletop → `screens/trade/TradeGlance.tsx:177-240` · top segment is three tiles side by side: timer card (PAY NOW chip, dots, TIME TO PAY 61 min, ring), SEND EXACTLY card with 40 px send tile, "$412.50 USD", "By Zelle for 1.250000 XMR", "To (•••) •••-4821", MEMO card with 40 px tile and the memo in a mono block · glance is one stacked column of facts with uppercase labels, no icon tiles.

### P2 — component not using the kit

- P2 · BuyOffers/SellOffers/BuyQuote/Fold-* → `ui/ui.css:1474-1489` `.x2f-avatar` · kit `avatar()`: surface-raised fill, ink initials (15 px at 40, 48 variant), online dot teal with a 2 px surface ring, Trusted ring teal · the only avatar in the kit is the team-blue one (`--x2f-team` fill, `--x2f-ground` initials); no neutral trader avatar, no dot / ring variants, not used by any browse screen.
- P2 · Badges → `ui/ui.css:128-140` · `chip()` / `seal()` / `more()` from `gen/badges.py` · `.x2f-badge` is a bespoke outlined pill; no seal component exists.
- P2 · Main/BuyMain/MyOffers → `ui/EmptyState.tsx:7-14`, `ui.css:1737-1762` · the one shared empty-state mark (56 px tile flanked by two small blocks in escrow and caution, radius tokens) · 32 px bare icon above the title.
- P2 · Main/BuyMain/MyOffers/Profile → no `stat()` component · stat tile (mono 16 value over 12 muted label, surface-raised, radius 10, grid of 3) · nothing in `ui/` (`.x2f-number-card` / `.x2f-big-number` at `ui.css:1163-1222` are hero numbers, not tiles).
- P2 · BuyOffers/SellOffers → `screens/browse/OfferCard.tsx:216-219` · VENDOR role tag from the kit (`.x2f-tag` exists at `ui.css:1451-1461` with a team tone only) · no vendor tone and no use on offer cards.
- P2 · BuyQuote/Fold-Offers → `screens/quote/quote.css:281-288` · hero per v2 §6 (gradient wash 14 % to 140/160 px, 35 % border) · `.x2f-quote__card` is a flat surface card.
- P2 · PostOffer → `screens/PostOffer.tsx:247-419` · builder step head from `gen/craft-home/kit.py` · none in `ui/`.
- P2 · MyOffers → `screens/MyOffers.tsx:301-304` · 40 px side tile (arrow up-right / down-left) on wide rows · `.x2f-icon-tile` exists (`ui.css:664-673`) but is not used here.
- P2 · Fold-Offers → `screens/browse/OfferCard.tsx:176` · board pane rows are the compact list-card trader block (`gen/badge_parts.py`) · build reuses `PickButton` with two text lines.
- P2 · Desktop → `ui/DesktopShell.tsx:24-38` · left nav rail with icon rows · top text-link header.

### P3 — token / spacing / type drift

- P3 · all → `theme/tokens.css:13-14` (`design/design-system/tokens.json:13-14`) · board night `--monero` / `--monero-ink` = `#ff6600` · build night = `#ff7a1a` (day `#f26822` / `#b84a00` match the board's day monero-ink; board day `--monero` not emitted). Every other colour token matches.
- P3 · BuyOffers/SellOffers → `screens/browse/browse.css:351-360` · market price mono 15/500 with "/ XMR" in `--monero-ink` · mono 18/24 500, "/ XMR" in ink-muted.
- P3 · BuyOffers/SellOffers → `screens/browse/browse.css:428-432` · range `$50 – $1,500` right-aligned mono 15 in ink, the time line under it muted 13 · mono 14; matches otherwise.
- P3 · BuyOffers/SellOffers → `screens/browse/browse.css:438-473` · badge row gap 8, "+N" 30 px tall with chevron · gap 6, "+N" 12 px text in a 22 px pill.
- P3 · BuyQuote → `screens/quote/quote.css:290-293` · hero label uppercase 12/16 muted with letter-spacing (`--x2f-label-*`) · section title 18/24 600 sentence case (`Quote.tsx:336`).
- P3 · BuyQuote → `screens/quote/quote.css:320-341` · inner block rows: label 14/20 muted left, value mono 15/500 right · values are 14/20 regular (`.x2f-quote__rows` font-size 14, `.x2f-quote__mono` no size/weight).
- P3 · Main/BuyMain → `screens/browse/browse.css:210-230` · method rows 64 px with a 14 px gap after the tile, section cards 16 px apart · rows 64 px, no tile; fine except the tile.
- P3 · Main/BuyMain → `screens/browse/browse.css:36-38` · title "How do you want to get paid?" wraps balanced (board: `text-wrap: balance`, no orphan) · no balance; wraps as the browser decides.
- P3 · MyOffers → `screens/MyOffers.tsx:191-194` · "3 of 5 offers on" sits above the title as the compact-header lead line · it sits under the title as a 13 px note.
- P3 · MyOffers → `ui/ui.css:1578-1587` · cards 16 px apart, 20 px inside · `.x2f-list` gap 4 px (`screens.css:175-182`), card padding 4 px with 12 px body top.
- P3 · PostOffer → `screens/post/PostOffer.css:291-298` · preview card: solid surface card with 1 px line border, radius 16 · dashed 1 px border.
- P3 · PostOffer → `screens/post/PostOffer.css:85-89` · Smallest / Largest fields with the currency sign inside, mono 16 · plain text inputs with `post-mono`, no sign.
- P3 · Desktop → `ui/ui.css:520-525` · content column starts at 48 px from the rail, cards 24 px apart on wide · header padding 16/32 and body 24/32; no rail.

### P4 — wording drift

- P4 · BuyOffers/SellOffers → `screens/browse/BuyCopy.ts:15`, `SellCopy.ts:46` · COPY: board says "Releases in about 8 min" / "Pays in about 6 min", build says "Releases in ~8 min" / "Pays in ~6 min".
- P4 · BuyOffers/SellOffers → `screens/browse/OfferCard.tsx:30` · COPY: board badge name "Security key", build "Security key verified".
- P4 · BuyOffers/SellOffers → `screens/browse/OfferCard.tsx:26` · COPY: board Trusted meaning "500+ trades and 98%+ positive.", build "100+ trades, 98%+ positive".
- P4 · BuyOffers/SellOffers → `screens/browse/OfferCard.tsx:31` · COPY: board Clean record "No lost disputes in 100 trades.", build "100 trades with no lost disputes".
- P4 · BuyOffers/SellOffers → `screens/browse/OfferCard.tsx:28` · COPY: board Veteran "Trading on X2F for over a year.", build "trading on X2F for 1+ year".
- P4 · BuyOffers/SellOffers → `screens/browse/OfferCard.tsx:27` · COPY: board Fast "Usually pays or releases within 10 min.", build "usually pays or releases within 10 min" (case only).
- P4 · BuyOffers/SellOffers → `screens/browse/OfferCard.tsx:22` · COPY: board New meaning "Joined in the last 30 days. Shown for 30 days", build "new to X2F, still on starter limits".
- P4 · BuyOffers/SellOffers → `screens/browse/OfferCard.tsx:131-133` · COPY: board card title "3 MORE BADGES" (desktop) / "satoshi_ghost's badges" (sheet), build "All of satoshi_ghost's badges".
- P4 · BuyOffers/SellOffers → `screens/browse/OfferCard.tsx:73-75` · COPY: board shows the volume as a stat tile "275.4 / XMR traded" (OfferAd) and no volume line on the list card; build prints "275+ XMR traded to date" as a card sub line.
- P4 · SellOffers → `screens/browse/OfferCard.tsx:249` · COPY: board third card (0 trades) says "New trader" where the time line goes; build prints nothing when `typicalMinutes` is null.
- P4 · BuyQuote → `screens/quote/BuyQuote.tsx:26` · COPY: board Network fee "Paid by satoshi_ghost", build "about 0.0001 XMR, taken from the payout" (owner OD-4, noted in the file; board not updated).
- P4 · BuyQuote → `screens/quote/BuyQuote.tsx` · COPY: board has a "Deposit · None for this trade" row; build omits it (spec 2.5, noted in the file).
- P4 · BuyQuote → `screens/quote/Quote.tsx:282-289` · board Chat pill is live; build is `aria-disabled` with "Chat opens once the trade starts." (lead decision 2026-10-29).
- P4 · BuyQuote → `screens/quote/Quote.tsx:272-275` · COPY: board sub line "Zelle · USD · $330.00 / XMR · Example"; build drops the "· Example" (correct) — no gap.
- P4 · PostOffer → `screens/PostOffer.tsx:378-388` · COPY: board labels "SMALLEST" / "LARGEST" under "TRADE SIZE IN USD"; build "Smallest trade" / "Largest trade".
- P4 · PostOffer → `screens/PostOffer.tsx:283` · COPY: board "CURRENCIES"; build "Currency".
- P4 · MyOffers → `screens/MyOffers.tsx:186` · COPY: board header pairs the back arrow with "Draft copy"; build has no draft marker (expected — annotation).
- P4 · MyOffers → `screens/MyOffers.tsx:220-222` · COPY: board empty state (design review shot 35) "No offers yet / Post an offer to buy or sell XMR." matches; FOOTNOTE in `myoffers/model.ts:146` matches the Fold-MyOffers board's corrected sentence.
- P4 · Fold-Cover → `screens/trade/TradeGlance.tsx:181-186` · COPY: board "62 min left / Send by Zelle, then tap I've paid"; build shows the timer and label but no "Send by Zelle, then tap I've paid" sub line (check `timer.note`).
- P4 · Desktop → `ui/DesktopShell.tsx:8-11` · COPY: board nav "Trade · Post offer · Wallets · Profile · Settings · Help"; build "Buy · Sell · My trades · Wallets".

## Summary

1. The trader identity kit (avatar, online dot, Trusted ring, Vendor tag, stat tiles) is absent from the build; every browse, quote and fold screen draws a person as an 8 px dot and a name.
2. Badges are an outlined uppercase pill with a tooltip; the board's seal + chip, 44 px buttons, phone sheet and desktop "N more badges" card are not built.
3. Whole boards are missing: OfferAd, FlexOffer-Post/Quote, Profile, ProfileVisibility, Reviews/Review, BadgeSettings, MyOffers-Wide; the Profile tab dead-ends at `/sell`.
4. Craft-pass structure (market-price hero + stat tiles, Active trades, 40 px icon tiles on rows, builder step heads, the shared empty-state mark, the "You receive" hero wash) is not in the build; cards still open on flat stacks.
5. Tokens match except night Monero orange (#ff6600 board vs #ff7a1a build); the Desktop shell is a top bar not the board's rail, and the fold panes lay out correctly but their contents (pick rows, pane quote, chat header, tabletop tiles, tri-fold third pane) are not the boards'.
