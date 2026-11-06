# Review: Task 34 multi-currency / multi-method, WEB side (C2-T34WR, 2026-11-02)

Branch: `origin/wip/second-p3-task34-web` @ `871a19e5`, diffed against the API head `667e5edd`
(8 commits, 26 files, +1740/−679). Reviewer is read-only; tests ran in a detached worktree at 871a19e5.

## Verdict: CHANGES REQUIRED

The wire body, price math, take body and signed deal are right (details below). Two Important findings
need fixing first. Both come from the same gap: unticking a currency leaves the per-currency payment
instructions in a bad state. One loses text from the posted offer without telling the poster, and
the other throws away the whole saved draft.

## What checks out

- **Post body matches the wire shapes** (`offerForm.ts validate`): `{ side, currencies: [{ currency, bands: [{ min, max, marginBps, minTrades }] }], methods: [{ methodId, adjustBps, instructions, instructionsByCurrency? }], terms, country? }`. The keys are exactly the ones `parseNewOffer` / `bandShape` take (`exactKeys` on bands). `country` is sent only for a gift card. No `currencies` on methods (absent = every offer currency, as the API reads it).
- **Validation is as strict as the API or stricter**: whole units (`parseWhole`, cents refused), ≥ 1, `from <= to`, contiguous `next.min = prev.max + 1` in typed order (the API sorts, so web-valid ⇒ API-valid), ≤ 12 digits (= API `WHOLE`), 5 currencies (= API), 5 bands (API 10; board's limit), margin ±10% and adjust −5%..+10% (well inside ±5000 combined), the band rule floored by the offer rule. Every currency gets every method, so the API's "every currency has a method" rule always holds.
- **Price math is the API's**: `inBand` uses `rateFor(market, band.marginBps + adjustBps)`, rounded once, the same as `tierRate`/`finalRate`. The band is picked by the total (`tierFor` on `b.fiatCents` in take.ts:296). The total at the locked rate must stay inside the band (take.ts:303), and the web re-checks that and falls back to the next band when a total rounds across an edge. The 500.50-in-50–500 edge is right because the web reads the API's covered ranges (`50099`) and doesn't recompute them. Test `quote.test.ts` "500.50 is in the first band" covers it. The top band ends at its own max: the card's `maxFiatCents` = the top tier's max.
- **What is shown is what gets signed**: `deal.currency = o.currency` (the filtered currency, the same one the card was fetched in), `deal.centsPerXmr = ok.rate` (the band's locked rate, also shown on the Rate row and in the header via `rateOf(q)`), and `deal.maxFiatCents = ok.band.maxFiatCents`, which equals take.ts:322 `tier.maxFiatCents`. `useTake` sends `currency: confirmed.deal.currency` and `methodId: confirmed.deal.methodId`, so the take body is built from the confirmed deal and not from separate state. Instructions for method+currency are chosen server-side (`instructionsFor(method, b.currency)`) and signed as `instructionsSha256`. The web neither shows nor sends instructions at quote time, as before.
- **CantDoThat**: `no-usd-price` is in `CANT_DO_CODES` (moved, deduped), with text naming the currency and saying it is usually temporary (COPY-UNSIGNED, marked). `too-many-offers` uses `{ perSide }` and goes through `postCantDo` → CantDoThat (e2e post.spec:360). `tiers-not-yet` has new words.
- **Old single-currency cards still render**: `parseOffers` reads absent `tiers`/`methods`/`currencies` as empty. `quote()` falls back to the old range check when `tiers` is empty or the pricing is fixed (871a19e5). `MyOffer.currencies` is optional and `offerTitle` falls back to `currency`.
- **Parity KNOWN_EXCEPTIONS**: justified. The in-repo PostOffer board is the single-currency one, and the six texts it lists are exactly what the FlexOffer-Post structure replaces. parity.spec asserts that the screen no longer shows them. (See Q4: nothing checks parity against the new board yet.)
- **Tests test the real thing**: `postOfferFlex.test.ts` asserts the exact wire body, contiguity words, Add-a-band and the draft round trip. `quote.test.ts` checks band rates against hand-computed numbers (33 330 = 330 + 1%, 33 825 = 330 + 2.5%) and the XMR path against `fiatCents`. post.spec is rewritten for bands, currencies and methods, uses role/label locators, and contains no `waitForTimeout` (one `force: true` click on an aria-disabled chip, which is intended). It passed 24/24 on the first run.

## Important

**I1. Unticking down to one currency silently drops that currency's own instructions from the posted offer.**
`offerForm.ts:415` `const split = !m.same && f.currencies.length > 1;`: once only one currency is left, the shared `m.instructions` is posted and `m.byCurrency` is ignored. `PostOffer.tsx:357` does the same, so the screen switches to the shared textarea, which is usually empty.
Scenario: a vendor ticks USD + EUR, adds Bank transfer, unticks "Same for all currencies", and types "Account 123, routing 456" under USD and an IBAN under EUR. They then decide against EUR and untick it. The Bank transfer card now shows an empty instructions box, and the offer posts with `instructions: ""`. The USD text they typed is gone without a word, and every trade on that offer locks and signs empty instructions (`instructionsSha256` of ""). Reproduced in a scratch test: the posted methods are `[{"methodId":"BANK","adjustBps":0,"instructions":""}]`. `postOfferFlex.test.ts:209` ("…only for those still ticked") asserts exactly this loss (`instructions: ''` after unticking EUR) instead of catching it.
Fix: when the split collapses to one currency, carry the remaining currency's text into `instructions`, either in `toggleCurrency` or in `validate`/the render (for example `split ? '' : cleanTerms(m.same ? m.instructions : (m.byCurrency[f.currencies[0]] ?? m.instructions))`). Change the test to expect the USD text.

**I2. Unticking a currency after typing per-currency instructions makes the saved draft unreadable, so the whole form is lost on the setup / Add-a-wallet round trip.**
`toggleCurrency` (`offerForm.ts:228`) removes `bands[currency]` but leaves `methods[].byCurrency[currency]`. `draftMethod` (`offerForm.ts:497`) rejects any `byCurrency` key that is not a ticked currency, so `loadDraft` returns null.
Scenario: a signed-out vendor fills the form as in I1 (EUR text typed, then EUR unticked) and taps Post offer. The 401 sends them to setup, and they come back to a blank default form: bands, methods, terms and country all gone. The same happens with a `no-wallet` redirect. Reproduced in a scratch test (`loadDraft(...) !== null` is false). Spec 6.4's "comes back filled in" is broken for this path.
Fix: drop the unticked currency's key from every method's `byCurrency` in `toggleCurrency`, and/or make `loadDraft` filter stray keys instead of rejecting the draft. Add a round-trip test for this case.

## Minor

**M1. There is no 10-method cap on the web.** `addMethod` (`offerForm.ts:275`) and `validate` accept any number of methods, but the API allows `MAX_METHODS = 10` (routes.ts `parseMethods`, 400). Scenario: a vendor who adds 11 methods from the dropdown gets "Something went wrong and your offer wasn't posted. Try again." Retrying cannot help, and nothing says which rule failed. Scratch test: `validate` posts 11. Cap the picker at 10 (hide or disable the select, with a line like the bands-full one) or add a validate error.

**M2. Focus doesn't move to the bad band.** `PostOffer.tsx:228-229` switches the currency tab to the first bad currency, but focus stays on Post offer at the bottom. Scenario: a keyboard or screen-reader user on a phone hears "Fix the band marked in red…" but has to tab back up through the whole form to find it. Move focus to the first invalid band input (or its fieldset) after `setTab`, for example in an effect keyed on a "focus bad band" flag.

**M3. The currency tabs are not a full ARIA tab pattern.** `PostOffer.tsx:487-502`: `role="tab"` buttons with no arrow-key handling, no roving `tabindex`, no `aria-controls`/`id` linking to the `tabpanel`, and a tabpanel with no `aria-labelledby`. Scenario: screen-reader users are told "tab, 1 of 3" and press the arrow keys as the role invites, and nothing happens. Either implement the pattern (RadioChips already does arrow keys for "I want to", e2e post.spec:271) or drop the tab roles and use the plain `aria-pressed`/`aria-current` chip buttons.

**M4. "Same for all currencies" is a raw `<input type="checkbox">`** (`PostOffer.tsx:402-408`, styled by `.post-check-row input` in PostOffer.css), while the band rule and method head use the shared `Checkbox`. This goes against the shared-kit rule (one Checkbox). Scenario: the two checkboxes on one card look and behave differently (focus ring and size come from browser defaults, not the kit), and the next kit restyle (offers-v2) misses this one.

**M5. An XMR amount near a band edge can fall between bands and read "Too high".** `quoteModel.ts:175` / `:145`: the XMR path tries each band at its own rate. With the usual setup where the next band is cheaper (Add a band makes it 0.1% cheaper), there is a narrow window of XMR amounts whose total is above band 1's max at band 1's rate and below band 2's min at band 2's rate. Scenario: bands 50–500 (+0.5%) and 501–1,000 (+0.4%), market $330, and the buyer types an XMR amount worth $501.10 at band 1's price. The quote says "Too high: the largest trade is $1,000". Scratch test: kind `too-high`. The amount is about 1.51 XMR and nothing about it is "too high". The API would refuse it too (`out-of-range`), so this is a wording problem, not a safety one. Say "This amount falls between two price bands; try a little more or less", or snap to the nearest band.

**M6. The band error `role="alert"` fires while the user is still typing.** `PostOffer.tsx:216,304`: once both ends are non-empty, every keystroke that changes the error re-mounts or re-texts an alert. Scenario: band 1 is 50–500, and the user edits band 2's From from 501 to 1000. The intermediate "1" and "10" values each announce "This band overlaps band 1…". Show the live error on blur (or only after a failed post), or use `aria-live="polite"` on a stable node.

**M7. Two pieces of COPY-UNSIGNED copy are not marked.** The board (FlexOffer-Post, 760393ac) lists as COPY-UNSIGNED: the Currencies helper, the bands sub-line, the contiguity error, and "Same for all currencies". `offerForm.ts:89` marks only the sub-line and the contiguity error. Mark `currenciesHelp` (:94) and `sameForAll` (:100). The per-currency instructions placeholder (`PostOffer.tsx:376`, "What the other person needs to know to pay you in {c}.") and the "Add a payment method" label (:534) aren't on the board either.

**M8. The currency chips (44 px) and the "I want to" chips share the `.post-choices .x2f-chip-button` selector.** `PostOffer.css:86` and `:297` both style chips inside `.post-choices`. The result depends on source order now, and offers-v2 changes `.post-choices .x2f-chip-button` to 48 px (see the merge risk). Give the currency chips their own class.

## Merge risk with `wip/second-design-offers-v2` (@3dbd82e3, after 86c58ec3)

- **PostOffer.tsx: high, conflicts in nearly every hunk.** v2 restyles the old single-currency JSX: it wraps sections in `.post-card`, and adds `x2f-icon-button` on Close, `x2f-screen-title` on the h1, `x2f-section-title` and `post-caption`. Task 34 replaced that JSX. Resolve by hand: keep Task 34's structure and reapply v2's classes and wrappers to the new sections (Currencies, Price bands, Payment methods). Don't keep both sides.
- **PostOffer.css: both sides edit** (+193 here, +120 there). Merge by hand. The rule for `.post-choices .x2f-chip-button` (48 px in v2) affects the currency chips (M8).
- **Semantic clashes with no textual conflict:**
  - v2's design-shots.spec adds a new PostOffer shot that fills `getByLabel('Smallest trade')` / `'Largest trade'`. Those fields don't exist after Task 34, so the test will fail. Switch it to `getByRole('group', { name: 'Band 1' }).getByLabel('From'/'To')` as in this branch.
  - v2's `offersV2.test.tsx` asserts CSS rules on PostOffer (`.post-card`, `.post-preview`, `.post-close`, `.post-step` at 44 px, "Your price" chip), and its PostOffer render test may rely on parts Task 34 removed. Rerun it after the merge.
  - Quote.tsx and quoteScreen.test.tsx: small hunks on different lines (Notice footnote, chat icon, title class), so an auto-merge is likely. Still run quoteScreen after the merge.
- Run `apps/web/test/app-routes.test.ts`, tsc, and the vitest files named here plus `offersV2.test.tsx` after the merge.

## Questions (product / sequencing calls for the lead, not findings)

- **Q1.** The form lets a vendor add up to 5 bands per currency, but the API refuses any currency with more than one band (409 `tiers-not-yet`, routes.ts:735, unless `deps.multiTierOffers`). Until that is lifted, every multi-band post ends in a CantDoThat. Should Add a band be hidden behind the same flag, or is the CantDoThat acceptable for now?
- **Q2.** The wire supports per-method `currencies` (for example Zelle only in USD), and the owner's Q2 answer says the vendor picks which methods and which currencies. The board offers every picked method in every picked currency. Is "every pair" the intended web behaviour for now? It means a USD + EUR offer with Zelle lists Zelle under EUR.
- **Q3.** With "Same for all currencies" off, a currency left blank posts `""` for it without a warning. Should a blank per-currency box be refused or warned about?
- **Q4.** Nothing checks parity against the new FlexOffer-Post board until the controller step copies it in and re-captures PostOffer.png. Is that step scheduled?

## Tests run (worktree at 871a19e5, `npm ci` with npm 11.21.0, all under `flock ~/x2f-comms/check.lock`)

- `tsc --noEmit -p apps/web`: clean.
- `vitest run test/postOfferFlex.test.ts test/postOffer.test.ts test/quote.test.ts test/quoteScreen.test.tsx test/myOffers.test.tsx`: 5 files, **113/113 passed**.
- `playwright test post.spec.ts --workers=1` (2.6–3.5 GB available): **24/24 passed** (36 s), first run.
- Scratch reproductions (temporary test file, deleted, never committed) confirmed I1, I2, M1 and M5.
