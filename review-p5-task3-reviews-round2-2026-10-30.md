# Review: Plan 5 Task 3 (reviews API), round 2

- Branch `wip/third-p5-reviews-api` @ 6a14904 (claude3). Base for the diff: 558ff2b (round 1). Round 1: `~/x2f-comms/review-p5-task3-reviews-2026-10-30.md`.
- Reviewer: read-only helper, 2026-10-30. Worktree `~/x2f-worktrees/rv-p5t3r2` (detached, removed after).

## Verdict: APPROVED (3 Minors, none blocks the merge)

Every round-1 item is fixed as asked. I found no new reveal leak, and the trigger allows nothing beyond the coarsening.

## Tests (worktree at 6a14904, npm ci, each run under `flock ~/x2f-comms/check.lock`)
- `tsc -p apps/api --noEmit`: OK. `tsc -p apps/web --noEmit`: OK.
- `vitest --project @x2f/api` reviews, reviews-gate, reviews-tripwire, offers, take, schema: 6 files, **172 passed**.
- `vitest --project @x2f/reputation`: 3 files, **97 passed**.
- `vitest --project @x2f/web` myOffers: **11 passed**.

## Round-1 items
- **M1, fixed.** `apps/api/src/reviews/store.ts:107` anchors on `reviews[viewer]?.reviewable_since ?? live` and no longer reads the other side's row. Both the GET (routes.ts:92) and the POST late check (routes.ts:123) pass `side`. Test: the seller rates, the trade is escalated, and the buyer's view matches the no-review control, also after +8 d. The buyer's POST is refused with `not-reviewable`.
- **M3, fixed.** `MyOffer.hidden` now has `'review-pending'` (offers/routes.ts:84, :588-594), ordered paused > hold > review-pending > method-unavailable. It comes from the same `hasPendingReview` and the same clock as the gate. The web copy is marked COPY-UNSIGNED (cantDoCodes.ts:290).
- **M4, fixed.** See "Cutoff, fresh vs upgraded" below.
- **M5, noted** in coordination.md.
- **I2, fixed.** `detachReviews` (store.ts:144-170) coarsens both times in the one detach UPDATE: `created_at` is truncated down; `reviewable_since` is truncated down once its +7 d deadline has passed, and otherwise rounded up, so the reveal is never brought forward. `REVIEW_DETACH_GRANULARITY = 'month'` is marked PENDING OWNER (item 27).

## Attack: is `reviews_final` too permissive? No.
`301_reviews.sql:96-112`. As x2f_purge:
- The jsonb compare drops only `trade_code`, `reviewer_id`, `created_at` and `reviewable_since`. Every other column, including any added later, must stay as it was.
- Both nulls are required, on a row that is not yet detached (`old.trade_code is not null`). So a detached row can never be coarsened or moved again, and coarsening without the detach is refused.
- Both times must match the same unit `u`, exactly: `created_at` equals `trunc(u, old)`. `reviewable_since` equals `trunc(u, old)` only when the deadline has passed. Before the deadline it must be either the old value (already on a unit boundary) or `trunc + 1 u`, and that is never earlier than the old value. So x2f_purge can neither move a time to an arbitrary value nor bring a reveal forward. The worst it can do is delay a not-yet-due reveal by up to one unit, which is the intended round-up.
- `now()` is the transaction start in both the trigger and `detachReviews`, so the two cannot disagree within one purge transaction.
- No check constraint ties `created_at` to `reviewable_since`, so a round-up that leaves `created_at < reviewable_since` cannot make the purge fail.
- The column grant is widened only to the two time columns (`:135`). Every other role is still refused.
- Not new (also true in round 1): x2f_purge could detach a review whose trade still exists, and the unique `(trade_code, reviewer_role)` would then allow a second review. x2f_purge is only used by the trade purge, so I accept this.

