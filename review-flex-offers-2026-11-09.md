# Review: J-16 flexible offers (`wip/lead-flex-offers` @ 088199a7), 9 Nov 2026

Reviewer: independent security and correctness reviewer. I did not change any code. Worktree `/home/user/X2F/.claude/worktrees/flex-offers`. Commits reviewed: e6927030, d600aa42, 5b0f8d1d (merge), 6c5af052, 00f414dd, 9b05308b, 088199a7, plus the `@x2f/trade` base they build on (f17416a9, 4e922b07: `flexOffer.ts`, `currencyChoices.ts`).

## Verdict: CHANGES REQUIRED

I found no money-safety defect. The server picks the band itself, the rate arithmetic is right, the written-once tables hold, and the instructions are gated on the server. Four things block landing:

- **I1:** migration 440 sits in J-07's reserved range.
- **I4:** the owner's −5%..+10% price-change rule is enforced only in the web form.
- **e2e:** both specs I ran are red (18 failures), and quote.spec breaks as well as post.spec.
- **Owner decision (I2):** every trade keeps its payment details forever. That is a retention gap; it does not block landing.

**I3 is a note for whoever lands this after launch-rules:** that merge rewrites logic, it is not a mechanical merge.

## Tests run (serialised runner)

| Run | Result |
|---|---|
| `apps/api/test/flexOffers.test.ts` | 16/16 pass |
| `apps/api/test/take.test.ts` | 42/42 pass |
| `packages/trade/test/flexOffer.test.ts` | 19/19 pass |
| `apps/web/test/quote.test.ts` | 32/32 pass |
| Playwright `e2e/post.spec.ts e2e/quote.spec.ts --workers=1` | **18 failed, 40 passed** (log `scratchpad/logs/flex-pw-212803.log`) |

### What breaks in Playwright

**post.spec.ts: 12 failures.** All of them look like test drift from the new PostOffer, not product bugs:

- **Old request shape (3).** The tests expect the old body (`pricing`/`minTrades`/`minFiatCents`, `methodId` and `currency` at the top level). The new body is right on the wire: 50% above posts `marginBps: 5000`; 1.5% below posts `marginBps: -150`, `adjustBps: 0`, band `50`–`2000` whole units.
- **Board-copy parity (1).** At 390x844 six board strings are missing: "Payment method", "Currency", "EUR", "GBP", the "Market $329.90 / XMR right now…" line, and "Who can trade with you". Either design's board gets updated (J-32) or the parity exceptions do. That choice is the lead's or design's, not the builder's.
- **"Who can trade with you" not found (1).** The default-price test.
- **Strict-mode label clash (4).** `getByLabel('Payment method')` now matches two elements: the section `aria-label="Payment methods"` and the select labelled "Add a payment method". The methods-failed Retry test fails the same way (count 1, expected 0).
- **XMR preview (1).** `[data-part="preview-xmr"]` is gone from the preview.
- **Setup round trip (1).** After setup, `getByLabel('Currency')` reads "" where GBP was expected. My guess is that `select#currency` is now an "add a currency" picker that resets to "". The builder should confirm that the draft still keeps GBP as a chosen currency. If it doesn't, this one is a real regression: a logged-out poster would lose their currency.

**quote.spec.ts: 7 failures.** This spec breaks too, which the builder did not predict. It covers the no-wallet then Add-a-wallet take and the six phone-size takes. All seven fail for one reason: the take body now carries `currency: 'USD', methodId: 'ZELLE'`, and the `seen.takes` expectations don't have them. The port is mechanical, and the new fields are the right ones.

## The eight checks

### (1) The band the quote shows is the band the take locks

The server decides. `take.ts` reads the taker's completed trades inside the transaction, with both accounts locked (`COMPLETED_TRADES_SQL`). It then calls `pickTier(tiers, unit, b, method, side, completed)`:

- it keeps the bands that hold the take with this method,
- drops those whose rule the taker misses,
- and takes the best of the rest for the taker.

The client sends no band and no trade count, only `amountAtomic`, `centsPerXmr`, `fiatCents`, `methodId` and `currency`. `viewerTrades` only lets the web quote predict the band.

Suppose a client quotes a better band's rate than it qualifies for. The server locks its own band's rate (`lockRate`). If the quoted rate is more than 0.5% off, the take is refused with `price-changed`. The taker never gets the better band.

