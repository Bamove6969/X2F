# Review: origin/wip/lead-offer-units (offer amounts in XMR or fiat)

- Head reviewed: b96f933348cca026ee740ff937d99cd2c5b68cf2, against origin/main (merge-base diff)
- Reviewer: independent (Opus), read-only worktree /home/flem/x2f-worktrees/rv-units (removed)
- Verdict: **CHANGES REQUESTED, two findings.** The server-side money path is sound. H1 (Post an offer, switching units keeps the typed number) can post an offer 100x+ larger than the poster meant. M1 (the quote checks an XMR-unit offer against converted fiat limits) means takers get refused at the edges. Both are web-side and small to fix.

## What holds (verified)

- Every conversion is bigint. `rangeInBoth`: XMR to fiat rounds half up (`fiatCents`), fiat to XMR floors (`atomicForFiat`). `rangeAllows` checks the poster's own unit: atomic for an XMR range, `fiatCents` total for a fiat range. No floats anywhere in the path (packages/trade/src/offerRange.ts).
- Take (apps/api/src/trades/take.ts:288-297): `lockRate` runs before the range check and throws 409 `price-unavailable` when a market offer has no feed. An XMR-unit market offer with the feed down is refused cleanly; no stale price is used. A fixed-price offer still works.
- The margin is applied the same way everywhere. The API's converted pair (`amountsOf`, routes.ts:229) uses `rateOf` = `offerRate`, the same rate the take locks. The web with the markup box on uses `o.rate`; with it off it uses the market price (`displayRate`).
- The trade records fiat limits at the locked rate (`tradeFiatLimits`). The minimum is at least 1 minor unit and the maximum is never below the minimum. For a fiat range the limits are unchanged from before.
- Fiat-unit offers: the XMR bounds shown on the card (offer rate, markup on) pass the server when typed in XMR. Checked at rate 1500033, $500-$3,000: both edges return `ok`.
- Validation (routes.ts:305-347): `amountUnit` must be 'xmr' or 'fiat' (missing means 'fiat'; null or anything else is refused). The other unit's keys are refused. Amounts must be positive digit strings matching the regex, with min <= max. `minTrades` must be null or exactly 5, 10, 25 or 50 (number type). The DB has CHECKs for the unit, the pair being exactly one unit, `max_atomic >= min_atomic` and the min_trades choices.
- Migrations: 324 defaults existing rows to 'fiat' and their fiat columns stay non-null, so `offers_amount_pair` holds for every existing row. 315 maps min_trades down (0 becomes null). Both numbers are unique across every origin branch (others: 313 on wip/lead-sessions, 316 on wip/lead-terms-signature). The migrator applies by name set, so a lower number landing later is fine.
- The markup checkbox is display only: `withMarkup` feeds only `cardRows` in OfferCard and never reaches the quote or take. Storage reads and writes are wrapped (offerAmounts.ts `loadWithMarkup`/`saveWithMarkup`; OfferList.tsx `localStore()` wraps the `window.localStorage` access too).
- No other API path reads `min_fiat_cents` from offers (PATCH changes status only; bulk is unaffected).

## Findings

### H1. Switching units on Post an offer keeps the typed number, so a fiat amount becomes XMR
- apps/web/src/screens/PostOffer.tsx:172: `onChange={(u) => set('unit', u)}`. `set` (line 165) only stores the key; `form.min` and `form.max` are left as typed.
- Scenario: the form opens in XMR (DEFAULT_FORM.unit = 'xmr', offerForm.ts:54). A poster types "500" and "3000" meaning CAD, then taps CAD. The boxes now mean CA$500 - CA$3,000, which is fine. The reverse is the danger. A poster who started in CAD (or restored a fiat draft) and taps XMR now has "500 – 3000 XMR", and that posts without complaint (the API allows up to 20 digits). The same happens to a draft saved before this change: it loads as 'fiat' (offerForm.ts:343), and one tap on XMR re-reads "50"/"2000" as XMR. The preview shows the ≈ fiat, but nothing stops the post. That is an offer of roughly 1,000x the intended size.
- Fix: on a unit change, convert both boxes at `yourPrice`. Round up for the min and down for the max. Rounding the min down instead could shrink the range to nothing; once converted, the poster's unit is exact. If there is no price, clear both boxes. Add a unit test: type 500 in fiat, switch to XMR, the box no longer reads "500". The spec asked for "converts or clears values sensibly", and right now it does neither.

