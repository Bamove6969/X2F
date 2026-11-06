# Review RV3: traded + past-rep join (2026-11-06)

Reviewer: lead's read-only review helper. Branch `origin/wip/third-p5-traded-pastrep` @ **315142b9** (claude3) = `wip/third-p5-reviews-api` a7a38fdf + `wip/third-p5-past-rep` 4a687f94, joined by 192a341d, cd4520e1, 7eb32c0a, 315142b9.
Main line `origin/claude/compassionate-johnson-k95ssr` @ a779ef97 (= GitHub main e7636c74 + a settings-only chore). The branch already holds e7636c74; a trial `git merge-tree` against a779ef97 is clean.
Worktree `~/x2f-worktrees/rv-pastrep` (detached at 315142b), removed after the run. Nothing was committed or pushed.

## Verdict: APPROVED WITH MINOR

The code at 315142b is correct. All four prior C12 items (I1-I3, M1) are fixed, and the past-rep work since round 2 holds up. The joins have no semantic clash. The typecheck and the targeted tests are green.

Two landing hazards need the lead's attention. Neither is a bug at this tip; both bite at landing:
- **I1:** land R4 as the single landing of R2 and R3.
- **I2:** when this branch meets Plan 4 Task 10 (R13), switch the overturn source to `disputes.overturned`.

There are also three minors.

## Checks

| Check | Result |
|---|---|
| `npm run typecheck` (all workspaces, under check.lock) | exit 0, 0 errors |
| `vitest --project @x2f/api` on reviews, reviews-gate, reviews-tripwire, tradedTotal, pastrep, pastrepVerifiedUsd, schema (the migration tests), coolingOff, offers, take, view | **11 files, 372 passed**, 0 failed (74 s). Log `~/x2f-comms/rv-traded-pastrep-api.log` |
| `vitest` with @x2f/reputation (all), @x2f/auth-client flows, @x2f/accounts pgp, @x2f/web browse + myOffers | **8 files, 185 passed**, 0 failed. Log `~/x2f-comms/rv-traded-pastrep-pkg.log` |
| Trial merge with main line a779ef9 | clean |
| 3xx migration numbers across every `origin/*` branch (`git ls-tree`) | no clash (table below) |
| Join merges, read by hand (`git show --cc`) | no semantic clash (section C) |

I did not run Playwright, copy-lint, semgrep or the full suite (RAM was tight: under 1 GB available during the runs).

## A. reviews-api `8cb4ea2..a7a38fd`: prior items

Only the branch's own commits were read: 0ca49284, 04a6a36b, d2b5d2a7, 91eb92f6, 99a9863e, a8d02363, bd529a2b, a7a38fdf. The two main merges (c0aaca9d, ae50ecb8) were checked with `--cc`. ae50ecb8 has hand resolutions in hold.ts (all four LIVE_SESSION_EXEMPT lines kept) and in the schema lists, and both are correct.

| Item | Status |
|---|---|
| **I1** migration 307 clash | **FIXED.** Renamed to `308_traded_totals.sql`, and the overturn grant is `309_overturned_reviews.sql`. The schema.test lists and coordination.md were updated. 307 stays `wip/lead-sessions` only. |
| **I2** overturn erases reviews | **FIXED, as a seam.** `eraseReviewsOfTrade(q, code)` (`apps/api/src/reviews/store.ts`, about line 190) does the following: <br>• takes `for update` on the trade under the caller's role; <br>• deletes the trade's reviews and `review_skips` as `x2f_purge`; <br>• restores the caller's role with `set_config('role', …, true)`. <br>`eraseOverturnedReviews` wraps it and erases only when `overturnedSql` is true, meaning round 2 ≠ round 1 in `dispute_rulings`. `reviewableSinceSql` now returns null for an overturned trade, so the gate and the pending list skip it. 309 grants `x2f_purge` select and delete on `review_skips`, and the 301 trigger is unchanged. <br>The tripwire `NEEDS_P4_OVERTURN_ERASES_REVIEWS` (`apps/api/test/reviews-tripwire.test.ts:44-89`) scans `apps/api/src` for three things: `insert into dispute_rulings`, an update that sets `disputes` status final or `overturned =`, and `'ruling.final'`. It has a self-test of the detector. <br>Race tests cover both lock orders, and the late-funds test title now says "unless the ruling is later overturned". <br>The answers to my old owner questions 2-4 are built as I recommended: erase reviews and skips, never gate again. The totals keep counting the trade, which is still an open owner question (Q7 below). |
| **I3** auth-client flows red | **FIXED.** The six routes are in `NOT_AUTH_CLIENT`, and the four past-rep routes were added on the past-rep side. flows.test passes. |
| **M1** "over $X" at the boundary | **FIXED, final owner rule Q4 (2026-11-03): MORE than the step.** `tradedBucketUsd` uses `(cents − 1) / 100`: exactly $10,000.00 → null, $10,000.01 → 10,000, $100,000.00 → 90,000, $100,000.01 → 100,000. Web copy is "$X+ in trades to date" (COPY-UNSIGNED). Boundary tests are in reputation `traded.test.ts` and api `tradedTotal.test.ts`. The comments were not all updated: see M2. |

