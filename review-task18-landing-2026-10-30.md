# Review: Plan 2 Task 18 landing (`origin/wip/landing-p2-task18` @ fd894b6), 2026-10-30

Reviewer: read-only security helper (fresh eyes; account takeover = top threat).
Scope: merge fa0f090 (3635fac + 0765d18) and the follow-ups 0b5b23e, 0365ed7, c933530, 39ac2be, 440ec05, fd894b6.

## Verdict: CHANGES REQUIRED (one Important, I1: a known open item that is exploitable)

Everything else is sound; I1 is a small, contained fix. The merge resolution lost no check from either side.

## Tests (own worktree `~/x2f-worktrees/rv-t18land` @ fd894b6, `npm ci`, every run under flock; worktree removed afterwards)

- `apps/api` `tsc --noEmit`: 0 errors. `apps/web` `tsc --noEmit`: 0 errors.
- vitest `@x2f/api`: team, deviceApproval, coolingOff, take, sessions, login-tags: **6 files, 245 passed**; account.test.ts: **44 passed**.
- vitest `@x2f/web`: team.test.tsx, team-tripwires.test.ts, app-routes.test.ts: **3 files, 12 passed**.

## 1. The merge (fa0f090, `git show --cc`) against both parents

I checked every hand-resolved hunk. Each one keeps both sides:
- `sessions.ts openSession`: Task 16-17's `strength` column and the `{sessionId, after}` / `startSession` split are kept. Task 18's member block runs after the `accounts` read: level must be full, the member must be joined and not removed (`for share of tm`), and the team must be a live trader account. Then `account_id` = team, `member_id` is set, there is no onboarding window for members, the alert is `team-member-login`, the `new-login` push is skipped for members, and `trustDevice` uses the member's own account. `SESSION_HOOK` and `MEMBER_GUARDS` are both set on the same handler. OK.
- Trade, dispute and confirmations guards `{...FINISH_OPEN_TRADES, member: 'trades'}`: the recovery and held exemptions from Task 17 are kept. Member sessions are always `full`, with `hold_until` null. OK.
- `applyEvent`: `within` = auditMember and `before` = requireLiveSessionInTx are both passed, in the right parameter order (store.ts:311-327; `before` runs after the trade row lock). OK.
- Take: `[...requireTrader, requireNotHeld]` keeps `ownerDeviceOnly`, and `requireLiveSessionInTx` inside the transaction is kept (take.ts:249). The audit row is added. OK.
- offers/routes.ts: `lockAccountLive`/`requireLiveSessionInTx` (round 5 M2) is kept on post, relist, pause/remove and edit, and `auditMember` is added. `assertMayPost` now takes `req.auth`. Typechecks. OK.
- `RETENTION_JOBS` has both `purgeTeamLeftovers` and `purgeChatsJob`. The purge test and the schema migration order (013, 014, 015, 199) match. OK.
- `alerts`, `actionInput` (`set-one-device` + the team-* actions), `pgp.ts` (`applyPgpKey` + team-join helpers), `account.ts` (`accountHoldUntil` + `member`), App.tsx, Login.tsx, Devices.tsx and cantDoCodes: both sides are present.

## 2-4. The new work

- `ownerWriteGate` (team/members.ts:139-143) runs first in all three write transactions. It calls `requireLiveSessionInTx` (account lock, `for no key update`), then `holdInTx`. The invite count race is still serialized because both invites take the same lock. `setRoles` now runs in a transaction, and its stream closes happen after the commit. `requireNotHeld` runs before `requireConfirm`, so no token is spent during a hold. The routes are listed in both LIVE_SESSION_ROUTES and HOLD_BLOCKED_ROUTES. OK.
- `traderLogin` changes (approval.ts:257-285):
  - The `own` check now requires `member_id is null`, so a member's cookie no longer turns an owner login on that browser into an approval-free session. This closes a real bypass that existed before the fix.
  - Member sessions are left out of `n`/`answering`, so they never answer the owner's login. With only members logged in, the owner's login goes in, and a weak login on an untrusted device starts the hold. That is the Task 17 no-device rule, so the owner is not locked out.
  - `devicesInUse` still counts members.
  - Approval routes are owner-only (approval.ts:684: `requireSession({kinds:['trader']})`, so members get `owner-only`).
  - Lockout analysis: members filling the limit cannot lock the owner out. The owner's strong login with no strong owner session goes in (makeRoom only removes weak sessions and never refuses). The owner's weak login rotates its own session via `logOut` or gets in with `n === 0`. A member cannot end owner sessions (sessions routes are owner-only).
- Member strength (login.ts:102): `'strong'` is set only when `a.account.kind === 'member'`, in the pair branch after `pairAllowed`. Traders return earlier, and staff and owner keep the default. Members never reach `traderLogin`: the password login uses `passwordAllowed(kind)`, and TOTP is not a member method. No non-member path gets `'strong'` this way. OK. But see M1 for the join sessions.

## Findings

