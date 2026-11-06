# Review: Plan 3 Task 37 (trader-to-trader block), round 2 (fix round), 2026-10-29

Branch `origin/wip/lead-p3-task37` @ `6e02e10`. The fixes are 4a24433 (api) and 8fb9059 (web). The main line was merged by hand twice: b3e7599 at e07bd76 (with 0daaa13), and 990affe at 6e02e10. Round 1: `review-task37-2026-10-29.md`.

## Verdict: APPROVED (0 Important, 2 Minor)

Every round-1 finding is fixed as the builder claims. Neither main-line merge caused a regression. The 202-but-undelivered nudge leaks nothing I can find.

## Round-1 findings

- **I1, fixed.** The `/v1/methods` route (`methods/routes.ts:81`) now calls the exported `viewer()` and passes `viewerId` through `LiveOfferQuery`.
  - `liveOfferStats` adds `not blockedEitherWaySql('o.account_id', '$4::uuid')`, so the count and `min`/`max` both come from the filtered rows.
  - A null viewer (logged out) is unchanged, and an injected `deps.liveOffers` just ignores the new optional field.
  - The new test covers all of these: the blocked person sees 1 offer at the other poster's price, matching their list; the blocker, a third party and a logged-out viewer still see 2 at the blocker's price; unblocking restores it.
- **M1, fixed.**
  - **Server:** the DELETE is one statement, a `with who …, gone as (delete … using who where b.account_id = $1 …)` on `display_key = lower($2)`, with no name-shape or reserved-word check. Postgres runs a data-modifying CTE even when nothing reads it, so the delete always happens. It stays scoped to the caller's own rows. A 404 means only that no account has that name. The test sets the name to `'x'` and unblocks it as `X`.
  - **Web:** Blocked.tsx drops a row on a 404 only if a re-read of the list confirms the row is gone; otherwise it keeps the row and shows the error.
- **M2, fixed.**
  - **BlockAction:** focus goes to the question when the confirm opens, back to "Block X" on Cancel or an error, and to the focused `role=status` note after a block.
  - **Blocked:** has a live region that is always mounted. The row's button stays in place and uses `aria-disabled`, not `disabled`, so focus survives; `toggle` guards double clicks with `busy`. Unblock turns the row into an undo (re-block).
- **M3, fixed.** Security has a "Blocked traders" card that links to `/settings/blocked`.
- **M4, fixed.** The coordination.md leak line now names recovery sessions and recovery holds, and `viewer()`'s doc says every 401/403 gives a null viewer.
- **M5, fixed.** The tripwire now uses `/['"`]\/v1\/traders\//`.
- **M6, fixed.** Nudges are dropped when either trader has blocked the other (`nudge/routes.ts:131`); a test covers the blocker sending to the blocked person.
- **M7, fixed.** The copy now says "while they're signed in" and stays `COPY-UNSIGNED`.

## Does the 202-but-undelivered nudge leak anything? No.

- **Response and timing:** the response is the same `{ok:true}` 202. The queries are the same and run in the same order, inside the same transaction; the only change is the `blocked` expression inside the one facts query. Delivery runs in `setImmediate` after the reply, so the sender cannot time it.
- **Counters:** the row is recorded with `delivered=false`, so the sender's 10-minute gap starts exactly as for every other silent drop. The recipient's 3-an-hour budget counts only delivered nudges, so a dropped nudge cannot be found by watching that budget, and the sender never sees the budget anyway.
- **The sender's own view:** no route returns a sender's nudge history or the `delivered` flag (`GET /v1/account/nudges` is settings only).

## Main-line merges

- **App.tsx:** the `DisputeScreen` (Task 27) and `Blocked` imports and the `/settings/blocked` route sit side by side. There are no duplicate routes, and `app-routes.test.ts` passes.
- **flows.test.ts:** `NOT_AUTH_CLIENT` has no duplicate entries. It includes Task 24's `GET /v1/trades/:code/confirmations` and both block routes, sorted, and auth-client passes.
- **Remaining diff:** the diff of `6e02e10` against the main line (990affe) contains only Task 37 files (20 files).

## Minor (new)

