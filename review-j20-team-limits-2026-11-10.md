# Security review: wip/second-team-limits (J-20: member trade-size band, working hours, first-login notice), 2026-11-10

Reviewer: independent security reviewer (read-only on code).
Branch: `origin/wip/second-team-limits`, head `d3053141` (READY), base `wip/lead-team-perms-port-2 cba502d2`
(the abilities catalogue of review-team-perms-2026-11-09.md). Seven commits: `9935286a` RED tests, `995ed353` API,
`32fb1b9b` web, `345da7a6` tests, `ee3db26c` e2e, `7321a9ca` web fix, `d3053141` READY notes. 31 files, +1183/-34.
Throwaway worktree `.claude/worktrees/rv-j20`, `npm ci` clean, removed after the review.

Rows: S-091 (p7-4 band), S-096 (p7-11 hours), S-107 (p11-27: first login = notice + Jabber, no approval;
supersedes S-095). Owner words checked in `pc-local/owner-answers-raw/.../p7-4.json`, `p7-11.json`,
`owner-answers-page11-2026-11-08.md` p11-27.

## Verdict

**Approve the security content for the lead's batch, with one owner decision to take before it lands (F1)
and one engineering fix the lead can do in the merge (F2).** Every check the job asked for holds, with
file:line below: the band and the hours are enforced server-side, inside the same transaction and from
the same locked `team_members` row as the ability check (`assertLiveMember`), on every member action that
writes a trade or an offer; a member cannot set any limits (403 `owner-only`, their own included); the
lead's change goes through the confirm (bound to the exact band and hours, and the PGP text names both)
and, from a username-and-password session, through hold v3 staging and the 24-hour wait; hours are
enforced at login, on every request (the session is revoked), in the action's transaction, and by a
one-minute sweep; "any" is the explicit default; the first login raises an alert and a push to the lead
and there is no approval gate anywhere. Migration 380 is in J-20's range and in all three schema lists.
No catalogue row changed. Tests were red first and nothing was weakened.

What does not match the job's own wording: the band is in **XMR atomic units**, not the USD equivalent at
market that the take and every other size on the site uses (F1). The builder flagged this as choice 1 for
the lead; it is an owner question with a product consequence (fiat-priced offers are refused outright for
a banded member, F3). The Jabber half of S-107 is not built, because no outbox exists on this base (F4).

## Tests run (serialised runner, single files, Node 24.22.1)

| File | Result |
|---|---|
| apps/api/test/teamLimits.test.ts (new) | 13/13 passed |
| apps/api/test/coolingOff.test.ts (changed) | 90/90 passed |
| apps/api/test/schema.test.ts (changed) | 74/74 passed |
| apps/api/test/teamAbilities.test.ts | 14/14 passed |
| apps/api/test/team.test.ts | 70/70 passed (1 run) |
| apps/api/test/frontDoor.test.ts | 19/19 passed |
| packages/accounts/test/confirmAction.test.ts (changed) | 29/29 passed |
| `npx tsc -p apps/api --noEmit` | exit 0 |

Not run: apps/web/test/team.test.tsx and apps/web/e2e/team.spec.ts (changed, web/Playwright; the builder
reports 28/28 Playwright team.spec), packages/auth-client tests, the full API project, Monero regtest.

## Findings

### F1 (Major, owner decision before landing): the band's unit is XMR, not the trade's USD value at market

`apps/api/migrations/380_team_limits.sql:9-10` stores `band_min_atomic` / `band_max_atomic` (numeric(30,0),
XMR atomic). `apps/api/src/team/limits.ts:176-198` `assertInsideBand` compares `trades.amount_atomic` and an
offer's `min_atomic`/`max_atomic` with it. The owner's words (p7-4) are "from this size to this size"; the
unit is undecided. Everywhere else the platform values a trade's size in US cents at market: the take
(`trades/take.ts:301-303` `usdCents` → `checkStarterLimits`), the stage caps (`traders/stage.ts:76-92`),
the offer list's `opensAt` (`offers/routes.ts:526-528`), the dispute's large-trade limit, past-rep. The job
brief for this review says the band is valued "the way the take values it (USD equivalent at market)". A
lead thinking "this member handles trades up to $500" cannot express that: an XMR band drifts with the
price, and the builder's own hint copy says so ("Offers priced in fiat are outside any limit").

