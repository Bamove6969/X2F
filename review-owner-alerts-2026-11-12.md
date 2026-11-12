# Security and code review: `wip/lead-owner-alerts` 9666d561 (O-040, the owner's notifications on the staff site)

Reviewer: independent reviewer (cloud helper), 12 Nov 2026. Read-only on code. Detached worktree `rv-oa` at 9666d561 (base main 6ebed537), fresh `npm ci`, removed afterwards; dockerd not restarted.
The branch is a single commit (11 files, +507/-4). It adds:
- `apps/api/src/staff/ownerAlerts.ts` (three routes), registered in `staff/app.ts`;
- three rows in `test/staff/routes.ts`;
- a new `test/staff/ownerAlerts.test.ts`;
- in staff-web: the `/notifications` page (`screens/OwnerAlerts.tsx`), the Notifications link and unread badge in `StaffShell`, `alertsCount.ts`, CSS, and a new `test/ownerAlerts.test.tsx`.

## Verdict: PASS. 0 Major, 1 Minor (OA1), 4 Info (OA2-OA5)

## The questions

**Every role except owner gets 403, including the unread count.** All three routes use `opts = { config: { perm: 'self' }, preHandler: [...requireStaff('self'), ownerOnly] }`.
- `requireStaff('self')` admits any signed-in staff member within their login hours.
- `ownerOnly` then throws 403 `forbidden` unless `req.staff.role === 'owner'`. This is the same shape as the owner-key routes.
- The unread count only exists inside `GET /staff/v1/owner/alerts`, so it is behind the same guard. There is no separate count route.
- Before the guard, anyone without a staff session gets 401 `not-authenticated`. `staff/matrix.test.ts` drives every caller through all three rows: anonymous, a trader session, a team member, helper, mod, senior, owner, a switched-off mod, an out-of-hours mod, a recovery mod, and a mod with a grant.
- The rows are not `grantable`, so a grant can't open them. Tested directly too: senior, mod and helper get `forbidden` on the list and on read-all.

**Only the owner's own rows can be read or changed.** Every query is bound to `account_id = req.staff.accountId`: the list, the count, read-all's update, and the per-id update and its follow-up select. `addOwnerAlert` writes one row per enabled `kind = 'owner'` account, so each owner sees only their own copy.
- Tested: the owner can't list or mark a moderator's alert.
- Not asserted: that the moderator's row is still unseen afterwards. The SQL makes that certain, since the `where` names the owner's account.

**The 404 on someone else's alert id, and whether it reveals that the id exists.** It doesn't.
- `POST /:id/read` first runs `update ... where id = $1 and account_id = $2 and seen_at is null`. When nothing changes, it runs `select 1 ... where id = $1 and account_id = $2`.
- Another account's id, a random UUID that exists nowhere, and an id that isn't a UUID all get the same 404 `not-found`. Both queries run the same way in the first two cases, so the timing reveals nothing beyond noise.
- An id of the owner's own that is already read gets 204, which only tells the owner about their own row.
- The id is lower-cased before the query, and the UUID check runs first, so nothing malformed reaches Postgres as a cast error.

**The cursor is validated.** `parseCursor`:
- a non-string (for example `?before=a&before=b`, which arrives as an array) gets 400;
- the value must split into exactly `<iso>_<uuid>`;
- the ISO part must match `YYYY-MM-DDTHH:MM:SS.mmmZ` and `Date.parse` must be finite;
- the UUID must match;
- anything else gets 400 `bad-request` (tested with `nonsense`).

The values are bound as parameters (`$3`, `$4::uuid`), never interpolated. Every insert into `alerts` binds a JS `Date` (`alerts.ts`, `auth/throttle.ts`), so `created_at` has millisecond precision. The `toISOString()` cursor therefore names the last row exactly, and `(created_at, id) < (...)` neither skips nor repeats a row at a millisecond tie (tested: two pages of 50 and more, no repeat). See OA3 for one leniency.