A fiat band is chosen by the client's quoted total. Within the 0.5% tolerance that total can be nudged, but `rangeAllows(tierRange(pick.tier), amount, lockedRate)` then checks the chosen band again against the real locked total. So the band that locks always holds the real total, and its trade rule is met. Nudging gains the taker nothing the poster didn't offer.

The web `quoteModel.inTier` uses the same rule as `pickTier` (each band at its own price, rule met, best for the taker), and the deal's `maxFiatCents` comes from the picked band's range. That matches what the API records (`tradeFiatLimits(tierRange)`).

**Residual risk (M2):** two bands priced less than 0.5% apart (for example +2.0% and +2.3%). If `viewerTrades` is stale, the take succeeds at the server's band, at a rate up to 0.5% from the one shown. This is the existing tolerance rule; the take answers with the rate it locked.

### (2) The 3+3 cap and the $5,000 launch cap

**3+3 cap: correct.** `assertMayPost` counts `offers` rows per side. A 5-currency offer counts once, and `flexOffers.test` proves it.

**Launch cap: see I3.** A band can be typed up to 12 digits of whole units. On this branch nothing at post bounds an offer's top against $5,000; only the per-take Starter caps apply. Launch-rules' post, relist, bulk-relist and take checks all read `offers.currency`, `method_id`, `min_fiat_cents` and `max_fiat_cents`, and migration 440 drops those columns.

### (3) Margin + price change arithmetic

The final rate is `rateFor(market, band.marginBps + method.adjustBps)`: one sum, rounded once half up, checked against ±5000. The SQL sort uses the identical formula (`finalRateSql` → `rateSql`, exact `div`). The web uses the same `rateFor`.

At post, every band × method pair that applies is checked to stay within ±50%. A pair that does not apply (a band scoped to other methods) is correctly left out. The effective rate is between 0.5× and 1.5× the market: never negative, never past 50%.

Direction: +bps means above market for both sides. "Best for taker" is the lowest margin on a sell ad and the highest on a buy ad (`bestForTaker`, `inTier`, SQL `min`/`max`). All three agree.

The DB only has backstops (`margin_bps` ±5000, `adjust_bps` ±2000). No DB check covers the sum (L2). The owner's −5%..+10% in 0.5% steps is not enforced by the API (I4).

### (4) "Written once" vs edits and relisting

There is no edit path. PATCH changes only `status`, and relisting reuses the same rows. Triggers refuse any update to `offer_currencies` and `offer_tiers`. `offer_methods` and `offer_method_currencies` accept one update only: blanking the instructions, which the removal does. All of this is tested.

A trade copies its own deal at take: currency, method, band limits, locked rate and instructions. `trades_deal_fixed` now includes `method_instructions`. So a poster cannot change bands under a live trade, and removing the offer does not reach the trade's copy.

The take locks both accounts and the offer row (`for share`). Removal takes the account lock, so a take and a removal run one at a time. I checked that the recreated `trades_deal_fixed` is 112's body plus `method_instructions`, and that no migration between them changes it.

### (5) Instructions only after the escrow is secured

Enforced on the server. `toTradeView` sends `paymentInstructions: securedAt === null ? null : …`, and it is the only reader of `method_instructions`.

- **Public cards:** `publicMethods` has no instructions; tested on the list.
- **Offer detail:** a non-owner gets `publicMethods`, the poster gets `ownMethods`.
- **My offers:** the owner only (team members with Offers too).
- **Browsing visitors:** never sent.
- **Unsecured trades:** null; tested.

Gaps:

- No test of the positive path (instructions shown once secured) or of offer detail for a non-owner (M1).
- **M4:** the web shows `paymentInstructions` nowhere (grep of `apps/web/src` finds nothing), so traders don't see the locked instructions yet.
- **I2:** retention.

### (6) The no-rate currency path

- **Lists:** `GET /v1/offers` returns [] for a currency with no market price, and `liveOfferStats` does the same. The offer still lists under its other currencies; tested.
- **My offers:** an offer whose only currencies are all unpriced gets `hidden: 'no-price'`; tested.
- **Coming back:** nothing is stored, so the offer is back on the next request after the rate returns. That is tested for `/v1/currencies` only, not for the list.
- **Offer detail:** shows the currency with `rate: null`.
- **Take:** `tierRate` returns null, so 409 `price-unavailable`. A missing USD rate also refuses, via the Starter USD count (take.test). There is no flexOffers test of a take in the unpriced currency of a multi-currency offer.
- **Picker:** `GET /v1/currencies` keeps the currency, `available: false`. The web tags it "no rate" and polls every 30 s.

