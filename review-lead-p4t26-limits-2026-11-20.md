# Review: wip/lead-p4t26-limits at bd311f60 (Plan 4 Task 26, recommended account limits)

Reviewer: independent code and security review helper, 20 Nov 2026 (BC time), against origin/main 54104057.
Scope: migration 760, apps/api/src/staff/limits.ts, the `account-limit` tap kind (packages/staff intent.ts, apps/api keyTap.ts), `tradeCap` (apps/api/src/traders/stage.ts), the take refusal (409 `account-limit`), the ModCase "Recommend limits" card and the LimitRecommendations page.

## Verdict

APPROVE WITH CHANGES. No blockers. The core security properties hold: the recommender can never decide their own recommendation, the tap binds the exact decision, a limit can never raise a cap, and the reason stays out of the log and away from the trader. Two M findings need a lead or owner call before landing: M1 (the poster's hidden limit can be found by probing take amounts) and M2 (the decider becomes "involved in round 1" of the case). One test gap (m1) let a mutation survive and should be closed. Not yet run: the branch head's full `npm run check`, which reviewers must run before a plain APPROVED (13 Nov rule). Only targeted suites ran here, so this verdict holds only once that full check is green.

## What I checked, and why it holds

- **Self-decision.** `decide` refuses with 409 `same-person` when `recommended_by === me.id` (limits.ts:191), checked after the row is locked `for update` (limits.ts:185). Migration 760 also has `check (decided_by is null or decided_by <> recommended_by)` (760:24). The check is on the account id, so these all fail: another session of the same account, a moderator promoted to senior after recommending, the owner deciding the owner's own recommendation. A race between two deciders serialises on the row lock, and the second gets `wrong-state`. Two recommends at once serialise on `accounts ... for update` (limits.ts:93), with the partial unique index `limit_recommendations_one_pending` behind that. One case code can't stop: one person with two staff accounts. That is an invite-process matter.
- **Tap binding.** The route builds the intent from the locked database row: `{recId, accountId, approve, capUsd, stage}` (limits.ts:192). `consumeKeyTap` compares it canonically with the stored tap intent, and also checks: the tap belongs to the decider, it is unused (`used_at is null`), it is finished, it is within the 2-minute TTL, it is from the same session, and its key is still registered (keyTap.ts:269-283). Ids are lower-cased on both sides. Replay, another recommendation, another account, another cap or stage, approve versus decline, and expiry all fail. The tap is consumed inside the decision transaction, so a refused decision (404, `wrong-state`, `same-person`) rolls back and leaves the tap unused. `tapPermOf('account-limit') = 'rulings.approve'` (keyTap.ts:520), so a moderator can't even start the tap.
- **Permissions.** Recommending takes `disputes.handle` (owner, senior, mod; not helper). Listing and deciding take `rulings.approve` (owner, senior). The matrix rows for all 4 routes are in apps/api/test/staff/routes.ts:126-130, and matrix.test passes. The case route uses the existing `mayWork` (the assignee, or a senior or the owner; never someone involved in round 1 of an appeal), so others get 403 `forbidden-case`.
- **tradeCap.** The new cap is the lower of `min(cap_usd)` over active limits and the stage's own cap (`byLimit` only when the limit is strictly lower, stage.ts:166-168). The stage is `lowerStage(earned, limit_stage)` (stage.ts:164). Neither can raise anything. The take locks both accounts `for update` and calls `tradeCap` inside the take transaction (take.ts:311, 390), for both taker and poster.
- **Leaks.** The log details are `{recId, accountId, capUsd|stage}` and `{recId, approved}`. The reason is never in them, and a test asserts it. The trader's own refusal carries `capUsdCents` only. The other side's refusal is `starter-limit` with no details (take.ts:249). The trader web copy ("This trade is above a trading limit right now") names nothing.
- **Migration.** Each CHECK is fully parenthesised, so Postgres's `IS` and `=` precedence doesn't matter. The checks hold: exactly one of cap and stage; pending if and only if `decided_by` and `decided_at` are null; decider is not the recommender; cap between 1 and 1,000,000; reason 40 to 2000 characters. The API trims before counting, and a trimmed reason of 40 or more characters implies a raw one of 40 or more, so the API and the database agree.

## Findings

### B (blockers)

None.

### M (major)

**M1. The poster's account limit can be found by probing take amounts, against the lead default that a limit is "never shown to anyone else".** apps/api/src/trades/take.ts:249, together with the comment at take.ts:228-233 and apps/api/src/staff/limits.ts:38-39.
The poster-side `starter-limit {}` refusal was safe before Task 26 because "their stage is public on the card". Now a Graduated poster (no New badge; summary.ts still shows the earned stage) with a $100 cap, or a stage limit, also refuses with `starter-limit {}`. A taker who sees that refusal on a Graduated card learns the poster has an account limit. By bisecting take amounts, the taker learns the exact cap. A stage limit's open-trade count shows up the same way as `offer-busy`, which is generic and fine.
Recommendation (owner or lead question, since it changes what traders see): either accept and document it, or have the offer feed treat an account limit as the offer's own maximum (clamp, or unlist the bands above it) so takers never hit it. Engineering can do either once the behaviour is chosen.

**M2. The decider becomes "involved in round 1" of the case the recommendation came from.** apps/api/src/staff/limits.ts:202 (`tradeCode: r.from_code` on `limits.decided`), together with apps/api/src/disputes/routes.ts:381-389 and packages/staff/src/appealReviewers.ts:28-38.
`involvedIn` counts every staff log entry on the trade code before `appeal.opened`. So a senior moderator who only decided the limits, and never worked the case, is struck from that case's appeal reviewers. Task 24 has no fallback, so the pool can shrink until the appeal waits for the owner. The same happens to a senior who recommends from a case they did not otherwise work (limits.ts:103), which matches how other case actions count.
Whether deciding a party's limits is "involvement" is a rule call. Recommendation (lead or owner question): log `limits.decided` with `tradeCode: null` and carry `fromCode` in the detail, unless the owner wants deciders excluded from appeals.

### m (minor)

**m1. Test gap: no test that a stage limit can't raise a stage.** apps/api/test/staff/limits.test.ts:159.
The mutation `const stage = r.limit_stage ?? earned` (dropping `lowerStage`, stage.ts:164) passed all of limits.test.ts and take.test.ts (96 of 96). The only stage-limit tests hold a Graduated account to Starter. Add a test: a Starter account with an approved `building` stage limit stays `starter`, with a cap of $200 and at most 3 open trades.

**m2. Test gap: the tap test never uses a tap made for another recommendation or another account.** apps/api/test/staff/limits.test.ts:181-195.
Binding holds by construction (canonical compare of the whole intent), but the test only varies approve, cap and stage. Add a tap for recommendation B consumed on recommendation A, and a tap naming another account id.

**m3. The case route's `forbidden-case` can be bypassed through the account route.** apps/api/src/staff/limits.ts:112-116 versus 118-133.
A moderator who may not work a case (for example, involved in round 1 of an appeal) can still recommend limits for either party through `POST /staff/v1/accounts/:id/limit-recommendations`, given the account id. This matches the plan's interface, and a senior moderator still decides. Confirm that is intended. If not, require `from_code`, or require `disputes.handle` plus a case the caller may work.

**m4. `decide` doesn't lock the account row, unlike `recommend` (limits.ts:93) and take (take.ts:311).** apps/api/src/staff/limits.ts:183-201.
A take already past its `tradeCap` read can commit a trade above a limit approved a moment later. Effectively the take came first, so this is benign. Adding `select id from accounts where id = $1 for update` before the insert makes the ordering strict and consistent with the hold pattern.

**m5. The "Opens at" hint ignores account limits.** apps/api/src/offers/routes.ts:850.
`opensAt(settings, cap.stage, usd)` uses only the stage. With a cap limit, cards above the limit show no hint, and the take then refuses with `account-limit`. With a stage limit, cards say "Opens at Building/Graduated", which is not true while the limit holds. Lead or owner question on the words. The engineering fix is to skip or adjust the hint when `cap.byLimit` or a stage limit applies.

**m6. Migration 760 doesn't tie `account_limits` to its recommendation.** apps/api/migrations/760_account_limits.sql:30-40.
Nothing in the database forces `account_limits.account_id`, `cap_usd` and `stage` to match the approved recommendation, or forces the recommendation to be `approved`. A decided row can also be rewritten later (application-only "decided once"). Suggest:
- a unique key on `limit_recommendations (id, account_id)`;
- a composite foreign key `(recommendation_id, account_id)` from `account_limits` to it;
- optionally, a trigger refusing updates once `status <> 'pending'`.

`from_code` has no foreign key to `trades(code)`.

**m7. GET /staff/v1/limit-recommendations runs `tradeCap` once per row, and each call reloads the starter settings.** apps/api/src/staff/limits.ts:153.
That is up to 400 queries for 200 rows. Load the settings once and pass them as the fourth argument.

## Guard reverts (each restored afterwards; the worktree is clean)

1. Removed the `same-person` check (limits.ts:191). Result: limits.test "the recommender cannot decide, even as a senior moderator" FAILED. It received `internal`: the migration's CHECK still refused the write and the tap rolled back.
2. Removed `mayWork` / `forbidden-case` on the case route (limits.ts:126). Result: "a moderator not on the case cannot; a bad side is 400" FAILED.
3. Let a limit raise the cap: `capUsdCents: limitCap ?? stageCap` (stage.ts:168). Result: "a cap above the stage cap changes nothing" FAILED.
4. Bound the tap to `approve: true` always (limits.ts:192). Result: "a declined recommendation sets nothing" and the listing test FAILED.
5. Named the poster's limit to the taker (`if (c.byLimit)`, take.ts:248). Result: take.test "a stage limit holds the taker ... the poster's limit refuses without naming it" FAILED.
6. Let a stage limit raise the stage (`limit_stage ?? earned`, stage.ts:164). Result: SURVIVED. All 96 tests passed. This is m1.

## Tests run on bd311f60

Targeted vitest runs, outside the lock with `nice -n 10`:
- @x2f/api, 4 files (staff/limits.test.ts, take.test.ts, staff/keyTap.test.ts, staff/matrix.test.ts): 284 of 284 passed.
- @x2f/staff packages/staff/test/intent.test.ts: 24 of 24 passed.
- @x2f/staff-web apps/staff-web/test/limits.test.tsx: 6 of 6 passed.
- @x2f/web apps/web/test/quote.test.ts: 33 of 33 passed.

Playwright, under the lock, run once: `npx playwright test -c apps/staff-web/e2e/playwright.config.ts limits.spec.ts`. Result: 2 of 2 passed (exit 0). This is the first green run the builder has seen of its fix (bd311f60). Log: scratchpad/logs/rev-p4t26-e2e-153644.log

Not run: the branch head's full `npm run check`. The 13 Nov reviewer rule needs it before a plain APPROVED.

## Owner or lead questions

- M1: should takers be able to infer a poster's hidden account limit? The recommendation is to clamp or unlist offer bands above the poster's limit.
- M2: does deciding limits make a senior "involved" for that case's appeal? The recommendation is no: log the decision without a trade code.
- m3: may a moderator struck from a case recommend limits for its parties through the account route?
- m5: what should the offer list show a trader held by an account limit?

---

## Addendum: re-review at 3685029f (one commit on bd311f60), 20 Nov 2026 10:09 BC time

**Verdict: NOT APPROVED.** There is one new blocker, B1: the M1 clamp's shown maximum fails the take whenever the offer's rate is below the market. M2, m1-m4, m6 and m7 are fixed and verified. m5 is fixed.

### B1. The clamped maximum fails the take at any margin below market (apps/api/src/offers/routes.ts:493-509, 540)

`capInCurrency` converts the poster's US-cent cap to the card currency at the market, and `clampTiers` caps each band's fiat at that value. For an XMR band it caps the XMR amount at `atomicForFiat(capFiat, rate)`.

The take counts the trade differently. `usdValue` (take.ts:175-180) takes the larger of two figures: the USD of the fiat total, and the USD of the XMR **at the market price**. When the card's rate is below the market (a negative margin), the XMR at the clamped maximum is worth more than the cap at market. The take then refuses with `starter-limit {}`, the refusal the clamp was meant to make unreachable. Buy ads below market are common, so this is not an edge case.

I proved it with a temporary probe, since removed. A Graduated poster held to a $300 limit posts a sell ad in USD; the market is $330. I listed the offer as another trader, then took exactly the shown maximum at the card's rate:

| Margin | Fiat band | XMR band |
|---|---|---|
| -5% (card max $300.00, rate $313.50) | take 409 `starter-limit` | take 409 `starter-limit` (0.9569 XMR) |
| 0 | take 200 | take 200 |
| +5% | take 200 | take 200 |

The fix is engineering, not a product choice: compute the clamp by the take's own rule. Reuse `usdValue` and the bisection in the launch-cap growth-ceiling helper (take.ts:182-216), or clamp fiat to `min(capFiat, floor(capFiat × rate / market))` and the XMR amount to `min(atomicForFiat(capFiat, rate), atomicForFiat(capFiat, market))`. Add the negative-margin case to the offers or take test, for both a fiat band and an XMR band.

A price move between listing and taking can still refuse a shown maximum. The launch cap already shares that, so it is acceptable; a comment should say so.

### m8 (new). The clamp shows a limit that doesn't bind (routes.ts:513-522)

`limitedPosters` clamps any poster with an active `account_limits` row to `tradeCap().capUsdCents`, even when the limit doesn't lower anything. Two examples:
- a Starter poster with a $5,000 cap limit, or a `building` stage limit;
- a Building poster with a $1,500 limit.

Each is clamped to its stage cap ($200 or $1,000). A plain Starter or Building poster is not clamped (the test only covers Graduated). Takers can compare the two and tell that a limit exists.

Fix: clamp only when the limit actually binds, that is, `byLimit` is true or the limited stage is below the earned stage. That needs `tradeCap` to expose the earned stage, or a comparison of the limited cap against `capUsdCents(s, earned)`.

### Your checks

- **M1, list, detail and amount search.** The list drops a card with no band left. The detail (`GET /v1/offers/:id`) gives 404 to anyone but the poster, and the poster sees the offer as posted; tests cover both. An `amount` search above the cap drops the card (`amount` is fiat minor units, compared with `capFiat`). The search shares B1, because at a negative margin it lists amounts the take refuses. The method-summary counts are unclamped: an offer wholly above the limit is still counted, though not listed. That is minor; a count that doesn't match the list could hint at a limit.
- **M2.** Both log entries now have `tradeCode: null` and `fromCode` in the detail (limits.ts:106, 213). Nothing outside apps/api/src/staff reads `limit_recommendations`, `account_limits.recommendation_id` or the case code. The trader's refusal carries the cap only, and the trader's account page shows only its own stage. No case code reaches the trader. Deciding or recommending no longer counts as involvement in round 1.
- **m3.** The account-id route now needs `rulings.approve`. The matrix row is updated, and matrix.test passes.
- **m4.** `decide` locks `accounts` first, then the recommendation row. The take locks both accounts in id order and never touches `limit_recommendations`. Neither `recommend` nor `decide` locks trades, offers or `site_flags`. Decide holds one account lock and one recommendation lock, and nothing that holds the recommendation waits on an account. So there is no cycle, and a decision and a take on one account run one after the other. A decide with a wrong account id in the URL locks that account, then gets 404; no cycle either.
- **m6.** I attacked the triggers and the composite foreign key with direct SQL in a temporary probe, since removed.
  - Refused:
    - a limit for a pending recommendation;
    - a limit with a higher cap than the recommendation;
    - a limit naming another account (the trigger refuses first; the composite foreign key backs it);
    - a limit whose `set_by` is not the decider;
    - raising a limit's cap;
    - moving a limit to another account;
    - editing a decided recommendation's cap;
    - flipping a decided recommendation back to pending;
    - deleting a decided recommendation that has a limit (the foreign key refuses).
  - Still possible to any database writer, as expected for app-enforced steps (no change needed; noted for the lead):
    - `pending` to `approved` without a tap;
    - inserting a recommendation already `approved`;
    - setting `account_limits.until` in the past;
    - deleting an `account_limits` row.

  The last two are lifting a limit, which still has no route (an open owner question). A delete or update trigger on `account_limits` would make lifting explicit, but the owner should decide that along with the lift route.
- **m1, m2, m7.** The new tests are in place. Reverting `lowerStage` now fails "a stage limit never raises a stage".

### Guard reverts on 3685029f (each restored afterwards)

1. `lowerStage` removed: caught by limits.test.
2. The clamp switched off (`if (false && posterCapUsdCents !== null)`): caught by the offers.test M1 test.
3. The decided-recommendation trigger switched off (`if false`): caught by limits.test "a decided recommendation cannot change".

B1 itself is not caught: no test uses a negative margin.

### Tests on 3685029f

Targeted vitest runs, outside the lock with `nice -n 10`:
- @x2f/api, 6 files (staff/limits, take, staff/keyTap, staff/matrix, offers, schema): 408 of 408 passed.
- @x2f/staff intent.test: 24 of 24 passed.
- @x2f/staff-web limits.test.tsx: 6 of 6 passed.
- @x2f/web quote.test: 33 of 33 passed.

Not run: Playwright and the full `npm run check`. Both are still needed before APPROVED; run them once B1 and m8 are fixed.

---

## Addendum 2: round 3 at 01a5ae14 (one commit on 3685029f), 20 Nov 2026, BC time

**Verdict: APPROVE (code).** B1 and m8 are fixed, and so are the method counts. The refactor leaves the take and the launch cap unchanged for unlimited accounts. Two minor points need no action before landing. One condition stands from the 13 Nov rule: the head's full `npm run check`, and the Playwright suites that cover offers and limits, must run under the lock before landing. I have not run them in this round.

### The refactor against main (take and launch cap)

Against 54104057, `git diff -- apps/api/src/trades/take.ts apps/api/src/trades/launchCap.ts` shows only these code changes:
- the `capValue.js` import;
- `usdValue` moved into trades/capValue.ts, byte for byte;
- the `growthCeiling` bisection replaced by `largestAtomicWithin(currency, q, rate, LAUNCH_TRADE_CAP_USD_CENTS, a.amountAtomic)`;
- the round-1 `account-limit` line.

launchCap.ts is unchanged. The shared bisection is the old loop, given the same start point (`lo = amountAtomic`, `hi = 2 × lo`). It differs only when `from` is 0, which the take never passes (amounts are positive). So the take's USD value, its starter and account cap checks, the launch cap and the growth ceiling behave as on main.

In the offer list, unlimited posters still get `priceFor` on their tiers as posted (it now runs after the clamp, which is a no-op for them). The per-method counts and best rates come from the same tiers and rates. The query is now grouped per offer and then aggregated: the count is still the number of distinct offers per method, and the lowest and highest rates are unchanged.

### B1: fixed

`clampTiers` now values a trade by the take's own rule. It uses each band's own `tierRate`, the function `lockRate` also uses, and the shared `usdValue`/`largestAtomicWithin`. For a fiat band, the top is `largestTotalWithin(rate, lo)`: the largest total whose `atomicForFiat` amount is at most `lo`, which I checked algebraically.

My round-2 HTTP probe (fiat and XMR bands at -5%, 0 and +5%, taking exactly the listed maximum) now passes 6 of 6. The branch's own B1 tests also refuse one cent or one atomic unit past the maximum.

### Edge-case property probe (temporary unit test, since deleted)

The probe called `clampTiers` directly. Each case was a combination of one market, margin, method adjustment, cap and band unit:

- **Markets:**
  - USD at $330;
  - JPY, KRW and VND (no minor unit; VND at 838,000,000,000 per XMR);
  - KWD (three decimals);
  - EUR at 1 and 7 minor units per XMR against USD at 1 and 3 cents (tiny prices);
  - USD at 999,999,999,999 cents per XMR;
  - EUR at 0.9 of USD.
- **Margins:** -50%, -5%, -0.01%, 0, +0.01%, +5% and +50%.
- **Method adjustments:** 0, -0.37% and +2.5%.
- **Caps:** 1 cent, $1, $123.45, $300 and $5,000.
- **Band units:** fiat and XMR.

Margin and adjustment pairs that `rateFor` rejects were skipped; the take rejects them the same way.

Every case passed (more than 500):
- the top always takes by the take's rule;
- for a fiat band, the total at the locked rate never exceeds the top (so the range check passes);
- top + 1 never takes (the clamp is tight);
- for an XMR band, the top equals the bisection.

Band edges also hold: a band whose minimum equals the top is kept at exactly the top, one above it is dropped, and a band wholly below the cap is untouched.

### m8 and the method counts: fixed

`limitBinds = byLimit || stage !== earned` is the right test. A Starter poster with a $5,000 cap limit or a `building` stage limit now lists exactly like a plain Starter, and a test asserts it. The method counts leave out an offer the limit unlists, and its test covers that.

### Minor points (no action needed before landing)

- **m9. Best rate from a dropped band.** In `liveOfferStats` (routes.ts:873-915), a limited poster's per-offer best rate still comes from all of that method's bands, including ones the clamp dropped. The best rate a method shows can then belong to a band the viewer will not see listed. This is rare: it needs a multi-band offer, a binding limit, and the dropped band being the best-priced one.
- **m10. A survived mutation in `largestTotalWithin`.** Dropping its `- 1n` (capValue.ts:46) survived take.test. It changes the result only when `(maxAtomic + 1) × rate` is an exact multiple of 10^12. The shipped code is correct; a one-line unit test with such a case would pin it.

### Guard reverts on 01a5ae14 (each restored afterwards)

1. Counting no XMR at market inside `largestAtomicWithin`: caught (the -5% B1 test and the launch-cap growth test).
2. `limitBinds: true` always: caught (the m8 test).
3. Not filtering the method counts: caught (the counts test).
4. Dropping `- 1n` in `largestTotalWithin`: survived. This is m10.

### Tests on 01a5ae14

Targeted vitest runs, outside the lock with `nice -n 10`:
- @x2f/api, 9 files (staff/limits, take, staff/keyTap, staff/matrix, offers, schema, methods, offerUnits, flexOffers): 496 of 496 passed.
- @x2f/staff intent.test: 24 of 24 passed.
- @x2f/staff-web limits.test.tsx: 6 of 6 passed.
- @x2f/web quote.test: 33 of 33 passed.
- `tsc -p apps/api --noEmit`: clean.

Not run: the full `npm run check` and Playwright. Both are needed under the lock before landing (13 Nov rule).
