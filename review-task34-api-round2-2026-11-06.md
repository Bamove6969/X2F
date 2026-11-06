# Review round 2: Task 34 several currencies per offer, API (RV-H, 2026-11-06)

Branch `origin/wip/second-p3-task34` @ `c2d1006c`. Round 1: `~/x2f-comms/review-task34-multicurrency-api-2026-11-02.md` (APPROVED WITH MINOR at `667e5edd`). Fix commits: `c586cc1e` (red tests), `e78143f9` (fixes + notes). `c2d1006c` is docs only: one line in `docs/superpowers/specs/2026-11-02-task34-multi-currency.md` (owner settles band coverage as built, round-1 Q1). Confirmed with `git show --stat`.

## Verdict: APPROVED WITH MINOR

No Important findings. Every round-1 finding is fixed or recorded as asked; no regression found in the API, `@x2f/trade` or the tests. The open items are landing work (below), not defects in this branch.

## Round-1 findings

| # | Fix | Check |
|---|---|---|
| M1 old single-method shape skips the whole-unit rule | `parseNewOffer` accepts `FLEX_KEYS` only (`apps/api/src/offers/routes.ts` ~509); `LEGACY_KEYS`, `parseLegacyPricing`, `fiat`, `MIN_TRADES` removed; no dead references (tsc 0). Tripwire test "the old single-method shape is gone": market and fixed legacy bodies are both 400 `bad-request` and write no row. Tests post through `apps/api/test/helpers/offers.ts` `flexBody`, which throws on non-whole amounts instead of rounding, so no test silently changed its band. | fixed |
| M2 15-digit minor units for 3-decimal currencies | API `FIAT = /^\d{1,15}$/` (routes.ts:189), trade `FIAT = /^[1-9]\d{0,14}$/` (flexOffer.ts:66), `WHOLE` still 12 digits. 12 + exponent ≤ 3 = 15, so every storable band edge is listable and `tiersValid`. 15 digits stay far inside `numeric(30,0)` and take's 18-digit `CENTS`. Web parsers accept up to 30 digits; `takeErrors.ts` already 15. Tests: KWD `1-999999999999` lists at `amount=999999999999000`, `tiersValid` true, 16 digits 400; trade test bad tier moved to 16 digits. | fixed |
| M3 merge order | coordination.md: "API and web land together, never the API alone". `wip/second-p3-task34-web` contains `e78143f9` and its API sources (`apps/api/src`, `apps/api/migrations`, `packages/trade/src`) are identical to `c2d1006c`; it lacks only the docs commit `c2d1006c`. | done (note) |
| M4 My offers silent when no currency is priced | `hidden: 'no-price'` when every offer currency has `prices.current(c) === null`, after the account reasons and `method-unavailable` (routes.ts ~956-961); type, spec and coordination updated; test covers one unpriced (not hidden), all unpriced (`no-price`), paused (never hidden). | fixed |
| M5 dev databases with an earlier 117 | coordination.md deploy note: drop and recreate. | done (note) |
| Q1 band coverage | owner settled as built (`c2d1006c`). | closed |
| Q2 gift card several currencies, Q3 team member sees instructions | not addressed in this branch (product questions); still open for the lead. | open |

## Minor

**m1. `hidden` is still blank for an offer listed nowhere by a mix of reasons.** `apps/api/src/offers/routes.ts:957-961`. `method-unavailable` needs every method under review and `no-price` needs every currency unpriced; the list needs, per currency, a price AND an available method in that currency. Scenario: USD offered only with REVOLUT (under legal review), EUR offered with ZELLE but EUR's feed is down: no list shows the offer and My offers says nothing. Rare (two independent outages on one offer); the web can still read `currencies[].rate === null`. Fix if wanted: compute `hidden` as "no currency is both priced and has an available method", and pick the word from which reason applies. Not blocking.

**m2. The API branch's own web file is stale on the cap fields.** `apps/web/src/ui/cantDoCodes.ts:220-241` @ `c2d1006c` still reads `{ perMarket, total }` while the API sends `{ perSide }`, so on this branch alone `offerCapsOf` returns null and PostOffer says "…per side … in each currency, or on offers in all", the old cap. Harmless only because of M3: `wip/second-p3-task34-web` replaces it (`perSide`, `offerCapLine`). Take the web branch's file at landing; never land this branch's `cantDoCodes.ts` alone.

