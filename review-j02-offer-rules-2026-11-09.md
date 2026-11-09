# Review: J-02, wip/second-offer-rules (fixed-price offers removed end to end)

- Branch: `wip/second-offer-rules`, head `32744fdd`, built by claude2 on `wip/lead-land` `f89233af`.
- Diff reviewed: `git diff f89233af..32744fdd` (52 files, +770/-579; commits 10091676, d7217fa5 BLOCKED, 6458c4b0, 027bb691, 684d0a02, merge 9b7ee8f6, 32744fdd).
- Reviewer: independent, read-only (cloud lead session, 9 Nov 2026). Throwaway worktree `.claude/worktrees/rv-j02`, `npm ci` run there. No code changed.
- Owner rule checked: Q1 (6 Nov) offers are market ± % only, no fixed-price offers, none to migrate; F1 (7 Nov) above or below, at most 50%.

## Verdict

**APPROVED (Minors only).** It can land as is. Every fixed-price path is gone or refused, and nothing in the market ± % logic was damaged. The one item for the lead is the BLOCKED owner question in d7217fa5 (m1). The owner's ruling already answers it.

## Tests run (serialised runner, single files)

- `apps/api/test/take.test.ts`: 42/42 passed.
- `apps/api/test/offers.test.ts`: 36/36 passed.
- `apps/web/test/postOffer.test.ts`: 35/35 passed. The first try was stopped by the background time limit while it waited for the runner's lock, before it started; the second try ran.
- Not run by me: offerMigrations, offersBulk, chat, blocks, offerUnits, the web browse/quote/myOffers tests, `@x2f/trade` money/offerRange, and Playwright. The builder's commits say they ran.

## Fixed-price paths, one by one

| Path | State on the branch |
|---|---|
| API `POST /v1/offers` `pricing.mode: 'fixed'` | Refused with 400 `bad-request`. `parsePricing` takes only `{mode:'market', marginBps}` with exact keys and \|bps\| <= 5000 (offers/routes.ts:301). Tested: 'fixed' is 400 with nothing stored, ±5001 is 400, ±5000 is posted with the right rate. |
| `price_mode` column | Still present. Insert hard-codes `'market'` (routes.ts:552-554). Reads never select it. `MARKET_PRICED` (`o.price_mode = 'market'`) is ANDed into LISTED (offers and chat), GET one, My offers, PATCH, bulk status, and take's OFFER_SQL. |
| `fixed_cents_per_xmr` | No longer read or written by any src. `rateSql` lost its fixed branch. Covered by the 20-digit rate parity test, plus a new null-market case. |
| `@x2f/trade` `Pricing` / `offerRate` / `displayRate` | `Pricing` is market-only. The fixed branch is deleted. An unknown mode still throws `RangeError`. |
| Take | The exact-compare fixed path is gone. The tolerance is always 0.5%. A legacy fixed row is 404 `not-found` with or without the feed (tested, and no trade row is created). |
| "Fixed offer can be taken while the feed is down" | Dead. Take test: with the feed down, −50% and 0% offers are both 409 `price-unavailable` and no trade is created. With the feed back, the −50% offer locks at 16 500. |
| Starter cap M5 ("fixed far below market") | Re-expressed at −50%, the lowest allowed. It still proves that the cap counts XMR at market. |
| Web PostOffer | The Market/Fixed chips, fixed input, stale warning and `fixedPriceCheck` are gone. They are replaced by Above/Below chips plus a typed percentage (0-50, two decimals). `validate` always sends market. Old drafts: a fixed draft is dropped, and a market draft is converted to side and percentage. |
| Web browse / My offers / quote parsers | `parsePricing` accepts only `'market'`. OfferCard's fixed markup branch, the My offers "Fixed price" line, `marketLine`'s fixed sentence and the quote comments are gone. |
| Spec 2.2 step 5 | Rewritten to market ± % only. |

## DB guard, migration 345

`alter table offers add constraint offers_market_only check (price_mode = 'market' and margin_bps is not null and fixed_cents_per_xmr is null) not valid;`