### M1. The quote checks an XMR-unit offer against converted fiat limits, while the take checks XMR, so edge amounts pass the quote and are then refused
- apps/web/src/screens/quote/api.ts:51-52 passes the API's converted `minFiatCents`/`maxFiatCents` into `QuoteOffer`. quoteModel.ts:113-114 compares the fiat total. The server compares `amountAtomic` against `min_atomic`/`max_atomic` (offerRange.ts `rangeAllows`).
- Verified with @x2f/trade. XMR range 0.1 - 0.5 XMR, rate 1500033 (CA$15,000.33). The card shows ≈ CA$1,500.03 - CA$7,500.17.
  - Typing 1500.03 in fiat gives `atomicForFiat` = 99,999,800,004 atomic. The quote says ok; the server says `too-low`, a 409 `out-of-range`.
  - Typing 7500.17 in fiat gives 500,000,333,326 atomic. The quote says ok; the server says `too-high`.
  - Typing 0.500000000001 XMR gives a fiat total of 750017, inside the converted max. The quote says ok; the server says `too-high`.
- The quote also keeps the converted bounds fetched at load time, while its rate refreshes every PRICE_REFRESH_MS. As the price moves, the fiat bounds drift away from the XMR range in both directions: the quote can refuse amounts the server would take, and the reverse.
- Money is safe (the server is authoritative). The cost is takers hitting a confusing refusal near the shown limits, and "Max" on SellQuote (`showMax`) could target the converted max.
- Fix: carry `amountUnit`, `minAtomic` and `maxAtomic` into `QuoteOffer` and run the quote's size check through @x2f/trade `rangeAllows(offerRange(o), amountAtomic, rate)` at the quote's current rate. The `fetchOffer` comment already plans this. For fiat-unit offers nothing changes. For the fiat-typed path on an XMR offer, you could also snap to `minAtomic` when the floored figure lands within one minor unit under it. Add quote tests at both XMR edges, typed in fiat and in XMR.

### L1. XMR-unit trades: funded growth can pass `max_atomic` by under a cent
- `tradeFiatLimits` gives maxFiat = fiatCents(maxAtomic) rounded half up. The escrow growth rule (apps/web/src/escrow/policy.ts:75, `fiatCents(candidate) <= maxFiatCents`) therefore allows a few hundred atomic above `maxAtomic` (verified: maxAtomic + 300 passes at 1500033). This is negligible (under one minor unit of value) and consistent with how the fiat cap already works. No change needed; noted so nobody assumes `max_atomic` is a hard cap after funding.

### L2. Small validation edges
- The web `parseXmrAmount` allows 9 whole digits plus 12 decimals, up to about 1e21 atomic, but the API's `ATOMIC` allows only 20 digits. Typing 100,000,000 XMR or more gets a generic 400 instead of a field error. Cap the web at 8 whole digits, or add a sane XMR maximum on both sides.
- `loadDraft` (apps/web/src/screens/post/offerForm.ts:332) drops a whole saved draft whose `minTrades` is 0. 0 was the old default, so most posters with a pre-change draft lose it silently. Map 0 to null when loading.
- An XMR-unit market offer with the feed down: `fetchOffer` returns null, and the quote screen (Quote.tsx:203) says "This offer is no longer listed." while the card is still on the list. The take would refuse anyway; show the price-unavailable state instead.

### Info (owner rule, not a bug)
- With "Display amounts including vendor markup" off (the default), the converted row uses the market price. For a +margin fiat offer, the XMR max shown is larger than any amount the take accepts. The `xmrBound` comment, "the range shown is never wider than the one the offer takes", holds only with the box on. This is what the owner asked for, and the hint text says so. Worth one line to the owner: should the default-off view say the XMR row is indicative?

## Tests
- New tests are meaningful at the edges: half-cent rounding, beyond MAX_SAFE_INTEGER, tiny XMR minimums, the locked-rate limits, the migration value mapping, and unit/body mismatches. Gaps: no take test for an XMR-unit market offer with the feed down (the code path is shared and covered by take.test.ts:247), and no quote test for XMR-unit offers (that is M1).
- Run: see the report for results of `flock ~/x2f-comms/check.lock npx vitest run <changed test files>` and typecheck.
