# Re-review round 2: Plan 3 Task 36 (My offers), 2026-10-29

Branch `origin/wip/lead-p3-task36` @ c802e66 (fix 478ddd4; main-line merges de78a86 and c802e66). Trial merges with main line `origin/claude/compassionate-johnson-k95ssr`: first @ 047b4f3 (News); final @ **9a9795c** (adds Task 5 take, landed, and docs).
Reviewer: read-only helper. Answers `review-task36-2026-10-29.md`.

## Verdict: APPROVED WITH MINOR (0 Important, 3 Minor, 1 nit)

## Round-1 findings

- **M1, fixed.** `idsFor` always returns the ticked listed ids (model.ts). The web never sends `'all'`, which stays API-only.
- **M2, fixed.** The switch and tick box are labelled by title + methods + price + limits. e2e pins the full names (myOffers.spec.ts:82-83).
- **M3, fixed.**
  - The switch's name starts with its visible "On"/"Off" (self-reference in aria-labelledby).
  - The tick box has no visible text, only an icon, so 2.5.3 does not apply. Its name "Select …" comes from a hidden span, and accname reads hidden referenced nodes.
- **M4, fixed.** `GET /v1/account/offers` returns `hidden` (routes.ts:557-579), and `statusLine` shows the reason. API test included.
- **M5, fixed.** Web `batches(…, 100)`. A partial failure says "The rest weren't changed".
- **M6, fixed.** The e2e stub marks an offer already in the asked status as done before any guard.
- **N1, fixed.** Method is checked first, as PATCH does, with a test.
- **N2, fixed.** Any string up to 64 chars that is not one of my ids gives `not-found`. It is safe: only ids found in `byId` (DB uuids) reach the `::uuid[]` update. Test included.
- **N3, fixed.** The error summary is `role="alert"`.

## R10 change (lead decision (a))

- **What a stale-Terms trader can do:** list their own offers (`GET /v1/account/offers`), bulk with `status: 'paused'`, and `PATCH { status: 'paused' }`.
- **What still needs the current Terms** (403 `terms-required { version }`, the same shape as requireSession):
  - bulk with `live` (routes.ts:617, checked before the transaction, so nothing is half-done)
  - PATCH `live` and PATCH `removed` (:452)
  - `POST /v1/offers` (still `requireTrader`)
- No other route changed preHandler (grep of `allowStaleTerms`). The offersBulk R10 test pins every case above.
- In the web, Turn on on stale Terms gets a 403, and api() redirects to /terms.
- **Does `hidden` leak anything?** No. It is computed only from the caller's own `trading_holds` row and the global `site_flags`, and only for the caller's own offers. It does not read blocks, other accounts or `LISTED`'s poster joins. Blocks (Task 37) are not built and `LISTED` does not use blocks.
- `hidden` matches `LISTED`: no site_flags row counts as paused (fails closed), plus the hold and `isAvailable` (`GET /v1/offers` returns [] for an unavailable method).

## Board behaviour (origin/wip/design-brief docs/design-boards/MyOffers.dc.html)

These match the board:
- per-offer tick box plus its own switch
- "Select all" only ticks or clears, with `aria-checked` mixed
- the "Selected offers" bar with "N selected", Clear, Turn on, Turn off
- the board's title, methods, price and limits lines
- the On/Off status wording and the footnote (cap sentence left for Task 34, noted)
- Post an offer at the end

These are deliberate and acceptable:
- Edit is deferred to Task 35.
- The selection is kept when the call failed (the board always clears).

## Minor

**m1. Removing an offer still needs the current Terms.**
- Where: apps/api/src/offers/routes.ts:452 (`if (status !== 'paused') await assertTermsCurrent(…)`).
- Scenario: a trader who won't accept new Terms wants to delete an offer for good. They get 403 and can only pause.
- Removing is a "shutting things off" action too, so (a) arguably covers it. Nothing is live, so there is no risk either way.
- Lead call: either allow `removed` on stale Terms too (change `!== 'paused'` to `=== 'live'`) or record "remove needs Terms" in coordination.md. The test at offersBulk.test.ts:376 pins today's choice.