### I1 (Important): a weak owner session can invite a member, which turns a weak foothold into a lasting strong login that skips approval and the hold
team/members.ts:139-143 (`ownerWriteGate` has no `weakOf` check); routes/team.ts:156-163.
Failure scenario:
1. A thief has the owner's password and a copied device cookie. This is the copyable trust cookie that Task 17 already treats as a threat.
2. The thief logs in weak on a trusted device below the limit. `traderLogin` returns `session(false)`: no approval, no hold.
3. Under R42, this session could not add a login method (`gateChange` would start the hold). But `POST /v1/team/invites` has no weak gate, and confirm-it's-you accepts the password. So the thief invites "Support" with roles `trades` (and `offers`), then joins with their own PGP key plus a security key.
4. The thief now has a member login that:
   - is `strong` (login.ts:102);
   - never waits for approval and is not counted against the device limit (completeLogin's non-trader branch);
   - is not refused during a hold;
   - is not ended by the owner's proof (`endHoldIfOwner`, hold.ts:266-271, only ends weak, recovery and hold-starter sessions);
   - is not ended by deleting trusted devices.
5. If the thief then makes a weak security change to start a hold (`gateChange`), `DELETE /v1/team/members/:id` is refused for 24 hours (the owner decision, see O1). An owner with only weak methods cannot end that hold.
6. For that time the thief acts on the account's trades: mark-paid, disputes, cancels, wallet pick among existing wallets, and offers. All in the owner's name. Only escrow signing stays blocked (`ownerDeviceOnly`).

Fix (small):
- In `ownerWriteGate`, take the `LiveSession` that `requireLiveSessionInTx` returns. If `weakOf(caller, now)`, refuse invites and role changes that add roles with 403 `weak-session`. Alternatively, route them through the hold like `gateChange`; that is a lead/owner choice.
- Keep removals (and role reductions) open to weak sessions, since they only reduce access.
- Add a coolingOff/team test: a weak session invite gets 403, and nothing is written.

### O1 (OWNER CHOICE, flagged): removing a member or cancelling an invite is refused during a hold
hold.ts:567-571 HOLD_BLOCKED_ROUTES `DELETE /v1/team/members/:id`; members.ts `removeMember` → `ownerWriteGate`.
- Removing a member only reduces access. Refusing it during a hold means that whoever can start a hold (any weak session, see I1) also freezes a rogue member or pending invite in place for 24 hours. Meanwhile the member keeps logging in and trading, because member logins and trade events ignore the hold.
- The owner can end the hold only with a strong login whose methods predate it.
- Recommendation: allow `DELETE` during a hold, at least from a strong session or from every session. Keep invites and role additions blocked. The owner decided "all team changes wait", so this is for the owner to confirm knowing this trade-off.

### M1 (Minor): a member's first session after joining is not `strong`
routes/team.ts:296 and :325 call `startSession` without `strength`.
- A member who joins with a second PGP key gets a `pgp-single` session, and one who joins with a passkey or security key gets `strong` only by the method default. This goes against the landing rule that member logins are strong, even though two factors were just proven.
- Effects: the session is ended by the owner's proof, makeRoom ends it first, and the push route's `weakOf` treats it as weak (push/routes.ts:101, since `req.auth.kind` is `'trader'` for a member).
- No security loss, because it fails toward weaker. But it is inconsistent, and the strength of a join session is untested.
- Fix: pass `strength: 'strong'` in both join `startSession` calls and add one assertion.

### M2 (Minor): with "One device at a time" on, any member session stops the owner's weak session from approving a new device
approval.ts:561-567 (the weak check counts strong member sessions as "a strong one logged out").
- Failure scenario: an owner with only a password, one-device on, and a member logged in gets 403 `weak-session` on every approval.
- The owner can work around it: log out its own device and log in again (the `n === 0` path), or remove the member outside a hold. It is not a lockout, but it is confusing.
- This is related to the known item about `logOut` at the limit. Suggest leaving member sessions out of the weak check, or listing it with that item.

### N1 (Note): Task 20 chat routes are owner-only for members
chat/routes.ts:46 is `requireSession({kinds:['trader']})` with no `member` option, so members get `owner-only` by default.
- This fails closed, so it is safe, but a member with Trades in a trade room gets 403 on chat.
- This is a product gap for the lead to schedule; it is not a security issue.

## Known open items (confirmed, listed; only the first is escalated, as I1)
1. A weak owner session can make team changes outside a hold. This is escalated as **I1**: invites and role additions are exploitable.
2. A member login does not check the device limit. Members can exceed `max_devices`. That is not a lockout: the owner's login still gets in through approval, makeRoom or the `n === 0` path. Low.
3. A weak owner cannot log out a member through approval `logOut`, and also not through `DELETE /v1/account/sessions/:id` (account.ts:437). The owner can still remove the member outside a hold. Related to M2.
4. The `login-approval` live event reaches member streams. It carries only the id, but tells a member when the owner is logging in. The member's GET of the approval gets 403. Low.
5. The hold copy does not mention team changes. This is copy only; the Team screen does show the hold sentence (fd894b6).
