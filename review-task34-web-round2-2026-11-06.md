# Review round 2: Task 34 web (C2-T34WR2, 2026-11-06)

Branch `origin/wip/second-p3-task34-web` @ `488a5a71`. Round 1 = `review-task34-multicurrency-web-2026-11-02.md` (CHANGES REQUIRED on 871a19e5). Reviewer is read-only. Tests ran in a detached worktree `~/x2f-worktrees/rv-t34web2` (now removed).

## Verdict: APPROVED WITH MINOR

Both Important items are fixed, and the tests prove it: the new tests fail against the pre-fix source (1a57ab85) and pass at the head. All eight Minors are fixed. The two merges are clean: no hunk is dropped, and every v2 rule is kept. On the money path, what the confirm card shows is what gets signed, including after the M5 snap. I found three new Minors. None blocks the merge, and one of them (N2) only matters once bands go on.

## Round-1 items

| Item | Status | Evidence | Test proves it |
|---|---|---|---|
| I1 unticking to one currency dropped its own instructions | **Fixed** | `offerForm.ts` `fitMethod` (new, ~l.233): with one currency left and `!same`, that currency's own text becomes `instructions` and `same: true`. An empty box keeps the shared text. `toggleCurrency` maps every method through it. | Yes. `postOfferFlex` "per-currency instructions only while…" now expects the USD text (and EUR when unticking USD), plus "…box left empty keeps the shared text". Both fail on 1a57ab85. e2e `post.spec -g 'review I'` per the fixer. |
| I2 stray `byCurrency` key made the draft unreadable | **Fixed** | `fitMethod` drops unticked keys on toggle. `draftMethod` no longer rejects unknown keys (it caps them at `POST_CURRENCIES.length`), and `loadDraft` maps through `fitMethod`, so stale keys are dropped and the draft is kept. | Yes. The "…unticked again still round-trips (setup and Add a wallet)" and "draft with per-currency text for a currency no longer ticked" tests fail on 1a57ab85. |
| M1 no 10-method cap | **Fixed** | `MAX_METHODS = 10` (offerForm.ts ~l.27). `addMethod` stops at 10, `validate` refuses 11 with `methodsFull`, and PostOffer.tsx swaps the picker for the `methods-full` line. | Yes. The vitest fails on 1a57ab85. e2e "at most 10 payment methods" (fixed in 68ae8844). |
| M2 focus not moved to the bad band | **Fixed** | PostOffer.tsx: `focusBad` counter, effect `panelRef…querySelector('input[aria-invalid="true"]').focus()`. Set together with `setTab(bad)` in one batch, so the panel already shows that currency. | e2e "a band left empty in another currency…" now asserts `from(1)` focused. |
| M3 tabs not a real ARIA tab pattern | **Fixed** | Tab buttons: `id`, `aria-controls` → panel id, roving `tabIndex`, Arrow/Home/End (`TAB_STEP`, wraps), and `focus()` moves with the selection. Panel: `aria-labelledby="<bands h2> <tab>"` ("Price bands USD"). | e2e "the currency tabs are a tab list…". |
| M4 raw checkbox | **Fixed** | The kit `Checkbox` with `aria-label`. The `.post-check-row input` CSS is removed. | e2e uses `getByRole('checkbox', { name: 'Same for all currencies' })`. |
| M5 XMR amount between bands read "Too high" | **Fixed** (see N2) | `quoteModel.ts` `snapXmr`: when band k's price puts the total inside band k+1, it uses band k+1's smallest amount at band k+1's price. The loop guarantees `fiatCents(a) ≥ min` and `fiatCents(a−1) < min`, and the result is only taken if `total ≤ band.max` and `a > typed`. | Yes. The quote.test M5 case fails on 1a57ab85. It checks the rate, the total `50 100`, minimality, and that `5` XMR is still too-high. |
| M6 alert on every keystroke | **Fixed** | No `role="alert"` under the band. A hidden `role="status"` node (`data-part="band-announce"`) is set on blur, once per band and error (`announced` ref). On a failed post, the footer alert plus focus on an input whose `aria-describedby` is the error reads it. | e2e "a band's error is announced once…". |
| M7 unmarked COPY-UNSIGNED | **Fixed** | `currenciesHelp`, `bandsHelp`, `sameForAll` and the contiguity error are marked (board). `instructionsFor`, `addMethod` and `methodsFull` are marked as not on the board. | n/a (copy). |
| M8 shared `.post-choices` chip selector | **Fixed** (in 499a78ba) | The currency chips and tabs dropped `post-choices` and use `.post-chips .x2f-chip-button` (PostOffer.css ~l.353-381). See N1 for a side effect. | `offersV2.test.tsx` passes. |
| Q1 Add a band vs API single band | **Answered by a flag** | `post/flags.ts` `BANDS_ENABLED = false`. Add a band and the bands-full line are hidden, Remove band shows only when there are more than 1 bands (so an old 2-band draft can still be cut to 1), and the contiguity e2e is skipped. API: routes.ts:702 `tiers.length > 1 && !multiTierOffers` → 409. With the flag off, the web can only post more than one band from a pre-flag draft, and that draft shows Remove band. | e2e "Add a band is off…: one band per currency is posted" checks the wire body. |
| Q2 every method in every currency | Still open (unchanged) | | |
| Q3 blank per-currency box posts `""` | Still open (unchanged; `validate` posts `''` for a blank currency) | | |
| Q4 parity against the FlexOffer-Post board | Still open: the board is not in the repo, so the shots can't be compared against it (see Shots). | | |