## Cutoff: fresh install vs upgraded (`301_reviews.sql:141`, `gate.ts:34`)
- **Fresh install:** 102 inserts the only `site_flags` row (`id boolean primary key check (id)`, so there is at most one row). 301 runs after it and sets `reviews_since` to the migration time. No trades exist yet, so every real trade counts. Correct.
- **Upgraded:** `add column ... default now()` with a stable default is evaluated once and stored for the existing row, so the cutoff is the deploy transaction's time. Trades released earlier are still reviewable but never gate, and they are not listed in `/v1/reviews/pending` (helper's own call; see OWNER CHOICE below). A pre-deploy release whose dispute closes after the deploy gets a new `since` and does gate. That is correct, because it became reviewable after reviews existed.
- The tests' template sets `-infinity`, and reviews-gate sets its own cutoff to test the boundary (1 ms before: no gate; at the cutoff: it gates).
- One edge case fails open; see m1.

## Attack: new reveal leaks? None found.
- **The viewer has not rated.** `submitted[viewer]` is null, so `revealAt` is always `anchor + 7 d` with anchor = live. That is the same as the no-review control in every state: released, escalated (null), and final → closed (live moves later).
- **The viewer has rated, and the dispute moves `live` later (S1 < S2).** The viewer's anchor stays at S1, so after S1+7 d the viewer sees the counterparty's review as soon as it is posted. The viewer has already rated, so this opens no revenge path. The counterparty's own anchor and late check use S2, so they still cannot see the viewer's review before S2+7 d unless both have rated. The gate's `stillOpen` also uses live, which is consistent.
- **My offers `review-pending`:** it is shown only to the poster about themselves.
- **`/v1/reviews/pending` cutoff:** it only hides old trades and leaks nothing.

## Minor

**m1. If the `site_flags` row is missing, the review gate fails open, while every other `site_flags` reader fails closed.** `apps/api/src/reviews/gate.ts:34`.
`s.since >= (select f.reviews_since from site_flags f)` is NULL when there is no row, so `pendingReviewSql` is false everywhere: take, wallet and the offer filters.
- The codebase's rule is that "no site_flags row fails closed" (take.ts:257, offers/routes.ts:160, :328, :576, cancelReturn.ts:60). A missing row already blocks all trading through those readers, so the practical effect is small.
- Fix (one line): `coalesce((select f.reviews_since from site_flags f), '-infinity')`.

**m2. The trigger hard-codes the 7-day deadline; the app reads `REVEAL_AFTER_DAYS`.** `301_reviews.sql:104` (`interval '7 days'`) vs `store.ts` (`make_interval(days => REVEAL_AFTER_DAYS)`).
If the constant changes, say to 10, then for a row between +7 d and +10 d `detachReviews` rounds up but the trigger expects a round-down. It raises `reviews are final`, the purge transaction rolls back, and the trade is never purged: a privacy failure that nothing reports.
- The only guard is `expect(REVEAL_AFTER_DAYS).toBe(7)` (packages/reputation/test/reviews.test.ts:130), which does not mention the trigger.
- Fix: add a message to that assertion, or a small api test that reads 301's text and checks it contains `interval '${REVEAL_AFTER_DAYS} days'`.

**m3. The trigger allows any of day, week or month, not only the configured unit.** `301_reviews.sql:100`.
A future purge path that passes `'day'` while the owner has chosen month would pass the database check silently.
- The app path is pinned by the test "detach coarsens both times to REVIEW_DETACH_GRANULARITY". This is acceptable while the unit is PENDING OWNER.
- Once the owner decides, consider narrowing the trigger's array to that unit, or to that unit and coarser ones.

## OWNER CHOICE (not bugs; kept as built, per the lead)
- I1: weight = exact USD cents in linear mode (owner item 26).
- M2: offers reappearing when the poster rates (item 28).
- `offer-busy` for a poster who owes a review.
- `ruled` disputes are not reviewable.
- REVIEW_DETACH_GRANULARITY day, week or month (item 27).
- **New, helper's call:** pre-cutoff trades are not listed in `/v1/reviews/pending`. Traders are not prompted to rate their last pre-deploy trades; they can still rate them from the trade page. I recommend accepting this; it only matters if 301 reaches a database with real trades.
