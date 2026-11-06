# Review: two claude3 branches ready to land (2026-11-02)

Reviewer: lead's review helper. Main line `origin/claude/compassionate-johnson-k95ssr` @ b6835eef.
Worktrees (detached, nothing committed/pushed): `~/x2f-worktrees/review-c3-reviews`, `~/x2f-worktrees/review-c3-feedback`.
Both trial merges with latest main are CLEAN (tests ran on the uncommitted merge; merges aborted afterwards, worktrees back at the branch tips).

---

## 1. `origin/wip/third-p5-reviews-api` @ 8cb4ea2c (Plan 5 Task 3 rework + C12b traded total)

**Verdict: APPROVED WITH CHANGES.** Land after I1 (migration number) and I3 (one red test) are fixed; I2 (overturn erases the review) is a new owner rule that is NOT built and needs a seam + tripwire before or right after landing (lead's call). Everything else asked for is in place and correct.

Reviewed `git diff 7cbf2d0..8cb4ea2c` restricted to the branch's own files (the rest is main merges), plus the merge state with b6835eef.

### What checks out
- **Review weight gone**: no `weight` column; `positivePct` counts each rated review once (`packages/reputation/src/stats.ts`); test asserts no usd/cent/amount/weight column on `reviews` (`apps/api/test/reviews.test.ts:268-275`).
- **Month only after self-destruct**: `detachReviews` truncates `created_at` to the UTC month (`apps/api/src/reviews/store.ts:145`); the 301 trigger allows exactly that to `x2f_purge` and nothing else (`apps/api/migrations/301_reviews.sql:78-100`). Public `age` is month+year anyway.
- **No blind reveal**: `GET /v1/trades/:code/review` returns `theirs` as soon as it exists; reveal/late-review code removed everywhere (reputation + API + web codes).
- **Skip**: `POST .../review/skip` → 204; `review_skips (trade_code → trades on delete cascade, side)`, no account column; never read for stats; only the caller's own skip is shown. Review-after-skip, skip-after-review, double skip all 409 `review-exists` under the trade row lock (`reviewableSide`, routes.ts:81-88) with the PK/unique backstop mapped to 409. Gate (`sideDone`) treats skip like a review.
- **307_traded_totals**: `account_traded_totals` has no FK to trades (survives purge); `trade_totals_counted` cascades with the trade; `accounts.show_traded_total default false`.
- **Once-per-trade counting**: `countTradeTotals` runs inside `applyEvent`'s transaction on the row-locked trade (`apps/api/src/trades/store.ts:367`), and is idempotent via the `trade_totals_counted` PK with `on conflict do nothing ... returning` gating the add. A concurrent second transaction blocks on the unique index and then adds nothing. `applyEvent` is the only writer of `trades.state` (grepped all `update trades`). Re-entry (released → late-funds escalate → disputed → released/refunded) does not double count (tested path for buyer-cancel re-call too).
- **Buckets**: `tradedBucketUsd` (packages/reputation/src/traded.ts): null < $10,000; floor to $10k steps below $100k (so $90k-$99,999 → 90,000); $100k+ floors to $50k steps. Integer bigint maths, never above the total, negative refused. Matches the brief.
- **Privacy**: exact totals and `buyer_cancels` are read only in `traders/tradedTotal.ts` and `traders/summary.ts`, and only ever leave as the bucket. No staff/internal/owner route, activity-log action (`log/actions.ts`, `tradeLogDetail` uses the event record, not the row) or `app.log` call carries `usd_cents`, `own_usd_cents` or `buyer_cancels`. `trades.usd_cents` is in `TradeRow` (`select *`) but no route serialises a raw row. Test `tradedTotal.test.ts:166` scans summary, setting, trade view and `/v1/account/me` bodies. Opt-in default off; the trader's own GET shows their bucket even while off (fine, it's theirs).
- **Route classification**: `POST .../review/skip` and `PUT /v1/account/profile/traded-total` are in `LIVE_SESSION_EXEMPT` with reasons (`apps/api/src/auth/hold.ts`); members (no `member:` option) are refused on all review and traded-total routes.
- **Purge interplay**: totals survive (tested `tradedTotal.test.ts:109`); skips and counted-marks cascade; reviews detach via the Plan 7 seam, guarded by tripwire `NEEDS_PLAN_7_DETACH_REVIEWS` (`apps/api/test/reviews-tripwire.test.ts`).
- Web: `OfferCard` shows the line only when `tradedOverUsd !== null`; parser accepts missing/null.

### Findings