**N1. Nudges inside an open trade are now dropped both ways, but the copy says open trades "aren't affected".** `apps/api/src/nudge/routes.ts:131`; `apps/web/src/screens/settings/blockCopy.ts:15`.
Today the only shared context for a nudge is an open trade (`tradeSharedContext`), so "either way" now covers every nudge.
Scenario: seller A blocks buyer B in the middle of a trade. B pays and taps Nudge to wake A to release. B gets a 202 and nothing is delivered. A, in turn, cannot nudge B to pay.
Half of this was already true from Task 26 (B to A was dropped before). But the confirm copy promises "Open trades with them aren't affected. They finish normally", and the lead decided that open trades continue to the end.
Lead call, either:
- (a) keep nudges inside a trade context despite a block, and drop them only for offer-chat contexts (Task 20), which is what M6 was about; or
- (b) add "nudges" to what a block stops, even in open trades, and adjust the copy.

**N2. The visible label and the accessible name differ** (WCAG 2.5.3, label in name). `apps/web/src/screens/settings/Blocked.tsx:144,148`.
The visible text is "Undo" / "Unblock". The accessible names are "Block X again" / "Unblock X".
Scenario: a voice-control user says "click Undo" and nothing matches, because "Undo" is not in "Block X again".
Fix: visible "Block again" (or keep "Undo" and make the accessible name "Undo: block X again").

## Test runs

All in my own detached worktree `~/x2f-worktrees/rv-t37` @ 6e02e10. The trial merge of the main line (990affe) said "Already up to date", then `npm ci` with npm 11.21.0. Everything ran as one script under a single `flock ~/x2f-comms/check.lock`, with no nested flock.

- **tsc:** apps/api, apps/web and packages/auth-client all exit 0.
- **api vitest:** 8 files, 247 tests passed (offers, account, blocks, block-tripwires, nudge, view, schema, methods).
- **auth-client vitest:** 5 files, 70 tests passed.
- **web vitest (full):** 64 files, 932 tests passed.
- **Playwright** block + quote + security (X2F_CHROMIUM_PATH=/usr/bin/chromium): 51 passed.

No process of mine was left running afterwards; Playwright's web server exited with the run.

### Re-run on the new main line 047b4f3 (News landed)

I trial-merged `origin/claude/compassionate-johnson-k95ssr` @047b4f3 into 6e02e10 in the same worktree.

- **One conflict: `apps/web/src/App.tsx`.** Task 37's `/settings/blocked` route and News's `/news` route sit on the same line. Resolve by hand by keeping both routes. Both imports (`News`, `Blocked`) merged on their own.
- **`flows.test.ts` merged cleanly** (`GET /v1/news` was added).
- **No lockfile change.** The only change to `apps/api/package.json` is a `news` script.
- **News does not touch offers, presence or blocks.**

Results after the merge, under the same single lock:
- **tsc:** api, web and auth-client all exit 0.
- **api vitest:** 8 files, 247 tests passed (the same 8 files).
- **auth-client vitest:** 5 files, 70 tests passed.
- **web vitest (full):** 66 files, 945 tests passed, `app-routes.test.ts` included.
- **Playwright** block + quote + security: 51 passed.

Afterwards I aborted the trial merge and removed the worktree. No process of mine is left running.

## Landing conflict notes

- **Main line 047b4f3:** the `App.tsx` route line, as above. Keep both routes. The lead must merge the main line before landing, or resolve this at landing.

The pending branches below were checked with `git merge-tree` against 6e02e10. All of these are keep-both.

- **`wip/lead-p3-task5`:** conflicts in `app.ts`, `schema.test.ts` and `flows.test.ts`. All of them also conflict against the bare main line, so Task 37 adds nothing new. In `flows.test.ts`, keep the sorted list, with `POST /v1/offers/:id/take` next to the block routes. Then NEEDS_TASK_5_BLOCK fires until `trades/take.ts` calls `assertNotBlocked`.
- **`wip/second-p3-task20-rest`:**
  - New from Task 37: an import-block conflict in `apps/web/src/screens/quote/Quote.tsx`. Keep `useSession` and Task 20's `goLogin` and `OfferChatPanel`.
  - The other conflicts exist against main too.
  - After landing, NEEDS_TASK_20_BLOCK and NEEDS_TASK_20_BLOCK_UI fire, as intended.
  - The NEEDS_TASK_23_CHAT and N1 decisions apply to Task 20's offer-chat nudge context.
- **`wip/lead-p5-task21`:** new from Task 37.
  - `App.tsx`: keep both the `/settings/blocked` and `/feedback` routes.
  - `Quote.tsx`: keep both Task 37's `session`/`myName`/`blockedPoster` state and Task 21's `closedError` state.
  - Then NEEDS_TASK_21_CANTDOTHAT fires: route the block refusals through `CantDoThat`.

Worktree removed.
