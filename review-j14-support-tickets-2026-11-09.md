# Security review: J-14 support tickets and the compromised-account lockout, `wip/second-support-tickets` 41751b28

Reviewer: independent security reviewer (cloud helper), 9 Nov 2026. Read-only on code.
Base: wip/third-p4-task16 169fa1d6, plus a main merge f8ccad2a (22b379e8). The branch's own work is f8ccad2a..41751b28 (45 files).
Register rows: D-055, D-057, D-059. Owner words: owner-answers-2026-10-30-lead-window.md lines 5-10 (q32, ~11:00/11:20/11:50), Q54 (the login name is private), Q67/Q69 (10 a day, shared across a team), G7 (a held trade: both can enter, chat, reach moderators, no coins move).

## Verdict: CHANGES REQUIRED before landing (owner decisions needed; the engineering is sound)

The mechanics are careful:
- The lock sets `disabled_at`, which every session and every login finish already refuses, and it revokes every session and stream.
- Trades are held at the trade store, the timer loop, the dispute timers and the moderation watch list.
- The unlock needs `accounts.freeze` plus a bound key tap.
- No login name is stored or logged, request bodies are redacted in logs, and the logs carry ids only.

The problem is the trust model. As built, one anonymous request that knows a login name freezes an honest trader's account and every open trade, with no proof and no recourse but staff. Two Major findings (J1, J2) and one Major gap on unlock (J3) need owner calls.

## Findings

### J1 (Major, owner decision): an anonymous freeze with no proof; mass griefing is possible
`POST /v1/tickets/compromised` takes `{loginName, methodsLeft, comment}` with no session and no proof of any kind, and it locks the matched account at once.

The limits:
- 3 sends per typed name per day (`daily_counts` keyed by the HMAC tag). This is irrelevant, because one send is enough.
- The app-wide login-start bucket, 120 a minute. Attack arithmetic: about 170,000 locks a day from one script with a name list.
- There is no per-IP, proof-of-work or captcha step.

The lock lasts until a senior moderator or the owner unlocks it, and every open trade of the victim is frozen with it (J2).

What limits the attack today:
- Login names are private (Q54).
- Staff and owner names are never locked.
- The answer is the same for every name.

But login names leak in many ways: people reuse their display name, ex-team members know them, there are phishing pages and old screenshots. The owner explicitly left "griefing by someone who knows a username" open on 30 Oct.

The owner's own words were "enters the USERNAME, then whatever credentials they still have" and "fills in the credentials asked". The branch instead tells the person "Never type a password or a code here" and collects only method kinds. That is a reasonable safety choice, but it changes the owner's spec and removes the only possible proof. It must go to the owner, not be decided here.

Options for the owner (recommendation first):
- (a) **Verified freeze at once, unverified freeze queued.** If the sender proves any one credential still on the account (password, recovery code, passkey/security key, PGP, TOTP), using the existing finish code without opening a session, the full lockout happens at once, as now. With no proof, the ticket goes to the staff queue with a high-priority flag and staff decide within minutes. A thief who changed everything is still covered: the real owner usually still has the recovery code, which was designed for exactly this (owner, 1 Nov).
- (b) Keep the anonymous instant freeze, but add a per-source limit (a per-IP or proof-of-work budget separate from login starts), a cap on locks per hour app-wide that alerts staff, and a page for the frozen user to see why (they get a bare `account-disabled` today).
- (c) Keep it as built: accept the griefing risk, and accept that staff must clear false locks by hand.

### J2 (Major, owner decision, G7): the counterparty of a held trade cannot open a dispute
`applyEvent` refuses every non-system event on a held trade, "the other party's neither" (store.ts, 409 `trade-held`). `POST /v1/trades/:code/dispute` goes through `applyEvent(..., side)`, so the honest counterparty cannot open a dispute while the other side is locked, for as long as the lock lasts.

Coins never move, which matches G7 and D-059. But G7 also says that on a held trade "both people can still enter it, chat and reach moderators". Combined with J1:
- A griefer who knows the counterparty's login name can freeze a trade they are in.
- A cheat can freeze their own account mid-trade, typing their own name.

In both cases the honest side has no dispute button and no clock, only a generic support ticket. Dispute timers are correctly paused (disputes/timers.ts), so opening a dispute would cost nothing.

Recommendation: let `open-dispute` (and only that) through on a held trade, with its timers paused from the start, so a moderator sees the case. Also show the counterparty a "this trade is held by X2F staff" state instead of a bare 409. The owner should confirm this reading of G7 against D-059's "paused until staff resolve".

### J3 (Major, lead/owner): unlock restores every old credential, the thief's included
`unlockAccount` clears `disabled_at` and ends the lock, and that is all. The account comes back with every login method it had, including a password, passkey or recovery code the thief stole or added. The thief can log in the moment staff unlock it, possibly before the real owner does.

