# Review: quote bands + design review 8 Nov item 4 (wip/lead-quote-bands)

- SHA reviewed: fcad4cad77f0d87db2749fa3263142e2715ded2c (local `qb`, tracks origin/wip/lead-quote-bands; clean)
- Range: `git diff origin/main...HEAD`, bands work 3be7baa0..b9ea7b30, main merge feefe4c8, item 4 06dfabcf, READY fcad4cad
- Reviewer: lead's independent reviewer, read-only. Nothing changed.
- Tests run (3 files): `test/bands.test.ts`, `test/quoteScreen.test.tsx`, `test/quoteFocus.test.ts`: 63/63 pass. No Playwright (builder ran quote.spec 39/39).

## Verdict

**APPROVED after one Important fix (I1, forced-colors focus).** The money is right. The minors can land later or go to design.

## What I checked and found sound

- **BuyQuote "You receive" at 6 places.** `formatXmr` (packages/trade/src/money.ts:82) cuts off the extra digits and never rounds up, so the figure is never more than `receiveAtomic`. The take still sends the exact amount: Quote.tsx:430 sends `ok.amountAtomic`, the confirmed deal (Quote.tsx:258) carries `takeAmountAtomic: ok.amountAtomic`, and quoteScreen.test checks that the take carries `'151515151515'` while the screen shows `0.151515 XMR`. Display only, so no money risk.
- **SellQuote "You lock in escrow" stays exact.** `headlineExact: true` (SellQuote.tsx:22) goes through `xmrText = formatXmrExact`, which follows the exact-send rule. The new e2e checks `1.151515151515 XMR` in full at 390 and 360. On a buy ad `sellerFundsAtomic` equals the amount (escrowPlan, the taker pays no fee).
- **M5 scope.** M5 is Task 18 review item 5 (docs/superpowers/reviews/2026-10-27-p3-task18.md:12). Its example was SellQuote: you type 1.0000009, the screen shows 1.000000, but the trade and the funding request are 1.0000009. The fix went into shared code, so it reached BuyQuote too, and 663e3ad9 changed the BuyQuote e2e on the reasoning that "the figure is what is sent". That reasoning doesn't hold for the buyer, who sends no XMR. So BuyQuote was not really part of M5. Changing the quote.spec expectation to `1.213235` (with `not.toContainText('1.213235294117')`) is correct: it keeps M5 for the seller and follows the 6-place display rule.
- **Same as the trade room.** The buyer's XMR is shown with `formatXmr` (6 places) in TradeGlance.tsx:198/225, TradeFund.tsx:402, AcceptedSheet.tsx:178 and DisputeRoom.tsx:148. The amounts someone has to send stay exact: TradeFund.tsx:158/350 and FundFallback.tsx:82 use `formatXmrExact`. BuyQuote now matches the trade room. Nothing on main contradicts this.
- **The 26 px size.** `data-long` is set only when the string has more than 6 places, so only on SellQuote (BuyQuote never has more than 6). 15 mono characters at 26 px with -0.02em tracking come to about 227 px, plus the unit about 270 px. That fits the about 288 px inside the card at 360. At 320, `overflow-wrap: anywhere` moves the unit to the next line rather than breaking the number.
- **Focus contrast, normal state.** The border changes from line to ink: 4.12:1 dark, 4.80:1 light against the unfocused border. Ink against surface-raised is 13.4 and 15.6. This meets WCAG 2.4.7 and 1.4.11.
- **Bands.** All the maths uses bigint through @x2f/trade. `bandXmr` rounds down and the display shows "≈". `markupText` rounds half away from zero on bps and is exact for market bands. `bandAt` includes both edges of a band. Clip lines take the neighbour's rate with markup. `offerBands` is a single band until the API sends bands, so there are no clip lines today, and the e2e asserts that. OfferCard's `marginLine` and `offerRange` moved into bands.ts without changing what they do, so the offers card and the quote use the same wording.
- **`price.at` is now required** (api.ts:92-93). The real route sends it (apps/api/src/price/routes.ts:23), and every e2e stub of `/v1/price` includes it (quote, block, design-shots, fold).
- **Max on BuyQuote.** The comment cites owner #5. Max fills `maxFiatCents`, and the e2e shows the band ring moving to it. A starter cap below the max is refused by the server (409 `starter-limit`), the same as SellQuote already does.

## Findings

### Important

**I1. In forced-colors mode (Windows High Contrast) the amount field has no focus indicator.** quote.css:160-162 sets `outline: none` on the input. The new indicator is only a `border-color` change (quote.css:156-158) and, in error, a `box-shadow` (quote.css:169-171). Forced-colors mode replaces border colours with system colours (focused and unfocused look the same) and removes box-shadow. So a keyboard user in High Contrast gets no visible focus on the quote's main input (WCAG 2.4.7). This is the only input in the app that removes its outline (the other `outline: none` rules are on programmatic focus targets in ui.css:321/327). The file already has a forced-colors block for the bands (quote.css:524).
Fix (CSS only, the normal look is unchanged):
```css
@media (forced-colors: active) {
  .x2f-quote__box:focus-within { outline: 2px solid Highlight; outline-offset: 2px; }
}
```
(Or use `outline-color: transparent` in place of `outline: none` at :161: a transparent outline is drawn in forced colours.) Add an assertion for it to test/quoteFocus.test.ts.