**m2. The `requireSession` doc comment is now wrong.**
- Where: apps/api/src/auth/sessions.ts:188, which says "R10: only logout, me, terms, methods and sessions routes set it".
- The offers list, bulk status and PATCH now set it too.
- Scenario: a later reviewer or builder trusts the comment, treats `requireTraderStaleOk` as a violation, or misses it when auditing R10.
- Fix: add "and turning offers off / reading my offers (Task 36, lead decision 2026-10-29)".

**m3. The take vs bulk race test is now owed by Task 36's landing.**
- Task 5 landed first, at 3b35ccf on 9a9795c, without the take vs bulk race test that coordination.md asked of whoever lands Task 5. There is no `account/offers/status` use anywhere in apps/api/test outside offersBulk.
- The lock analysis still holds against the landed take.ts:254-266:
  - The take locks accounts {taker, poster} `for update` in id order, then the offer `for share`, then site_flags `for share`.
  - The bulk locks accounts(A), then site_flags `for share`, then A's offers.
  - Both lock A before any A offer row, so there is no cycle.
- Even so, nothing pins this. Scenario: a later change makes the take lock the offer before the accounts. That deadlocks with a bulk pause, and no test catches it.
- Fix at the Task 36 landing merge: add to offersBulk.test.ts a race of `take` on A's offer against A's `status 'all' paused` (and B's bulk where B is the taker). Expect no 500/40P01, and expect the offer to be either taken while live or paused with no trade. Update the coordination.md line to say Task 36 owes it.

## Nit

- n1. The Selected offers bar is rendered after the list and footnote (MyOffers.tsx:259). It has no CSS of its own (NEEDS_DESIGN_MYOFFERS), so with many offers it sits below the fold. Someone who ticks the first offer sees no bar appear; screen readers do get the aria-live "N selected". The board's bar presumably sits at the bottom of the screen. Fix it when the board lands, and add it to the tripwire note.

## Merges

- **de78a86 / c802e66:** `NOT_AUTH_CLIENT` has no duplicate and is sorted. It has `GET /v1/trades/:code/confirmations` once, plus `GET /v1/trades/:code/dispute` and the Task 27 POST routes. flows.test.ts's own "sorted, once each" test passes.
- **Trial merge with 047b4f3 (News):**
  - One textual conflict in apps/web/src/App.tsx, imports only: `MyOffers` and `News`. Keep both lines, in that order (alphabetical). The routes `/profile/offers` and `/news` merged clean.
  - flows.test.ts auto-merged (`GET /v1/news` added, no duplicate).
  - No lockfile change.

## Tests (own detached worktree, each step under check.lock)

| Step | On c802e66 (includes main line 990affe) | On c802e66 + 047b4f3 trial merge |
|---|---|---|
| tsc api / web / auth-client | 0 / 0 / 0 | 0 / 0 / 0 |
| api vitest (offers, offersBulk, schema) | 3 files, 113 passed | 3 files, 113 passed |
| auth-client vitest | 5 files, 70 passed | 5 files, 70 passed |
| web vitest (full) | 64 files, 933 passed | 66 files, 946 passed |
| Playwright myOffers + post | 25 passed | 25 passed |

### Final run: c802e66 + 9a9795c (Task 5 landed), fresh worktree, npm ci (lockfile unchanged), one step at a time under check.lock

- tsc api / web / auth-client: 0 / 0 / 0.
- api vitest (offers, offersBulk, schema **+ take**): 4 files, **147 passed**.
- auth-client vitest: 5 files, **70 passed**. NOT_AUTH_CLIENT is sorted with no duplicates after Task 5's and News's additions.
- web vitest (full): 66 files, **952 passed**.
- Playwright myOffers + post: **25 passed**.
- On 4d75461 (a run that died in e2e): web vitest 66 files / 950 passed. That run is superseded by the run above.

## Landing notes

- Merge with the current main line (9a9795c): the only conflict is still the App.tsx import (`MyOffers` + `News`; keep both). docs/coordination.md and flows.test.ts auto-merge.
- Task 5 has landed without the take vs bulk race test; Task 36's landing adds it (m3).