## Landing: overlap with `wip/second-api-cap-dispute` (@ `286c6654`) and migration 117

Both branches (and `-web`) sit on main-line `e7636c74`; main is now `a779ef97` (one commit, settings only). Trial merges with `git merge-tree`:

- `c2d1006c` into main line: clean. `cap-dispute` into main line: clean.
- **The cap code is the same on both sides**: `OFFER_CAP_DEFAULTS { perSide: 3 }`, `OFFER_CAP_KEYS { perSide: 'offers_max_per_side' }`, `tooManyOffers` → 409 `{ perSide }`, `assertMayPost(…, { side }, except)` counting `offers` rows of that side, bulk turn-on counting `x.side === o.side`. No semantic difference; Task 34 adds only `caps` in the bulk response, which cap-dispute lacks.
- **Whichever lands second conflicts.** Merging cap-dispute into `-web` (the pair that lands together): conflicts in
  - `apps/api/src/offers/routes.ts`: 6 hunks, all comments or formatting of the same cap code (doc comment, `loadOfferCaps` body, `assertMayPost` doc/signature/query, bulk comment). **Take the Task 34 side in every hunk.**
  - `apps/api/test/offers.test.ts`: import (`finalRateSql` + `currencyExponent`; main line's `rateSql` no longer exists on Task 34), cap test bodies (keep `flexBody(...)`), and cap-dispute's fixed-price `fixedBig` lines (~447-449): **drop them** (fixed price is 400 since Task 34). Take Task 34 side.
  - `apps/api/test/offersBulk.test.ts`: the raw `insert into offers (… price_mode, fixed_cents_per_xmr, min_fiat_cents …)` on the cap side uses columns 117 drops: **take Task 34's `insertOffer` + `renameOfferMethod`**, keep Task 34's extra bulk-caps assertion and the method-unavailable test.
  - `apps/web/src/ui/cantDoCodes.ts`, `apps/web/src/screens/myoffers/model.ts`: take `-web` (it already has `OFFER_CAP_LINE`, plus `offerCapsOf { perSide }` and `offerCapLine`).
  - `apps/web/test/myOffers.test.tsx`: one comment line.
  - `docs/coordination.md`: two hunks; keep cap-dispute's strike-through of N-M5 ("superseded by C2-A1") and Task 34's text where they differ by hand.
- **Silent clash (no textual conflict, red after the merge):** cap-dispute's `apps/web/test/postOffer.test.ts` change auto-merges into `-web` and expects `refusalText('too-many-offers')` to be exactly `'You can have 3 buying and 3 selling offers. Remove one you no longer need, then post this one.'` (merged line ~159), but `-web`'s `postCantDoText` says `"… offers. Paused offers count too. Remove one …"`. Same for `myOffersCantDoText` in the merged `apps/web/test/myOffers.test.tsx` ~203-204 vs `-web`'s "Paused offers count too." wording. Resolve: keep `-web`'s wording (it carries the lead's M6 "paused offers count") and change those expectations, then run web vitest (`postOffer`, `myOffers`). Run tsc + vitest for api and web after the merge (helper rule).
- **Migration 117**: no other open branch adds a `117_*` file (checked every remote branch not merged into the main line; only `-task34` and `-task34-web`, same file). Main line has 111, 112, 115, 116, 199, 201, 302, 306. Cap-dispute adds no migration. The schema-list tests (`apps/api/test/schema.test.ts:47, 70, 146`) already list `117_flex_offers.sql` after `116_fund_started.sql`. Later conflicts on those same lines: `wip/second-p3-task9-view` / `wip/second-p3-task10` add `113_release_claim.sql` (not yet on the main line), so whichever lands second adds its name in number order to all three lists by hand; no number clash.

## Tests run (own worktree `~/x2f-worktrees/rv-task34` @ `c2d1006c`, `npm ci` with npm 11.21.0, every run under `flock ~/x2f-comms/check.lock`)

- tsc `packages/trade`, `apps/api`, `apps/web`: 0 errors each.
- `npx vitest run --project @x2f/trade`: 13 files, 348 passed.
- `npx vitest run --project @x2f/api` flexOffers, offers, offersBulk, take, blocks, team, schema: 7 files, 247 passed, 0 failed (round 1: 245; +2 new tests for M2 and M4, the M1 test rewritten).

Not run: Playwright, web vitest (no web source change in the fix round), full api suite.

Worktree removed after the run.