## Merges

- **499a78ba (offers v2 into Task 34 web, by hand).** v2-only files (browse.css, quote.css, Notice.tsx, icons.tsx, ui.css, OfferList/MethodList/OfferCard) equal the v2 side byte for byte. Task 34 had not touched them. Quote.tsx = v2 plus Task 34's signed `deal` hunk (band max and methodId), kept. In PostOffer.tsx, v2's classes (`x2f-icon-button`, `x2f-screen-title`, `post-card` wrappers, `x2f-section-title` on each h2, `post-caption`) are reapplied to Task 34's sections. The v2 sections that Task 34 removed (Your price, Smallest/Largest) are gone, which is correct. Every line v2 added to PostOffer.css is present in the merged file (checked line by line). offersV2.test is adapted only for the caption text. design-shots.spec fills Band 1. No duplicated code found.
- **e3807442 (offers v2 @a8724b19, carries main 16f37629 selection).** Its 7 touched files (Wallets/screens/setup/pay/release CSS, base.css, selection-ink.test) are identical to a8724b19. selection-ink and kit-selection pass. No orange on selection: the post chips and tabs use an ink border (PostOffer.css:366-372).

## Money path (re-read at the head)

- Shown = signed: `confirmed.deal = { takeAmountAtomic: ok.amountAtomic, currency: o.currency, centsPerXmr: ok.rate.centsPerXmr, maxFiatCents: ok.band?.maxFiatCents ?? o.maxFiatCents, methodId }` (Quote.tsx:231). The take sends `ok.amountAtomic / ok.rate / ok.fiatCents` (Quote.tsx:382). The headline (`receiveAtomic` / `sellerFundsAtomic` of the same `amountAtomic`), the Rate row and the Total all come from `ok`.
- M5 snap: the total is in `[band.min, band.max]` of band k+1, which lies inside the offer's range, so the signed amount never leaves it. The API picks the tier by the total (`tierFor(fiatCents)`), so it lands in the same band k+1 the web locked. The snapped total (band k+1's min) is ≤ the typed amount's total at band k's price, so the buyer never pays more fiat than band k would have charged. The snap is dormant today: the API refuses more than 1 band, and the flag hides Add a band.
- Draft: `saveDraft` before post, `loadDraft` → `fitMethod` normalises. Round trips are tested for the 3→2→1 currency path.
- BANDS_ENABLED=false matches the API's single-band rule (see Q1 row).

## Important

None.

## Minor

