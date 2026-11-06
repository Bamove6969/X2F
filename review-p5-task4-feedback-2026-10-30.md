# Review: Plan 5 Task 4, platform feedback ("How's X2F doing?"), API part (first review)

- Branch `wip/third-p5-feedback` @ 2f18d9b (on main line 5c4d35b, merge-base = origin/claude/compassionate-johnson-k95ssr), by claude3.
- Reviewer: read-only helper, 2026-10-30.
- **Verdict: APPROVED WITH MINOR** (no Critical, no Important).

## Checks run (own detached worktree ~/x2f-worktrees/rv-p5t4 @ 2f18d9b, npm ci, under flock; worktree removed)
- `tsc --noEmit` apps/api: 0 errors.
- `vitest run test/feedback.test.ts test/feedbackForm.test.ts test/purge.test.ts test/schema.test.ts`: 4 files, 143/143 passed.

## What the plan asks vs what is built
| Plan 5 Task 4 item | Status |
|---|---|
| Migration 302 `platform_feedback(id uuid, mood check, note ≤ 500, created_on date)`, no account column, no time of day | Built (`apps/api/migrations/302_feedback.sql`); also no FK, `gen_random_uuid()`, index on `created_on`. Schema introspection test pins it. |
| `POST /v1/feedback { mood, note? }` requireTrader → 202; in-memory 3/account/day; nothing about the sender stored or logged | Built (`apps/api/src/feedback/mood.ts`), `touch: false` (lead call of 2026-10-29b applied here too), 4th = 202 with nothing stored, failed insert refunds. Log-capture tests (note text and route never logged on 202/400; 500 logs only type+code). |
| `purgeFeedback(db, now)` 365 days, run by `startRetention` | Built; in `RETENTION_JOBS` after `purgeFeedbackForm`; 364/365/366-day boundary test. |
| `GET /staff/v1/feedback?before` (perm `feedback.read`), roles.ts perm + NAV.owner, matrix row, staff-web Feedback page | **Owed to Plan 4** (packages/staff, staff API and apps/staff-web are not on the main line). `listFeedback` (keyset cursor, needs the id too) and `feedbackMoodCounts` (30 days) are ready; three local-tree tripwires (`NEEDS_P4_FEEDBACK_READ_PERM`, `NEEDS_P4_STAFF_FEEDBACK_ROUTE`, `NEEDS_P4_STAFF_WEB_FEEDBACK_PAGE`) with paths that match Plan 4's layout (`apps/api/src/staff/*`, `buildStaffApi`, `apps/staff-web`); recorded in docs/coordination.md. Consistent with Task 21's `NEEDS_PLAN_4_STAFF`. |
| File names | Plan says `feedback/routes.ts` and `retention/scheduler.ts`; built as `feedback/mood.ts` and `retentionJobs.ts`, matching what Task 21 actually landed (`feedback/form.ts`). Fine. |

## Task 21 overlap (feedback form, on the main line)
- No duplication or conflict: separate table (`feedback_form` 306 vs `platform_feedback` 302), separate route (`/v1/feedback/form` vs `/v1/feedback`), separate purge jobs, separate in-memory maps. The only shared code is `HIDDEN`, now exported from `form.ts` (a pure export, no behaviour change). Validation mirrors Task 21's (CRLF normalise, trim, code-point length, hidden-character refusal, unknown keys refused).
- Migration 302: no other branch uses 302 (checked every remote branch: only `wip/third-p5-reviews-api` has a 3xx, `301_reviews.sql`). Applying 302 after 306 on an existing database works (migrate applies missing names); schema tests updated in all three lists.

