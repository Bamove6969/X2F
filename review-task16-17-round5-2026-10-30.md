# Review round 5: Plan 2 Tasks 16 and 17, the round-4 fixes, 2026-10-30

Branch `wip/lead-p2-task17` @ `fdd56ab`. Diff base `git merge-base fdd56ab origin/claude/compassionate-johnson-k95ssr` = `5c4d35b`. The Task 9 files from merge `5193e11` were ignored (moderation, trade machine/watch, `trades/timers.ts`, internal watch routes). New since round 4: `6f6e8b6` (red tests), `21f324e` (fixes), `fdd56ab` (auth-client helper). Round 4: `review-task16-17-round4-2026-10-30.md`.

## Verdict: APPROVED WITH MINOR (0 Critical, 0 Important, 2 Minor, 3 Nits, 1 OWNER CHOICE, 1 out-of-scope note)

As far as I can tell, the class is closed. The class is a request in flight across the owner's proof, or across any other revocation of its session, that writes account, session, approval, security, wallet, push or alert state.

How the fix closes it:
- Every revocation path that matters takes the account lock: `endHoldIfOwner`, `DELETE /v1/account/sessions/:id`, `applyPassword`, `applyRemoval` and `applyOneDevice` (through `gateChange`), and `makeRoom`, `endForNewDevice` and `openSession`'s cookie replacement (under the login or poll locks).
- `requireLiveSessionInTx` re-reads the session under that same lock. The check is therefore exact against those paths.
- I re-ran the round-4 reproduction shape against every listed route through the table test. I also walked each route left out of the list. None of them gives a takeover or redirects money.

The remaining findings are about keeping the class closed in future and about one residual from a lead decision.

## Goal 1: is the class closed?

**The routes in `LIVE_SESSION_ROUTES` (18): all checked, and all correct.**
- Each one calls `requireLiveSessionInTx` (or `gateChange`) as the first statement of the transaction that writes.
- `decide` takes `lockApprovals` first, then the account lock: the right order.
- `cancelRecovery` reads the caller under the lock and compares `created_at` there (`recovery.ts:242-251`).
- `POST /v1/account/push` filters the weak-cap path with the `caller` it read under the lock.
- At `6f6e8b6` the table test is red for the 8 direct routes and `pgp/finish` (the `expired` vs `not-authenticated` code). It is green for the 9 routes through `gateChange`, which already had the check from round 3. That is expected.

**The excluded routes: I tested the coordination.md reasoning.**
- **A dead session's `*/start` challenge, spent by a live session: not possible.**
  - Add-method challenges are bound to `session_id`: TOTP `totp.ts:257,272`, WebAuthn `webauthn.ts:694` (`ch.session_id === req.auth.sessionId`), PGP `pgp.ts:405`.
  - A challenge a dead session wrote can only be finished by that same session. Its finish route is in the list, so it gets 401.
- **Confirm tokens bound to a dead session: unusable.**
  - `redeemConfirm` matches `session_id = req.auth.sessionId` (`confirm.ts:72-77`).
  - Every route that spends a token and then writes is in the list. The `*/start` routes spend a token and write only a session-bound challenge.
- **`POST /v1/logout`:** it revokes the cookie's own session. It does not take the lock, but racing your own logout gains nothing.
- **Login and `poll`** run under the approvals and account locks. `poll` now requires `decided_by` to be live (R4-M2).
  - A thief login after the proof finds no hold and no trusted devices. It needs an approval that only the owner's strong session can give, because the weak sessions are gone.
- **SSE `/v1/events`** already re-checks liveness after it attaches (`events/routes.ts:78-90`). No zombie stream is possible.
- **Trading and social routes** (take, offers, offer status, trade events, identity, disputes, nudges, blocks, feedback, suggestions) have no liveness check. This is confirmed, see M2. The doc's reasoning holds for safety: none of them writes login, session, approval, wallet-list or alert-seen state.

## Goal 2: lock order and deadlocks

I found no deadlock cycle.
- **Advisory and row-lock order** is approvals, then account (`decide`, `poll`, `traderLogin`). Every new transaction takes the account lock first.
  - `DELETE /v1/wallets/:id` now takes account, then the wallets row. That matches `/v1/trades/:code/wallet` (trade, account, wallet `for share`) and `applyWallets`.
  - `POST /v1/wallets` takes `for update` before `gateChange`'s `for no key update`. That is already the stronger lock, so there is no upgrade.
