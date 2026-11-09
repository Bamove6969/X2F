# Review: J-04, wip/second-timers-maint (setupMin 60; maintenance planned/unplanned)

- Branch: `wip/second-timers-maint`, head `3dde2b28`, on `wip/lead-trade-rules-p1` `1801ffb5` with main `22b379e8` merged in (82eb2754).
- J-04's own commits reviewed: 987655c2 (setupMin), 8775c2aa and e60f07d0 (API, migration 350), 9939bd28 (web), acabb93e (coordination), 70c15fb6 (test logins after the merge), c79dba82 (e2e), 3dde2b28. The rest of `1801ffb5..HEAD` is the main merge and was not reviewed here.
- Reviewer: independent, read-only (cloud lead session, 9 Nov 2026). Throwaway worktree `.claude/worktrees/rv-j04`, `npm ci` run there. No code changed.
- Owner rules checked: T-061/Q11 (60 minutes to answer a trade request), W-004/G19 (never "emergency"; planned with about 24 h notice, start and end; unplanned with minimal info and a best guess; up to 500 characters in a big bright banner), G62 (timers freeze as built).

## Verdict

**APPROVED (Minors only).** It can land as is.

## Tests run (serialised runner, single files)

- `apps/api/test/site.test.ts`: 10/10 passed.
- `apps/web/test/SiteBanner.test.tsx`: 12/12 passed.
- `packages/trade/test/machine.test.ts`: 151/151 passed.
- Not run by me: timerLoop.test.ts, the API timers/take tests, the staff route-perm matrix, schema.test.ts, and the e2e `maintenance.spec.ts`. The builder's commits report them green.

## setupMin 15 -> 60

- `TIMERS.setupMin = 60` (packages/trade/src/timers.ts) has a single consumer: `machine.ts:252` `setupBy = addMin(now, TIMERS.setupMin)`. The API reads the stored `setup_by` (take.ts:373, view, store), so nothing else needs to change.
- Moderation does not mirror setup: `apps/moderation/src` uses no `TIMERS` and no `setupBy`. Nothing to propagate there.
- No "15 min" setup copy exists anywhere in web, API or moderation src. The only 15-minute strings left are the nudge interval, the final alert, the throttle and settling, which are all different timers. The web screens use `setupBy` from the API, not the constant.
- Tests: machine.test (TIMERS, take -> setupBy, the tick past setupBy) and timerLoop.test move to the 60-minute timeline with the same assertions. The "past deadlines do not move" case was re-timed to minute 50 so that setupBy has passed while fundBy has not. That is correct, not weakened. Plan 3's Global Constraints and the Task 1 interface line are updated with the revision.
- Cosmetic: the web fixtures (tradeFund.test `setupBy` 15 min after take, e2e refundViews) still use a 15-minute gap. They are fixtures with no assertion on the gap, so no change is needed.

## Maintenance model

- **Kinds:** `MAINTENANCE_KINDS = ['planned', 'unplanned']`. `PUT /staff/v1/site/maintenance` with `on: true` now **requires** the kind (no default), and `'emergency'` is 400. Migration 350 rewrites a stored `emergency`, or an on-without-kind row, to `unplanned`. It replaces the check with `('planned','unplanned')` and adds `site_flags_maintenance_has_kind` (on implies kind). `readSiteState` no longer falls back to `'emergency'`. Tested, including that a raw `update ... = 'emergency'` violates the check.
- **Unplanned best guess:** `backBy` is optional, must be an ISO time strictly after now, and is cleared when maintenance goes off. The DB requires it to be null when maintenance is off.
- **Planned, announced ahead:** `PUT /staff/v1/site/maintenance/planned { startsAt, endsAt, message? }`: start after now, end after start. The DB checks that the plan is whole and in order. `GET /v1/site` shows `plannedMaintenance` until its end. `DELETE` → 204. Switching planned maintenance on takes over the plan's end (as backBy, while it is still ahead) and its message (when the body gives none), then retires the plan. Switching unplanned on leaves the plan alone. No minimum notice is enforced; the builder lists that as an OWNER-Q and I agree it is the owner's call.
- **500-character cap, server side:** `messageOf` trims, counts code points with `chars()`, refuses more than 500 and control characters other than a newline (400 `field: 'message'`). It is used for both the maintenance and the plan message. The DB backs it up: 206's maintenance_message check, and 350's `planned_message char_length between 1 and 500` (an empty message is stored as null). Tested at 501.
- **"emergency" in user-facing strings:** absent. In the web the kind parses to planned/unplanned (unknown or missing reads unplanned), and the chip and lines read "Planned maintenance" / "Unplanned maintenance", "Our best guess: back by …" / "Back by …". The remaining "emergency" hits are internal only: the staff key-tap intent `emergency-stop`, API comments, and the `cantDoCodes` classification text, which is a reviewer note and is never rendered. The SiteBanner test and the e2e spec assert there is no "emergency".
- **Big bright banner:** `.x2f-big-banner`, a solid caution fill with surface ink, 17/19 px, a clock icon so colour is not the only cue, `pre-line` and `overflow-wrap: anywhere` for 500 characters. It is used on the Maintenance screen and in `PlannedMaintenanceBanner`, which sits in both trader Layouts, so it covers every trader route (/sell, /buy, offers, trade room, dispute, wallets, settings, login, news …). All strings are marked COPY-UNSIGNED and DESIGN: wording.

## Trader timers during maintenance: unchanged

J-04 touches nothing under `apps/api/src/trades` or `apps/api/src/disputes`, and nothing in moderation. The trade and dispute timer loops and `cancelReturn`/`accountInactivity` key off `maintenance_since` only, not the kind, so the new kinds cannot change the freeze (G62 as built). `maintenance_since` is still kept across a re-PUT while maintenance is on (`coalesce`), so the shift covers the whole maintenance.

## Staff route: owner-only and audited

- All the routes use `perm: 'site.control'`, and only the `owner` role holds it. It is not grantable (`packages/staff/src/roles.ts`). The two new routes were added to the route-perm matrix (`apps/api/test/staff/routes.ts`, `allowed: OWNER`).
- Audit log entries: `site.maintenance-planned { startsAt, endsAt }` (never the message), `site.maintenance-plan-removed` (only when a plan was removed), and the existing `site.maintenance-on { kind }` / `-off`. Each one is written in the same transaction as its change.

## Findings

- **m1 (Minor): a change made while maintenance is already on is not logged.** A second `PUT .../maintenance {on:true}` can switch the kind (unplanned ↔ planned), set or move `backBy`, change the message, or take up and retire an announced plan. It writes no log entry, because `site.maintenance-on` is logged only when maintenance was off. The message-change gap existed before; kind, backBy and retiring the plan are new. Suggest logging `site.maintenance-on` (or a `-changed` action) with `{ kind }` whenever the stored kind, backBy or plan changes. Engineering-only.
- **m2 (Minor): `site.maintenance-on` does not record `backBy` or whether a plan was taken up.** This is optional; the detail map is `{ kind: 'id' }`.
- **m3 (Minor, owner wording / OWNER-Q, already listed by the builder):** there is no minimum notice for a plan (owner said "try and give 24-hour notice"). Planned maintenance switched on with no announced plan and no `backBy` shows no end. The Maintenance screen says nothing about timers being frozen.
- **m4 (note): the branch also carries the main merge.** `POST /staff/v1/site/auto-close/resume` (6a3bb54e, security review 8 Nov M1) shows in `1801ffb5..HEAD` but is not J-04's. It was reviewed elsewhere.
- **Migration numbering:** 350 is within J-04's assigned 350-354. J-02 uses 345. No clash.
