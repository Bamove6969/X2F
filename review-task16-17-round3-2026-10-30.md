# Review round 3: Plan 2 Tasks 16 and 17 (device approval, mig 013; 24-hour hold, mig 014), 2026-10-30

Branch `wip/lead-p2-task17` @ `1603ed1`. Diff base: `36e728a` (the unpushed local main-line commit, merged as `5193e11`; `git merge-base 1603ed1 36e728a` = `36e728a`). Round 2: `review-task16-17-round2-2026-10-30.md`.

## Verdict: CHANGES REQUIRED (0 Critical, 1 Important, 5 Minor)

The round-2 Critical is fixed. The password-alone takeover (N-C1) no longer reproduces, and the four Important findings are fixed as described.

One Important finding remains. It is a one-line fix: `gateChange` does not check that the calling session is still live. A thief's request that is in flight when the owner logs in strongly can start a new hold, with the thief's change pending, from a session the owner's login had just revoked. I reproduced this by calling the gate directly.

## Round-2 findings

| R2 | Status |
|---|---|
| N-C1 password alone fills the device limit | **Fixed.** During a hold, a waiting login opens no session, even on a trusted device (`approval.ts:273`). An owner-proof login is never refused: `endHoldIfOwner` runs, then `makeRoom` with `strongToo` (`approval.ts:268-270`, `147-168`). The owner's proof forgets trusted devices (`hold.ts:269`). The test (`coolingOff.test.ts:702`) is exactly the round-2 scenario. |
| N-I1 backup session outlives the owner's proof | **Fixed.** `endHoldIfOwner` revokes `level='recovery'`, every non-strong session and `started_by` (`hold.ts:254-260`). It also expires approved logins that were not yet collected. |
| N-I2 pushes silenced | **Fixed.** `DELETE` is scoped to the calling session (`push/routes.ts:125-138`). A weak session's `POST` displaces only its own subscriptions. `hold-started` is pushed with `exceptSession`. |
| N-I3 weak sessions veto or end strong ones | **Fixed.** `DELETE sessions` refuses a strong target, and refuses any other session during a hold (`account.ts:396-402`). `decide` refuses a weak session on a strong approval, on one-device logouts of a strong session, and on a `logOut` of a strong session (`approval.ts:529-530`, `546-549`, `567`). A strong login that no strong session could answer goes in (`approval.ts:288`). |
| N-I4 PGP-alone wallet | **Fixed** (lead decision). `POST /v1/wallets` is gated and held (`wallets/routes.ts`, `SECURITY_CHANGE_ROUTES`). When the hold ends by time, the wallets are usable at once (they waited once). |
| N-M1 pending login names | **Fixed.** `namesTaken` sees pending tags in both namespaces. `applyLoginName` runs under `NAMES_LOCK` and drops a tag made under a stale key. |
| N-M2 raw error on settle | **Fixed** (lead accepted drop-not-refuse). It uses a savepoint and logs only the class and code (`hold.ts:163-171`). |
| N-M3 weak session marks warnings seen | **Fixed** (`OWNER_WARNINGS`, `account.ts:427-440`). |
| N-M4 unlocked `requireNotHeld` | Note only, documented. See also R3-I1, which is the dangerous case of the same check-then-act gap. |
| N-M5 test gaps | **Fixed.** `describe('review round 2')` covers N-C1, N-I1, N-M1, N-I2. |
| N-M6 migration rename | Deploy note added. |

## Lead's two acceptances, checked for new holes

**Forgetting trusted devices on the owner's proof: no hole found.**
- After the proof the thief has no live session. Every waiting, recovery and `started_by` session is revoked, and approved logins not yet collected are expired. The exceptions are the two races in R3-I1 and R3-M1.
- The thief's next login therefore needs the owner's approval, because the owner's strong session is open and the browser is no longer trusted. It cannot be answered by a device the thief controls.
- The owner's own other browsers need an approval from the owner's session. That is friction, not a hole.

**N-M2 drop-not-refuse: no exploit found.**
- A pending change belongs to whoever queued it. Dropping it fails closed: nothing is written, the old password still works, and the alert says `applied: false`.
- A thief can only make their own change fail. They cannot make a different change apply.

## Is there an ungated route?

I re-enumerated all 58 mutating routes (`git grep "app\.(post|put|patch|delete)("`).

**Gated (`SECURITY_CHANGE_ROUTES`):** password, pgp/finish, webauthn/finish, totp/finish, recovery-codes, DELETE methods, login-name, one-device, logout-timer, POST wallets.
- Each also carries `requireNotHeld`.
- The `start` routes carry `requireNotHeld`.