**I1. Migration number clash: `307`.** `origin/wip/lead-sessions` has `apps/api/migrations/307_session_length.sql`; this branch adds `307_traded_totals.sql`. The runner (`apps/api/src/db/migrate.ts`) keys on the full name so both would apply, but numbers are meant to be unique (docs/coordination.md "Migration 306" note), and `schema.test.ts`'s exact migration lists will conflict. Fix: whichever lands second renumbers (suggest this one → `308_traded_totals.sql`, update `schema.test.ts` lists and the coordination note). Other 3xx in use on remotes: 301 (this), 302 (feedback), 304 (past-rep), 306 (main). 301 itself is unique and safe to apply after 306 on existing databases (depends only on trades/disputes/site_flags/accounts).

**I2. Owner rule "overturned in a dispute → its review is ERASED; finishes normally after a dispute → review stays" is NOT built.**
- Where it bites: a review can exist before a dispute. A released trade is reviewable; late funds then `escalate` it into a system dispute, and the review stays shown (`apps/api/test/reviews.test.ts:182` asserts exactly this). If that dispute's ruling is later overturned, the review must go. (A trader-opened dispute can't precede a review: `reviewableSinceSql`, store.ts:26, blocks reviews until every dispute is `final`/`closed`, but the same erase rule should apply defensively.)
- Nothing on this tree knows "overturned" yet: no `disputes.overturned` column, no API code that moves a dispute to `final` (only `@x2f/staff` `resolveFinal` sets `overturned = round2 outcome !== round1 outcome`, packages/staff/src/dispute.ts:280-295; log action `ruling.final { overturned }`).
- Fix (now, as a seam): add `eraseReviewsOfTrade(q, code)` in `apps/api/src/reviews/store.ts` (DELETE from reviews where trade_code = $1, run as `x2f_purge`; the 301 trigger already allows x2f_purge DELETE) and a tripwire `NEEDS_P4_OVERTURN_ERASES_REVIEWS` that fails once the API writes `ruling.final` / `overturned` without calling it. Update the comment/test at reviews.test.ts:182 to say "stays unless the ruling is overturned".
- Open points for the owner (see Questions): what "overturned" means here, and what happens to Skip rows and the gate after an erase.

**I3. A test fails: `@x2f/auth-client` `test/flows.test.ts` "every route of the API ... has its client method" (flows.test.ts:150).** It fails at the branch tip and in the merge (the merge does not touch auth-client); claude3's checks ran api/web/reputation only. Six new routes are neither client methods nor in the `NOT_AUTH_CLIENT` list (flows.test.ts:~40-80): `GET /v1/account/profile/traded-total`, `PUT /v1/account/profile/traded-total`, `GET /v1/reviews/pending`, `GET /v1/trades/:code/review`, `POST /v1/trades/:code/review`, `POST /v1/trades/:code/review/skip`. Fix: add them to `NOT_AUTH_CLIENT` (they are app routes like `POST /v1/feedback/form`, which is already there), as the feedback branch did for `POST /v1/feedback` (fa5542b9).

**M1. `traded` line copy at exact boundaries.** `apps/web/src/screens/browse/OfferCard.tsx:69` "Completed over $X" is false when the total is exactly X (bucket floors, so $90,000.00 → "over $90,000"). Either use `>=` wording ("$90,000+ in trades to date", the existing `tradedBucketLabel`) or have the bucket require strictly more than X. Copy is COPY-UNSIGNED; claude3 already lists it as open question (b).

**N1. Sticky totals vs live completed count.** `own_usd_cents` never goes down, while `COMPLETED_TRADES_SQL` (traders/stage.ts:110) counts the live state: a released trade that late funds escalate drops out of `completedTrades` while disputed but stays in the dollar total. Harmless (it comes back as completed whoever wins, R38), just note it for Task 20's `account_totals`.

**N2. Bucket changes are observable.** A counterparty who looks at the poster's line before and after their own trade can see a step crossed. Steps are $10k/$50k so the leak is coarse; opt-in. Mention to the owner only if they want the line to update with a delay.

**N3. `buyer_cancels` and `own_usd_cents` are exact and permanent** (by design, survive purge). No reader yet; when Plan 4 adds the moderator figure, keep it behind a staff perm and out of the activity log details.

### Tests (merge state with b6835eef)
- `vitest --project @x2f/api @x2f/web @x2f/reputation @x2f/auth-client` (under check.lock): 154 files; **2805 passed, 1 failed (I3)**, 1 todo. Log `~/x2f-comms/rvc3r-test.log`.
- `npm run typecheck`: clean. `npm run copy-lint`: clean.