Not a hole: with an XMR band the check is exact and price-feed-free, and fails closed. But it is the
owner's product decision and the brief's wording points the other way.

Recommendation (Q1): store the band in US cents. Value a trade by `trades.usd_cents` (migration 301: set
at take from the same `usdCents` the caps use, immutable by trigger), which needs no price feed in the
action's transaction and never moves. Value an offer's range at the current market quote with
`usdCentsOf` exactly as `opensAt` does (an XMR range converted at the quote, a fiat range through the
currency's quote), refusing 409 `price-unavailable` with no quote, as the take does. The confirm text then
reads "trades of $50 to $500". If the owner prefers XMR, keep the branch as is and record the choice.

### F2 (Medium, engineering; fix in the merge): the band also blocks pausing and removing offers, and a fiat offer cannot even be shut off

`assertInsideBand` runs for `offer-paused` and `offer-removed` (`offers/routes.ts:618`, and the bulk route
`:828`) and refuses any offer whose range reaches outside the band, and every fiat-ranged offer
(`limits.ts:194`). Pausing and removing reduce the account's exposure; the codebase treats shutting off as
the action that must always work (lead decision R10: pause and remove work on stale Terms; the
offers-pause box is "Pause or resume"). A banded member with `offers-pause` therefore cannot pause the
lead's fiat offers in an emergency, and the bulk "pause all" of a banded member fails whole (one refusal
throws inside the transaction, so nothing is paused). The builder lists this as choice 3.

Recommendation: band only the actions that create or enlarge exposure (post, relist, the bulk switch to
`live`, trade events); let pause and remove through for any offer. If the owner wants pause/remove banded
too, at least make the bulk route report `outside-trade-band` per offer (as it reports `too-many-offers`)
instead of failing the batch. Owner question Q2.

### F3 (Medium, consequence of F1; owner question): fiat-ranged offers are refused outright under a band

`limits.ts:193-194`: `amount_unit !== 'xmr'` → 403 `outside-trade-band`. A banded member with the Offers
preset cannot post, relist, pause or remove any offer kept in fiat, which is the common way to post. With
F1 resolved towards USD this goes away (a fiat range compares directly); with XMR kept, the alternative is
to convert the fiat range at the current quote (as `minFiatNow` does for `opensAt`). Builder's choice 2.

### F4 (Medium, scope; not a hole): the Jabber notice of S-107 is not built; there is no outbox on this base

The owner (p11-27) wants "a notification and even a Jabber notification" on a member's first login. The
branch raises the in-app alert `team-member-first-login` and a `new-login` push (`auth/sessions.ts:278-282,
300`) and leaves `NEEDS_JABBER_NOTICES` at `sessions.ts:277`. Nothing on cba502d2 is an outbox: the
only Jabber code is the ban seam (`bans.ts`, `NEEDS_JABBER_SETUP`); `wip/lead-jabber-notices` is a separate
branch. So "queued through the existing outbox (dark)" was not possible here. The alert kind is a stable
key the jabber-notices job can route. Recommendation: the lead adds `team-member-first-login` to the
jabber-notices event list when that branch lands, and W-021 (the Jabber settings page) lists it.

### F5 (Minor): the first-login alert fires inside the join, so the lead gets three alerts for one event; the real join path is untested

`routes/team.ts` (webauthn and pgp `second/*/finish`: `startSession` right after `finishMember`): the join's last step calls `startSession` → `openSession`, whose
member branch (`sessions.ts:224-237`) now sets `first_login_at` and adds `team-member-first-login`
(`:278-281`), right after `finishMember` added `team-member-joined` and before the usual
`team-member-login`. That is correct by the owner's words (the join is the first login) and the migration
relies on it (`380:28`: joined members are marked), but the lead's alert list shows joined + first login +
login at the same minute. `teamLimits.test.ts:330-346` seeds a joined member directly and logs in through
`/t/login`, so the join route's behaviour is inferred, not pinned; `team.test.ts:279` only asserts
`toContain('team-member-joined')`. Recommendation: a test on the real join asserting the three alerts, and
an owner/design question whether `team-member-first-login` should be skipped when it coincides with
`team-member-joined` (Q3).