- It **neither drops nor rewrites** existing rows. Because it is NOT VALID, an old fixed row stays and the API treats it as non-existent. Postgres still checks NOT VALID constraints on every insert and update. So no new fixed row can be written, and no existing row can be changed into a fixed one (offerMigrations.test covers both).
- Side effect to know about: an UPDATE of a legacy fixed row also fails the check. Today no code path can update such a row: both `update offers` statements in src are filtered through MARKET_PRICED ids. A future data migration over all offers (like 315's backfill) would fail on such a row. That is fail-closed, so it is acceptable.
- The margin bound stays where it was: 102's `margin_bps between -5000 and 5000`, the API's `MAX_MARGIN_BPS`, `rateFor`'s RangeError, and the web's `MARGIN_MAX_BPS`. All four agree on 50%.

## Market ± % logic, not damaged

- `rateSql`'s rounding (`div(m*(10000+bps)*2+10000, 20000)`) is unchanged. The parity test still runs it against `offerRate` at the 20-digit maximum.
- The stale or down price pause is unchanged: `offerRate` returns null with no or other-currency market, so the list shows `rate: null` and take answers 409 `price-unavailable`. The cap check's own `price-unavailable` (take.ts:186) is untouched.
- The tie-break tests that used fixed prices to make rates distinct now use ±bps margins over new fake currencies in the test market (GBP/BRL/SEK/MXN/THB). I checked the expected values (for example SEK 330000 +2% = 336600, BRL −10% = 148500). The rounding test now uses a $10.00 market so that 4/5/6 bps round to 1000/1001/1001, which still proves the DB sorts on the rounded rate.
- Web: the margin limit widens from the board's ±10% stepper to the owner's 50% (F1). `marginText` shows a second decimal only when the margin has one.

## Tests updated, not weakened

Every removed fixed assertion was replaced with a market equivalent that tests the same property (sort, cap, rounding, best rate). New tests were added for the 400 refusal, the ±50% boundaries, and the legacy-row invisibility across list, count, GET, My offers, PATCH, bulk status, take and chat. The tests that insert a legacy row drop the constraint and add it back around the insert. That is acceptable, but if the insert throws, the rest of that file runs without the constraint. This is test hygiene only.

## Web copy (COPY-UNSIGNED)

New strings are marked `COPY-UNSIGNED` and `DESIGN: wording`: "Above market", "Below market", "Percentage", "Enter a percentage from 0 to 50, like 0.5.", "Set your percentage". The parity exceptions for the board's −/+ stepper are recorded in parity.ts with a reason. Removed: "Market ± %", "Fixed price per XMR", "A fixed price goes stale when the market moves.", the caution/refuse lines, "Fixed price" (card and My offers), and "A fixed price doesn't follow the market. Check it often."

## Findings

- **m1 (Minor, for the lead, not code): the BLOCKED question in d7217fa5 is already answered.** The owner said "none to migrate". The branch is safe while the question stays open: legacy rows are invisible and immutable. Recommend the lead closes it with option A (a later migration converts any fixed row to market 0% and paused, then VALIDATEs the constraint and drops `price_mode`/`fixed_cents_per_xmr`). A is a no-op on an empty table, so no new owner question is needed.
- **m2 (Minor): stale comments and docs.** `apps/api/src/price/market.ts:10` still says "fixed-price offers do not use this". Plan 3 (`docs/superpowers/plans/2026-10-15-plan-3-trading.md` lines 104, 224, 350, 375) still describes fixed-price offers and the "fixed offer can be taken while the feed is down" default. The coordination.md history lines are a log and can stay.
- **m3 (Minor, merge note): conflict with `wip/lead-launch-rules` (17eba0de).** That branch is not in J-02's base. It rewrites the same take test ("a fixed-price offer compares exactly; while the feed is down neither a fixed nor a market offer can be taken") and still posts fixed offers in tests (`pricing: { mode: 'fixed', centsPerXmr: ... }`). Whichever lands second must take J-02's version of that test and convert launch-rules' fixed-offer test fixtures to margins, or they will 400.
- **m4 (Minor): bulk status still counts legacy fixed rows against the offer caps** (routes.ts:397, and the comment at 782). This is documented as intentional and belongs to the offer-caps branch. It is moot once m1's migration runs.