---

## 2. `origin/wip/landing-p5-feedback` @ 04a45156 (platform feedback; global daily cap removed)

**Verdict: APPROVED.** The removal is complete; the merge with latest main is clean, and migration 302 is in order.

- **Removal complete**: `FEEDBACK_GLOBAL_DAILY`, its count query, its test and its coordination entry are gone (04a45156); no reference left anywhere in apps/, packages/, tools/ or docs. A new test asserts a send is stored beyond the old 5000/day (`apps/api/test/feedback.test.ts:116`).
- **Abuse controls left on `POST /v1/feedback`**: `FEEDBACK_DAILY = 3` per account per UTC day, in process memory only (`apps/api/src/feedback/mood.ts:31`, `:103-132`); over it, a silent 202. Trader sessions only (`mood.ts:109`, no members, no recovery). Body: mood enum, note ≤ 500 chars, hidden/control characters refused. Nothing else: no shared bucket, no IP limit (by design: no IPs).
- **Migration 302**: `302_feedback.sql` creates only `platform_feedback` (no dependencies), so it is safe both on fresh databases (applies before 306) and on existing ones that already have 306 (applies after). `schema.test.ts` lists are updated in the merge (302 between 201 and 306, all three lists). No other branch uses 302 except its own source `wip/third-p5-feedback`.

### Findings
**N1. The per-account limit is per process and resets on restart.** With more than one API process, or after a deploy, an account gets 3 more. Accepted earlier (P5-A19: never stored so it can't link a row); just note that with the global cap gone, the only bound on total rows is the number of trader accounts × 3 a day × processes. If account creation is cheap, that is the remaining flood vector (rows are tiny and purged after 365 days).
**N2. The server does not check that the sender just finished a trade** (`shouldAskFeedback` is web-only). Any trader can send 3 a day. Fine for a courtesy prompt; mention only if the owner wants it tied to completed trades.
**N3. Expected conflict with branch 1:** `apps/api/src/auth/hold.ts` (both add a `LIVE_SESSION_EXEMPT` line) and `apps/api/test/schema.test.ts` (migration lists). Trivial: keep both lines; lists become `... 201, 301, 302, 306, 307|308`.

### Feedback FORM limit (owner wants max 1 send per 30 s per person, pending lead confirmation)
What exists on main today (`apps/api/src/feedback/form.ts`, from main, not this branch): `FEEDBACK_FORM_DAILY = 5` per account per UTC day in memory (429 `slow-down` to midnight, line 29, 127-130), plus ONE shared `TokenBucket` for everyone, `FEEDBACK_FORM_BUCKET = { capacity: 30, perMinute: 10 }` (lines 31, 108, 132). Problem with the shared bucket: a few accounts can drain it and block everyone's form (429 for all). No per-person interval exists.
claude3 already has this in progress: `origin/wip/third-feedback-form-limit` @ 171b38ad replaces the shared bucket with `KeyedBuckets({ capacity: 1, perMinute: 2 })` keyed by account (`apps/api/src/limits.ts:96` already provides `KeyedBuckets`, which answers 429 `slow-down` with `retryAfterSeconds`). It keeps the 5-a-day count. Not reviewed here; review it separately once pushed as ready.

### Tests (merge state with b6835eef)
- `vitest --project @x2f/api @x2f/auth-client @x2f/staff @x2f/web` (under check.lock): 151 files, **2882 passed**, 1 todo, 0 failed. Log `~/x2f-comms/rvc3f-test.log`.
- `npm run typecheck`: clean.

---

## Questions for the lead / owner
1. (I1) Which 307 keeps its number: `307_session_length` (lead-sessions) or `307_traded_totals`? Suggest traded totals → 308.
2. (I2) "Overturned": does the owner mean the appeal reversing round 1 (`overturned` in `@x2f/staff`), or any dispute whose outcome reverses how the trade first ended (e.g. released, then late funds and a ruling to refund)? The two differ for late-funds escalations.
3. (I2) After an erase: can both sides review the trade again, or is it done (no review, no gate)? And is a Skip row erased too? Suggest: done, erase reviews AND skips, never gates again.
4. (I2) Should an overturned trade still count in the traded total and completed count? Today it does (R38: a settled dispute counts whoever won).
5. (M1) Line wording at the exact boundary: "over $X" vs "$X+".
6. Form limit: does "1 per 30 s" replace only the shared bucket (claude3's reading) or also the 5-a-day count?
