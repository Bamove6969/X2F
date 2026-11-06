# Review round 4: Plan 2 Tasks 16 and 17, the round-3 fixes, 2026-10-30

Branch `wip/lead-p2-task17` @ `7f3ef2e`; diff base `1603ed1`. New commits: `a953a63` (red tests), `7f3ef2e` (fixes). Round 3: `review-task16-17-round3-2026-10-30.md`.

## Verdict: CHANGES REQUIRED (0 Critical, 1 Important, 3 Minor)

All six round-3 findings are fixed as described, and the red tests are honest. One Important finding remains. It is R3-I1's race again, this time through `decide` (approving a new device) instead of `gateChange`. I reproduced it end to end: after the owner's proof, the thief's browser holds a live weak session and has started a new hold with a change pending. The fix is small.

## Round-3 findings

| R3 | Status |
|---|---|
| I1 `gateChange` acts for a revoked session | **Fixed** (`hold.ts:390-395`). The liveness check sits under `lockAccount`, which `endHoldIfOwner` also holds, so it is exact. The per-session password throttle is defence in depth on top (see below). The same race is still open through `decide`: see R4-I1. |
| M1 unlocked `poll` | **Fixed** (`approval.ts:406-410`). The locks are taken in the same order as `traderLogin` (approvals, then account). A due hold settles first, and a waiting login is refused during a hold. The race test drives `endHoldIfOwner` statement by statement. |
| M2 weak session logs out others | **Fixed** (`account.ts:396-403`). `recovery-sessions` was extended too. For the cost of that extension, see R4-M1. |
| M3 login refusal copy | **Fixed** (`cantDoCodes.ts:314-316`, `refusals.ts:57-59,86`). For a small nit, see R4-M3. |
| M4 dead too-many-devices text | **Fixed.** The text was removed and the comments reworded. |
| M5 lock-order and no-push notes | **Fixed.** The lock-order note is in `hold.ts:33-38`, and the design gap is recorded in coordination.md for Plan 6. |

## Attacks on the new code

**Can the rate limiter lock the owner out? No.**
- `KeyedBuckets` is keyed by `req.auth.sessionId`, and `throttlePasswordChange` runs after `requireSession` (`password.ts:404-407`). A thief can only drain buckets for session ids they can authenticate as, so the owner's bucket is out of reach.
- The owner can only exhaust their own bucket, with 10 tries of their own. They then get a 429 `slow-down` with `retryAfterSeconds`, which the web already words as a throttle fault.

**Can a thief reset their own bucket through eviction? Not usefully.**
- Eviction is by insertion order (FIFO), not LRU: `get` does not refresh a key. The comment's "the oldest is dropped first" is accurate. The lead's note calls it LRU, which is not quite right.
- To evict their own key, a thief must push 10,000 new session ids through `PUT /v1/account/password`. That needs 10,000 sessions, each from a login or registration. The global `START_BUCKET` (120/min) and `REGISTER_BUCKET` (20/min) budgets put that at 80 minutes or more per reset, and each reset buys only 10 more tries.
- None of this matters for safety any more: the gate's liveness check closes R3-I1 exactly, and the throttle only makes the loop more expensive.
- Note: the buckets are in memory and per process. With more than one API instance the effective limit is multiplied. That is harmless for the same reason.

**Lock-order deadlocks between `poll`, login and `endHoldIfOwner`: none.**
- `lockApprovals` is taken only in `approval.ts`, always before `lockAccount`: `traderLogin` 228-229, `poll` 407-408, `decide` 524 then 546.
- `endHoldIfOwner` is called only from `traderLogin`, under both locks.
- `gateChange`, `backupSession`, `cancelRecovery`, `holdUntil` and `settleDueHolds` take `lockAccount` only. None of them then takes `lockApprovals`.
- Nothing that holds `lockAccount` writes `login_approvals`. The only other writer is the retention cleanup in `challenges.ts:93`, which takes no advisory lock and deletes only rows expired for more than an hour.
- `decide` row-locks `login_approvals` between the two advisory locks, but only under the approvals lock, so no cycle can form.
- The only known cycle remains the documented `NAMES_LOCK` one (R3-M5).