**Weak-limited:** DELETE sessions, POST approvals, POST and DELETE push, alerts seen.

**Held:** offers (post, patch, status), take, wallets (add, delete), approvals.

**Left open, and fine:**
- terms (lead decision)
- confirm/*: tokens only
- trades/:code/wallet: picks an already-usable saved wallet for a trade in setup
- disputes and trade events (`FINISH_OPEN_TRADES`, lead decision)
- nudges, blocks, feedback, method-suggestions
- recovery-sessions DELETE: helps the owner
- logout

I found no tenth security route.

**makeRoom abuse.**
- Weak logins never call `makeRoom`. Only a strong login does: `strongToo` only with owner proof, else weak sessions only.
- A thief with a pre-hold strong factor is the owner as far as the server can tell. Ping-pong eviction is possible, but it ends when either side changes the password or removes the factor: after a proof there is no hold, so a strong session's change applies at once. This is inherent, not new.
- A weak session cannot get the owner's strong session evicted: the `decide` checks hold, and the one-device check holds.

## Important

**R3-I1. `gateChange` acts for a revoked session. A thief's request in flight across the owner's proof starts a new hold with the thief's change pending, after the owner believes it is over.**

Code:
- `apps/api/src/auth/hold.ts:377-383`: `gateChange` reads the session with no `revoked_at is null` and no `expires_at > now`. If the account has no running hold (`:385-386`), it starts one with `startedBy: sessionId` (`:392`).
- `requireSession` is checked once, before the transaction, so it does not help here.

Scenario: an owner whose strong proof is password + TOTP; the thief knows only the password.
1. A hold runs, started by the thief's weak session W.
2. W sends `PUT /v1/account/password` in a loop.
   - There is no rate limit on it.
   - The confirm token is redeemed only after `requireNotHeld` passes, so one pre-minted token serves every attempt.
   - During the hold, each attempt gets 403 at `requireNotHeld`.
3. The owner logs in with password + TOTP. The proof ends the hold and revokes W (`hold.ts:249-270`), and the alert says "The 24-hour hold ended".
4. One of W's attempts read its session in `requireSession` before the owner's commit, and the hold row in `requireNotHeld` after it. It then reaches `gateChange`:
   - no hold is running;
   - W's strength waits;
   - so a new hold starts with `pending_change: password` and `started_by` = the revoked W.
5. After 24 hours, `applyPassword(keep = W)` sets the thief's password and ends all of the owner's sessions.
   - The owner's strong combination (the old password plus TOTP) is now gone, and the owner has no other strong method to end the next hold.
   - The thief logs in with the new password: nothing is logged in, so the login gets a session and a hold.
   - When that hold ends, the thief queues "remove TOTP, add passkey". This is the takeover, unless the owner noticed the second `hold-started` within those 24 hours.

How likely: the window is the gap between two preHandler queries, about 1-2 ms, against an unthrottled loop. At hundreds of requests a second, the thief has a good chance on each owner login. The webauthn/pgp variants also need a challenge from before the hold, so they are much narrower.

Reproduction (scratch test, deleted):
- Steps: a passkey owner with a password; the thief logs in with the password; the owner's passkey login ends the hold and the thief's `GET /me` answers 401.
- Then `gateChange` is called with the thief's revoked session id, as if its request had passed its preHandlers before the commit.
- Result: `{ holdUntil }`, and the hold row reads `{ reason: 'weak-change', pending: 'logout-timer' }`.

Fix:
- In `gateChange`'s session query, add `and s.revoked_at is null and s.expires_at > $now`, so the call answers 401 `not-authenticated` instead. The account lock serialises the call with `endHoldIfOwner`, so the check is then exact.
- Add a regression test that calls the gate with a revoked session. Consider the same check in `weakSession` (an unknown or revoked session already counts as weak, so nothing more is needed there).

## Minor

**R3-M1. Collecting an approved login (`poll`) takes no lock and checks no hold** (`apps/api/src/auth/approval.ts:403-416`).

Two effects:
- An approval approved before a hold can be collected during it. A waiting login then opens a session during the hold, which the module comment says cannot happen. Such a session can do nothing during the hold.
- `endHoldIfOwner` revokes sessions first (`hold.ts:254-260`) and expires approvals second (`:262-265`). A poll that commits between the two statements leaves a weak session alive after the owner's proof.

Scenario: thief session W approves the thief's own second browser (a weak session may answer a weak login). W then queues a change, which starts a hold. The second browser keeps its approval uncollected (up to 5 min) and collects it just as the owner logs in. The thief cannot see when the owner logs in, so this is hard to hit.

Fix: in `poll`'s transaction, take `lockApprovals` and `lockAccount`, then run `holdInTx`. Refuse `waits(won.strength)` during a hold with 403 `recovery-hold`.

**R3-M2. A weak session can still end the owner's *weak* sessions outside a hold, and with them their push subscriptions** (`apps/api/src/routes/account.ts:396-402`; subscriptions are session-bound and dropped by trigger).

Scenario:
1. The owner's phone is logged in with a password only.
2. The thief, with a trusted-cookie weak session (no hold running), logs that phone out. Its subscription goes with it.
3. The thief queues a change. The `hold-started` push now reaches no device.
4. The owner had already got one push, `new-login`, when the thief logged in. Otherwise they find out only when they next open the app.

This is a lead call. Options: a weak session may end only itself (and recovery sessions), or ending another weak session is refused during *and* outside a hold.

**R3-M3. Copy: the login refusal during a hold is not truthful for the person reading it** (`apps/web/src/ui/cantDoCodes.ts:304-305`, through `refusals.ts` `loginCantDo('login')` → `holdSentence`).

What it gets wrong:
- On the login screen, a password login has just been refused a session. The text says only that "new trades, wallet changes and login changes wait". It never says that this kind of login cannot get in until then.
- It says "Trades already open can still be finished", which is not possible from this login.
- A password-only account is told to log in with a passkey or an authenticator code it does not have.

Fix: a login-specific sentence, for example: "Until {when} you can only log in here with a passkey, a security key, or your password and authenticator code from before the hold. Logging in that way ends the hold."

**R3-M4. Dead copy.**
- `TOO_MANY_DEVICES_LOGIN` (`cantDoCodes.ts:309`) and the `where === 'login'` branch of `loginCantDo` (`refusals.ts:78`) can no longer be reached: no login answers 409 `too-many-devices` now.
- Their comments ("the owner's own login during a hold, at the device limit") describe the round-2 hole as if it were behaviour.

Remove both, or reword them as a safety net. Update the `cantDoCodes` comment on `too-many-devices` to match.

**R3-M5. Two lock-order and notice notes.**
- **Opposite lock orders.**
  - `POST /v1/account/login-name` takes `NAMES_LOCK` first (`loginNameTaken`), then the account lock (`gateChange`).
  - Settling that account's held login name takes the account lock first, then `NAMES_LOCK` (`applyLoginName`).
  - If both run at once, Postgres reports a deadlock (40P01). That is harmless: the route answers 409 `names-unavailable`, and the settle's savepoint drops the change.
- **Owners who are logged out get no `hold-started` push.** Pushes go only to session-bound subscriptions, so an owner who is logged out (the N-C1 precondition) gets nothing. The hold's warning then depends on the owner opening the app within 24 hours. This is design scope (no out-of-band channel). It is flagged for the plan, not for this branch.

## Races and time

- `traderLogin`, `decide`, backup logins, `gateChange` and settling all serialise on `lockAccount`, and the approval paths also take `lockApprovals` first.
- A waiting login that races the owner's proof is refused before it, or after it needs the owner's approval because the device trust is gone.
- Two exceptions remain:
  - a request already past its preHandlers (R3-I1);
  - the unlocked `poll` (R3-M1).
- Every hold decision uses `deps.clock()`.

## Test runs

All in my own detached worktree `~/x2f-worktrees/rv-t1617r3` @ `1603ed1` (npm ci with npm 11.21.0), each run under `flock ~/x2f-comms/check.lock`. The worktree has been removed.

- **tsc:** apps/api 0, apps/web 0, packages/auth-client 0.
- **api vitest, 11 files:** coolingOff, deviceApproval, push, wallets, login-tags, password, pgp, recovery, account, webauthn, totp. **467 passed, 1 todo, 0 failed.**
- **auth-client vitest:** 5 files, **72 passed**.
- **web vitest, 7 files:** hold, loginApprove, devices-tripwire, cantDoThat-lint, copy-lint, task30-refusals, app-routes. **55 passed.**
- **R3-I1 reproduction:** a scratch test appended to `coolingOff.test.ts` called `gateChange` with the revoked thief session after the owner's passkey proof. It returned `{ holdUntil }`, and the hold row read `weak-change` / `logout-timer`. The test was reverted with `git checkout` and never committed.
