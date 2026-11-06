# Review RV-G (round 2): several price feeds, per-currency fallback

Branch origin/wip/second-price-feeds @f1dea13d. Round 1: review-price-feeds-2026-11-02.md (APPROVED WITH MINOR at 526650a6).
Diff read: `git diff 526650a..f1dea13`, 2 commits (274cfa4c red tests, f1dea13d fixes), 9 files, +120/-19.
Reviewer: RV-G (read-only; tests in a detached worktree ~/x2f-worktrees/rv-price-feeds, since removed).

## Verdict: APPROVED

M1, M2, M3, M4 and M6 are fixed and each has a test. I made all 7 new or changed tests go red against the round-1 source, and I made the matching test go red with each of 8 single-line reverts. I found no regressions. M5 was not built: the branch records it in the plan note as owner call **OC6** (backup-route alert; recommendation (b), owner-only info alert, "Not built"), which is what round 1 asked for. There are no Important or Minor findings. Two nits are listed at the end; neither blocks.

## Each round-1 finding

- **M1 (order and trust), fixed.**
  - `parseFxSources` (`fx.ts:240-245`) refuses a candidate in first place, and also any approved source placed after a candidate.
  - `parsePriceSources` (`sources.ts:205-213`) applies the same ordering rule. It also needs at least one exchange (`PRICE_EXCHANGES = kraken, bitfinex`), so a median made only of aggregators is refused at startup.
  - `parsePriceRoutes` (`chain.ts:172-174`) needs `market` first, so `direct` alone or ahead of it is refused.
  - All three are reached through `loadConfig` (`config.ts:210-212`), so a bad setting stops startup. The tests cover each bad shape, including through `loadConfig`.
  - Existing accepted inputs still pass: `' coingecko , kraken '` and `bitfinex,coingecko` in price.test.ts, `FX_SOURCES=coingecko` alone in fx.test.ts.
  - Nothing outside the tests sets these env vars (no compose or env files), so no deploy config breaks.
- **M2 (future dates), fixed.**
  - Frankfurter refuses `day > now` (`fx.ts:192`). Today's UTC date is fine; tomorrow is refused. ECB dates are published in the CET afternoon of the same day, so a real answer is never ahead of UTC midnight.
  - erapi refuses a time more than 5 min ahead (`fx.ts:214`). The edges are tested: +300 s passes, +301 s fails, and 2100 fails.
- **M3 (Frankfurter `amount`), fixed.** `body.amount !== 1` is now part of the shape check (`fx.ts:187`). The test refuses 10, 0, `'1'` and missing.
- **M4 (URL in the note), fixed.** The spec table now gives the exact URLs the code uses, `https://api.frankfurter.dev/v1/latest?base=USD` among them. It also documents the future-date and `amount` rules and the ordering rules.
- **M5 (no alert on fallback), not built, recorded as OC6** in `docs/superpowers/specs/2026-11-02-price-feeds.md`. This is fine, and the lead should put it to the owner together with OC1.
- **M6 (chain age check off without a clock), fixed.**
  - `ChainOptions.maxAgeMs` is now `number` (no `null`), so the check is always on (`chain.ts:40-41, 60, 68`).
  - `createMarketPrices` no longer passes `maxAgeMs: null` (`market.ts:72-76`).
  - Regression check: every `createMarketPrices` caller that uses a fake clock now passes `clock`: `test/helpers/app.ts:99`, `price-health.test.ts:428,471`, `price.test.ts:559`. Without it, the default real clock would refuse their 2026 `T0` quotes. main.ts already passes one.
  - `git grep` finds no other callers in the repo, and the full api suite is green (below).

## Tests (worktree @f1dea13d, `npx -y npm@11.21.0 ci`, each run under `flock ~/x2f-comms/check.lock`, one at a time)

- `npx tsc --noEmit -p apps/api`: clean (exit 0).
- `npx vitest run --project @x2f/api price-chain price-health price fx`: 4 files, **154 passed**. Round 1 had 147; the branch adds 7 tests.
- **Red run** (observed this time): `git checkout 526650a -- apps/api/src/price` with the f1dea13 tests: **7 failed | 147 passed (154)**. The failures are exactly the 7 M1/M2/M3/M6 tests. After that I restored the source with `git checkout f1dea13 -- apps/api/src/price`.
- **Single-line reverts**, each restored with `git checkout -- <file>`. Each run was `vitest run --project @x2f/api price-chain` (43 tests) and went red:

  | Revert | Failed |
  |---|---|
  | FX candidate-order throw | 1 (M1 order test) |
  | PRICE_SOURCES candidate-order throw | 1 |
  | PRICE_SOURCES exchange-required throw | 2 (M1 order and exchange tests) |
  | PRICE_ROUTES market-first throw | 1 |
  | Frankfurter `day > now` | 1 |
  | erapi future slack | 1 |
  | Frankfurter `amount !== 1` | 1 |
  | market.ts chain age check off without a clock | 1 (M6 market test) |

  The tree was clean after the last revert.
- Full api: `npx vitest run --project @x2f/api`: 59 files, **1505 passed, 1 todo**, 0 failed (round 1 had 1498; the +7 are the new tests).

## Nits (optional, non-blocking)

- `market.ts:50`: the `MarketOptions.clock` doc still says "for the alerts' quiet period". It now also drives the chain age check, and leaving it out means the real time is used. A test that hands the feeds a fake clock but not `createMarketPrices` gets no prices; the test helpers were fixed for exactly that reason.
- `market.ts:54`: the programmatic `routes` option is not checked the way `parsePriceRoutes` is, so `createMarketPrices({ routes: ['direct'] })` is accepted. Only `config.priceRoutes` (already parsed) reaches it in main.ts, so this has no effect today.
- The chain-level M6 unit test (`price-chain.test.ts:132`) passes on the round-1 source too, because `createPriceChain` with no options already defaulted to 5 min. The market-level test at `:211` is the one that guards the fix, and it does go red.