**Does the `recovery-sessions` change let a thief's backup session survive?**
- Against an owner who has a strong method: no. The owner's strong login ends the hold and revokes every `level='recovery'` session (`hold.ts:265-269`), and the owner's strong session can still cancel a backup session (tested at `coolingOff.test.ts:1081`).
- Against an owner with no strong method: yes. See R4-M1.

## Important

**R4-I1. `decide` approves a new device for a session the owner's proof has just revoked, so a thief's browser gets a live session after the owner believes the hold is over.**

This is R3-I1 again, through `POST /v1/account/approvals/:id`.

Code:
- `approval.ts:516-582`: `decide` never checks, under its locks, that the calling session is still live.
- `weakSession` (`hold.ts:342-353`) reads the session row with no `revoked_at` or `expires_at` filter. A revoked weak session therefore still counts as an ordinary weak session, and a weak session may answer a weak login.
- `endHoldIfOwner` (`hold.ts:270-273`) expires only logins that were approved and not yet collected (`outcome = 'approved'`). Logins still waiting for an answer (`outcome is null`) stay open.
- `poll` (fixed for R3-M1) then finds no hold and opens the session.

Scenario: an owner with a passkey (or password + TOTP) and a strong session open; the thief knows the password.
1. The thief's session W is in (an approval or a trusted cookie). The thief's second browser B2 logs in with the password, which opens an approval A for 5 minutes (B2 is not trusted).
2. W queues a change, which starts the hold. W then loops `POST /v1/account/approvals/A { choice }`.
   - During the hold each attempt gets 403 `recovery-hold` (`approval.ts:547-548`).
   - This route has no throttle.
3. The owner gets the `hold-started` push and logs in with the passkey within the 5 minutes.
   - `endHoldIfOwner` deletes the hold, revokes W and expires approved logins.
   - A is still waiting for an answer, so it stays open.
4. One of W's attempts passed `requireSession` before the owner's commit and waited on `lockApprovals` behind the owner's transaction.
   - It then finds A open, W counts as weak, A is weak, and there is no hold, so A is approved.
5. B2 polls and gets a live full session: no hold is running, and R3-M1's check passes.
6. B2 queues a password change. A new hold starts with the thief's change pending, after the owner was told "The 24-hour hold ended". This is the same outcome as R3-I1.

Reproduction (scratch test in my worktree, reverted, never committed):
- Setup: a passkey owner with a password, plus `approvedThief`. B2's password login opens an approval, and the thief's logout-timer change starts the hold.
- An owner transaction takes `lockApprovals` and `lockAccount`, the thief's `decide` is fired, then the owner runs `endHoldIfOwner`'s statements and commits.
- Result: `DECIDE 200 {"outcome":"approved"}`, `POLL 200 {"status":"ok"}`, B2 `GET /me` 200, one weak session live, and B2's `PUT logout-timer` 202 (a new hold).

How likely:
- The approval must be opened before the hold starts, and lasts only 5 minutes. The thief controls that timing, and the push makes a quick owner response plausible.
- The race window is the owner's transaction plus one round trip, against an unthrottled loop. That is similar to, or wider than, R3-I1.

Fix (either closes it; both is best):
- (a) In `decide`, under `lockApprovals`, refuse a dead caller: `select 1 from sessions where id = $1 and account_id = $2 and revoked_at is null and expires_at > $3`, else 401 `not-authenticated`. For a cheap belt, also make `weakSession` treat a revoked or expired session as weak/unknown.
- (b) In `endHoldIfOwner`, expire every open approval too (`outcome is null or (outcome = 'approved' and used_at is null)`). Every waiting login from before the owner's proof was requested under the thief's possible influence, and the owner can simply log in again.
- Add a regression test along the lines of the reproduction above.

## Minor

