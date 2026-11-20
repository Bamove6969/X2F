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
