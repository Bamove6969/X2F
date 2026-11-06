# Review C2-V3R: offers screens on design v2 batch 3

Branch origin/wip/second-design-offers-v2 @86c58ec3 vs main line @e7636c74 (`git diff e7636c74...86c58ec3`).
Reviewer: C2-V3R (read-only). Boards: origin/wip/design-brief @09467b6f, docs/design-conventions.md (2 Nov additions).

## Verdict: APPROVED WITH MINOR

No Important findings. No behaviour, copy, focus-order or a11y regressions found. The kit is reused (Notice, screen-title, Icon) and no tokens are added or duplicated (tokens.css is untouched; the v2 tokens came in through the main-line merge). Selection is ink everywhere (chips, Buy/Sell tab, PostOffer two-up, wallet card, wallet radio dot). Orange is only on the primary Trade/Post fill. M1 is a small kit-compliance fix I recommend making before merge.

## What I checked
- **TSX text diff:** none. PostOffer.tsx with `-w` adds only `className`s and three `post-card` wrappers (`<div>`/`<section>`): no label, id, `aria-*`, handler or order changes. Quote.tsx: the footnote `<p>` becomes the kit `<Notice tone="plain" icon="info" live="off">` with the same text, plus an aria-hidden chat icon in Chat; its `aria-disabled`/`aria-describedby` are unchanged. MethodList wraps the search input in a span with an aria-hidden icon; the label `htmlFor` still works. OfferCard swaps `range<br>time` for two spans; textContent is identical. OfferList and the quote add `x2f-screen-title` to the title only.
- **Reading order:** SellOffers/BuyOffers (`column-reverse`, browse.css ~309) and the quote header (`display: grid` + `display: contents` on the head-text div, quote.css ~16-45) draw the sub-line above the title. The DOM order is still title, then sub-line, so screen readers read the title first. Neither header contains anything focusable between back and Chat, so the tab order is unchanged (back, Chat). `display: contents` sits on a plain div with no role, so no semantics are lost.
- **Headings:** Main/BuyMain have h1 then h2 sections, as before. PostOffer has its h1. The quote and SellOffers titles were already spans (see N1).
- **Focus rings:** already ink in base.css:28-36 and ui.css. The wallet radio ring went monero to ink (quote.css focus-visible), which is high contrast in both themes (night #eef1f5 ink, day #12161c ink on white). The ring sits on the radio, not on the ink-bordered card, so the two stay apart.
- **Quote footnote Notice:** `live="off"`, so no role and it is not announced. The icon is aria-hidden. Its look matches the BuyQuote board's info box (board lines 78-81).
- **Shared CSS:** `.x2f-chip-button`/RadioChips are used only by browse (currency, Sort) and PostOffer (I want to, Your price). The PostOffer overrides (`.post-choices .x2f-chip-button`, `::before { inset: 0; radius-md }`) out-specify the base and still pick up the ink selection. WalletPicker gets the new wallet look on both buyer and seller quotes, as intended. No browse/quote class is used outside these screens (dispute/trade use `.x2f-method-name`, a different class). Nothing in My offers, the tab bar, CantDoThat, cancel/dispute or fold/result is touched.
- **Dark/day:** all colours are tokens. The Notice override uses `color-mix(ink-muted 30%)`, which is fine in both themes. The row rules are a `--x2f-surface` line on surface-raised, decorative only.
- **Runs** (own detached worktree, under check.lock): `tsc --noEmit` for apps/web is clean (the only output was 2 errors in ~/x2f/apps/api, reached through my node_modules symlink into the shared tree, not from this branch). `vitest run offersV2 browse browse-buy quoteScreen postOffer`: 5 files, 101 tests passed.

## Important
None.

## Minor

**M1. The kit Notice is restyled from screen CSS: an info look lives only in quote.css.** quote.css:379-389 (`.x2f-quote__main .x2f-outcome[data-tone='plain']` and its `__icon`), Quote.tsx:350.
The board's info box (surface-raised, 30% ink-muted border, ink-muted icon) is built by overriding the kit's `plain` tone under `.x2f-quote__main`. Notice.tsx:8 still documents `plain` as "a done change". The kit's icon colour defaults to `--x2f-caution` (ui.css ~888).
- **Failure scenario:** the next screen that uses `<Notice tone="plain" icon="info">` for an info note (FlexOffer-Quote, Maintenance, ...) gets a caution-orange icon in a flat box. That is a second Notice look, which the brief's "one Notice, no duplicates" rule rules out.
- **Fix:** add an `info` tone (or make `plain` this look, with an ink-muted icon) in ui.css and Notice.tsx with a kit test, then drop the screen override.

**M2. Kit styles are re-typed per screen instead of using the kit classes/tokens.**
- **Heading style (18/24 600 ink), written three times:** browse.css:199 `.x2f-browse__section-title`, PostOffer.css:75 `.post-label.post-card-title`, quote.css:292 `.x2f-quote__figure > .x2f-quote__label`. The kit already has `.x2f-section-title` (ui.css:1191).
- **Amount 28/32 500 hard-coded:** browse.css:555 `.x2f-offer__rate`, PostOffer.css:310 `.post-preview .post-big`. This duplicates `--x2f-amount-size/-line/-weight`.
- **Label 13/16 600 .04em uppercase re-typed:** PostOffer.css:146 `.post-field > label`, plus quote/post labels, instead of `--x2f-label-*`.
- **Icon-button radius:** the 12 px focus/hover radius is added to the kit icon button per screen (browse.css:303, quote.css:27, PostOffer.css `.post-close`).
- **Failure scenario:** if the heading or amount scale changes in tokens.css, these screens don't follow and drift from the rest of the app.
- **Fix:** use the token vars, or the class, where one exists.

**M3. The focus ring on chips and the Buy/Sell tab no longer follows the pill.** browse.css:58-80 and 147-178.
- **Failure scenario:** the button element is now a borderless, radius-less 44 px box, and the pill is drawn by `::before` (inset 6px, or 4px for the tab). Keyboard focus on a currency or Sort chip draws a square ink ring 8 px outside the pill. That ring sits closer to the neighbouring chips and rows than to the pill it marks. It is still visible, but it is a visual a11y step back from the old pill-shaped ring.
- **Fix:** keep `border-radius: var(--x2f-radius-pill)` on the button, or draw the ring on `::before` via `:focus-visible::before { outline: ... }`.

**M4. Wrapped Sort chips have overlapping tap targets.** browse.css:132-137 (`gap: var(--x2f-space-2)`) with `.x2f-chip-button { height: 44px; margin: -6px 0 }`.
- **Failure scenario:** each wrapped line takes 32 px plus an 8 px gap (40 px), but the targets are 44 px. When the chips wrap (longer copy, large text or zoom, the 320 px phone check), the rows' targets overlap by 4 px and a tap at the edge hits the chip on the next line.
- **Fix:** `row-gap: var(--x2f-space-3)` on `.x2f-browse__sorts`.

**M5. The PostOffer labels are only partly uppercased.** PostOffer.css:146 targets only `.post-field > label`. In the methods-failed state the "Payment method" caption is a `<span>` (PostOffer.tsx:258), so it stays sentence case next to the uppercase "CURRENCY". "Minimum completed trades" (`.post-inline label`) is also sentence case; check that against the board.
- **Failure scenario:** in the methods-failed state, the "Payment method" caption is sentence case next to the uppercase "CURRENCY".

**M6. The new test reads TSX source with a regex.** offersV2.test.tsx:116-118 matches `className="x2f-quote__title x2f-screen-title">\{copy\.title` and `<h1 className="x2f-screen-title">Post an offer</h1>` in the source files.
- **Failure scenario:** a harmless reformat breaks the test with no behaviour change. Examples: prettier wrapping, the class order swapped, an added `id`/`data-part`, or the title becoming an `<h1>` (see N1).
- **Fix:** render QuoteScreen and PostOffer, as the MethodList and OfferList cases already do, and assert the class on the element. The `rule()` CSS-text checks follow the existing kit-selection/loginApproveV2 precedent and are acceptable.

**M7. Design-shot spec hygiene.** design-shots.spec.ts:1005 (`72 PostOffer`) stubs only /account/me, /methods, /offers and /price. Anything else PostOffer or the app shell fetches (/v1/events, wallets) goes to the dev proxy unstubbed. The 70-71 shots also reuse `BOARD_BUY_QUOTE` (a sell ad) for the seller quote at /sell/....
- **Failure scenario:** on a machine with an API running, shot 72 can pick up real data or errors and differ between runs. Shot 71 shows the seller quote over a buy-side fixture, so the design team may read it as the real seller example.
- **Fix:** route the remaining calls (as `blockApi` does), and name the seller fixture or note it in the spec comment.

## Notes (no action required by this branch)
- **N1:** the SellOffers/BuyOffers title (OfferList.tsx:76) and the quote title (Quote.tsx:249) are spans now drawn as 28/32 screen titles. The boards use `<h1>`. This is not a regression (they were spans before), but these screens have no h1 for heading navigation. Worth a follow-up task: making them h1 changes the a11y tree, so it is out of this visuals-only scope.
- **N2:** `.x2f-quote__title`/`.x2f-browse__head-title` set `margin-top` at the same specificity as the kit's `.x2f-screen-title { margin: 0 }`. They win only because screen CSS loads after ui.css, which holds in today's import order. PostOffer avoids this with `.post-header h1`.
- **N3:** the "Your price", "Who can trade with you" and "You receive" card titles now look like headings but stay spans/labels (as before). This is fine for now and the same follow-up as N1.