### (7) Migration 440 numbering

Not clean. `owner-answers-assignments.md:47` reserves 440-449 for **J-07** (blur check); J-16 has no reservation. The migration header says "440-449 free for J-16", which is wrong (I1). There is no J-07 branch yet, so there is no file clash today.

The three `schema.test.ts` lists (lines 46, 110, 186) all include `440_flex_offers.sql`, in order. `merge-plan-batch4` lists 440 as pending.

The migration also drops eight `offers` columns, so every other branch that reads them needs semantic work at landing, launch-rules certainly (I3). Check J-17 gift cards (country / method profile) and any branch touching offers SQL.

### (8) Tests: what they prove and what they miss

**Proved:**

- the post shape, 5 methods, 3 bands, no gap, whole units, band-must-differ, ±50%, 5 currencies, XMR one band
- cards per currency and method, a scoped band, the viewer-trades band
- no-rate hiding
- the picker's order, flags and availability
- the take's currency/method validation, its locked pair instructions and band limits
- the null view before secured, the deal trigger
- best band by trade count, `not-enough-trades` with its rule
- written-once tables, removal blanking, the cap counting an offer once

**Missing (M1):**

- (a) A taker who doesn't qualify but sends the better band's rate is refused (`price-changed`) and never locks that band. This is the core money negative.
- (b) Instructions visible once secured, to both traders.
- (c) Offer detail for a non-owner without instructions.
- (d) A take in the unpriced currency of a multi-currency offer.
- (e) The list coming back after the rate returns.
- (f) The band boundary 200-500 / 501-800 at 500.50 and 501.00, through the take (it is covered only in `bandsToTiers`).
- (g) The API refusing an adjustment outside −5..+10 or off the 0.5% step (after I4).

**Red runs:** never observed. Commits e6927030, 6c5af052 and 00f414dd all say so.

## Findings

**I1. Migration 440 is in J-07's reserved range (Important; engineering, lead).**

- Where: `apps/api/migrations/440_flex_offers.sql` header; `owner-answers-assignments.md:47`.
- Fix: the lead gives J-16 its own range (or re-reserves 440-449 for J-16 and gives J-07 another), and fixes the header line.
- If the file is renumbered, update all three `schema.test.ts` lists and the `offerMigrations.test` references.

**I2. Every trade keeps its payment details forever (Important; owner/lead decision).**

- `trades.method_instructions` holds the poster's account number, IBAN, PayPal address and so on. It is never purged.
- `purgeTradeAddresses` (90 days after close, not disputed) clears only `buyer_payout` and `seller_refund`. The `x2f_purge` role has no grant on the column, and `trades_deal_fixed` refuses any change, even by the purge.
- This contradicts Task 34 review M3's reason for blanking a removed offer ("no payment details at rest once nothing can be taken").
- Recommendation: clear it with the addresses, using the same rule. Allow `x2f_purge` to set `''` after close in the trigger, grant `update (method_instructions)`, and add a purge test. Disputes keep it while open.

**I3. Landing with launch-rules is a logic rewrite, not a mechanical merge (Important; note for whoever lands it).**

- Launch-rules (`d98e2f60`) uses `o.currency` and `o.max_fiat_cents`:
  - post: `assertWithinLaunchCap(usdCentsFor(o.currency, o.maxFiatCents))`
  - PATCH relist
  - bulk relist (`routes.ts:730`)
  - take: `total > r.max_fiat_cents`, and the `growthCeiling` `offerMaxCents`
- At landing:
  - (a) Check each currency's top band: a fiat band's max converted to USD at that currency's rate; an XMR band's max at the market.
  - (b) A relist of a multi-currency offer where one currency has no rate: `launchCapRefusal(null)` answers `price-unavailable`. Refuse the whole relist, or check only the priced currencies? That is a product call (owner question). My recommendation: refuse only if no currency can be checked, and keep checking every currency at take.
  - (c) The growth ceiling takes the trade's band limits (`trades.max_fiat_cents` = the band's covered max, e.g. 500.99). That is fine as is.