**`staff.alert-seen` is logged only when a row actually changes.**
- Per id: the log runs only when the update's `rowCount > 0`. Marking an already-read alert again returns 204 and logs nothing (tested).
- Read-all: the update has `seen_at is null`, and the log runs only when `rowCount > 0`. With nothing unread it logs nothing (by reading the code; untested, see OA1).
- Both logs are written inside the same `withTx` as the update, so a log failure rolls the change back. That keeps the lead's 7 Nov M1 rule: a stolen session cannot silence an alert without a trace.

**The route matrix rows are complete.** There are three rows:
- `GET /staff/v1/owner/alerts`
- `POST /staff/v1/owner/alerts/read-all`
- `POST /staff/v1/owner/alerts/:id/read`

Each has `perm: 'self'` and `allowed: OWNER`, matching the code. The matrix's coverage test, which checks every registered staff route against a row, passes with them.

**Other roles never call the API.**
- `StaffShell`'s effect returns early unless `who.role === 'owner'`, and the Notifications link is rendered only for the owner.
- The `/notifications` route renders `<NothingForRole />` for anyone else, so `OwnerAlerts` (which fetches on mount) is never mounted for them.
- Tested: for a mod, no request starts with `/staff/v1/owner/alerts`, and `/notifications` shows nothing of the page.
- The server is the real gate in any case: a hand-made request from another role gets 403.

**No test was weakened.** The diff touches one existing test file, `test/staff/routes.ts`, and only adds the three rows. Everything else in the test diff is new.

## Minor

### OA1: two small test gaps
- Read-all's `staff.alert-seen` log is not asserted, and neither is its no-log case when nothing is unread.
- The other-account 404 test doesn't assert that the other account's row stays `seen_at is null`.

The code is right in both places, but these are the guarantees M1 depends on, so they should be pinned.

## Info

- **OA2. The log entry says that an alert was hidden, not which one.** `staff.alert-seen` has the empty detail schema from `log/actions.ts` (the existing `/staff/v1/account/alerts/:id/seen` route uses it the same way). An owner reviewing the log after a stolen session learns something was marked read, not that it was the "New login" alert. Consider `{ kind }` for a single alert and `{ count }` for read-all, which reveal no person or address. That is a schema change, so it belongs to the lead.
- **OA3. The cursor's date isn't checked against the calendar.** `Date.parse('2026-02-31T00:00:00.000Z')` is finite (it becomes 3 March), so a hand-made cursor for a date that doesn't exist is accepted as the next valid moment. It only moves a page boundary of the owner's own list, so it's harmless. A round-trip check (`new Date(at).toISOString() === at`) would make it exact.
- **OA4. The badge reads a whole page.** On every route change (and after each action) the shell calls the list route for `unread`, which fetches up to 51 rows with their full `detail`. That's fine at the owner's volumes, but a count-only answer (a `?count` flag, or `limit 0`) would be lighter. Separately, after Mark as read or Mark all the page reloads only the first 50, so any "Show older" pages collapse. That's UX only.
- **OA5. `detail` goes to the browser in full.** The page uses only `message`, `kind` and the times, but the API returns each alert's whole `detail`. A login alert's detail holds the method and device label, for example. It is the owner's own data on the owner's own session, as on the existing account-alerts route, so this isn't a leak. Trimming it to what the page shows would be the minimal choice.
  - Related: the owner can now mark their alerts read through two routes, this one and `/staff/v1/account/alerts/:id/seen`. Both are owner-bound and both log, which is consistent, but worth knowing.

## Tests run (serialised runner)
- `apps/api` `staff/ownerAlerts.test.ts` + `staff/matrix.test.ts`: 108/108 passed (2 files)
- `apps/staff-web`, the whole suite (`ownerAlerts`, `shell`, `screens`, `oneDoor`, `inviteTerms`): 50/50 passed (5 files)
- `tsc --noEmit` on `apps/api` and `apps/staff-web`: clean

Not run: the rest of the API suite, Playwright, `npm run check`.
