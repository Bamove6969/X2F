# Review RV3 round 2: traded + past-rep join (2026-11-06)

Reviewer: lead's read-only review helper. Branch `origin/wip/third-p5-traded-pastrep` @ **1a99f7b9** (claude3).
Scope: `git diff 315142b 1a99f7b9` only. That is one commit (1a99f7b9), with no merges in the range and 9 files changed (+47/−18).
Round 1: `~/x2f-comms/review-traded-pastrep-2026-11-06.md` on 315142b (APPROVED WITH MINOR).
Worktree `~/x2f-worktrees/rv-pastrep2` (detached at 1a99f7b9), removed at the end. Nothing was committed or pushed.

## Verdict: APPROVED

M1 and M2 are fixed. The new trigger test fails on 315142b's 310 and passes on 1a99f7b9. It also catches the mutant that would break the on-delete path. I found nothing new that is broken.

M3 is still an owner question. I1 is resolved by the landing shape, which carries one condition (below). I2 is still a landing hazard for the R4 × R13 merge, and it is on claude3's list.

## Per-item status

| Item | Status | Evidence |
|---|---|---|
| **M1** 310 bypass let anyone re-attribute `verified_usd_by` | **FIXED** | `apps/api/migrations/310_pastrep_verified_usd.sql:29-31`. The bypass now also needs `(new.verified_usd_by is null or new.verified_usd_by is not distinct from old.verified_usd_by)`. Any other re-point falls through to the full check at `:34-38` (enabled `staff`/`owner`, plus a time). The trigger columns (`:45`) are unchanged. Tests are in `apps/api/test/pastrepVerifiedUsd.test.ts:93-115`. The re-point test checks a trader, a member and a disabled staff account (each 42501, row unchanged), then an enabled staff account (passes). The delete test checks that deleting the verifying staff account leaves `{300, null, T0}`. |
| **M1** proof that the test is real | **CONFIRMED** | (a) The new test file against **315142b's 310** gave **1 failed / 13 passed** ("promise resolved … instead of rejecting"), which matches claude3's claim. (b) Mutant: I dropped the `new.verified_usd_by is null or` branch. That gave **1 failed / 13 passed**, and the failing test was the on-delete test, so both halves of the new clause are pinned. |
| **M1** editing 310 in place is safe | **SAFE** | `git log origin/main origin/claude/compassionate-johnson-k95ssr -- '**/310_*'` is empty, and the main line (now 16f37629) has only 302 and 306 in the 3xx range. Only two remotes carry a 310. One is `wip/third-p5-traded-pastrep` (blob a9702997, new). The other is `wip/third-p5-past-rep` = R3 (blob 74aa446d, the old content). See the landing condition below. |
| **M2** old "at least / Completed over $X" wording | **FIXED** | `traders/summary.ts:27-29` ("MORE than $10,000 … exactly $10,000.00 shows nothing"); `browse/OfferCard.tsx:68-69`; `browse/api.ts:56-57`; `pastrep/store.ts:14`; `308_traded_totals.sql:1-2`; `310_…sql:2`; test headers in `tradedTotal.test.ts:14-15` and `pastrepVerifiedUsd.test.ts:2`; `docs/coordination.md` (C12b Public bullet, open question (b), the 310 bullet). `git grep -iE "completed over\|has REACHED\|reached at least\|exactly \$10,000 counts"` on 1a99f7b9 finds nothing (the one "at least" hit is unrelated min-trades copy in `cantDoCodes.ts:219`). All web changes are JSDoc only; no user-facing string changed. |
| **M3** no ceiling on the verified figure | **OPEN (owner)** | Unchanged, as agreed. This is a limits choice: see question 1. |
| **I1** two different `308_traded_totals.sql` | **RESOLVED by landing shape** | This tip carries R4's 308 (blob c77d89ca: no `imported_verified_usd_cents`; it differs from R4@315142b only in the line 1-4 comment). R2 (`wip/third-p5-reviews-api`) still carries the other 308 (blob e2ecc28d). claude3 (to-lead 00:22:06, 00:38:57) says R4 lands alone as R2 + R3 and R2/R3 never merge separately. If the lead lands 1a99f7b9 itself, there is only one 308, and it matches this tip. |
| **I2** overturn source clash with R13 (Plan 4 Task 10) | **STILL A LANDING HAZARD** | `apps/api/src/reviews/store.ts:26` `overturnedSql` still reads only `dispute_rulings`. R13 (`wip/third-p4-task10` @3d678a33, migration 207) records `disputes.overturned`. Not fixed on this branch, by design. It is on claude3's Plan 4 landing list (to-lead 00:22:06): at R4 × R13, read `disputes.overturned`, have `saveDispute(overturned = true)` call `eraseReviewsOfTrade` in the same transaction, and test overturn → `reviewable: false` → POST 409. |

