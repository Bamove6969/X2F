# Review C2-PFR: several price feeds, per-currency fallback

Branch origin/wip/second-price-feeds @526650a6 vs main line e7636c74 (`git diff e7636c74...526650a6`), 5 commits.
Reviewer: C2-PFR (read-only; tests in a detached worktree ~/x2f-worktrees/rv-pricefeeds, since removed).

## Verdict: APPROVED WITH MINOR

No Important findings. Nothing changes by default: `PRICE_ROUTES` defaults to `market` only, the gap check is off, and the candidate adapters run only when named in config. With defaults, `createMarketPrices` gives the same numbers as before; only `route: 'market'` is added. The chain adds checks on top of the existing feed and FX rules and does not take any of them away. The Minor findings below are mainly config hardening. Close them before the owner turns on OC1 or OC3.

## What I checked (holds)

- **The fallback can't pick a bad quote.** `chain.ts:62-68` `sane()` refuses: null or non-object; `price.currency !== currency` (wrong currency); `exponent !== currencyExponent(currency)` (wrong exponent); a non-bigint price or one <= 0; a USD value <= 0; an invalid or non-Date `at`; anything older than 5 min (when a clock is given, which main.ts does). This is on top of each route's own checks: the feed's >=2 sources within 5%/2%, its 5 min age limit and frozen-quote check, and FX's 1 h age, 10% guard and trust order. An outlier inside one route is outvoted by that route's own median. The direct route reads the same feed medians (`feed.ts:205-216`), so it has the same >=2-source rule. Only EUR (Kraken + CoinGecko, under the 2% pair spread) can reach two sources today, and the tests show a single-source currency gets no price (`price-chain.test.ts:181`).
- **Existing rules are not weakened.** `marketRoute` (`chain.ts:106-125`) is the old `market.ts` quote, moved over byte for byte (the same half-up rounding: `(usd*rate*10^e*2 + den) / (2*den)`, all bigint). Feed and FX internals are unchanged apart from the candidate builders. The direct route still needs the XMR/USD median (Q9), so an XMR/USD outage still pauses every currency.
- **A route that throws or hangs can't block other currencies.** Route `quote()` is synchronous over cached feed state, and a throw counts as no quote (`chain.ts:70-76`, tested). Network work stays in the existing pollers, behind `withTimeout` (5 s / 10 s). A throw is per currency, so it can't block another currency.
- **Gap check math.** `farApart` (`chain.ts:51-55`) is all bigint: `|a-b| * 10000 > min(a,b) * bps`. It is symmetric and measured against the smaller value, so a price too small by any factor is refused. bps is an integer from config (100..5000). It only compares the chosen quote with later sane quotes, and if any of them is too far off the currency gets no price (fails closed). The edges are tested: 10 300 passes and 10 301 is refused at 3%; 9 708 is refused.
- **Candidate adapters.** They are off by default (tests at `price-chain.test.ts:296-305`), use fixed URLs, and fetch through the single `getJson` seam: `redirect: 'error'`, `credentials: 'omit'`, 200 only, a 256 KiB cap, no user data. The shape checks throw on an unexpected root, base or result, and on a missing or invalid time. Rates still go through `keep()` (bounds 10^-4..10^9) and through the FX sanity guard. Prices still go through `decimalToMinor` and the feed median.
- **Config parsing refuses bad values.** `parsePriceRoutes` refuses unknown names, duplicates, trailing commas and wrong case. `parsePriceRouteMaxGap` accepts `^\d{1,2}$` in 1..50 and nothing else. Both are wired into `loadConfig`, so a bad value stops startup.
- **503 / paused / owner alerts are unchanged.** `/v1/price` still returns 503 `price-unavailable` on null, and it does not expose `route` (fits OC5). `paused` is now worked out from `coverage`, so it means "no route prices it". The alert grouper (`health.ts`) is untouched, and the alerts for paused currencies and failing or refused sources still fire.
- **Owner route.** `/v1/owner/price-health` keeps `requireSession({ kinds: ['owner'] })`. No routes were added, so the classification tables and tripwires don't change.
- **Callers stay compatible.** `quote` and `current` keep their shape. The callers (offers/routes.ts:184,406,431,544; trades/take.ts:133,149; traders/stage.ts:136; price/routes.ts) use only `price`, `usdCentsPerXmr`, `exponent` and `at`. No caller outside price/ reads `fx` or `sources`. Hand-made `MarketQuote` fakes still type-check because `route` is optional.
- **The tests are real tests.** They use fake routes, stub sources and a stubbed `fetch`, with no network calls. They cover throw, stale, zero/negative, wrong currency, wrong exponent, NaN time, gap edges, direct-route fallback while GBP pauses alone, the candidates' URLs, init and shapes, and the published-age edges.