- Until then a band may advertise far above $5,000.

**I4. The owner's price-change rule (−5%..+10%, 0.5% steps) exists only in the web (Important; engineering).**

- The API takes any integer −2000..+2000 bps (`MAX_ADJUST_BPS` = 20%, "lead default 29 Oct"); the DB check is ±2000. The web clamps to `ADJUST_MIN_BPS` −500 / `ADJUST_MAX_BPS` 1000, steps of 50.
- A direct API client can post −20% or +0.37%. The ±50% sum still holds, so this is not a rate-safety bug, but it is an owner rule that the server does not enforce.
- Fix: `parseMethods` refuses `adjustBps < −500`, `> 1000`, or `% 50 !== 0`. Narrow the DB check the same way, set `MAX_ADJUST_BPS` to match, and add a test. Exception: if −5..+10 is a design number rather than the owner's, ask first.

**M1. Test gaps.** Items (a)-(g) under check (8). (a) and (b) matter most.

**M2. The 0.5% tolerance can quietly move a take to a neighbouring band** priced within 0.5% (stale `viewerTrades`, or the trade count changing between list and take). The server is still the one deciding, and the response carries the locked rate. Optional: in the web, re-quote when the locked rate's band differs from the one shown.

**M3. e2e not ported.** post.spec has 12 failures and quote.spec 7 (list above). The board parity needs a design/lead call.

**M4. Locked instructions reach no screen.** `paymentInstructions` is in the trade view but the web trade room never shows it. Build it (with design), or say in the READY note that it is deferred.

**L1.** Migration header text: "440-449 free for J-16" (see I1).

**L2.** No DB backstop for |margin + adjust| ≤ 5000. A row inserted outside the API makes `rateFor` throw, so the take answers 500. Optional.

**L3.** My offers flags `no-price` only when every currency is unpriced; a partly unpriced offer gives no hint. Design.

**L4.** An amount on the edge between two bands priced apart can be unquotable (quote `too-high`), though the poster meant to cover it. UX only, and it fails closed.

**L5.** `rateSql`'s default `bps = 'o.margin_bps'` names a dropped column. Only tests use the default, with a synthetic alias. Drop the default.

## The builder's 6 decisions, with my recommendation

I found no numbered list in the commits or the comms notes, so this is the six as the code shows them (LEAD DEFAULT and builder markers). The lead can map them onto the builder's own list.

1. **The band-must-differ rule (`BAND_DIFFER_DEFAULT`):** bands may share amounts if they differ by range, minimum trades, margin or payment types (pending owner p11-60). **Recommend: keep it as interim, but drop `margin`.** Two bands with the same amounts, the same rule and the same methods, differing only in margin, are never both live: `pickTier` always gives the taker the better one, so the worse band is dead and misleads the poster. The owner's word was "modifiers" (conditions), and margin alone is not a condition. Put it to the owner with p11-60.
2. **An XMR offer has one band per currency** (`xmr-one-band`). **Recommend: accept until the owner rules.** It avoids the "how do XMR bands follow on" question and fails closed.
3. **When several bands hold an amount, the take uses the best for the taker among the bands whose rule they meet** (`pickTier`; cards use `headlineTier`, falling back to the lowest rule so a card still shows a rate). **Recommend: accept.** It is the only taker-safe reading, the poster set every band, and the server decides. Confirm with p11-60.
4. **Locked instructions are shown to both traders only once the escrow is secured** (`securedAt`). **Recommend: accept.** It is enforced on the server. Add the positive test (M1b), build the display (M4), and settle retention (I2).
5. **The method price change is −5%..+10% in 0.5% steps in the web, while the API allows ±20% in any step.** **Recommend: reject the split; enforce the owner's numbers on the API (I4).**
6. **A no-rate currency:** hidden from lists and counts, shown on offer detail with a null rate, take refused, kept in `/v1/currencies` as `available: false`, tagged "no rate" in the PostOffer picker (30 s poll), My offers `no-price` only when all currencies are unpriced. **Recommend: accept.** The tag versus hidden look is design's (J-32). Add tests for "comes back" on the list and for a take in that currency (M1d, M1e).

Related, but not one of the six: old fixed-price rows get a band with margin 0 and stay invisible under `MARKET_PRICED`, still waiting on J-02 BLOCKED d7217fa5. Fine as is.
