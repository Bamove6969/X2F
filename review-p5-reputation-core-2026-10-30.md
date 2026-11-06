# Review: Plan 5 Tasks 1–2, `@x2f/reputation` (wip/third-p5-reputation-core @c259cd4), 2026-10-30

Reviewer: lead reviewer (helper), read only. Scope: `git diff origin/claude/compassionate-johnson-k95ssr...origin/wip/third-p5-reputation-core` (1b4da64 scaffold, d96da64 Task 1, 93345ff Task 2, c259cd4 merge of main d48033f): `packages/reputation/{package.json,tsconfig.json,src/{index,reviews,stats,badges}.ts,test/*}` and the lockfile link. Checked against Plan 5 Tasks 1–2, P5-A1..A33, Revisions 2026-10-29 (Tasks 19, 20; R38), 2026-10-29b, 2026-10-29c, spec 5.1–5.5, R38, and `COMPLETED_TRADES_SQL` (apps/api/src/traders/stage.ts:110).

Runs (detached worktree ~/x2f-worktrees/rv-rep at c259cd4, under `check.lock`, one at a time):
- `npx vitest run --project @x2f/reputation`: 3 files, **87 passed**.
- `npx tsc --noEmit -p packages/reputation`: **clean**.
- A throw-away probe test (deleted) for the control-character, leap-day and stale-level cases below.

## Verdict: APPROVED WITH MINOR

No Critical or Important findings. The maths follows the plan exactly and is integer throughout: weights are `bigint`, % positive is `(pos*100n)/total` (floor, `total ≥ floor weight > 0` whenever `n > 0`, so no division by zero; steps mode weighs ≥ 1n), cancel rate is integer floor capped at 100, median floors the mean of the middle two, `actionMinutes` floors and clamps at 0. No clock reads, no randomness, no I/O; every function is pure and does not mutate its inputs (tested for `median`, `pushActionMinutes`, `applyChoice`). `isCompletedTrade` matches `COMPLETED_TRADES_SQL` and R38 exactly (released, or refunded with a dispute; a lost dispute still counts; tested in `badges.test.ts:123` as well). `revealAt` is the later submission capped at `reviewableSince + 7 d`, which is what spec 5.3 says ("until both are submitted, or 7 days pass"), and the cap case is tested. Review disputes follow 2026-10-29b (`open`/`removed` out of the numbers, `stands`/`comments-removed` in). No volume badge, and the test greps labels and meanings. The past-reputation property test (300 seeded LCG cases) shows past reputation never changes any X2F badge. The package wiring matches the sibling packages (`@x2f/trade`): same `tsconfig.json`, `typecheck` script picked up by the root workspace typecheck, vitest project from the `packages/*` glob, lockfile link entries only, no dependencies.

The Minor items below are worth doing before Task 3/5 build on the package (M1 and M2 shape what Tasks 5 and 20 store).

## Minor

**M1. `positivePct` takes the raw take-time USD value, which pushes Task 20 to keep the exact trade amount on every permanent, anonymous review.**
Where: `packages/reputation/src/stats.ts:2-3` (header says the inputs are "review kind and weight"), `stats.ts:52-57` (`WeightedReview.usdCents`), `stats.ts:42-50`.
Scenario: Task 3 stores `reviews.usd_cents` (plan line 266) and Revision 2026-10-29 makes reviews permanent with no trade link. After the 30-day purge every public-but-anonymous review still sits next to its exact USD value, its month, its method and its subject; anyone with a DB copy (or a future bug that returns the column) can match reviews to trades and sum a trader's volume, against spec 5.4 "no volume stats" and 2026-10-29b "nothing on a review can link it to whoever left it". It also makes `WEIGHT_MODE` hard to switch later (steps mode needs the raw value; a stored step weight fed back through `reviewWeight(…, 'steps')` gives 1 for 2n). The header comment and the API disagree about which one is kept.
Fix: let `WeightedReview` carry a precomputed `weight: bigint` (from `reviewWeight` at review time) and have `positivePct` sum it, so Task 3/20 store only the weight, not `usd_cents`; fix the header comment either way. Flag to the lead: whether the stored column is the weight or the amount is a Task 3/20 decision tied to owner question 15 (P5-A32); in linear mode the weight is still the amount for $10–$1,000 trades, so the steps option also shrinks what is kept forever.