- **Accounts that lock two account rows** (take, nudge) do so in id order, and none of the 16-17 paths holds two.
- **requireSession's touch** takes `for share` on the account inside an autocommit `update sessions` (`sessions.ts:285`). The subquery runs before the tuple lock, so the order is account then session, the same as `endHoldIfOwner`.
- **The only known cycle** is still the documented `NAMES_LOCK` one (R3-M5).
- See N1 for one pattern, new in this round, that is deadlock-prone but has no partner today.

## Goal 3: is the test-only trigger really test-only? Yes.

- `t_revoke_on_touch` (and round 2's `t_fail_hold` and `t_fail_password`) are created in `beforeAll` of `apps/api/test/coolingOff.test.ts:1233-1245` only.
- They are not in any file under `apps/api/migrations` or `src`. I grepped every `.sql` and `.ts` outside `test/`.
- Each test file gets a fresh database cloned from `x2f_template` (`test/helpers/db.ts:5-27`). The trigger never reaches the template, let alone production.
- Even if it were left behind, the trigger does nothing unless a row sits in `t_revoke_on_touch`.

## Goal 4: new ways to lock the owner out

I found none that a thief can trigger.
- **`APPROVAL_DECISION_BUCKET`** is keyed by `req.auth.sessionId` and runs after `requireSession` (`approval.ts:612-613`). A thief can only drain the buckets of sessions they hold. The owner's strong session keeps its own 10 tries.
- **`endHoldIfOwner` expiring waiting approvals** (`hold.ts:275-279`) can only cost the owner a re-login on another waiting device, which is the intended cost.
- **R4-M2 (an approval dies with its granter)** checks at collection time, before `endForNewDevice` revokes anything (`approval.ts:415-426`).
  - One-device mode, and choosing the approving session itself as `logOut`, therefore still work.
  - The remaining cost is UX only: the owner approves on their phone and then logs the phone out before the new device collects.
- For the residual of R4-M1's lead decision, see the OWNER CHOICE below.

## Goal 5: the unlocked `requireNotHeld` on trading routes

It cannot be exploited for takeover or money.
- **When a hold starts:** only the thief benefits from racing it (the hold starter is the thief's weak session, the thief's new-device login or the thief's backup login). They could have made the same take or offer a moment earlier, because a weak session outside a hold may trade (design).
- **When a hold ends by the owner's proof:** nothing is blocked any more, so there is no race on the hold itself.
- **Money:** a take's payout or refund address comes from the account's existing wallets (`pickWallet`, `take.ts:346-347`). A weak session cannot add a wallet without the 24 hours (N-I4). There is no way to redirect money.
- What does remain is the zombie action itself (M2).

## Minor

**M1. "The table test fails until it has a row" is only true for routes someone has already put in `LIVE_SESSION_ROUTES`.** Where: `docs/coordination.md:396`, and `coolingOff.test.ts` "the table covers exactly LIVE_SESSION_ROUTES".
- The test compares the table with the list. A new route that writes security, session or approval state, and that its author never adds to the list, fails nothing.
- That is how this class kept coming back: R3-I1 was the gate, R4-I1 was `decide`, and each time the route was simply not considered.
- Scenario: Plan 4's "disable account" or a future "trust this device" route writes session or approval state with `requireSession` only. No test flags it, and a request in flight across the owner's proof acts for a revoked session.
- Fix: add a tripwire that enumerates the app's routes (an `onRoute` hook or `app.printRoutes`).
  - Every non-GET route behind `requireSession` must be in `LIVE_SESSION_ROUTES` or in an explicit `LIVE_SESSION_EXEMPT` list with a one-line reason. That list would move the coordination.md "left out" paragraph into code.
  - Unclassified routes fail the test.

**M2. Trading routes act for a session revoked in flight (confirmed by reproduction).** Where: `trades/take.ts:222-241` (and likewise `POST /v1/offers`, `PATCH /v1/offers/:id`, `POST /v1/account/offers/status`, `POST /v1/trades/:code/events`, `/identity`, `/wallet`, disputes).
- Reproduction (scratch test in my worktree, deleted, never committed):
  - A buyer's take was fired while a separate transaction held the poster's account row. It blocked inside its transaction, after `requireSession`.
  - The buyer's session was then revoked, standing in for the owner's proof or a logout, and the holder committed.
  - Result: `ZOMBIE TAKE 200 {"code":"XVRT-…"}`, and the same browser's `GET /v1/account/me` then returned 401.
- Effect: after the owner's "the 24-hour hold ended" and "sessions ended", a trade (or an offer switched on) can still appear on the account from the thief's evicted browser.
  - There is no takeover and no money redirect: the addresses are the owner's own wallets.
  - The owner then has an unwanted trade in setup to cancel or let time out. Check whether a setup timeout or cancel counts against the owner's reputation under Task 38's cancel rules.
- It is no worse than the same take one second before the proof, which is why coordination.md leaves it out. But it breaks the promise the owner reads ("sessions ended"), and the fix is one query where the lock is already held.
  - The take already locks both accounts `for update` (`take.ts:241`). A `select 1 from sessions where id = $1 and revoked_at is null and expires_at > now` right after it closes it for take.
  - `assertMayPost` and `offers/status` lock the account the same way.
- Recommendation: add the check to the take and the offer writes, which are the ones that create new obligations. Leave trade events alone so open trades can always be finished. Otherwise, record in coordination.md that a zombie take is an accepted residual.

## Nits

**N1. `POST /v1/account/push` now takes `for no key update` and then upgrades to `for update` on the same account row** (`push/routes.ts:90-92`).
- An upgrade like this deadlocks against any transaction that holds `for key share` on that account (from an insert with a foreign key to `accounts`) and then waits for the account lock.
- I found no such partner today: `backupSession`, `traderLogin` and `POST /v1/wallets` all lock first.
- The second lock is now redundant, because `no key update` conflicts with itself, so the cap is already serialised. Drop line 92.

**N2. `weakSession` (`hold.ts:367`) is no longer called anywhere.** Every caller now uses `weakOf` on the row from `requireLiveSessionInTx`. Delete it, or keep it with a "no callers; prefer weakOf(caller)" note, so a future route does not use the unlocked read.

**N3. Coordination wording.** "every route that spends one is in the list above" is true for the routes that write after a token. The `*/start` routes also spend a token, but write only a session-bound challenge. Say so, so the next reviewer does not trip on it.

## OWNER CHOICE

**OC1. R4-M1 residual: a weak-only owner has no move against a stolen recovery code unless they already had a weak session open before the thief's backup login.**

Where: `recovery.ts:251`, together with `traderLogin` refusing every waiting login during a hold (`approval.ts:265`).

Which owners: those with no strong combination (password-only, PGP-only, PGP+TOTP), who have recovery codes.

Scenario:
1. The owner is logged out everywhere, or their only session is younger than R.
2. The thief makes a backup login with one code, which opens recovery session R and starts the hold.
3. The owner gets no push if they are logged out (the known Plan 6 gap). If they see the warning and log in with their password, they get 403 `recovery-hold`.
4. Once 24 hours pass, R has waited (`gateChange` `waited`), and its `PUT /v1/account/password` applies at once and ends every other session.

The other direction (the lead's reason): a thief's older weak session can cancel the owner's own backup sessions one after another. Each cancel spends one of the owner's codes, a stalemate that slowly drains them, but it is not a takeover.

Options:
- (a) Keep it as decided. Settings should then tell weak-only owners that "a passkey, or password + authenticator, is your only answer to a stolen recovery code".
- (b) Let a waiting login during a `weak-backup-login` hold open a cancel-only session: it may only `DELETE /v1/account/recovery-sessions/:id`, and nothing else.
- (c) Require a strong method before recovery codes can be generated.

## Out of scope (pre-existing, Plan 3 Tasks 10/25), for the lead

**X1. Any session, a weak one included (and a zombie one, as in M2), can post `POST /v1/trades/:code/final-alert-seen`** (`trades/routes.ts:121`).

This sets `final_alert_delivered` and starts the buyer's 15-minute clock after the seller asks for a refund. A thief with a password-approved weak session, working with a seller, could acknowledge the owner's final alert so the owner never sees it, and the refund then goes through.

It is the trade-side twin of N-M3 (weak sessions may not mark owner warnings seen). It is not part of this branch, but it is the one money-relevant weak-session action I found.

## Tests run

All runs were in my detached worktree `~/x2f-worktrees/rv-t1617r5`, after `npm ci` with npm 11.21.0, each under `flock ~/x2f-comms/check.lock`.

**At `fdd56ab`:**
- **tsc:** apps/api 0, apps/web 0, packages/auth-client 0.
- **api vitest:** coolingOff, deviceApproval, push, account, wallets, pgp, limits (7 files). **357 passed, 1 todo, 0 failed.**
- **auth-client vitest (5 files):** **72 passed.**

**Red tests at `6f6e8b6`:** `coolingOff.test.ts` gave **14 failed, 64 passed** (78).
- The failures are the 9 class-audit rows: the 8 direct routes and `pgp/finish`.
- They also include the R4-I1 reproduction, waiting approvals expiring, the decide throttle, R4-M2 and R4-M1 (older weak session).
- The 9 `gateChange` rows pass, as expected, because the round-3 check was already there.

**Scratch reproduction:** the M2 zombie take, in a test file added and then deleted (`git status` clean before removal).

The worktree has been removed.
