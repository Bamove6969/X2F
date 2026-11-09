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