## Minor

**M1. Candidates and route order can be put ahead of the approved trust order** (`fx.ts:221-225`, `sources.ts:196`, `chain.ts:161-171`).
The parsers accept candidates in any position, and `direct` before `market`. Scenario: an operator sets `FX_SOURCES=erapi,coinbase,bitpay`. erapi's rate, published once a day and up to 2 days old, becomes rank 1 for every currency it covers. Fetch-time staleness counts it as fresh, so Coinbase is used only when erapi fails. That is the opposite of the plan note's OC3(b) "last in the trust order".
Similarly, `PRICE_SOURCES=coingecko,coinpaprika` makes the XMR/USD median from two aggregators and no exchange. Before this change the median always had at least one exchange-grade source unless someone picked bitfinex/kraken-less sets on purpose.
Suggest: refuse a candidate placed ahead of any approved source in `FX_SOURCES`; refuse `direct` before `market` and `direct` alone, or at least warn; or leave all of this as an explicit OC1/OC3 decision and document it.

**M2. A published date in the future is accepted** (`fx.ts:186` frankfurter, `fx.ts:205` erapi).
The age check is `now - published > limit`, so a future date gives a negative age and passes. Scenario: a vendor bug or a cache serves `date: '2099-01-01'` (or a far-future `time_last_update_unix`) with a broken rate table. The adapter calls it fresh, and only the bounds and the 10% guard stand in the way. The guard is weak after a restart if this source is the only peer. Suggest failing closed when the published time is more than a few minutes (erapi) or more than one day (frankfurter) ahead of the clock. The XMR feed already clamps a future `at` to now, so coinpaprika is fine.

**M3. Frankfurter's `amount` field is not checked** (`fx.ts:183`).
Frankfurter scales `rates` by `amount`. The URL is fixed with no `amount`, so today it is 1. If a different URL or API default ever returned `amount: 10`, every rate would be 10x and only the bounds and guard would catch it. The cost is one condition (`body.amount === 1`), and the parser then fails closed.

**M4. The plan note and the code disagree on the Frankfurter URL** (`docs/superpowers/specs/2026-11-02-price-feeds.md:57` says `api.frankfurter.app/latest?from=USD`; code and test use `https://api.frankfurter.dev/v1/latest?base=USD`).
Fix the doc so the person who checks it over Tor tests the URL the code actually uses.

**M5. Falling back to another route sends no alert** (`market.ts:81-85`).
When EUR moves from `market` to `direct`, it isn't paused, so no "EUR market prices paused" alert fires. Only the FX source-failure or refused-rate alerts fire, and only when that is the cause. The owner sees which route is in use only in `coverage` on the panel. This is acceptable, but put it to the lead with OC1(b) so the owner knows a backup route can serve EUR quietly. An optional "<CCY> priced by backup route" info alert would cover it.

**M6. The chain's own age check is off when `createMarketPrices` gets no clock** (`market.ts:76`).
This is documented, and each feed's own 5 min check still applies, so there is no real exposure. main.ts always passes a clock. Noted only because the defence-in-depth claim depends on that.

## Tests (worktree rv-pricefeeds @526650a6, npm ci with npm@11.21.0, all under `flock ~/x2f-comms/check.lock`)

- `tsc --noEmit -p apps/api`: clean.
- Targeted: `vitest run --project @x2f/api price-chain, price-health, price, fx`: 4 files, **147 passed**.
- Full api: `vitest run --project @x2f/api`: 59 files, **1498 passed, 1 todo**, 0 failed.
