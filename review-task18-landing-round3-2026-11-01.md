# Review round 3: Plan 2 Task 18 landing (`origin/wip/landing-p2-task18` @ 98dbdc1), 2026-11-01

Reviewer: read-only security helper. Scope: `git diff fd894b6..98dbdc1` (4cd11e9 red tests, 98dbdc1 fix), against the owner decisions of 1 Nov (a) strong session for invites and role changes, (b) all team changes wait during a hold (removal refused with a TODO), (c) M1. Prior review: `review-task18-landing-2026-10-30.md`.

## Verdict: APPROVED WITH MINOR

I1 and M1 are fixed as the owner decided. I found no bypass and no regression to Tasks 16-17. The only findings are test-coverage notes (N1, N2) and one owner question.

## Runs (worktree `~/x2f-worktrees/review-t18-r3` @ 98dbdc1, `npm ci`, every run under `flock check.lock`; worktree removed afterwards)

- `npm run typecheck` (all workspaces): clean.
- `npm run separation-check`: ok.
- `npm run copy-lint`: clean.
- vitest `@x2f/api`: team, coolingOff, deviceApproval, take and sessions. **5 files, 228 passed.**
- vitest `@x2f/web`: team.test.tsx, team-tripwires and app-routes. **3 files, 13 passed.**

## (a) A strong session for invites and role changes

### Every write path is covered
- Only two places write rows that add access:
  - `insert into team_members` exists only in `createInvite`, at members.ts:187.
  - `update team_members set roles` exists only in `setRoles`, at members.ts:258.
- The join-side updates (members.ts:376 and :398) are the member's own steps. They are bound to an invite that already exists, and they cannot add roles.
- The routes that reach those two writes are `POST /v1/team/invites` and `PATCH /v1/team/members/:id`. There is no other route and no alternate web flow. The web Team screen calls only these two.

### The preHandler check
- `requireStrongSession` (routes/team.ts:156-159) runs after `owner` and `requireNotHeld`, and before `requireConfirm`. So:
  - a weak session gets 403 `weak-session` before any confirm token is spent;
  - a bare POST without a token gets `weak-session` too, so the web never asks a weak device to prove itself for nothing.
- `waits(null)` is true, so sessions from before migration 014 are refused. This fails closed.

### The re-check under the lock
- `ownerWriteGate(..., {strong:true})` (members.ts:151-157) reads `strength` from the row that `requireLiveSessionInTx` returns. That function locks the account, so the check runs inside the write's transaction.
- `strength` is never updated after insert (grep finds no `set strength` in src), so there is no TOCTOU window. The in-transaction check is defence in depth.

### Who reaches these routes at all
- Members are refused by `requireSession` (`owner-only`).
- Recovery sessions are refused by the default `allowRecovery` false.

### Removal and holds
- Removal stays open to weak sessions outside a hold (`{strong:false}`). That matches the owner's decision.
- During a hold, the hold is checked first, both in the preHandler order and in `ownerWriteGate`. So every caller gets `recovery-hold`, whatever the session's strength.

## (b) During a hold
- Unchanged from round 2. All three routes are still in `HOLD_BLOCKED_ROUTES`. hold.ts changes only by a TODO comment on the DELETE entry.
- The TODO is in two places (hold.ts:571 and the `ownerWriteGate` doc). It points to `hold_changes` on wip/lead-p2-recovery-rules.
- docs/coordination.md is updated to match. Acceptable.

## (c) M1: the member's first session is strong
- Both join finish routes now pass `strength: 'strong'`:
  - routes/team.ts:312, which is WebAuthn second (`strong` by method default anyway);
  - routes/team.ts:342, which is PGP second (previously `pgp-single`).
- Every other path that creates a member session is the pair branch at login.ts:102 (already strong).
- Members cannot use `password.ts`, `pgp.ts`, `webauthn.ts` sign-up or `recovery.ts` to get a team session, since those create trader accounts or recovery sessions.

## Tasks 16-17 invariants
- `LIVE_SESSION_ROUTES`, `LIVE_SESSION_EXEMPT` and `HOLD_BLOCKED_ROUTES` are unchanged, apart from the comment.
- The coolingOff "route lists" tripwire now pins:
  - the preHandler order (two routes with `requireNotHeld, requireStrongSession, requireConfirm` and one without);
  - the `ownerWriteGate` flags (two `strong: true` and one `strong: false`).
- The class-audit tests still pass.

## Mutation checks (each reverted afterwards)
| Revert | Caught by |
|---|---|
| In-transaction strong check removed | team "read weak only under the account lock" fails |
| `requireStrongSession` removed from the invite route | both "invite gets weak-session ... no confirm token spent" tests fail |
| `requireStrongSession` removed from the PATCH route | only the coolingOff source tripwire (see N1) |
| `setRoles` set to `strong:false` | only the coolingOff source tripwire (see N1) |
| Both PATCH layers removed | team "role change gets weak-session" fails |
| M1 on the PGP join removed | the sign-up "second PGP key" test fails |
| M1 on the WebAuthn join removed | not detectable, since the method default is already strong. Harmless. |

## Findings

No Important or Minor findings.

### N1 (Note): role-change tests leave two things to the source tripwire
team.test.ts "a weak session's role change ...".
- The test does not assert that the confirm token stays unspent.
- The lock-race test covers only invites.
- Failure scenario: a refactor moves the role check from the preHandler into `setRoles`. A weak caller's confirm token would then be spent on refusal. The behavioural tests stay green, and only the string-match tripwire would catch it.
- Fix:
  - add `expect(await unspent(confirmToken)).toBe(1)` in the role loop;
  - optionally clone the lock-race test for PATCH.

### N2 (Note): the M1 assertion covers the PGP second-factor join only
- The WebAuthn join (routes/team.ts:312) passes `strong` explicitly, but no test pins it. It is strong by default today.
- Fix: one `strength` assertion in a WebAuthn join test, if one exists.

## Carried, deliberately left for the owner
- **M2:** with one-device on, member sessions block a weak owner's approval.
- **N1 (round 2):** chat is owner-only for members.
- Both are unchanged, as instructed.

## OWNER QUESTIONS
1. **Weak owner sessions in the sign-up window.**
   - Today `gateChange` lets a weak session make security changes in its sign-up's first 30 minutes (`onboarding_until`). The new strong rule has no such exception, which matches the 1 Nov decision as written.
   - So an owner who signs up with a password, or a PGP key alone, cannot invite anyone until they log out and log in again with a strong combination. Adding a second method does not upgrade the current session.
   - Is that intended? The implementation is the stricter reading. I recommend keeping it; this is for the owner to confirm.
2. **The new Team-screen sentence (cantDoCodes.ts:395) is user-facing copy.**
   - It reads: "This device logged in with only one way of proving it's you, so it can't invite team members or change their roles. Do this from a device where you logged in with a passkey, a security key, or your password and authenticator code."
   - It passes copy-lint. Copy sign-off follows the usual owner process (COPY-UNSIGNED if that convention applies).