## Landing condition (from I1 and M1 together)

Two migrations must never reach any database from the R2 or R3 branches, not only one:
- **R2's 308** (with the dead column);
- **R3's old 310** (`wip/third-p5-past-rep` @4a687f9, blob 74aa446d, the old bypass without the `verified_usd_by` check).

In round 1, R3 landing first was harmless because its 310 was byte-identical to R4's. That is **no longer true**. If R3 landed first, every database that ran it would keep the weak trigger, and R4's edited 310 would be skipped as already recorded.

So: land **1a99f7b9 (or a descendant) only**, and never `wip/third-p5-past-rep` or `wip/third-p5-reviews-api` on their own. Today's plan already does this. It is written here so nobody lands R3 for its routes alone.

## New findings

No Important or Minor findings.

Nits (no action needed):
- **n1.** Beyond the on-delete case, the bypass also lets a plain `update past_reputation set verified_usd_by = null` erase who verified a figure while keeping it (`310:31`). A trigger cannot tell this from the FK action, it needs SQL as the app role, and no code does it. This is the same defence-in-depth level as round 1's M1. If it matters later, the fix is to move the attribution into the append-only activity log, not the trigger.
- **n2.** Re-pointing to another *enabled* staff account passes and keeps the original `verified_usd_at` (`pastrepVerifiedUsd.test.ts:111-114` asserts this on purpose). That is consistent with "only staff or the owner may be named", but the time then belongs to a different verifier. Same caveat as n1.

## Checks

| Check | Result |
|---|---|
| Diff range `315142b..1a99f7b9` | 1 commit, 0 merges, 9 files. Read in full. |
| `npm ci` (npm 11.21.0) in the worktree | ok, 296 packages. The lockfile is unchanged in the range; the install was needed only for a fresh worktree. |
| `vitest --project @x2f/api` on reviews, reviews-gate, reviews-tripwire, tradedTotal, pastrep, pastrepVerifiedUsd, schema (under check.lock, Docker via `sg docker`) | **7 files, 210 passed**, 0 failed (29 s). Log `~/x2f-comms/rv-traded-pastrep2-api.log`. Matches claude3's 210/210. |
| The new test against 315142b's 310 (red check) | **1 failed / 13 passed**, as expected. Log `~/x2f-comms/rv-traded-pastrep2-red.log`. |
| Mutant: drop the `verified_usd_by is null or` branch | **1 failed / 13 passed** (the on-delete test). Log `~/x2f-comms/rv-traded-pastrep2-mutant.log`. |
| `npm run typecheck` (all workspaces, under check.lock) | exit 0, 0 errors. Log `~/x2f-comms/rv-traded-pastrep2-tsc.log`. |
| Trial `git merge-tree` with the main line 16f37629 | clean. The main line moved since round 1, but only for web/design changes. |
| 307-319 migrations across all `origin/*` | 307 lead-sessions only; 308 reviews-api (old) + traded-pastrep; 309 reviews-api + traded-pastrep; 310 past-rep (old) + traded-pastrep. No other 310. |

Not run: web vitest (the web diff is comments only), Playwright, copy-lint, semgrep (RAM was 0.9-1.8 GB available).

## Open questions (lead / owner; with recommendation)
1. **(M3, limits) A ceiling on a moderator-entered verified figure?** Recommend a hard cap per claim (e.g. $10,000,000), refused as `bad-amount`, with the number from the owner. This is unchanged from round 1 Q2.
2. **(I1 + M1, landing; technical, the lead's call)** Land only 1a99f7b9 or a descendant; never R2 or R3 alone. Optionally mark `wip/third-p5-past-rep` and `wip/third-p5-reviews-api` as "do not land" in the handoff.
3. Round 1 Q3 (should an overturned trade stay in the traded total) and Q4 (the meaning of "overturned") are still open, and both are tied to I2.
