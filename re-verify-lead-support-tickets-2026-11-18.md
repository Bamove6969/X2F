# Re-verify: `wip/lead-support-tickets` 6c673a47 (J-14 merged onto main 75f7b5b4)

Reviewer: independent security reviewer (cloud helper), 18 Nov 2026. Read-only on code. I used a detached throwaway worktree at 6c673a47 with a fresh `npm ci`. Two probe tests were written there, run, and deleted, so nothing was committed to code.

The head is merge d7577924 (origin/wip/lead-j14 65339bd6 onto main 75f7b5b4, 19 conflicts) plus two commits:
- 136c9d47: the close-other-trader assertion;
- 6c673a47: two test-expectation fixes.

Earlier rounds: `review-j14-support-tickets-2026-11-09.md` (J1-J8, R1-R8), `review-j14-sealing-2026-11-12.md` (S1-S6) and `re-verify-j14-2026-11-12.md` (S1/S2 fixed).

## Verdict: APPROVE (0 Major, 2 Minor, 3 Info). The Minors don't block. J1-J3 are still the owner's (p11-78..80), as before.

I found no data leak across traders. I found no new way for a stranger to lock or unlock an account beyond J1, and no ticket or unlock route that staff without `tickets.handle` or `accounts.freeze` can reach. I found no path that moves coins while the lock holds.

## The merge resolutions (checked)

- **keyTap.** `unlock-account` parses together with `remove-staff`, with exactly `{kind, accountId}` (a UUID, lowercased). `tapPermOf('unlock-account')` returns `accounts.freeze`. Main's `reset-staff-security` case and its owner-only perm are kept intact, and `pay-settings` → `settings.write` is kept. The unlock route also passes main's `{ sessionId }` to `consumeKeyTap` (RV5 m10), so the tap is usable only from the session that started it, and only by a holder of `accounts.freeze` (`taps/start` checks `tapPermOf`).
- **NAV_PERM / NavItem.** `tickets` → `tickets.handle` and `compromised` → `accounts.freeze`, next to main's `prices` → `stats.read`. The perms are unchanged:
  - `tickets.handle` is the owner's by role and grantable to anyone else;
  - `accounts.freeze` belongs to seniors and the owner and is not grantable (`GRANTABLE_PERMS` = `tickets.handle`, `feedback.read`).

  The staff web routes a page only for `who.nav` items (`StaffShell.tsx:189`), and the API refuses the data anyway.
- **Privilege matrix.** In `test/staff/routes.ts`, main's blur-checks row and the eight ticket rows are both present. The perms and allowed roles match the route declarations in `tickets/staffRoutes.ts:63-64, 124-125`, and the `matrix.test.ts` run passes.
- **Front door.**
  - Web: `FRONT_DOOR` = main's list + `/help/[a-z-]+` + `/support/compromised`. `/support` and `/support/:id` stay behind the door, and `frontDoor.test.tsx` pins both sets.
  - API: `PUBLIC_ROUTES` still adds only `POST /v1/tickets/compromised` (unchanged since R6).