**N1. Double selection ring on the currency chips and the currency tabs (merge side effect).** `PostOffer.css:366-372` draws a 2px ink `border` on the 44px button itself. v2's kit chip (browse.css:150-183) draws the visible 32px pill in `::before` (inset 6px, with a 2px ink ring when `aria-checked`). The chosen currency chip therefore shows two nested ink rings, and the chosen tab shows a 2px ring around a 1px pill. Both are visible in `docs/design-screens/2026-11-06-task34-web/72-postoffer-day.png` and `61-cantdothat-post-offer-day.png` (USD chip and USD tab), while "Sell XMR" next to them has one ring. Scenario: the shot set goes to the owner and the currency chips look like a focus ring stuck on, unlike every other chip in v2. Fix: in `.post-chips`, style `::before` the way the kit does (`[aria-selected='true']::before { border: 2px solid var(--x2f-ink); background: var(--x2f-surface-raised) }`), drop the button `border`, and put `data-bad` on `::before` as well.

**N2. The M5 snap changes the XMR amount without saying so, and on SellQuote it asks the seller to lock more than they typed.** `quoteModel.ts` `snapXmr` returns `amountAtomic > typed`. The amount box still shows what was typed (Quote.tsx: `text` unchanged), and the help line still shows the plain range. Only the headline and Total move. Scenario (once bands are on): a seller types their whole balance, 1.507 XMR. The card says "You lock in escrow 1.5106… XMR", the take signs 1.5106, and funding then falls short. A buyer sees 1.507 in the box and 1.5106 under "You receive" with no reason given. It is shown = signed, so this is not a safety issue. Options (a product/copy call, see Q-A): keep the snap and add a line ("This amount is in the next price band: you trade X XMR"); on SellQuote snap down to band k's largest amount instead; or put the snapped figure into the box. This can wait for Task 35, but should be decided before BANDS_ENABLED turns on.

**N3. With Add a band hidden, the bands section still talks about several bands.** PostOffer.tsx (Price bands head) shows "1 of 5 for USD", and `POST_COPY.bandsHelp` says "Set a different price for different trade sizes… one ends at 500, the next starts at 501". The poster has no way to add a second band. Scenario: a vendor reads "1 of 5" and looks for how to add the others. A copy call, see Q-B. The cheapest fix is to gate the counter and the multi-band sentences on `BANDS_ENABLED` as well.

## Checks (worktree at 488a5a71, `npm ci` with npm 11.21.0, each under `flock ~/x2f-comms/check.lock`, one at a time)

| Check | Result |
|---|---|
| `tsc --noEmit -p apps/web` | clean |
| `vitest run` postOfferFlex, postOffer, quote, quoteScreen, browse, browse-buy, browse-tripwire, myOffers, myOffers-tripwires, offersV2, selection-ink, kit-selection, app-routes | **13 files, 176/176 passed** |
| Red check: `offerForm.ts` + `quoteModel.ts` from 1a57ab85 (pre-fix), new tests at head: `vitest run postOfferFlex quote` | **7 failed / 50 passed** (M1, I1 x2, I2 x3, M5). Files restored after. |
| Playwright post.spec + quote.spec `--workers=1`, X2F_CHROMIUM_PATH=/usr/bin/chromium (~2.6 GB available) | **62 passed, 1 skipped** (the contiguity test, skipped while BANDS_ENABLED is off), 1.4 min. The server was Playwright's own webServer and stopped with the run. |
| `npm run copy-lint` | clean ("apps/web/src is clean") |

## Shots

`docs/design-screens/2026-11-06-task34-web/` 61, 72 and 72b (day and night) were looked at. The v2 look is kept: kit title, cards, section titles, the ink-selected "Sell XMR", the dashed preview, the kit Checkbox, and Add a band absent. The FlexOffer-Post board is not in the repo, so the shots could not be compared against it (round-1 Q4 still open). Problems seen: N1 (double ring), and N3 ("1 of 5 for USD").

## Open questions (for the lead; not mine to settle)

- **Q-A (N2, money/copy):** for an XMR amount between two bands, should the quote (a) keep snapping up with a line saying so, (b) snap down on SellQuote so a seller never locks more than typed, or (c) refuse with "falls between two price bands"? Recommendation: (a) on BuyQuote and (b) on SellQuote, before BANDS_ENABLED is turned on.
- **Q-B (N3, copy):** while bands are off, should the counter "1 of 5" and the multi-band lines of the bands helper be hidden? Recommendation: yes, gate them on BANDS_ENABLED.
- Round-1 **Q2** (every method in every currency), **Q3** (blank per-currency box posts ""), **Q4** (board parity / PostOffer.png recapture) remain open, unchanged.
