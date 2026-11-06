# Review: Plan 5 Task 3 (reviews API, blind reveal, pending-review gate), first review

- Branch `wip/third-p5-reviews-api` @ 558ff2b (claude3), contains main 5c4d35b. Migration 301.
- Reviewer: read-only helper, 2026-10-30. Worktree `~/x2f-worktrees/rv-p5t3` (detached, removed after).

## Verdict: CHANGES REQUIRED

The routes, the gate and the blind reveal are sound for the normal flow: only the two parties can post, once each (row lock plus unique backstop); side and subject come from the trade row; unknown and foreign codes get the same 404; `theirs` stays null until both are in or the deadline passes, and `revealAt` does not change when only the counterparty has rated. No push or SSE is sent on a review. No route returns weight, USD value, ids or exact times, except `revealAt`, which is the counterparty's own submission time and only shown to the other party of that trade. The take, wallet and offer-list gate cannot be bypassed: take and wallet check it under the account lock, and every public offer reader (list, method counts, single read) filters on it. Migration 301 is additive and safe; its triggers do what they say, and x2f_purge exists (104) and is what Plan 7's `tradePurge.ts` runs as. Refusals: `review-pending` and the two late codes are in `CANT_DO_CODES`, and the form-input codes are in `NOT_REFUSAL_CODES`.

The blocker is what the **permanent** row keeps after the 30-day purge (I1, I2). Not counting the deliberately open owner questions, this is the only thing that needs work before merge.

## Tests run (worktree at 558ff2b, npm ci, all under `flock ~/x2f-comms/check.lock`)
- `tsc -p apps/api --noEmit`: OK. `tsc -p apps/web --noEmit`: OK.
- `vitest --project @x2f/api` reviews, reviews-gate, reviews-tripwire, offers, take, schema: 6 files, **166 passed**.
- `vitest --project @x2f/reputation`: 3 files, **97 passed**.
- `vitest --project @x2f/api` disputes* and wallet*: 2 files, 82 passed. `--project @x2f/web` cantDo*: 2 files, 20 passed.

## Important