## Linkability analysis (the focus)
- Row: mood, note, day, random uuid. No account, session, device, address, time, serial, FK. Response body `{}` (no id echoed). List order inside a day is by random uuid, so it reveals nothing.
- Session: `touch: false`, so the request writes nothing to `sessions` (requireSession only selects). No other write in the request.
- Logs: request logging is off (R5); the 202 and 400 paths log nothing; the 500 path logs `{method, route, err.type, err.code}` with a time, but on that path no row exists, so nothing is linkable.
- Rate-limit map: `accountId → count` only, never written anywhere, cleared on the first request of a new UTC day; holds no row ids or times. Bounded by the number of trader accounts that sent that day (one entry each). A restart forgets it; with several API processes the cap is 3 per process. Both accepted by P5-A19 ("in memory only"), same as Task 21.
- Over-limit path returns faster (no insert); this only tells the sender what they already know.
- Database residual (xmin/ctid order) is the same as Task 21's and is referenced in the file header. See M1 for a second residual that is not recorded.

## Findings

### Critical
None.

### Important
None.

### Minor

**M1. Day-level correlation residual not recorded** (`apps/api/migrations/302_feedback.sql:4-7`, `docs/coordination.md` Task 4 section).
The prompt is shown only after a trader's 1st completed trade and every 10th (`shouldAskFeedback`, P5-A19), and trades (and `account_totals`) carry completion dates. Scenario: on a quiet day only one account reaches its 1st or 10th completed trade; the owner (the only `feedback.read` holder, who also has database access) sees one `platform_feedback` row with that `created_on` and knows who sent it, for the 30 days the trade survives, and via running totals possibly longer. Nothing in the code can fix this short of coarsening the stored date; it is inherent to "keep the day". Fix: record it in the coordination residual note next to xmin/ctid (and optionally let the staff page show the week, not the day). Owner/lead call; no code change required.

**M2. No shared flood budget across accounts** (`apps/api/src/feedback/mood.ts:104-131`).
Already flagged by the author as a lead call. Scenario: an attacker with K accounts (each needs a full trader session) writes 3K rows a day, up to 500 characters each, burying genuine notes on the owner's page for a year. Task 21 has a 30/10-per-minute shared bucket; here a visible 429 is ruled out by "the 4th is still 202". If wanted: a shared per-day or token-bucket cap that silently drops (202, nothing stored) bounds storage, at the cost that a flood also silently drops genuine sends. Acceptable as is; lead's choice.

**M3. Merge note misses the Plan 7 retention branches** (`docs/coordination.md` "Expected merge with Task 20 rest"; `apps/api/src/retentionJobs.ts:14`; `apps/api/test/purge.test.ts:149`).
`origin/wip/lead-p7-retention` and `origin/wip/lead-p7-retention-t20` rewrite `RETENTION_JOBS` as a multi-line array and append `purgeTradesJob` after `purgeFeedbackForm` (and `purgeChatsJob` before it). Scenario: whoever merges second resolves only against the note's one-line form and drops `purgeFeedback` or `purgeTradesJob` from the array or from purge.test.ts's `toEqual`. The order itself is harmless (`platform_feedback` is independent of trades and chats), so any position works, but the note should name the full target, e.g. `[purgeExpired, purgeRemovedWalletAddresses, purgeTradeAddressesJob, purgeNudges, purgeChatsJob, purgeFeedbackForm, purgeFeedback, purgeTradesJob]` in both files. The required Task 20 order (purgeChatsJob before purgeFeedbackForm) is respected by the note.

### Notes (no action)
- `listFeedback` returns `id` (needed for the keyset cursor) although the plan's GET shape lists only `{ mood, note, createdOn }`; recorded in coordination. The id is random, so exposing it to the owner is harmless.
- Lone UTF-16 surrogates pass `HIDDEN` (it covers Cc/Cf, not Cs) and are stored as U+FFFD by the driver; same as Task 21, harmless.
- The route refuses held, recovery and stale-Terms sessions (plain requireTrader), unlike Task 21's form, which is correct: this prompt follows a completed trade and is not a refusal channel. No `CantDoThat` is involved (the API answers only 202/400/401/403).
- The web card (Task 6) is not part of this branch and is correctly recorded as such.