**M2. A stale `featured` level can come back without the trader choosing it, and the saved level can disagree with what is shown.**
Where: `badges.ts:166-169` (`others` promotes any earned badge whose saved level is `featured`), `badges.ts:196-216` (`applyChoice` leaves `featured` levels on badges it did not put in `order`).
Scenario (probe): earned Trusted, Fast, PGP; feature Trusted (saved: Trusted, Fast featured). Trusted is lost; the trader features PGP (order Fast, PGP; Trusted's level still `featured`). Trusted is re-earned: it shows in More while `GET /v1/account/badges` would report its level as `featured` (the level Task 5 reads from `levels`). The trader then sets PGP to On hover, and Trusted jumps into Featured on its own, which P5-A15 says does not happen ("nothing is promoted automatically"). The same happens with a bad row (`badges.test.ts:196` covers only the cut, not the later promotion).
Fix: in `applyChoice`, after computing `order`, set every other `levels[b] === 'featured'` that is not in `order` to `'hover'`; in `resolveVisibility` (chosen) use only `prefs.order` (drop `others`), so the order is the single source. Export a small `levelShown(earned, prefs, id)` (or return a `hidden` list from `resolveVisibility`) so Task 5's `earned[].level` cannot disagree with the lists. Add a test for the sequence above.

**M3. The note check lets other control and direction characters through.**
Where: `reviews.ts:58` (`LINE_BREAK = /[\r\n  \u0085]/`).
Scenario: a note with `\u000B` (vertical tab) or `\u000C` (form feed) breaks the line in some renderers and in a plain-text portable record (Task 12); `‮` (right-to-left override) or `⁦`–`⁩` let a reviewer flip the visible order of a public note ("…dlrow" spoofing), and NUL/C0 controls pass too. All of these pass `validateReview` today.
Fix: refuse `/[\p{Cc}  ‪-‮⁦-⁩]/u` (C0/C1 controls, line and paragraph separators, bidi embeddings and isolates) with `note-multiline` or a new `note-bad-character`; consider NFC-normalising before the length check. Add them to the `reviews.test.ts:79` loop.

**M4. Trusted can rest on a single review.**
Where: `badges.ts:101`, `stats.ts:33` (`PCT_MIN_REVIEWS = 0`).
Scenario: 100 completed trades where 99 counterparties tapped Neutral (spec 5.1 makes Neutral the quick way through the gate) and one, possibly the trader's own second account, gave 5 stars: `positivePct = 100`, Trusted earned. As drafted per plan, so not a defect; but cheap to guard.
Fix (lead/owner call, next to P5-A32 option b and P5-A33): a `TRUSTED_MIN_RATED_REVIEWS` constant (for example 20 positive-or-negative reviews), or pass `minReviews` when computing the `positivePct` that feeds Trusted. Note for Task 19: an open dispute takes a negative review out of the numbers at once (2026-10-29b), so a trader can hold Trusted by disputing every negative review while the queue is slow; Task 19 should cap open disputes per subject or the lead should note the risk.

**M5. Small test gaps.**
- `fullYearsSince` (`badges.ts:79-85`): an account made on 29 Feb gets Veteran on 1 Mar in common years (probe: not on 2025-02-28, yes on 2025-03-01). Acceptable, but pin it with a test so nobody "fixes" it into an off-by-one.
- `cancelRatePct` and `pushActionMinutes`/`actionMinutes` take no guard against a negative `cancelledByMe`/`reachedFunding` (a negative count gives a negative %); one `RangeError` like `pushActionMinutes` has would match.
- `reviewWeight` of a negative or zero value weighs the floor (fine), untested.

## Notes (no change needed here)

- **"Disputes: N won, M lost"** (owner question 10, leaning yes; Revision 2026-10-29c): the package does not need it. `BadgeFacts` has `lostDisputes` only, and nothing here derives from won disputes. Adding `wonDisputes` later (Task 20's `won_disputes`, Task 5's `stats.disputesWon`) is additive and breaks nothing; `nextMilestones` takes a `Pick`, so it is unaffected. If Task 12 wants the copy in one place, a `disputesLine(won, lost)` (`"Disputes: 3 won, 1 lost"` / `"Disputes: none"`, `// COPY-UNSIGNED`) would fit here.
- **Blind reveal:** the package cannot leak on its own; it relies on callers passing only revealed reviews to `positivePct` and to `BadgeFacts.positivePct` (documented at `stats.ts:62` and `badges.ts:66`). Task 5's "byte-identical before and after" test is where that is enforced. A late review (after day 7) is revealed the moment it is stored; that is P5-A31, still open, with `assertLateReviewAllowed` ready for either owner answer.
- **Gaming by self-trades** (milestones, Fast, Trusted from a second account) is owner question 6 / P5-A33, default "count every trade", unchanged here.
- `TRADE_BADGES` (`reviews.ts:30`) is `// COPY-UNSIGNED` until the owner gives the list; good.