**I1. `reviews.weight` is the trade's USD amount, kept forever (OWNER CHOICE).** `apps/api/migrations/301_reviews.sql:56`, `apps/api/src/reviews/routes.ts` (insert, `reviewWeight(row.usd_cents)`), `packages/reputation/src/stats.ts:45-53`.
With `WEIGHT_MODE = 'linear'`, `reviewWeight` is `clamp(usdCents, 1000, 100000)`. So for every trade between $10 and $1,000 the stored "weight" is the exact take-time USD value in cents, and above or below that range it is the bound. The row is permanent and survives the purge that removes `trades.usd_cents`. "Store a weight, never an amount" holds in name only: the amount can be read straight from the weight, with no need for public stats.
Failure scenario: a database seized or leaked a year from now still holds, for every account (`subject_id`), each trade's USD value next to the method, the role and the date (see I2). The purge was meant to remove exactly this.
Options (P5-A32 is still open with the owner, so this is not the reviewer's pick):
- (a) `WEIGHT_MODE = 'steps'`: P5-A32 option (a), 1/2/3, already built in `@x2f/reputation`.
- (b) Keep weighting by size but store a coarse bucket, for example a log2 bucket or the nearest $50, so the exact value is gone.
- (c) Keep it as built and say in the privacy text that reviews permanently keep each trade's USD size (up to $1,000).
Whichever is picked, it applies to new reviews only. Either decide before launch or add a tripwire so linear mode cannot ship silently.

**I2. Exact timestamps on permanent rows rebuild the trade ledger after the purge.** `301_reviews.sql:59-60` (`reviewable_since`, `created_at`), `apps/api/src/reviews/store.ts:144` (`detachReviews` nulls only `trade_code` and `reviewer_id`), and the `reviews_final` trigger, which allows nothing else.
`reviewable_since` is the trade's exact `closed_at` (the release time) to the microsecond, and `created_at` is the exact review time. After detach the row still holds subject, role, method, exact release time and (I1) amount. Revision 2026-10-29b says nothing may link a review to its trade once the trade is gone. An exact release time links it to any external record of that trade: the counterparty's bank statement time, an XMR chain tx time, a log.
Failure scenario: a seized DB after purge, plus one bank transfer time, gives the X2F account on the other side of that trade.
Fix (lead can choose the granularity): in `detachReviews`, coarsen both columns when the trade is purged, for example to the UTC month (public output only uses the month) or to the day, and allow exactly that in `reviews_final` for x2f_purge.
- Take care not to bring the reveal forward. A disputed trade is purged 90 days after the dispute button (R36), so its reveal deadline can still be in the future at purge time. Coarsen `reviewable_since` only once `reviewable_since + 7 d` has passed, otherwise round **up**.
- If Task 5's "latest 20" needs an order within a month, add an ordinal column that holds no time.
- Add a Task 20 test: after purge, no column holds a time finer than the chosen granularity.

## Minor

**M1. `revealAt` (and the early reveal) are anchored on the counterparty's stored row, which leaks that they have rated.** `apps/api/src/reviews/store.ts:98-106`, `routes.ts:91-99`.
The anchor is the earliest stored `reviewable_since`, else the live one. Live and stored can differ:
- A released trade later escalated by the system (late funds; `disputes/store.ts:7`, state `disputed`): live `since` becomes null.
- A dispute going `final` (anchor = `ruled_at`) and then `closed` (anchor = `closed_at`): live `since` moves later.
Failure scenario: A rates the released trade, then a late-funds escalation disputes it. B's `GET …/review` now answers `reviewable: false, revealAt: <date>`. With no review stored the same trade answers `revealAt: null`, so B learns A has rated. After the old deadline B also sees A's review while B still cannot rate. When the dispute ends, B rates having read A's review, which is the P5-A31 revenge path.
A review written before a later dispute also stays as written, although P5-A3 says a trade that ever had a dispute is rated only after it closes.
Fix: anchor on the viewer's own row, else the live `since`, never the counterparty's row. Or make the anchor set-once on the trade (a `trades.reviewable_since` written the first time it becomes reviewable). Add a test with a stored single review plus an escalation.

**M2. Offer reappearance tells the counterparty when the poster has rated.** `apps/api/src/offers/routes.ts:168` (P5-A4 filter).
A buyer who just traded with poster P can poll P's offers. They vanish at release and come back at the moment P submits their review (if P has no other pending trade). This leaks the existence and time of P's review, not its content. It is inherent to P5-A4.
OWNER CHOICE / accept: (a) accept, since content stays blind; (b) note it in the P5-A4 text. Recommend (a), recorded in coordination.md.

**M3. My offers does not say why the offers are hidden.** `apps/api/src/offers/routes.ts:84` (`MyOffer.hidden` union), `:588-603`.
Review M4's pattern gives `trading-paused` and `trading-hold` as reasons, but a poster with a pending review sees their offers as plain `live` while nobody else can see them.
Fix: add `'review-pending'` to `hidden`, from `hasPendingReview(deps.db, accountId, now)`, and to the web's My offers copy in Task 6.

**M4. No cutoff for trades released before 301.** `apps/api/src/reviews/gate.ts:42-50`.
On deploy, every past released trade becomes a pending review at once. Every trader with history is blocked from taking, from setting up, and from having their offers listed until they rate each one, and with `LATE_REVIEW = 'any'` that means one review per old trade. This only matters if 301 reaches a database with real trades. If so, gate only trades whose `closed_at` (or dispute end) is after the 301 deploy time, for example by checking a constant or a `site_flags` timestamp. Otherwise record "pre-launch, no cutoff needed".

**M5. Account delete (Plan 7 Task 18) vs. 301's foreign keys.** `301_reviews.sql:46-47`.
`reviewer_id` and `subject_id` reference `accounts(id)` with no `on delete`. Reviews by and about a deleted account must stay ("Deleted user"), so the `accounts` row must stay as a tombstone. Otherwise the delete fails on a live `reviewer_id`, or on `subject_id` for any review.
Note it for Plan 7 Task 18, in coordination.md. No change needed here.

## Checked, no finding
- Spam and forgery: participant check from the trade row; `for update` on the trade plus `unique (trade_code, reviewer_role)` plus a 23505 handler; a check that `reviewer_id <> subject_id`; after purge the trade is gone, so POST answers 404.
- Changing a review after reveal: the trigger refuses UPDATE, DELETE and TRUNCATE for every role. x2f_purge may only detach (the jsonb compare covers future columns) and DELETE.
- Error differences: 404 is the same for an unknown code and someone else's trade. `not-reviewable` and `review-exists` are about the caller only. Late codes fire only after the reveal. ETag: none is registered, and `cache-control: no-store` is on by default (`app.ts:202`).
- The gate's `'closed'` window (live `since + 7 d`) matches the reveal deadline except in the M1 drift case.
- `usd_cents` is set once by trigger, nullable, and goes with the trade. It is never returned (test greps the JSON).
- Purge interplay: Plan 7's `tradePurge.ts` (wip/lead-p7-retention) runs `set local role x2f_purge` before deleting, so `detachReviews` will work when it is called there. The `NEEDS_PLAN_7_DETACH_REVIEWS` tripwire covers the missing call. The `NEEDS_TASK_7_SENSITIVE_TEXT` stand-in is conservative.
- Migration numbering: 301 is unique across remote branches (302 feedback, 306 feedback form).
- Not flagged (open owner questions, kept as built): `offer-busy` on a take of a poster who owes a review; a dispute still `ruled` is not reviewable and blocks nothing.