**R4-M1. A weak-only owner can no longer cancel a thief's backup session (lead/owner decision; the extension of R3-M2 to `DELETE /v1/account/recovery-sessions/:id`).**

Where: `recovery.ts:234-235`, `hold.ts:446`.

Which owners: those with no strong combination, for example password-only or PGP+TOTP, who have recovery codes. (TOTP alone is also a backup login.)

Scenario:
1. A thief with one stolen recovery code makes a backup login. That opens recovery session R and starts the hold.
2. The owner sees `hold-started`, but their session is weak. It now gets 403 `weak-session` on cancelling R.
3. The owner cannot regenerate codes or change the password either: every security change is refused during the hold.
4. When the hold runs out, R is no longer held, and `PUT /v1/account/password` (`allowRecovery`) sets the thief's password. This is a takeover the owner had no move against.
   - Before this commit, the owner's weak session could kill R. That costs the thief a code and 24 hours per attempt, and fails closed.

The opposite case is what the change protects: a password thief who kills the owner's own backup session, over and over. Neither weak party can take over in that case, so it is a stalemate (liveness), not a takeover.

Recommendation:
- Restore the cancel for weak full sessions. Killing a recovery session is fail-closed, the recovery-code holder can try again, and the hold still runs.
- Alternatively, allow it at least when the caller's session is older than R.
- If the lead keeps the change, record it as a decided trade-off in coordination.md, and tell weak-only owners in Settings that a strong method is their only answer to a stolen recovery code.

**R4-M2. An approval outlives the session that granted it, outside a hold too.** This is pre-existing from Task 16 and is not caused by this branch.

Where: `poll`, `approval.ts:403-420`, does not check that `decided_by` is still live.

Scenario:
1. Thief session W approves B2.
2. The owner's strong session logs W out (`DELETE /v1/account/sessions/:id`), or the owner changes the password, which ends the other sessions.
3. B2 collects the approval within its 5 minutes and is logged in.
4. The owner has to spot and log out a second device.

Fix: in `poll`'s claim, add `and exists (select 1 from sessions where id = decided_by and revoked_at is null)`. Alternatively, expire the approvals a session granted when that session ends (`endSession` and password changes).

**R4-M3. Copy nit in `holdLoginText`** (`cantDoCodes.ts:315`).
- "With a recovery code you can use a backup login in the meantime" leaves out that a backup login spends a code and pushes the hold's end out to 24 hours from then. `backupSession` calls `startHold`, whose `on conflict` takes `greatest(hold_until)`.
- Pushing the end out is not harmful: it delays the thief's pending change. But the reader should know the hold gets longer.
- The sentence is marked COPY-UNSIGNED, so it goes to the owner's copy review anyway.

## Red tests and checks

- **At `a953a63` (round-3 tests on the round-3 source):** `coolingOff.test.ts -t "review round 3"` gave 6 failed and 1 passed.
  - The failures are R3-I1 gate, R3-I1 throttle, both R3-M1 tests and both R3-M2 tests.
  - The test that passes is "confirm token is single-use". That is expected: it pins behaviour that already existed.
  - The M3/M4 web copy has no red test at `a953a63`. `hold.test.ts` was updated in the fix commit and passes, with 7 tests, at `a953a63` as well. That is acceptable for copy.
- **At `7f3ef2e`**, in my detached worktree `~/x2f-worktrees/rv-t1617r4` (npm ci with npm 11.21.0), every run under `flock ~/x2f-comms/check.lock`:
  - **tsc:** apps/api 0, apps/web 0, packages/auth-client 0.
  - **api vitest, 9 files:** coolingOff, deviceApproval, push, account, limits, password, recovery, login-tags, wallets. **374 passed, 1 todo, 0 failed.**
  - **web vitest, 6 files:** hold, loginApprove, cantDoThat-lint, copy-lint, task30-refusals, devices-tripwire. **55 passed.**
  - **R4-I1 reproduction:** the scratch test described above; reverted with `git checkout`.
- The worktree has been removed.
