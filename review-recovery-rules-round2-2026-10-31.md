# Review round 2: recovery-code rules (`origin/wip/lead-p2-recovery-rules` @ 291e753, base 3cfe204)

Reviewer: read-only security helper, 2026-10-31. Round 1: `review-recovery-rules-2026-10-31.md`.
Commits: 08e1d3f red tests, 291e753 fixes. Threat model: account takeover.

## Verdict: APPROVED (minor findings below, none blocking)

I1, I2, I3 and M2 are fixed. Both round-1 takeover scenarios (weak owner cancels the backup session; extended hold, strong owner cancels) are now covered by tests that fail at 08e1d3f and pass at 291e753.

## I1: a queued change dies with its session. Fixed.

- Every revocation path I found sets `revoked_at` from null to a value, so the trigger fires for all of them: `sessions.ts:136` (a login replacing the presented cookie's session), `:342` endSession, `:352` endOtherSessions, `:364` endAllSessions, `:382` logout, `routes/account.ts:412` Devices, `recovery.ts:257` cancelRecovery, `hold.ts:322` endHoldIfOwner, `approval.ts:158` makeRoom, `approval.ts:443/448`, `methods.ts:412`, `password.ts:380`. The `when (old.revoked_at is null ...)` guard means a second revoke writes no duplicate alert.
- Paths that do not set `revoked_at`:
  - Expiry (idle or absolute) is covered by the live check in `holdInTx` (`hold.ts:212`: `revoked_at is null and expires_at > now`). That matches `requireSession`, because `expires_at` is the idle deadline capped by the absolute one, and the logout-timer PUT moves it.
  - `purgeExpired` deletes rows (`challenges.ts:86`), and the FK `on delete cascade` takes the session's `hold_changes` with them. RI cascades run as the table owner, so the role does not matter.
  - Account deletion cascades the same way.
  - Nothing truncates `sessions`.
- Race between a queue insert and a revocation that does not take the account lock (`POST /v1/logout`): the insert's FK takes only a KEY SHARE lock, and the logout's trigger cannot see the uncommitted row. A row can therefore outlive a revoked session. The live check in `holdInTx` and the join in `GET /v1/account/hold` cover it: the row never applies and is never listed, and the cascade removes it within an hour. The second safeguard is what makes this safe.
- Ordering in `holdInTx`: the queued rows are read before `account_holds` is deleted, and the live set is read after the pending change. A held password change therefore ends the backup session first (tested). Early ends (`endHoldIfOwner`, `endHoldOfSession`) delete the hold first, so the trigger finds nothing and writes no spurious alert.
- Role: the trigger function is SECURITY INVOKER. Every revoking statement runs as the API's database user, which owns `hold_changes` and `alerts`. `x2f_purge` (migration 104) never touches `sessions`. The trigger works for every caller that exists today.
- Alert flood: one `hold-change-blocked` per dropped row, and only rows that were queued, each of which already wrote a `hold-change-queued`. This is the same amplification as M3, which is waiting on owner question q59; it is not flagged again here. Only the session's own rows are touched, so nobody can make the trigger write alerts about another account.
- Who may block, and whether a weak session older than the backup session may block: owner question, not flagged.

## I2: 409 `authenticator-exists`. Fixed.

- Start: `refuseReplacingFromRecovery` runs before `requireConfirm` (`totp.ts:393-396`), so no confirm token is spent. It applies to a backup session, and to any session while the running hold is a recovery-code hold.
- Finish: checked after `gateChange` under the account lock, for a queued change or a backup session (`totp.ts:286-287`). A throw rolls back the queue row and its alert.
- Hold end: checked per row inside the savepoint (`hold.ts`, the queued loop), so a second queued authenticator is dropped and the first one stands (tested).
- Other paths I checked: a full session outside any hold keeps normal replace semantics, which is intended. During a non-recovery hold, a backup session is refused by `requireNotHeldExceptTwoFactor`.

## I3: renumbered to 016. Fixed.

The three schema.test lists are updated. Still to check when Task 18 lands (noted in coordination.md): a team member's session cannot reach the two-factor add routes.

## M2: `sessionId`, `deviceLabel` and `mine`. Fixed. Exposing `sessionId` adds nothing for a thief.

A backup session already sees every live session's id and label through `GET /v1/account/sessions` (`readAny`, `routes/account.ts:377`). It cannot use them: `DELETE /v1/account/sessions/:id` and `DELETE /v1/account/hold/changes/:id` both need a full session (`requireSession()` default). No route accepts a session id from a backup session.

## Minor

**m1. Deadlock between a self-logout and the hold end can silently drop the owner's held password change.**
Files: `sessions.ts:382` (`POST /v1/logout` revokes without `lockAccount`); `hold.ts:~188` (the cascade from `delete from account_holds` locks the `hold_changes` rows); `hold.ts:198-205` (savepoint `pending_change`); `password.ts:380` (`applyPassword` revokes the other sessions).
Scenario: a hold with a pending password change, plus rows queued by session X, reaches its end in `settleDueHolds`. At the same moment X calls `POST /v1/logout`.
- Logout locks X's `sessions` row, and its trigger then waits on the `hold_changes` rows that the `holdInTx` cascade already locked.
- `applyPassword` inside the savepoint then waits on X's `sessions` row. That is a deadlock (40P01).
- If `holdInTx` is the victim, the error is caught by `rollback to savepoint pending_change` as a non-ApiError and the owner's password change is dropped for good ("fails closed", N-M2). X is still uncommitted-live at the live check, so X's queued rows apply.
- If logout is the victim, the logout answers 500.
Impact: low. It needs a self-logout at the instant of settle, and the owner's revoke paths (Devices, cancel) take the account lock first. But it is a new source of transient failure, and it costs a legitimate change.
Fix: take `lockAccount` in the logout route before revoking, or lock the queued sessions' rows (`select ... from sessions where id = any(..) for no key update`) in `holdInTx` before deleting `account_holds`, so both paths lock sessions before `hold_changes`. Also consider re-throwing 40P01/40001 from the savepoint catch instead of dropping the change.

**m2. Trigger function has no pinned `search_path`.**
File: `016_recovery_code_hold.sql:28`.
The repo's other trigger functions pin it (`104_trade_retention.sql`: `set search_path = pg_catalog`). This one resolves `hold_changes` and `alerts` through the caller's `search_path`. That is harmless today (one schema, owned by the app user), but it is inconsistent. Add `set search_path = public, pg_catalog` or schema-qualify the table names.

**m3. Device labels are client-chosen, so `deviceLabel` alone does not tell the owner which row is the thief's.**
File: `recovery.ts:294`.
A thief can name the backup device "iPhone 15" to match the owner's. Viewed from a third device, both rows show `mine: false` with the same label, and the owner may block their own row and leave the thief's. Add the queuing session's `level` (`recovery`) or a `byRecoveryCode` flag to each row: the row from a backup session is the one to suspect.

**m4. An expired session's queued change disappears with no alert.**
The purge cascade and the live filter drop it, but no `hold-change-blocked` is written: only revocation goes through the trigger. The other devices saw `hold-change-queued` and then the row simply vanishes from GET. Cosmetic.

**m5. Red-test discipline (as round-1 M6):** `apps/web/test/totpAuthenticatorExists.test.tsx` arrived with the fix (291e753), not with the red tests (08e1d3f). The API red tests are fine.

## Not flagged

- Open owner questions 49-61, including q58 (authenticator replace) and q59 (queue cap).
- Round-1 M1, M4 and M5, which remain open as recorded in coordination.md.

## Tests

Run in my own worktree `~/x2f-worktrees/rv-recov2` @ 291e753, after `npm ci`, under flock.
- `tsc --noEmit`: apps/api, apps/web and packages/auth-client all exit 0.
- vitest api (recoveryRules, recovery, coolingOff, totp, schema, account): 6 files, 265/265 passed.
- vitest web (totpAuthenticatorExists): 2/2 passed.
- Red check at 08e1d3f, recoveryRules: 10 failed and 12 passed out of 22. All 10 failures are the new round-2 tests (I1 ×5, I2 ×4, M2 ×1); every earlier test passes.

Worktree removed.