### F6 (Minor): a member's session keeps an `expiresAt` past the window; staff sessions do not

The staff pattern (`staff/login.ts:100-102`) caps the session end a client sees at `windowEndsAt`. For
members the branch enforces the end server-side three ways (per request `sessions.ts:441-445`, the
one-minute sweep `limits.ts:222-242`, the S-m4 refusal `limits.ts:114-119`) but `/v1/account/me` still
reports the session's own `expiresAt`, so the web's session countdown can show a time the member will
never reach, and the ending comes as a 401 `outside-login-hours`. Not a security gap. Recommendation: the
member's `sessionInfo` reports `min(expiresAt, workingUntil)`, as staff does (engineering; design wording
for the "your hours ended" screen is `cantDoCodes.ts`'s existing `outside-login-hours`).

### F7 (Nit): the RED commit carries production helpers

`9935286a` "RED" adds `teamLimits.test.ts` together with migration 380, `errors.ts` codes and 203 lines of
`team/limits.ts` (the parsers, keys and band check). The tests still could not pass on it (no route, no
`hours` column read in sessions, no audit wiring), so red-first stands, and the feature commit's only test
edit (`995ed353`: the OPEN window moved from 14:00 to 13:00 so the window ends inside the 2-hour session,
`workingUntil` adjusted) sharpens the test rather than weakening it. Noted for the lead's commit hygiene only.

### F8 (Nit): a member cannot see their own limits

`GET /v1/account/me` carries no band or hours for a member (`routes/account.ts`), so a member learns their
band only from the 403 and its copy (`cantDoCodes.ts`). The error body does carry `{ minAtomic, maxAtomic }`.
Owner/design question (Q4) whether the member's screen should show "You handle trades of X to Y; your
hours are ...".

## The five checks

### 1. The band: server-side, same transaction, same locked row, every member action