### Minor

**m1. In error, focus only makes the border 1 px thicker, in the same colour.** quote.css:169-171: the border is 1 px danger when not focused and 2 px danger when focused. That is visible, so 2.4.7 passes, but it is weak (it fails AAA 2.4.13's change-of-contrast test). Before this change, the error state had the full 2 px ink outline. Design's call: for example, add an ink ring outside the box in error, `box-shadow: inset 0 0 0 1px var(--x2f-danger), 0 0 0 2px var(--x2f-ink)`, or accept it as it is.

**m2. `:focus-within` also turns on the field border when Max or the unit switch has focus.** quote.css:156: Max sits inside `.x2f-quote__box` (Quote.tsx:333-337). When you tab to Max, the field's ink border and Max's own 2 px outline show together, so the field looks focused when it isn't. Fix: `.x2f-quote__box:has(input:focus-visible)` in place of `:focus-within` (keep `:focus-within` for the forced-colors rule in I1 if you prefer).

**m3. On BuyQuote, after switching to XMR, the input shows 12 places and the figure shows 6.** Quote.tsx:241 writes `xmrText(ok.amountAtomic)` into the input (correct: the exact amount carries across the switch, and the input has to keep it), while the figure shows `formatXmr` (Quote.tsx:269). Example: $412.50, switch, input `1.213235294117`, "You receive 1.213235 XMR". Both are honest and neither overstates. No code change needed. Tell design so they aren't surprised.

**m4. "You receive" is the gross amount, before the network fee.** quoteModel.ts:127 (`receiveAtomic: amountAtomic`). Under OD-4 the release fee comes off the buyer's payout, so the buyer gets about 0.0001 XMR less than the figure. Rounding down to 6 places doesn't change this. This was already on main, and the Network fee row says so ("about 0.0001 XMR, taken from the payout"). It is noted only because the review brief asked whether the figure "never shows more than the buyer gets": that holds for the amount, not for the payout after the fee. Showing a net figure would be a user-facing money rule, so it's for the owner or design to decide, not this branch.

**m5. The COPY-UNSIGNED tag isn't next to the new strings.** `signedOutPickLine` is defined at BuyQuote.tsx:23 and SellQuote.tsx:23 without the marker. The tag is only on the interface comment, Quote.tsx:50. Put `// COPY-UNSIGNED (design review 8 Nov item 4)` on both strings so a copy sweep finds them. Also, signed out, the screen now says nearly the same thing twice: the group says "You add your wallet when you set up your account, then pick it here." and the line under the figure says "In the wallet you add when you set up your account." (BuyQuote.tsx:30). Design can drop one. The SellQuote pair repeats "Refunds go back to it." the same way. Note too that design brief item 1 (signed out goes to Landing) will make this signed-out group unreachable once it lands. That does no harm.

**m6. The bands view switch's accessible name doesn't match what it does.** QuoteBands.tsx:61: `RadioChips label={{ name: 'Amounts in XMR' }}`. The chips also switch each band's rate and markup to the market rate, not only the XMR amounts. Something like "Show prices" or "Markup" would be accurate. The words are COPY-UNSIGNED, so this is design's call.

**m7. Two money formatters do the same job.** bands.ts:92-103 `money()` duplicates quoteModel.ts:153 `formatMinor(minor, currency, exponent)` for exponents other than 2 (whole yen, 3-place dinars). They agree today. If one changes, the bands card and the quote rows will show different results. Fix: have `money` call `formatMinor` from quoteModel, or move both into one helper. It can wait for the TODO(wip/lead-offer-units) switch.

### Dropped (couldn't back them up)

- The `price.at` shape check could break a stub or the demo: every stub sends `at`, and so does the real route.
- `markupText` rounding is off: checked by hand, it is correct half away from zero.
- `money()` with exponent 0 adds a stray fraction: Intl gives no fraction part when maximumFractionDigits is 0, so the map does nothing.

## For the landing check

The builder ran only quote.spec. Other specs open BuyQuote and now meet the bands card, the Max button and the signed-out group: block.spec.ts (signed out "no block action"), design-shots.spec.ts, fold.spec.ts:438, and parity wherever BuyQuote is compared. The full PW run before landing covers them.

## Strings added (all COPY-UNSIGNED)

- BuyQuote signedOutPickLine: "You add your wallet when you set up your account, then pick it here."
- SellQuote signedOutPickLine: "You add your wallet when you set up your account, then pick it here. Refunds go back to it."
- Bands card (from the board, 8 Nov): "This offer's bands", "The price changes with the amount", "With markup", "Without", "Band N", "Your amount", "markup", "market rate", "Above X the rate changes to Y.", "Below X the rate changes to Y.", "Market rate · updated HH:MM UTC"
- Bands card (not on the board, from owner Q27): "N+ completed trades"
- Accessible names: "Amounts in XMR" (see m6), "Bands"