- **Other conflicts.** Imports and registrations kept from both sides:
  - `disputes/staffRoutes`: main's F1 freeze-lift plus J-14's `tradeHeld`;
  - `disputes/timers`, `internal/routes`, `staff/app`, `retentionJobs` (`purgeTickets` after main's jobs).
- **Appeal route.** It now carries both refusals: J-14's lock check and main's hold-v3 `refuseHeldTradeEvent`. Same direction, no conflict.

## Migration 450 → 660 (checked)

- `660_support_tickets.sql` is byte-identical to 65339bd6's `450_support_tickets.sql`.
- No main migration from 451 to 550 creates or alters `tickets`, `ticket_messages` or `account_locks`, so running it later in the order changes nothing.
- 660 is unused on every remote branch I listed. The nearest is `650_lien_recovery` on the lien branches.
- The three `schema.test` lists name 660. `ticketSealing.test` pins 660 as the only ticket migration and refuses any `451_` or `ticket_sealing` file.

## The lock against main's newer code

- **FrozenWatch.** This is D-016's moderator trading freeze, a different mechanism. It runs only for a signed-in owner session, and a locked account has none (`disabled_at` refuses every session). Main's freeze-lift route can lift a freeze on a locked trade, but that only gives trading back and moves no coins.
- **Ruling executor.** `/internal/v1/watch` still reports `paused` when `lock_held` (`internal/routes.ts:418, 435`). The executor returns `'paused'` before it hands anything over (`moderation/src/execute.ts:116`). The auto-refund desk waits on the same flag (`autoRefund.ts:72`). See M2 for the missing test.
- **Ruling propose/approve on a trade locked after its dispute opened.** After the dispute timer's next pass, `paused_since` is set and `assertNotPaused` answers 409 `dispute-paused`. Before that pass there is a gap (M1).
- **reset-staff-security.** It targets staff accounts only, and `placeLock` locks only `trader` or `member` accounts. I found no path on main that clears a trader's `disabled_at` apart from `unlockAccount`. The staff switch-on and owner-setup clears touch staff or owner rows only.
- **Ban gate.** Not on main at 75f7b5b4 (no bans table or gate), so there is nothing to interact with.

## Findings

### M1 (Minor): ruling propose/approve on a locked trade is refused only after the dispute timer's next pass
`assertNotPaused` (`disputes/rulings.ts:183-193`) refuses on the dispute's `paused_since`, or on maintenance or the stop in `site_flags`. A compromised-account lock sets `paused_since` only on the next `runDisputeTimers` pass (every 30 s). Until then a moderator can propose, and a senior can approve.

Probe: lock the seller with no timer pass, then propose. The result was **200, and the ruling was published** (status `published`). After one `runDisputeTimers` pass the same propose was 409 `dispute-paused`.

No coins move while the lock holds, because the executor sees `paused` from `lock_held`. The pass then back-dates `paused_since` to `locked_at`, and on unlock `shiftDeadlines` moves the appeal window by the whole lock. But a ruling still gets published, and on round 2 it is final, against a party who was just locked out. This is the same gap main closed for maintenance ("lead follow-up to Q1": the `maintenance-before-tick` case).

Fix (engineering): in `assertNotPaused`, also refuse 409 `dispute-paused` when `tradeHeldSql` holds for the dispute's trade. Add a `locked-before-tick` case to the `rulings.test.ts` "maintenance and the emergency stop" loop.

### M2 (Minor, test gap): nothing tests the watch list's `lock_held`
No test inserts an `account_locks` row and reads `/internal/v1/watch`. Removing `|| r.lock_held` from `internal/routes.ts:435` would leave every suite green. Yet this is the one flag that stops the moderation executor and the auto-refund desk from signing on a locked trade.

My probe passed at this head: lock the buyer, the trade shows `paused: true`; unlock, it shows `paused: false`. Recommend adding it next to the hold-v3 case in `watchReports.test.ts:149`.

### I1 (Info): the two test-expectation fixes in 6c673a47 are legitimate
- `roles.test`: the owner's menu gains main's `prices` before `training`. `tickets` and `compromised` still sit before `settings`, and the senior and mod expectations are unchanged.
- `staff-web tickets.test`: the fake `taps/start` now answers with main's `honestTapStart` (X1), as main's own tests do. The assertions are unchanged, and the client now checks the unlock tap too.

Neither change weakens a test.

### I2 (Info): the new close-other-trader assertion (136c9d47) is real
Another trader's `POST /v1/tickets/:id/close` gets 404, and the owner's ticket still reads `open`. The route goes through `ownTicket(c, req.auth.accountId, id, true)` (`traderRoutes.ts:156`, filtered by `account_id` and `kind = 'support'`). With that filter removed, the status check would fail. List, read, reply and close are now all covered.

### I3 (Info): `NAV_PERM`'s test checks only `NAV[role]`, not `navFor` with grants
`roles.test.ts:84` iterates `NAV[role]`, which contains neither `tickets` nor `compromised`, so the two new `NAV_PERM` entries are not exercised by that loop. `navFor` derives them from `can(...)` directly, so they are consistent by construction. A one-line loop over `navFor(role, GRANTABLE_PERMS)` would pin them.

## Tests run (outside the lock per the 18 Nov rule, `nice -n 10`, throwaway worktree at 6c673a47)
- `apps/api`, one run of 18 files: 667 passed, 1 todo, 0 failed. The files: tickets, ticketSealing, schema, frontDoor, purge, holdV3, disputes/trader, disputes/staff, disputes/rulings, staff/keyTap, staff/login, staff/members, staff/matrix, staff/securityReset, team, watchReports, jabber-paths, timers.
- `@x2f/staff` roles, `@x2f/trade` timerLoop, `@x2f/auth-client` flows: 3 files, 123/123 passed.
- `@x2f/web` frontDoor, `@x2f/staff-web` tickets, shell, staffPages: 4 files, 118/118 passed.
- `npm run typecheck` (every workspace): exit 0.
- `npm run copy-lint`: exit 0 (`apps/web/src`, `apps/staff-web/src` clean).

Probes (written, run and deleted, not committed):
- the M1 ruling-before-tick probe: 200 published before the tick, 409 after it;
- the M2 watch-lock probe: passed.

Not run: the full `npm run check` (all vitest projects plus separation-check). The 13 Nov reviewer rule asks for it before APPROVED, but the lead's brief for this round names targeted vitest, typecheck and copy-lint only, and the full check needs the lock. Also not run: Playwright (`apps/web/e2e/tickets.spec.ts`), moderation, and Monero/regtest.

## For the lead
- M1: a two-line guard and one test case. Recommend doing it before landing, since it is the same shape as the maintenance fix.
- M2: one test.
- J1-J3 (p11-78..80) still wait on the owner, unchanged.