- One gate: `team/audit.ts:139` `auditMember` → `assertLiveMember(q, actor, need, now, { tradeCode, offerId })`,
  which reads `abilities, band_min_atomic, band_max_atomic, hours` from `team_members ... for share`
  (`audit.ts:176-193`) and runs the box check, the hours check and `assertInsideBand` on that one row,
  inside the caller's transaction. A lead's `PUT limits` (`applyLimits`'s UPDATE, `limits.ts:207-210`)
  waits on that share lock, so a limits change and a member action serialise.
- Trade events: `trades/routes.ts:165,176` inside `applyEvent`'s transaction after the trade row lock and
  `requireLiveSessionInTx`; the amount is `trades.amount_atomic` of the same trade (`limits.ts:179`; no code
  path updates `amount_atomic`). Tested above, below and inside, with the state unchanged and no audit row
  on refusal (`teamLimits.test.ts:202-226`); the lead is never limited (`:221-223`).
- The member's `confirm-cancel` read-side record: `trades/routes.ts:151-152` passes `tradeCode` too.
- Offers: post (`offers/routes.ts:565`, after the insert, same transaction, rolled back on refusal), relist
  (`:611`), pause/remove (`:618`), bulk switch (`:828`, one row per offer). The whole XMR range must be
  inside (`limits.ts:195`); tested `teamLimits.test.ts:238-257`, including the lead's own big offer the
  member cannot pause. See F2/F3 for pause/remove and fiat.
- Take, wallet set, identity: `ownerDeviceOnly` refuses every member (`trades/take.ts:233`,
  `trades/identity.ts:16`); when lifted, `trade-taken` (`take.ts:340`) and `trade-wallet-set` (`:400`) already
  pass `tradeCode`, and the trade row exists in the transaction by then, so the band will apply.
- Disputes: open is owner-only (`disputes/routes.ts:244`, D-066); appeal passes `tradeCode` (`:301`); the
  dispute view is a read (no band, hours yes).
- Chat: no chat route names a member (`chat/routes.ts:49` `requireSession({ kinds: ['trader'] })` → 403
  `owner-only`, C-019), so "chat about a trade above the band" cannot happen.
- Notes, hold approve/cancel, feedback: no trade or offer, so no band; hours apply (`assertLiveMember`).
- Reads (trade, offers list, dispute view, confirmations) are not banded (builder's choice 4); the owner's
  words are about creating and completing, so this is consistent. Owner question Q5 if he wants trades
  outside the band hidden.
- A member cannot raise their own band: `PUT /v1/team/members/:id/limits` is behind `owner =
  requireSession({ kinds: ['trader'] })` with no `member` (`routes/team.ts:230,292`) → 403 `owner-only`,
  tested with a member holding offers, trades and hold-end (`teamLimits.test.ts:173-178`). A member with
  `hold-end` cannot bring a staged `team-limits` change forward, nor a `hold-cancel` member cancel one, on
  themselves: `NAMES_MEMBER` and `refuseNamingMember` include `team-limits` (`holdChanges.ts:104,107-113`,
  used at `:228,256`).
- Valuation: XMR atomic, exact (F1).
- The lead's change under hold v3: `preHandler: [owner, checkLimits, requireVendor, requireNotHeld,
  requireConfirm(team-limits bound to memberId + bandKey + hoursKey)]` (`routes/team.ts:292-295`); body
  parsed before the token is spent (`checkLimits`, `:159-165`; tested `:146-171`: a token for other limits
  is 403 and the bad bodies are 400 with the good token still usable). Strong session → `setLimits` →
  `ownerWriteGate(strong: true)` under the account lock (`members.ts:334`, re-checking live session, hold,
  strength and vendor). Weak session → `gateChange` stages `{ kind: 'team-limits', memberId, band, hours }`
  (`routes/team.ts:302-307`), live member re-checked; applies 24 h after submission through `applyLimits`
  with `parseBand`/`parseHours` re-run (`hold.ts:299-303`); tested at the minute boundary
  (`teamLimits.test.ts:180-198`). `LIVE_SESSION_ROUTES`, `HOLD_BLOCKED_ROUTES` (`hold.ts:593,693`) and
  `OWN_DATA_WRITES` (`frontDoor.ts:165`) list the route; the coolingOff route-list counts were raised, not
  loosened (`coolingOff.test.ts:1648-1651`). `actionInput.ts:50` accepts only keys `bandFromKey`/`hoursFromKey`
  round-trip (`limits.ts:142-165`), so a token can only ever be issued for a canonical band and hours.
  The PGP/sheet text names the exact band in XMR and the exact hours (`confirmAction.ts:117-119,136-158`;
  tested `confirmAction.test.ts:23-28`), better WYSIWYS than the boxes change (review M3).
- A weak lead's narrowing also waits 24 h (builder's choice 7), the same as boxes; safe, slower. Q6.

### 2. Working hours: server-side, in the member's zone from the server clock, sessions cut

- Model: `@x2f/staff` `LoginHours` (`packages/staff/src/hours.ts:10`), `'any'` or `{ days, start, end, tz }`;
  `validateHours` checks weekday names, HH:MM, start ≠ end, a known IANA zone (`:30-44`). `inWindow`
  converts the server's UTC instant into the zone's wall clock with `Intl` (`:74-100`), DST-aware, with
  overnight windows. The DB check allows only `"any"` or an object (`380:17-19`); any stored value that
  fails `validateHours` counts as outside (`limits.ts:84-96`), so a corrupt row fails closed.
  Note: "enforced in UTC" in the job's wording is satisfied in the sense that the instant is the server's
  clock; the schedule is interpreted in the zone the lead chose, which is what the staff app does.
- Login refused: `sessions.ts:235` 403 `outside-login-hours` (tested `teamLimits.test.ts:261-269`).
- Every request: `sessions.ts:441-445` revokes the session and closes its streams, 401
  `outside-login-hours`, before any route logic (tested `:271-289`).
- In the action's transaction: `audit.ts:193` 401 from the locked row (tested `:317-327`).
- Sweep: `endMemberSessionsOutsideHours` (`limits.ts:222-242`), wired every minute with the hold jobs
  (`main.ts:103-104`), revokes and closes streams of every live member session whose hours are not `"any"`
  and not inside (tested `:283-285`).
- New limits that shut the member out now end their sessions at once (`limits.ts:213-215`, tested `:291-298`).
- Join: the last step is refused before the setup is used (`routes/team.ts:202-206,426,470`), and
  `openSession` would refuse anyway.
- S-m4 carried: `PUT session/length` and `POST session/extend` refuse an end past `workingUntil` before any
  write or token rotation (`routes/account.ts:470,517`; `limits.ts:114-119`), tested `:300-315`.
  The TODOs are gone.
- "Any time" default: column default `'"any"'::jsonb` (`380:18`), the view shows it (`members.ts:102`),
  tested `:137`. The lead is never limited (tested `:286-287`).
- Gap noted in F6 (client-visible `expiresAt`).

### 3. First login: notice and push, no approval, works without the lead

- `sessions.ts:278-281`: `update team_members set first_login_at ... where first_login_at is null returning
  id` is the once-only switch; on the first row the alert `team-member-first-login` `{ member, method,
  deviceLabel }` goes to the team account and `push.send(teamId, 'new-login')` (`:300`). No code path
  waits for anything: `openSession` continues to issue the session. `grep` for any approval state on
  `team_members`/sessions for members finds none; the only new column is `first_login_at`. Tested
  `teamLimits.test.ts:330-346`: first login 200, `/me` 200, second login 200, exactly one first-login alert.
- `alerts.ts:35` adds the kind; the web labels it (`Alerts.tsx`, COPY-UNSIGNED).
- Migration `380:27-28` marks already-joined members so nobody is re-announced.
- Jabber: not built here (F4). Triple alert at join (F5).

### 4. Migrations and catalogue

- One migration, `380_team_limits.sql`, in J-20's 380-384 (`owner-answers-assignments.md:42`). Present in all
  three `schema.test.ts` lists (`:48,112,190`). Constraints: `team_members_band` (both null, or 0 ≤ min ≤ max,
  max > 0), `hours` check, `first_login_at`.
- `team/abilities.ts` is untouched (not in the diff); no new box, no row made grantable. The limits route
  is owner-only by construction. `ACTION_ABILITY` unchanged: no new audit action.

### 5. Tests: red first, nothing weakened

- Order: `9935286a` tests (and helpers, F7) before `995ed353` implementation; the tests reference the route,
  the view fields and `assertLiveMember`'s new signature, none of which exist on cba502d2.
- Post-implementation edits to the RED file: the window end only (F7), stricter.
- `coolingOff.test.ts` counts 2→3, 1→2, 2→3 (more gated sites, not fewer); `schema.test.ts` adds 380 to each
  list; `confirmAction.test.ts` adds two cases. No test deleted, skipped or quarantined
  (`git diff cba502d2..HEAD -- '*.test.ts*'` shows no `skip`/`todo`).
- Flake noted by the builder (`team.test.ts` "m3 custom", ordering by uuid on equal `created_at`) is
  pre-existing and not touched here.

## Owner questions, with recommendations

- **Q1 (F1). Unit of the band: XMR or USD?** Recommend USD cents, valued like the take (`trades.usd_cents`
  for a trade; `usdCentsOf` at the market quote for an offer's range). Every other size the owner has ruled
  on (caps, large-trade limit) is in USD, and a lead sets a member's authority in money terms. Keep XMR
  only if the owner says the band must never move with the price.
- **Q2 (F2). Does the band also stop a member pausing or removing an offer?** Recommend no: shutting off
  reduces exposure and the codebase lets shutting off always work. Band post, relist, resume and trade events.
- **Q3 (F5). When the join itself is the first login, one alert or three?** Recommend the lead sees
  "joined" and "first login" as one line (skip `team-member-first-login` in the join's own session) and the
  Jabber notice says "joined and logged in". Design wording.
- **Q4 (F8). Should a member see their own band and hours on their screen?** Recommend yes, in the member's
  account view (`/v1/account/me`), so they do not learn it from a refusal.
- **Q5. Should trades outside the band be hidden from the member, or only un-actionable?** Recommend
  visible (as built): a member with "See active trades" can still watch and report, and the audit log shows
  nothing they could not do.
- **Q6. A weak lead narrowing a member's limits waits 24 h too (as boxes).** Recommend keep: one rule for
  all member changes from a weak login; the lead can log in strongly to narrow at once. (S-106's spirit:
  the change waits, nothing else does.)
- **Q7 (F4). Confirm that the Jabber notice for a first login is built on wip/lead-jabber-notices**, with
  `team-member-first-login` as its event, and that W-021 lists it.