The owner's flow is "then they log back in and set up security again", so the re-setup has to be forced, not hoped for. Recommendation (engineering shape, behaviour for the owner):
- On unlock, the account comes back in a recovery-only state: the next login must replace the methods.
- Or staff choose which methods to revoke as part of the unlock tap (the `unlock-account` intent would carry the list).

At minimum, write the unlock in the staff runbook as "remove the compromised methods first", and add a test that pins whichever is chosen.

### J4 (Minor): a timing oracle on whether a login name exists
For a matched trader, `afterLock` (revoking sessions and pausing each open trade in its own transaction) runs before the 202 is sent. An unknown name returns fast, a real one slowly, in proportion to its open trades.

The body is identical, as intended, but timing reveals that a private login name exists (Q54), which helps password guessing. Fix: send the 202 first and run `afterLock` after the reply. The trades are already held from the commit, via `tradeHeldSql`, so nothing waits on it. Alternatively, pad to a fixed time.

### J5 (Minor): the compromised form shares the login-start bucket
`req.server.budgets.start.take()` means a flood of compromised reports starves every login start site-wide, and each report also writes a ticket row. This is the same class as the existing start endpoints, but this one writes. It goes with J1(b): give the form its own budget.

### J6 (Minor): ticket text is stored in plaintext, and staff reads are not audited
- `ticket_messages.body` (support threads and the compromised comment) is plaintext in Postgres. The form says never to type secrets, but people will paste passwords, codes and addresses into "Tell us what happened". Other sensitive free text is sealed at rest on other branches (Jabber addresses with X2F_JABBER_KEYS). Consider sealing ticket bodies, or at least the compromised comment, with a staff-side key. This is a lead call, and it does not block launch if bodies stay out of logs. They do: `req.body` is redacted by the logger, and `ticket.replied` logs ids only (asserted by a test).
- `GET /staff/v1/compromised/:id` shows a locked account's open trade codes, states and sides, plus the comment, with no audit entry. `GET /staff/v1/tickets/:id` is not audited either. Writes are logged (`ticket.replied`, `ticket.closed`, `account.unlocked`). Recommendation: log `compromised.viewed` (ids only), as dispute evidence reads are logged.

### J7 (Minor): test gaps
- The lockout test logs in again with `/t/login`, which skips `assertNotDisabled` ("the test login skips the finish's assertNotDisabled"). No test finishes a real password, recovery-code or passkey login against a locked account.
  - The code is right: `assertNotDisabled` is called in password.ts, recovery.ts, totp.ts, login.ts and approval.ts, and `requireSession` checks both `disabled_at` and `member_disabled`.
  - On whether recovery-code logins should be blocked: yes. A recovery login is the thief's best tool, so blocking it during the lock is correct.
  - Add one test per finish path (at least recovery code and password) so a refactor cannot open it.
- No test covers a dispute open by the counterparty on a held trade (it is refused today; see J2 for the behaviour to pin).

### J8 (Info, merge notes)
- `apps/api/src/internal/routes.ts` `/internal/v1/watch` is edited here (`lock_held`) and on launch-rules (final-alert removal, p6-1). This is a textual conflict: keep `lock_held` in the `paused` expression.
- Owed to J-06 (already in docs/coordination.md): ruling execution must refuse to move coins on a held trade.
- Migration 450 is in J-14's own range, so no clash.

## What is right (checked)
- **One open ticket per account, 10 a day per account, shared across a team (D-055, D-057, Q67, Q69).** Enforced under the account row lock, with a partial unique index `tickets_one_open`, so a parallel burst opens one (tested). Feedback per member is untouched.
- **Full lockout at once.** `disabled_at` is set in the ticket's transaction. Every request of any session gets 403 `account-disabled` from the commit on, then sessions are revoked and streams closed. Offers drop out of `LISTED` and push subscriptions are dropped by trigger. A member login: that member's sessions are revoked and the member account is disabled, and the team owner is not locked (tested).
- **Paused trades behave as held.**
  - The timer loop pauses them and never resumes them while held, through maintenance too.
  - Dispute timers pause from the later of the lock and the opening, and shift on unlock.
  - `/internal/v1/watch` reports them paused from the commit, so moderation signs nothing.
  - System and chain events still record.
  - All of this is tested.
- **The freeze is reversible only by staff.** `accounts.freeze` (senior moderator and owner), with an `unlock-account` key tap bound to the account id and logged `account.unlocked`. Close is refused while the account is locked. A pre-existing disable survives the unlock (tested).
- **Never stored or logged:** the typed login name (only the keyed tag is used, for the daily count), secrets (the form takes method kinds only), and ticket text in the log (ids only). Staff and owner names are never locked, and the response is identical for them.

