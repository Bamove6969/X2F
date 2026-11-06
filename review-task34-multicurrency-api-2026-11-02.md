# Review: Task 34 several currencies per offer, API (C2-T34AR, 2026-11-02)

Branch `origin/wip/second-p3-task34` @ `667e5edd`, diff from `b4240210` (4 commits: f6ed5fb8 wire shapes, 3345ad44 build, 65d8f700 and 667e5edd tests).
Read in full: `apps/api/src/offers/routes.ts`, `apps/api/src/trades/take.ts` (take path), `packages/trade/src/flexOffer.ts`, `apps/api/migrations/117_flex_offers.sql`, spec `docs/superpowers/specs/2026-11-02-task34-multi-currency.md` (Owner decisions + Wire shapes), the flexOffers tests.

## Verdict: APPROVED WITH MINOR

No Important findings. Every owner decision is enforced on the server; the money math is integer-only and the edges hold; the signed terms cannot mix one currency's instructions with another's.

## Owner decisions: checked on the server

| Decision | Where | OK |
|---|---|---|
| Market ± % only, no fixed price | `parseLegacyPricing` refuses `mode !== 'market'` (routes.ts ~468); the new shape has no pricing key; 117 removes existing fixed offers and drops `price_mode`/`fixed_cents_per_xmr` | yes |
| Bands per currency, whole units, contiguous, next = max+1 | `bandShape`/`bandsValid` (flexOffer.ts 104-128): `^[1-9]\d{0,11}$`, min ≤ max, sorted, `min == prev.max + 1` exactly (gap and overlap both fail; equal mins fail too) | yes |
| Max 5 currencies, distinct, known to the feed | `parseCurrencies` (routes.ts ~485), `currencyExponent` non-null; DB `position between 0 and 4`, PK (offer_id, currency) | yes |
| Vendor picks methods + currencies | `parseMethods`: `currencies` ⊂ offer currencies, distinct, non-empty; every offer currency needs ≥ 1 method (parseNewOffer) | yes |
| Instructions per method+currency, else shared | `offer_method_currencies.instructions` (null = shared), `instructionsFor`; `instructionsByCurrency` keys must be the method's own currencies | yes |
| Buyer filters currency + method | list joins `offer_method_currencies` on ($3 currency, $2 method) + `isAvailable(method)` | yes |
| Take locks currency + method + that pair's instructions | take.ts 268-275: currency on offer, method offered in it, else 400; `lockRate` prices with `prices.current(b.currency)` so `lockedRate.currency == b.currency`; `methodInstructions = instructionsFor(method, b.currency)`; the trade row is the only source of `AttestedTerms.deal` (internal/routes.ts 80-89: `locked_currency`, `locked_cents_per_xmr`, `sha256Hex(method_instructions)`) | yes |
| Unpriced currency hidden for that currency only | list `[]` and `liveOfferStats` `[]` per currency; detail still opens with `rate: null` (documented) | yes |
| No USD price → 409 `no-usd-price` (CantDoThat) | take.ts 294 (`prices.quote`), and `lockRate` covers a feed drop in between; `ApiErrorCode` + `CANT_DO_CODES` both list it | yes |
| Cap 3 buy + 3 sell, counted per side, once per offer, race-safe | `assertMayPost` counts `offers` rows (one per offer) under `accounts … for update`; bulk turn-on counts the same in memory under the same lock; test "six concurrent posts … exactly three" | yes |

## Security focus: what I checked

