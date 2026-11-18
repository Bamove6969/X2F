# Review: wip/lead-staff-performance @952d69ac (Plan 4 Task 20, moderator performance)

Reviewer: independent helper, 18 Nov 2026. One round. Base: wip/lead-land-tw 001959cc (3 commits: 1551f397 red tests, 61d5ca21 feature, 952d69ac e2e CSP order).

**Verdict: APPROVE** (minors below, none blocking).

## What was checked

- **Metric maths** (`packages/staff/src/metrics.ts`):
  - Overturned: `disputes.overturned` (set by `resolveFinal` when round 2 becomes final) goes on the round-1 `CaseRow`. Round-1 cases are counted for round 1's proposer, so an overturn counts against round 1's proposer. The round-2 row is always `overturned: false` and is counted under `appeals`, never under `cases` or `payableCases`. Correct.
  - Median: middle value, or the floored mean of the two middle values; null when there are none; the input is not reordered. Correct.
  - Weeks: Monday 00:00 UTC (`(getUTCDay()+6)%7`). 8 slots, oldest first. Each slot ends at `start + 7d - 1 ms`, so the inclusive `inRange` cannot double-count a boundary instant. Cases are bucketed by publication, first replies by when they were sent. A week with no replies is null, never 0, and the line breaks there.
  - 24 h / 48 h shares: from opening to publication (`ruledAt`), inclusive `<=`. Appeals: from the appeal to round 2's `decided_at`, against `APPEAL_GOAL_H`. Percentages are floored; an empty set gives null.
  - Replied within deadline: `firstReplyAt <= replyDueAt` over every round whose first reply the person sent. For round 1 of an appealed dispute, the deadline is opening + the current first-response setting, because the row no longer keeps round 1's deadline. This is documented as a lead reading.
- **Row building** (`apps/api/src/staff/performance.ts`): `published_at` is round 1's publication only (`publishRound1`), so `r1RuledAt` is right for appealed disputes. The first replier is taken from the activity log (`chat.message-sent`, `actor_kind='staff'`), from round start up to the stored first-reply time inclusive. The messages route writes the log entry and the machine's reply with the same `now`, so the inclusive bound is correct.
- **No trader data**: the responses hold staff id, display name, role and numbers only. The SQL selects no trade code or trader field into the output. The API test checks that every seeded trade code (with and without dashes) and every trader id and login name are absent from both endpoints.
- **Owner only**: `perf.read` is in owner's role set only. It is not in `GRANTABLE_PERMS`, so no grant can widen it. `roles.test` pins it as owner-only. Both routes are in `STAFF_ROUTE_ROWS` with `allowed: OWNER`, so `matrix.test` covers them. The API test also checks 403 for senior, mod and helper, even on their own row.
- **SQL injection**: `period` is checked against the `PERIODS` whitelist (400 `bad-request` otherwise) and is never put into SQL. The interpolated SQL fragments are constants. `:id` goes through `idParam` and `$1`.
- **CSP / inline styles**: there is no `style=` in StaffPerformance.tsx, WeekBars.tsx or WeekLine.tsx. Chart colours come from theme tokens through classes, with a forced-colors fallback. The e2e checks for a CSP violation before the parity harness runs (Playwright not run here).
- **Chart accessibility**: each SVG has `role="img"` and an `aria-label` that lists every weekly value (the line chart also gives the deadline). Each chart has a figcaption. "Show as table" gives an 8-row table equivalent. The toggle has `aria-pressed` and `aria-describedby` set to the name cell. The period select has a label. The global `:focus-visible` ring (web base.css) applies.
- **Tests weakened**: none. The diff only adds test lines (+694 across 5 test files, 0 removed).

## Spot-mutations (6, all caught)

| # | Mutation | Caught by |
|---|---|---|
| M1 | median even count -> upper middle value | metrics.test (2 fail) |
| M2 | week starts Sunday | metrics.test (3 fail) |
| M3 | replied within deadline `<=` -> `<` | metrics.test (1 fail) |
| M4 | settled within 24/48 h `<=` -> `<` | metrics.test (1 fail) |
| M5 | round-1 row `overturned` forced false (API) | performance.test (2 fail) |
| M6 | perm widened to `disputes.handle` (config + preHandler) | performance.test 403 test + matrix.test (6 fail). Changing only the preHandler is refused by the app's declared-perm check at build. |

## Test runs (worktree rev-staff-perf at 952d69ac, `nice -n 10`, outside the lock per the 18 Nov rule)

- `@x2f/staff` metrics.test.ts + roles.test.ts: 104/104 pass
- `@x2f/staff-web` performance.test.tsx: 6/6 pass
- `@x2f/api` staff/performance.test.ts + staff/matrix.test.ts: 135/135 pass
- `tsc --noEmit` for packages/staff, apps/api and apps/staff-web: clean
- Not run: the full `npm run check` (the job asked for targeted runs only) and the Playwright e2e `performance.spec.ts`.

## Minors (non-blocking)

1. Week buckets are Monday 00:00 UTC, which is Sunday 17:00 BC time. That matches the plan, but the owner reads BC time, so a Sunday-evening ruling lands in the next week. This is an owner reading if he cares.
2. Round 1's reply deadline for appealed disputes uses the *current* first-response setting, so a later change to that setting rewrites history for those rows. This is documented. Storing `replyDueAt` in `round1` would fix it later.
3. `caseRows` loads every dispute, with two correlated log subqueries per row, on each request, whatever the period. That is fine at current volume (there is an index on `activity_log (trade_code, id)`). Filtering by period in SQL would help later.
4. The hover readout works only with a mouse; the hit rects cannot be focused. The aria-label and "Show as table" cover it, so this is acceptable.
5. When the chart fails to load, the top fault notice shows, but the row stays "Hide chart" / pressed with no panel. This is cosmetic.