## Tests run (3 single files, serialised runner)
- `apps/api/test/tickets.test.ts`: 14/14 passed.
- `apps/api/test/disputes/trader.test.ts`: 19/19 passed.
- `packages/trade/test/timerLoop.test.ts`: 20/20 passed.

Not run (capacity rule): purge, schema, staff roles/login/members, team, the web and staff-web unit tests, and the Playwright specs.

## Owner questions (with recommendations)
1. **Proof before an instant freeze (J1).** Recommend (a): instant full lockout when one credential still verifies; without proof, an urgent staff-queue ticket. Also confirm that "never type a password here" replaces "whatever credentials they still have".
2. **Can the other side of a held trade open a dispute (J2)?** Recommend yes: the dispute is recorded with its timers paused and no coins move.
3. **What does the unlock restore (J3)?** Recommend a forced security re-setup at the next login, or staff revoke the compromised methods in the unlock tap.
4. Chat channels (W-015/W-016): still placeholders, as expected.

## Re-verify 3a438934 (10 Nov 2026, security re-verifier, read-only on code)

Branch `wip/second-support-tickets` at 3a438934 = merge b8dc5743 of main 58f3d186 + 5cbc0574 (e2e), 6b099383 (red tests), e34f8155 (J4-J6 fixes), 3a438934 (READY). Branch-only source changes after the merge: `apps/api/src/limits.ts`, `log/actions.ts`, `tickets/staffRoutes.ts`, `tickets/traderRoutes.ts`, `test/tickets.test.ts`, `apps/web/e2e/tickets.spec.ts`, `docs/coordination.md` (7 files, +186/-11).

### Verdict: PASS for the engineering minors J4, J5, J7 and the audit half of J6; J1-J3 untouched as required. One declared deviation (J6 sealing not built, left to the lead), two information notes from the merge. Nothing blocks landing once the owner answers p11-78..80.

Counts: 0 Major, 0 Minor blocking, 1 deviation (R4), 2 Info (R7, R8).

### Findings

**R1. J1-J3 behaviour unchanged since 41751b28 (checked).** `git diff 41751b28..3a438934` is empty for `apps/api/src/tickets/lock.ts`, `tickets/held.ts`, `disputes/timers.ts`, `trades/timers.ts` and `migrations/450_support_tickets.sql`. `trades/store.ts` differs only by main's final-alert retirement; the trade-held refusal at `store.ts:359-360` (409 `trade-held`) is as reviewed. `tickets/traderRoutes.ts` changed only on the J4/J5 lines: the form still takes method kinds, no credential proof, and locks at once with no per-source limit (J1 as built); the counterparty's dispute is still refused via `applyEvent` (J2, now pinned at `tickets.test.ts:493-507`); `unlockAccount` (`lock.ts:126-132`) still restores every method (J3). LEAD-HANDOFF line 155 confirms J-14 is held on owner p11-78..80.

**R2. J4 done as recommended; residual is constant-size.** `traderRoutes.ts:296-344`: budget take (299), form parse (300), name tag (301), per-name daily cap (302), then ONE transaction (304-324) that always runs the lookup under every key of the ring (307), inserts the ticket and comment, and calls `placeLock` only for a matched trader/member (322). The 202 is returned at 343; `afterLock` (session revokes, trade pauses) is scheduled on `reply.raw` `finish`/`close` (340-341) with a `started` guard, so it runs only after the response is flushed; a failure logs `lock-after-failed` (ids only) and the app's `onClose` waits for pending runs (238, `afterLocksSettled`). No early return; same code path for every name. Residual: `placeLock` (`lock.ts:52-68`) still runs before the reply for a matched name: one `select ... for no key update`, one select, two writes, one log row, constant-size and not proportional to open trades or sessions (the oracle the review named). Not padded; I consider the remaining difference inside database jitter. The lock must be in the ticket's transaction (D-059 "at once"), so this is the right place for it. Test `tickets.test.ts:406-430` holds a trade row open on another connection and proves the 202 arrives within 3 s regardless, the trade is held from the commit (`tradeHeldSql`), and the pause and revokes complete afterwards.

**R3. J5 done.** `limits.ts:91` `COMPROMISED_BUCKET = { capacity: 30, perMinute: 30 }`, its own `TokenBucket` at `limits.ts:192` (`budgets.compromised`), taken at `traderRoutes.ts:299`; the login-start bucket (120/min) is no longer touched by the form. Refusal: `limits.ts:58-59`, 503 `busy` with `retryAfterSeconds`. 30/min app-wide (1,800/h ceiling) is sane for a form a person uses once; the 3-a-day-per-typed-name cap still applies. Test `tickets.test.ts:433-446`: an empty start bucket does not stop the form, an empty form bucket answers 503 `busy` and leaves the start bucket's tokens untouched. Still app-wide, not per source: J1(b)'s per-IP/proof-of-work budget remains with the owner.