- **Signed vs shown (I1 follow-through).** The buyer never sees instructions before the take (public cards and details strip them; `publicMethods`). After the take, both the trade view and the attested hash come from `trades.method_instructions`, which is written once (112's `trades_deal_fixed`) with the chosen currency's text. `deal.currency` comes from the same row. There is no path where the shown text belongs to currency A and the signed terms to currency B.
- **Take with a currency/method the offer lacks**: 400 before anything is read further (tiers null, method missing, or pair missing). Tested.
- **Stale/unpriced races list → take**: the take re-reads `quote` and `current` inside the transaction; a move > 0.5% is `price-changed`, a feed drop is `no-usd-price`; the rate locked is always the server's. Band and rule are re-derived from the locked rows, and the total at the locked rate must stay in the band.
- **Money math**: all bigint / numeric; `bandsToTiers` exact for exponents 0, 2, 3 (JPY 200-500,501 → 200-500 / 501-…; USD → 20000-50099); margin ±5000, adjust ±2000, and every (band, method in its currency) sum checked ±5000, so `rateFor` cannot throw on a stored offer; `finalRateSql` uses `div` (parity test passes). 12-digit bands × 10^3 stay well inside `numeric(30,0)` and take's `CENTS` (18 digits). One edge in Minor 2.
- **Write-once**: `offer_currencies` refuses every update; `offer_tiers` every update; `offer_methods` only blanking `instructions` to `''`; `offer_method_currencies` only setting `instructions` to null. Tests cover attacker-style instruction rewrites on both tables. No API path inserts or deletes child rows after post.
- **Removal blanks all copies**: PATCH `removed` blanks `offer_methods.instructions` and nulls every `offer_method_currencies.instructions` in the removal transaction, after the offer row update (which waits for any take holding `for share of o`). Tested.
- **Migration 117 on an existing DB**: 117 is not on the main line, so editing it is safe for production. Grep of `apps/` and `packages/` for `offers.currency`, `price_mode`, `fixed_cents_per_xmr`, `min_fiat_cents`, `max_fiat_cents`, `min_trades`, `method_id`, `margin_bps` on `offers`: no remaining reader in `src` (chat reads only `account_id, side`; take, trades, internal read the trade row). Web hits are wire fields of `MyOffer`, not DB columns. The migration test runs 117 on a pre-117 DB with a market and a fixed offer and checks rows, dropped columns, list and take. No trade path reads the offer's price after the take, so removing fixed offers loses nothing a live trade needs.
- **Compatibility old shape**: one currency (feed-checked), one band, method with no instructions and no adjustment; fixed price 400; the same cap, catalog, availability, gift-card country and margin checks apply after parsing. It cannot add currencies, bands or instructions. See Minor 1 for the one rule it skips.
- **Route tables/tripwires**: no new routes; the new refusal code is in `ApiErrorCode` and the web's `CANT_DO_CODES`; tsc web passes.
- **Privacy**: list → `publicMethods` (no instructions); detail → instructions only when `mine`; `GET /v1/account/offers` behind `requireTraderStaleOk` (member: offers); take/trade only for parties. See QUESTION 3 for a pre-existing detail.

## Minor

**M1. The old single-method shape skips the whole-unit band rule.** `apps/api/src/offers/routes.ts:529-539`. `minFiatCents`/`maxFiatCents` are taken in minor units as given (also with leading zeros, `FIAT = /^\d{1,14}$/` at :188), so `{ minFiatCents: "12345", maxFiatCents: "67891" }` posts a USD band 123.45-678.91 that the new shape cannot express. Not a money risk (one band, every other check applies), but it is a second way in that does not follow the owner's band rule, and Task 35's band display (`max = floor(maxFiatCents / 10^exp)`) would show it as 123-678. Fix: when the web switches, delete the legacy branch (keep a tripwire test that the legacy keys are 400); until then, optionally require `minFiatCents % 10^exp == 0`.

**M2. 3-decimal currencies: a 12-digit band edge is 15 digits of minor units, past the list's `amount` limit and `@x2f/trade`'s `FIAT`.** `packages/trade/src/flexOffer.ts:69` (comment says 12 digits stay within 14 "for 2-place currencies"), `apps/api/src/offers/routes.ts:188`, `packages/trade/src/flexOffer.ts:66`. Scenario: a KWD band `{ min: "1", max: "999999999999" }` stores `max_fiat_cents = 999999999999000`; `GET /v1/offers?…&currency=KWD&amount=999999999999000` is 400 and `tiersValid` (used by clients) rejects the tier. Unreachable in practice (≈ 3 trillion USD), so cosmetic; fix by limiting WHOLE to `14 - exponent` digits per currency, or widening FIAT to 15.

**M3. Merge order: this API breaks the main-line web until the web branch lands with it.** `apps/api/src/trades/take.ts:86` requires `currency` (exact keys), so every take from today's `apps/web/src/screens/quote/api.ts` is 400 `bad-request`; the web's PostOffer still has a Fixed price mode (`apps/web/src/screens/post/offerForm.ts:196`), which now answers a generic 400. Land `wip/second-p3-task34` and `wip/second-p3-task34-web` together (or the web first, sending `currency`); do not merge the API alone.

**M4. My offers says nothing when a live offer is listed nowhere because none of its currencies has a price.** `apps/api/src/offers/routes.ts:989`: `hidden` covers the stop, a hold and "every method unavailable", but an offer whose every currency is unpriced is invisible to buyers with no reason shown (each `currencies[].rate` is null, which the web could read). Also, "every method unavailable" is offer-wide, not per currency (an offer whose only EUR method is under review still lists in USD, which is correct, but EUR is silently gone). Low impact; the web can derive a "no price now" note from `rate: null`, or add `hidden: 'no-price'`.

**M5. Dev/test databases that applied an earlier 117 will not re-run it.** `apps/api/src/db/migrate.ts` records names only; any long-lived DB (a docker volume used with `wip/second-p3-task34` or `-web` before 3345ad44) keeps the old schema and then fails on `offer_currencies`. Not production (117 never shipped). Note it in coordination.md for the web helper: drop and recreate such DBs.

## QUESTIONS (product decisions, not bugs)

**Q1. What a band covers.** Lower bands cover up to just below the next band's min (200-500 covers 500.99), the top band ends at its own max exactly (800.00, not 800.99). Already marked open for the lead in the spec ("What a band covers"). Alternative: every band covers up to max.99 (top included), which reads more consistently to a vendor who typed "800".

**Q2. Gift-card offers with several currencies.** A gift-card offer names one `country`, but may list up to 5 currencies (and a gift-card method can be offered in all of them). Should a gift-card method be limited to one currency (the card's), as the catalog note "must name the card's country and currency" suggests (`apps/api/src/methods/profiles.ts:8`)?

**Q3. Team members without the Offers role see payment instructions on the offer detail (pre-existing, unchanged by this diff).** `apps/api/src/offers/routes.ts:661` (`viewerCheck`, `member: 'any'`) makes any team member browse as the account, so `mine` is true at :934 and `ownMethods` returns the instructions, while `GET /v1/account/offers` requires `member: 'offers'`. Is a Trades-only member allowed to read the account's payment details (they see them in trades anyway)? If not, pass `mine` only for the owner or an Offers member.

## Tests run (own worktree `~/x2f-worktrees/rv-t34api` @ 667e5edd, `npm ci` with npm 11.21.0, every run under `flock ~/x2f-comms/check.lock`)

- tsc `packages/trade`, `apps/api`, `apps/web`: 0 errors each.
- vitest `@x2f/trade`: 13 files, 348 passed.
- vitest `@x2f/api` targeted (flexOffers, offers, offersBulk, take, blocks, team, schema): 7 files, 245 passed.
- vitest `@x2f/api` full: 59 files, 1491 passed + 1 todo, 0 failed.
- Not run: Playwright (per brief), web vitest (only `cantDoCodes.ts` changed in web; tsc web passes).

Worktree removed after the run.
