# Build spec: offers3 (10 Nov 2026)

Covers lead messages 5, 6, 9 and 11 (LEAD-MSGS-2026-11-09.md). Boards: canvas/project/*.dc.html. All new copy is COPY-UNSIGNED unless it is quoted from main.
Tokens only (var(--…)); fonts as on the boards: sans = Atkinson Hyperlegible Next, mono = Atkinson Hyperlegible Mono.

---

## 1. Price wording, one form everywhere (lead msg 11)

Rule (all offer, quote and post screens):
- `p` = percent versus market (band margin + method change). Show `round(|p|, 2)` with trailing zeros trimmed: 0.40 → `0.4`, 0.03 → `0.03`, 2.00 → `2`.
- `p > 0`: "0.4% above market". `p < 0`: "0.5% below market". Rounds to 0: "at market" (mid-sentence) / "At market" (starts a line or stands alone).
- Gone: "+0.4%" over "Vendor markup", "+0.40% markup", "(+0.8%)", "0%".
- A payment method's own change to the band price (not versus market): "0.3% more" / "0.2% less" (was "+0.3%" / "−0.2%"). "No extra", "Band price", "Same as band" stay.
- The toggle "Display amounts including vendor markup" and its hints stay (owner's own words).
- XMR-set band: XMR range row first, then the converted row "≈ $33 – $330": whole currency units (no cents), mono, color `--ink-muted` (was `--ink`, with cents). Fiat-set bands are unchanged (fiat row exact, XMR row "≈ 0.151561 – 4.546832").

Code helper (as on the boards):
```
pctN  = (p) => String(Math.round(Math.abs(p) * 100) / 100) + '%'
vs    = (p) => round(|p|*100) === 0 ? 'At market' : pctN(p) + ' ' + (p > 0 ? 'above' : 'below') + ' market'
change= (p) => pctN(p) + (p > 0 ? ' more' : ' less')
```

### Per board
| Board | Where | Before | After |
|---|---|---|---|
| BuyOffers, SellOffers, Fold-Offers, FlexOffer-Quote(+Wide) | card, bottom-left of the amount block | "+0.03%" (mono 15/20 500 --escrow) over "Vendor markup" (12/16 ink-muted); at market "0%" over "At market" | "0.03%" (same mono style) over "above market" / "below market" (same 12/16 style). At market: only "At market" (12/16 ink-muted, one line). |
| same | converted fiat row of an XMR-set band | "≈ $98.97 – $2,969.10" ink | "≈ $99 – $2,969" mono ink-muted |
| FlexOffer-Quote(+Wide) | "Takes" chips | "Zelle +0.3%", "Bank transfer (ACH) −0.2%" | "Zelle · 0.3% more", "Bank transfer (ACH) · 0.2% less" |
| same | card label when a method adds to the price | "incl. Zelle +0.3%" | removed; the label is "above market" and the chip carries the method change |
| same | request sheet, method select | "Zelle +0.3% · $332.54 / XMR" | "Zelle · 0.3% more · $332.54 / XMR" |
| same | request sheet line | "Zelle adds 0.3% to kettle.moss’s price." | positive: "Zelle adds 0.3% to kettle.moss’s price."; negative: "Bank transfer (ACH) takes 0.2% off mira.k’s price." |
| same | request sheet band line | "0.6% above market · band …" (toFixed) | same words, two-decimal trim |
| same | card percent rounding | total rounded to 1 decimal before display | 2 decimals (0.03 no longer shows as 0) |
| FlexOffer-Quote(+Wide) | XMR sample (lowtide_rx) | "$20 – $400" fiat band | XMR-set band `0.100000 – 1.000000` XMR, row 2 "≈ $33 – $330" muted. Not-available box: "lowtide_rx trades 0.100000 – 1.000000 XMR only (≈ $33 – $330)." (converted at the market rate, whole units) |
| OfferAd(+Wide) | price line under the big price | "2% above market" (toFixed(1)); at market "0% above market" | "2% above market" / "0.5% below market" (percent mono) / "At market". The "· incl. Zelle" tail stays. |
| same | Pay with list, right side | "+1.5%" | "1.5% more" / "0.2% less"; "No extra" stays |
| FlexOffer-Post(+Wide) | under each From/To box | "≈ $165.77 at this band's price (+0.8%)" | "≈ $165.77 at this band's price (0.8% above market)"; zero: "(at market)" |
| same | band price line | "$332.54 / XMR at 0.8% above market" | unchanged form; percent trimmed to 2 decimals; zero: "/ XMR at market" |
| same | preview row | "+0.8% markup · Anyone can trade" | "0.8% above market · Anyone can trade" (percent mono --escrow, words ink-muted); zero: "At market · …" |
| same | method row tag (right of the name) | "+2.0%" | "2% more" / "0.5% less"; "Band price" when no change |
| same | preview methods line | "Zelle · PayPal +2.0% · Bank transfer" | "Zelle · PayPal 2% more · Bank transfer" |
| PostOffer | none (superseded, see 3) | | |

Heights: the card block keeps two lines, so cards do not change height. Board heights changed only by the new design-note asides (see the end).

---

## 2. FlexOffer-Post(+Wide): per-method currencies (lead msg 9, owner question p11-131; API: `methods[].currencies`, absent = every offer currency; lead ruling 10 Nov: a gift card only in its country's currency)

Tweak `methodCurrency`: `simple` (default, as before: every method takes every offer currency, nothing drawn) | `per-method` (the form that ships).

Ship `per-method`. In it, inside each ticked method's open card (Step 3 "Payment methods"), first item of the instructions column (column gap 12):

### 2a. Ordinary method (sample: Zelle in USD and EUR, checklist open)
- Line: 44 px min height, space-between, margin −4px 0.
  - Left: "In: " + codes joined with " · " → "In: USD · EUR". 14/20; "In:" ink-muted; codes mono, ink. `id="mcl-<method>"`.
  - Right: text button "Change" (15/20 600 ink, underline, offset 3px, min 44×44, `aria-expanded`, `aria-controls="mcc-<method>"`, aria-label "Change currencies for Zelle"). While open it reads "Done" (aria-label "Done choosing currencies for Zelle").
- Checklist (only while open), right under the line: `fieldset` 1 px `--line` border, 12 px radius, `--surface` background, padding 8px 14px 4px.
  - Legend (13/18 ink-muted): "Zelle takes payment in:"
  - One row per offer currency, in the offer's order: 44 px label row, 22 px checkbox (accent --ink), code mono 500 ("USD"), currency name ink-muted ("US dollar", "Euro").
  - Footer line (13/18 ink-muted): "A method needs at least one currency."
  - The last ticked currency's box is disabled (can't be unticked).
- Effects: per-currency instruction boxes ("For USD", "For EUR") follow the method's own currencies; with one currency the "Same for all currencies" tick is hidden and the single box is used. The preview's methods line adds the currencies for a narrowed method: "Amazon gift card (USD)".
- Validation (not drawn): every offer currency needs at least one method (API 400 otherwise). Suggested inline line under the Step 3 head, --danger: "No payment method takes EUR. Tick EUR under a method, or remove EUR." (COPY-UNSIGNED, posting blocked).

### 2b. Gift-card method (sample: "Amazon gift card", US card)
Order inside its open card:
1. Select, label "Country" (13/16 600 caps ink-muted), 48 px, 6 px radius, 1 px --line, --surface, chevron right 12 px. Placeholder option "Choose the card's country" (main's words). Sample value "United States".
2. Locked line (24 px min, 14/20 ink-muted): lock icon 16 px + "US card · USD only" ("US card" ink, "USD" mono ink). No Change button. `aria-describedby` from the select.
3. Bold warning (16/22 600, main's GIFT_CARD_WARNING): "When trading Monero for gift cards, you accept all risks and responsibilities that come with gift cards. Buyer beware."
4. Fieldset (as the checklist style, padding 12px 14px 4px): legend "Gift card terms" (16/22 600), hint "Tick each one to go on." (13/18 ink-muted), then 44 px tick rows (15/22). Main's words (giftCardCopy.ts):
   - Sell offer (poster checks the card): "I check the card within 45 minutes of getting its details." / "I check the card's balance myself before I release." / "The card is from this offer's country, in that country's currency."
   - Buy offer (poster sends the card): "The card was bought in the last 30 days." / "The card holds the full value written on it. A range card, like a Visa 200 to 500, may hold part of its range, and then I send a video of me logging in to it." / "The card is from this offer's country, in that country's currency." / "The other trader has 45 minutes to check the card once I hand over its details."
   Until all are ticked, posting is blocked (main's line "Tick each gift card term to post.").
5. Then the usual instructions box, fallback line, and "Price with Amazon gift card".
- If the card country's currency is not one of the offer's currencies: the locked line turns --danger with main's words "Pick the currency of the card's country." and posting is blocked.
- Card currency = the country's currency (US → USD). The method's `currencies` = [that currency].
- Method icon tile: gift glyph (board path `amazon`).

Sample seed in `per-method`: Zelle on (USD, EUR, checklist open), PayPal and Bank transfer off, Amazon gift card on (US, USD). `methods = five` adds Cash App and Cash by mail as before.

### 2c. From main (lead msg 5), drawn here
- Step 1, under "Market $329.90 / XMR right now. Every band is market ± %; prices follow the market.": clock icon 14 px + "Market rate · updated 14:05 UTC" (13/18 ink-muted, time mono). Main: `marketUpdated()`. Default height +34 px (phone).
- Tweak `methodsLoad`: `ok` (default) | `failed`. Failed: the method list is replaced by a --surface-raised 16 px-radius box, padding 16, gap 12: alert line (14/20 --danger, alert icon 16) "The payment methods didn't load." and a 48 px secondary button "Retry" (1 px --line, 12 px radius, 16 600). Nothing counts as picked ("0 of 5 picked"; posting blocked: "Pick at least one payment method to post this offer."). Retry reloads the list.
- Not drawn (main has them; board already covers or differs): "Price unavailable right now." (when the feed has no price: show it in place of the market sentence and the band price lines); "Set your percentage" / "Set your smallest and largest trade" (main's single-range preview placeholders; the board's preview uses "Band N" and "—"); "My offers" link (the board's Close goes to MyOffers); "Enter a percentage from 0 to 50, like 0.5." (board: "Enter a percent." / "Set 50% or less."); "No minimum" (board: "Anyone", owner #12 wording); fee sentence (main: "You pay X2F 1% of each completed trade from your own ads. Taking an offer is free."; board: "You pay the 1% X2F fee only when a trade on this offer completes." — lead to pick one).

### 2d. About "6 strings: amount bands, add-a-currency select"
origin/main's post screen (apps/web/src/screens/PostOffer.tsx, d421706c) is still the single-method form: it has no amount bands and no add-a-currency select. Those strings are in the lead's flex form on origin/wip/lead-flex-launch-4 (`POST_COPY`, offerForm.ts). Against the board:
| flex-launch-4 string | Board |
|---|---|
| "Add a currency" (select) | Board uses chips USD…JPY + "More" (owner Q28 order). Build the chips; no select. |
| "That's 5 currencies, the most one offer can have." | Not drawn; use it as the full line under the chips (same style as "That's 3 bands, …"). |
| "Pick at least one currency." | Not drawn; error under the chips, --danger. |
| "Pick up to 5. Each currency has its own bands; nothing is converted." | Board: "Pick up to 5. You set the smallest and largest trade for each one." (board wins) |
| "In XMR each currency has one band." / "To set amounts in XMR, keep one band per currency." | Board allows up to 3 XMR bands (contiguous at 6 decimals). Lead to decide; board unchanged. |
| "Two bands cover the same amounts with the same price and the same minimum of completed trades. Change one of them." | Not drawn; inline band error, same slot as the contiguity error. |
| "A band's price plus a payment method's price change can't pass 50% either way." | Not drawn; inline under the method's Percent. |
| "Add a payment method" / "Remove" / "Price change" / "No change" / "+2.0%" | Board: tick list of methods, "Above market / Below market / Same as band" + Percent; tag "2% more" (see 1). Board wins. |

### Sizes (FlexOffer-Post phone / Wide)
- Default height 7473 → 8551 (phone; +34 freshness line, +18 wording wrap, +1026 design notes), Wide 5113 → 5659.
- MIN_H: new constants `FRESH_H` (1078 / 546), `PM_H` (48 / 70), `FAIL_H` (−1822 / −1594). Every variant measured before == root.

---

## 3. PostOffer
Superseded note extended only ("Refreshed 10 Nov: … is drawn on FlexOffer-Post and FlexOffer-Post-Wide … This board is not updated for any of it."). Height 3474 → 3618 (min-height and $preview).

---

## 4. Locked payment instructions in the trade room (lead msg 6)

When: from the moment the escrow is secured (owner Q12: never before), to the payer (the XMR buyer), for the whole trade. The text is the offer's instructions for this trade's method and currency (per-currency text when set, else the method's shared text), copied onto the trade when it opens, so the seller's later edits to the offer don't reach it. Empty instructions: show the fallback "Payment method chosen: Zelle. Please post pertinent details in chat window." in the box.

Tweak `payInstructions`: `off` (default, as before) | `locked` (the form that ships for flex-offer trades). Boards: Desktop (1280) and Fold-Trade (840).

Layout (`locked`):
- "Send exactly" card keeps the amount, Desktop's Rate row and the own-name note; its "Zelle to" and "Memo" rows move to the new card.
- New card right under it (same column, gap as siblings: Desktop 24, Fold 16): `section`, --surface, 16 px radius, 20 px padding, 16 px gap.
  1. Head: 40 px method tile (--surface-raised, 12 px radius, method icon) + column: `h2` "How to pay satoshi_ghost" (18/24 600) over "Zelle · USD" (13/18 ink-muted, code mono).
  2. `figure`: --surface-raised, 12 px radius, 14 px padding, 1 px border ink-muted 30%, gap 8.
     - `figcaption`: lock icon 14 px + "satoshi_ghost's instructions" (13/16 600 caps ink-muted).
     - `blockquote` (15/22 ink): the seller's text, sample "Zelle to the phone number in the trade room. Put the trade code in the memo."
     - Caption (13/18 ink-muted): "Set by satoshi_ghost when the offer was posted. It can't change during this trade."
  3. `dl` (--surface-raised, 12 px radius), rows 48 px, padding 0 6 0 14, 1 px --surface divider:
     - "Zelle to" · `(•••) •••-4821` (mono 15 500) · "Copy" button.
     - "Memo" · `K7M2-9QXA-4FTR-8WPN` (mono 15 500) · "Copy" button.
     - Copy button: 44 px tall, 0 10 px padding, copy icon 16 + "Copy" (14 600 ink); after a tap "Copied" (one at a time). Copy puts the full value on the clipboard (the masking question on Desktop stays open).
- Heights: Desktop app 1011 → 1274 with `locked` (`INSTR_H = 263`); Fold-Trade 1031 → 1289 (`INSTR_H = 258`; dispute opened 1315). Defaults unchanged in the app area; Desktop board 1692 → 1922 only from the new notes.

### How it maps to BuyerPay (not my board)
BuyerPay (phone 390) is the same pay step: put the same "How to pay satoshi_ghost" card right under its "Send exactly" card and move its "Zelle to" / "Memo" rows into it, identical copy and states; on 390 the rows' values may wrap, so keep the row labels short ("Memo", not "Memo (trade code)"). Before the escrow is secured (BuyerPay's waiting state) the card is not shown at all. The seller's own SellerConfirm view does not show it.

---

## Height changes (default variant, old → new)
| Board | old | new | why |
|---|---|---|---|
| FlexOffer-Post | 390×7473 | 390×8551 | freshness line, wording wrap, notes |
| FlexOffer-Post-Wide | 1280×5113 | 1280×5659 | same |
| FlexOffer-Quote | 390×3566 | 390×4096 | XMR sample reason line +20, notes |
| FlexOffer-Quote-Wide | 1280×2071 | 1280×2343 | same |
| BuyOffers | 390×2199 | 390×2517 | notes |
| SellOffers | 390×2409 | 390×2727 | notes |
| OfferAd | 390×6023 | 390×6277 | notes (NOTES_H 3765/3783 → 4019/4037) |
| OfferAd-Wide | 1280×3179 | 1280×3319 | notes (WA_ADD floors +140) |
| Desktop | 1280×1692 | 1280×1922 | notes |
| PostOffer | 390×3474 | 390×3618 | note text |
| Fold-Trade | 840×1031 | 840×1031 | unchanged by default (locked 1289) |
| Fold-Offers | 840×1012 | 840×1012 | unchanged; pre-existing mismatch: renders 1219 (before 1012) |