**R4. J6: staff reads audited (done); ticket text NOT sealed (declared deviation).**
- Audit: `staffRoutes.ts:86-87` logs `ticket.viewed`, `:165-166` logs `compromised.viewed`, in their own `withTx` after the read and before the response (a failed log write fails the request). Registered at `log/actions.ts:171-174` with `{ ticketId: 'id' }` only. Test `tickets.test.ts:449-468` asserts both rows with actor `staff`, and that no log row contains the ticket text ("kumquat"). The staff list routes (`staffRoutes.ts:68`, `:128`) return ticket rows without bodies or the comment, so they need no audit row. Request bodies stay redacted (`app.ts:191`).
- Sealing: `ticket_messages.body` is plain `text` (`450_support_tickets.sql:48`); there is no seal/open call anywhere under `apps/api/src/tickets/`. `docs/coordination.md:765` says "sealing ticket bodies at rest (J6) is a lead call, not built". The codebase's helpers exist (`auth/keystore.ts` key ring, `totp.ts:66-71` `sealSecret`/`openSecret`, `accounts.ts:53` `sealNames`), so this is a scoped follow-up, not a design problem. The original J6 said sealing "does not block launch if bodies stay out of logs", and they do. The lead decides whether to require it before landing; I do not.

**R5. J7 done.** `tickets.test.ts:471-492` stores a real Argon2id password via `hashPassword`, proves `/v1/login/password` answers 200 before the lock, then after the report both `/v1/login/password` and `/v1/login/backup { kind: 'recovery-code' }` answer 403 `account-disabled`, the recovery code stays unused, and no live session exists. Code: `password.ts:259` and `recovery.ts:169` call `assertNotDisabled` before the code is consumed (`recovery.ts:170`). Also `:493-507` pins today's J2 behaviour (counterparty's dispute 409 `trade-held`, no dispute row). Not covered by a test: passkey, PGP and TOTP second-factor finishes (`login.ts:75`, totp, approval call `assertNotDisabled` in code); the review asked for password and recovery code at least, which is met.

**R6. Main merge checked.** `PUBLIC_ROUTES` differs from main 58f3d186 by exactly one entry, `POST /v1/tickets/compromised` (`frontDoor.ts:196-199`); `frontDoor.test.ts:91-100` asserts the set of unguarded routes equals `PUBLIC_ROUTES`. The other five ticket routes are in `OWN_DATA_READS`/`OWN_DATA_WRITES` (`frontDoor.ts:69-71`, `:133-136`). `/internal/v1/watch` keeps `lock_held` in the query (`internal/routes.ts:344`) and in `paused` (`:359`). Migration 450 is in all three schema lists (`schema.test.ts:46`, `:110`, `:186`). The web screen `/support/compromised` is a front-door screen (`apps/web/src/session/frontDoor.tsx`); e2e adjusted accordingly (`apps/web/e2e/tickets.spec.ts`, not run here).

**R7 (Info). The merge resolution added two held-trade refusals that were not at 41751b28.** (a) `POST /v1/trades/:code/appeal` now refuses a held trade, 409 `trade-held` (`disputes/routes.ts:282-285`); the appeal goes through `applyDispute`, not `applyEvent`, so before the merge an appeal on a held trade was allowed. (b) Task 11's moderator freeze refuses a held trade, 409 `freeze-not-allowed` (`disputes/staffRoutes.ts:546-548`, `:570-574`). Both are in the direction of D-059 and the review's reading of J2, both are tested (`disputes/trader.test.ts:363`, `disputes/staff.test.ts:738`; not run in this re-verify), and `coordination.md:762` records them. They widen the owner's J2 question: whatever he decides for the counterparty's open-dispute on a held trade should also settle the appeal.

**R8 (Info). Test timing.** The J4 test races the reply against a 3 s timer while a trade row is locked by another connection. Correct as a proof, but on the shared 4-core box a reply that legitimately takes over 3 s would fail it. A flake risk only.

### Tests run (serialised runner, throwaway worktree `rv-j14b` with a fresh `npm ci`)
- `apps/api/test/tickets.test.ts`: 20/20 passed (14 earlier + J4, J5, J6, J7 x2 + the PUBLIC_ROUTES entry test from the merge).
- `apps/api/test/frontDoor.test.ts`: 19/19 passed.
- `apps/api/test/schema.test.ts`: 73/73 passed.
- `npx tsc -p apps/api --noEmit`: clean (exit 0).
Not run: `disputes/trader.test.ts`, `disputes/staff.test.ts` (R7's tests), the web e2e. Throwaway worktree removed afterwards.