## B. past-rep `8ddbd4d..4a687f9`

Read: the past-rep source and migrations (304, 310, `pastrep/routes.ts`, `help.ts`, `store.ts`, `verify.ts`), plus `pastrepVerifiedUsd.test.ts`. The rest of the range is main merges.

- **Item 71 (owner): a Signer's User ID is accepted.** The refusal in `verify.ts` is removed. The stored signature (still the one packet, re-armored with no headers, as in round 2 M4) is now sealed:
  - column `signature_enc`;
  - `sealKey(..., claimId, 'x2f/pastrep-sig/')`;
  - the AAD carries the row id, because finish now picks the id up front (`randomUUID()` → the insert's `id`).
  f36941c8 fixed the undefined `claimId`/`signatureEnc` that c341b324 had shipped untested. The tests are now green.
- **Item 72: one key, several sites for the same account; never two accounts.** The partial *unique* index became a plain one. In its place is the trigger `past_reputation_one_account_per_key`, which takes `pg_advisory_xact_lock(7240304, hashtext(fp))` and then checks. On READ COMMITTED, the plpgsql query takes a fresh snapshot after the lock, so a racing commit is seen. The two-int advisory key space cannot collide with the one-bigint locks used elsewhere. The 23505 is raised with `constraint = 'past_reputation_fingerprint_account'`, and routes.ts maps that name. Lock order:
  - finish takes the account lock, then the challenge row, then the fingerprint lock;
  - two accounts with one key: each holds its own account lock first, so there is no cycle;
  - the same account on two sites: serialized by the account lock.
- **Item 74: re-claim after a revoke.** A dead row is not live, so a new `signed` row is allowed.
- **Item 75: `help` array.** On the key refusals, `key-no-signing`, and the finish refusals `bad-signature`, `wrong-text` and `wrong-key` (COPY-UNSIGNED).
- **Item 76: finish throttle 10 an hour.**
- **Migration 310 (verified $).** Adds:
  - `verified_usd_cents bigint > 0`, `verified_usd_by → accounts on delete set null`, `verified_usd_at`;
  - "cleared" and "dated" checks;
  - a trigger that requires an enabled `staff` or `owner` account and a time.
  `setVerifiedPastRepUsd` checks four things:
  - the role is in `['owner', 'senior']` (Q9);
  - the account kind matches the role;
  - the claim is live, checked inside the one UPDATE;
  - the amount is a safe integer > 0.
  A trader can never verify their own claim, because claims come only from `kinds: ['trader']` sessions and verifiers must be staff or owner. Only **approved** claims count (Q8; `verifiedPastRepUsdSql`), read at query time, so a revoke or a cleared figure stops counting at once (tested for revoked, removed and rejected).
- **Tripwire.** `NEEDS_P4_PASTREP_VERIFIED_USD` remains (Plan 4's route). `NEEDS_C12_PASTREP_IN_TRADED_TOTAL`, and C12's `NEEDS_P5_T10_VERIFIED_VOLUME` / `tradedTotal-tripwire.test.ts`, were fulfilled by the join and removed. That is correct.

## C. The joins, by hand

- **192a341d** (R2 a8d02363 + R3 8bb19111):
  - `app.ts`: reviewRoutes, tradedTotalRoutes and pastRepRoutes are each mounted once.
  - `cantDoCodes.ts`: both code sets kept, with no duplicates.
  - `schema.test.ts`: the three lists read 301 302 304 306 308 309 310 in name order.
- **02965f9f / 76b02fa5** (branch commits): `account_traded_totals.imported_verified_usd_cents` dropped. `tradedTotalSql` = own total + `verifiedPastRepUsdSql(account)` (a correlated subquery; `past_reputation_account (account_id, created_at)` serves it). `summary.ts` and the setting route both use `tradedTotalSql`, so the browse card and the trader's own view agree.
- **cd4520e1** (R3 4a687f94: Q8 approved-only, Q9 senior/owner): `pastrep/store.ts` resolved to `status = 'approved'` in BOTH the SQL fragment and `verifiedPastRepUsdCents`. That is correct; a "live" leftover here would have counted signed claims.
- **7eb32c0a / 315142b9** (R2 bd529a2b then a7a38fdf, the bucket rule flip-flop): `tradedTotal.test.ts` ends on the final rule ("MORE than a step": $10,000.00 → null, $10,000.01 → 10,000). Only `coordination.md` conflicted in the text.
- No other cross-branch rename or signature drift: the typecheck is clean, and the tests above cover the touched paths.

## D. Migrations 301 / 304 / 308 / 309 / 310

| # | Name | Remote branches that have it | Clash |
|---|---|---|---|
| 301 | 301_reviews | reviews-api, traded-pastrep | none |
| 302 | 302_feedback | main and most branches (landed) | n/a |
| 304 | 304_past_reputation | past-rep, traded-pastrep | none |
| 306 | 306_feedback_form | main (landed) | n/a |
| 307 | 307_session_length | lead-sessions only | none (no longer here) |
| 308 | 308_traded_totals | reviews-api, traded-pastrep | **same name, different content: I1** |
| 309 | 309_overturned_reviews | reviews-api, traded-pastrep | none (identical) |
| 310 | 310_pastrep_verified_usd | past-rep, traded-pastrep | none (identical) |

Plan 4 uses 202-207 (208 next), so there is no overlap. 304 and 310 are byte-identical between R3 4a687f9 and R4. 301 and 309 are byte-identical between R2 a7a38fd and R4.

- **Runner.** `db/migrate.ts` applies the missing files in name order, each in its own transaction, recorded in `schema_migrations`, under an advisory lock. On an existing database that already has 302/306, the 301/304 files apply after them. That is safe: 301 depends only on trades, disputes, site_flags and accounts; 304 only on accounts and challenges; 308 on trades and accounts; 309 on 301; 310 on 304.
- **Idempotency.** The files are not individually re-runnable (no `if not exists`). That is the repo convention, and the runner's record plus the per-file transaction make a partial apply impossible.
- **Existing data.** None of the five rewrites existing data:
  - 301 adds nullable `trades.usd_cents` (old trades stay null and count $0, so there is no backfill and none is possible) and a `before update` trigger on `trades` (a small plpgsql call on every trade update). It also adds `site_flags.reviews_since default now()`, so traders with history are not gated.
  - 308 adds `accounts.show_traded_total not null default false` (metadata-only on PG 17).
  - 310 adds nullable columns with checks that hold on the empty column.
  - Trades completed before 308 are never counted. Since their `usd_cents` is null, nothing is lost.
- **Down / rollback.** The repo has no down migrations, so rollback is forward-only. If one were ever needed, the manual SQL in reverse order is:
  - 310: drop the trigger and function, then the 3 columns and 2 constraints;
  - 309: revoke on `review_skips` from `x2f_purge`;
  - 308: drop `trade_totals_counted` and `account_traded_totals`, then `accounts.show_traded_total`;
  - 304: drop `past_reputation` and its function;
  - 301: drop `reviews` (the triggers block UPDATE, DELETE and TRUNCATE but not DROP), `review_skips`, `trades_set_once_usd` with its function, `trades.usd_cents` and `site_flags.reviews_since`.
  Reverting the code alone, without the SQL, is harmless: the extra tables and columns are unused, and the `trades` trigger only refuses changes to `usd_cents`.
- **Indexes.** These cover the paths:
  - `reviews (trade_code, reviewer_role)` unique, `reviews_subject`, partial `reviews_reviewer`;
  - the `review_skips` and `trade_totals_counted` PKs (leading `trade_code`, which suits the cascade);
  - the `account_traded_totals` PK;
  - `past_reputation`: `site_live` unique, `fingerprint_live` partial (used by the trigger), `account`, `status`.
  The only gap is `past_reputation.verified_usd_by` (and `reviewer_id`), which has no index. A staff account deletion would `set null` through a seq scan of a small table, which is acceptable.

## Findings

### Important

**I1. Two different files named `308_traded_totals.sql`: R2 (a7a38fd) and R4 (315142b).** `apps/api/migrations/308_traded_totals.sql:16-20`.
- R2's version has `imported_verified_usd_cents bigint not null default 0`; R4's dropped it in 02965f9f.
- The handoff's landing order (HANDOFF-claude3-2026-11-05 §3) is "R3 and R2 independent; **R4 after both**".
- Failure scenario: R2 lands and any database (dev, staging or prod) runs 308. R4 then lands with the edited 308, and the runner skips it because the name is already recorded. That database keeps the column, while fresh databases do not. Today the column is dead (nothing reads or writes it after R4), but the schema differs silently by install history. Any later migration that assumes the R4 shape (e.g. Task 20 folding these columns into `account_totals`) can break on one set of databases only. This also breaks the rule that a landed migration never changes.
- Fix (pick one):
  - (a) **Land R4 alone as the landing of R2 + R3.** It contains both, all its tests are green, and R2 is never merged on its own. This is my recommendation: it is simplest and needs no new migration.
  - (b) If R2 must land first: restore R2's 308 byte-for-byte on R4, and add `311_drop_imported_verified.sql` (`alter table account_traded_totals drop column imported_verified_usd_cents;`), with the schema.test lists updated.

  R3 landing alone first is fine: 304 and 310 are identical in R3 and R4.

**I2. Landing clash with R13 `wip/third-p4-task10` (Plan 4 Task 10): the overturn is recorded somewhere `overturnedSql` does not read.** This is not a bug at this tip.
- `apps/api/src/reviews/store.ts:26-29` (`overturnedSql`) and `:43` (`reviewableSinceSql`).
- R13's migration 207 adds `disputes.overturned boolean`. Its `saveDispute` (`apps/api/src/disputes/store.ts:126-129` on R13) writes `overturned = $16`, and its `timers.ts:60` logs `'ruling.final'`. R13 inserts no `dispute_rulings` rows; those come from the later rulings task.
- Failure scenario, once R4 and R13 are both on the main line:
  - (1) The tripwire `NEEDS_P4_OVERTURN_ERASES_REVIEWS` fires at once on both R13 files (it is meant to). Whoever lands second must wire the erase in that same merge, or the main line goes red.
  - (2) If that wiring calls `eraseOverturnedReviews`, the call does nothing. It decides from `dispute_rulings` round 2 ≠ round 1, which Plan 4's own flag does not feed. If it calls `eraseReviewsOfTrade` directly, the reviews are erased, but `reviewableSinceSql` still does not see the trade as overturned. Once the dispute is `final` or `closed`, the trade becomes reviewable again and the gate re-asks both sides. They can then post new reviews on a trade the owner said is "like it never happened".
- Fix, at the R4 × R13 merge (or now, as a guarded seam):
  - make `overturnedSql` read `exists (select 1 from disputes d where d.code = t.code and d.overturned)`, with or without the `dispute_rulings` comparison;
  - call `eraseReviewsOfTrade` where `saveDispute` persists `overturned = true`, in the same transaction;
  - add a test: overturn via `saveDispute`, then `reviewable: false`, then POST review → 409 `not-reviewable`.
- Also tell claude3. Task 12 (rulings + `eraseReviewsOfTrade` call) is in their queue.

### Minor

**M1. The 310 trigger lets anyone re-attribute a verified figure.** `apps/api/migrations/310_pastrep_verified_usd.sql:28-32`.
- The "set null on delete" bypass returns early whenever `verified_usd_cents` and `verified_usd_at` are unchanged. It does not check `verified_usd_by`.
- Failure scenario: `update past_reputation set verified_usd_by = '<a trader's id>' where id = …` passes the trigger. The record of who verified the figure now names a non-staff account, and the "second line" the comment promises is gone. This needs SQL as the app role (no route does it), so it is defence in depth only.
- Fix: `and (new.verified_usd_by is null or new.verified_usd_by is not distinct from old.verified_usd_by)` in the bypass, plus a test (re-point to a trader → `insufficient_privilege`).
- Since 310 has not landed, editing it in place is fine.

**M2. Comments still describe the abandoned "at least $X" rule.**
- `apps/api/src/traders/summary.ts:27-28` says "has reached at least $10,000 (owner 2026-11-02: exactly $10,000 counts)".
- `apps/web/src/screens/browse/OfferCard.tsx:67-70` says "X is a step the trader has REACHED … stays true at exactly $X".
- "Completed over $X" (the old copy) remains in `308_traded_totals.sql:1`, `310_pastrep_verified_usd.sql:2`, `pastrep/store.ts:14` and `apps/web/src/screens/browse/api.ts:56`.
- Failure scenario: a later change "fixes" `tradedBucketUsd` to match the summary.ts doc. Exactly $10,000.00 would then show "$10,000+", against owner Q4 final (2026-11-03). The boundary tests would catch it, but the docs would be pointing people the wrong way.
- Fix: reword these to "more than X (owner 2026-11-03)" and "$X+ in trades to date". Leave the landed text in 308:1 if I1(b) is chosen.

**M3. No upper bound on the verified figure.** `apps/api/src/pastrep/store.ts:44` accepts up to `Number.MAX_SAFE_INTEGER` cents (about $90 trillion).
- Failure scenario: a moderator's typo (extra zeros) is shown at once as "$90,000,000,000+ in trades to date" on every offer card of that trader. Nothing asks for a second look.
- In the far tail, bigint overflow in `tradedTotalSql`'s sum would make `traderSummaries` throw for every browse page showing that trader (`summary.ts:82`), but reaching it needs about 1000 maxed claims. That case is unrealistic.
- The bound is a limits choice, not mine: see question 2.

### Nits
- n1. 308 `account_traded_totals.account_id` and 301 `reviews.subject_id`/`reviewer_id` reference `accounts` with no `on delete`, so they block deleting a trader account. That matches trades and offers today, where only `member` accounts are deleted. Plan 7 account deletion must handle it.
- n2. The 304 and 310 trigger functions omit `set search_path`, unlike 301's. They are not SECURITY DEFINER, so there is no risk. If one is added, it must include `public`, because they name tables unqualified.
- n3. Old round-2 note n2 still applies: the stored signature is the packet re-armored as detached, so Task 11's re-verify may need the same newline variants that `verify.ts` tries.

## Open questions (for the lead / owner; with recommendation)
1. **(I1) Landing shape.** Land R4 as the one landing of R2 + R3, rather than R2 → R3 → R4? Recommend: yes.
2. **(M3, limits) A ceiling on a moderator-entered verified figure?** Options:
   - (a) none, as today;
   - (b) a hard cap per claim, e.g. $10,000,000, refused as `bad-amount`;
   - (c) a soft cap that needs the owner's confirmation above it.

   Recommend (b), with the number from the owner.
3. **(Q7, still open from 11-02) Should an overturned trade stay in the traded total and the completed count?** Today it does (R38), while its reviews are erased. Recommend: follow claude3's open owner question 7 ("yes, remove an overturned non-sale"), and build it with I2's fix, since both hang off the same overturn hook.
4. **(I2) Overturn definition once Plan 4 lands.** Is `disputes.overturned` (Plan 4: round 2 ≠ round 1) the only meaning, or does "OVERTURNED like it never happened" also cover a late-funds escalation that reverses a release to a refund with no appeal? This is my old question 2, which the code answers as the appeal-only meaning. Recommend: appeal-only, as built, unless the owner says otherwise.
