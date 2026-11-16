VERDICT: APPROVE WITH MINORS

# Review: wip/agy-setup-flow 23f4980a (agy Job 5, owner notes 12 Nov #27, #30)

Reviewer: claude3, 16 Nov 2026.

Scope: one commit on origin/wip/third-demo-r3 1fa6bed1, 4 files, +244/-9: SetupFlow.tsx, PgpChallenge.tsx, a new vitest (test/signupFlowOrder.test.tsx) and a new e2e case in signup-v2.spec.ts. It stays in the web flow, as the job says: no server, auth, Login.tsx or authenticator-screen changes (claude2's 17:42 line is respected). It adds no new user-facing text.

What it does: third-demo-r3 already walked through the ticked methods in SIGNUP_ORDER (finishMethod then nextStep). The real gap was that a URL could skip ahead: /setup/backup was unguarded, and any ticked but unfinished method's step could open out of order. agy's change does three things:
- Each method step opens only when it is the next one due (`more`, SetupFlow.tsx:84).
- /setup/backup redirects to the next method still due (SetupFlow.tsx:101).
- /setup/wallet, /setup/welcome and a signed-in /setup go to that next step instead of to backup.

This matches #27/#30 ("the recovery code screen will be after they set up all the ones they chose"). Use "Set up later" to skip one, as before.

## Owner decisions (16 Nov)

- **TOTP needs a password:** the branch adds no OTP-without-password path. Its tests tick TOTP only together with a password. SIGNUP_ORDER puts the password before the authenticator, so the server's 409 `totp-needs-password` on wip/second-signup-r3-fixes cannot trigger in this walk. Login.tsx still offers OTP without a password on third-demo-r3; that is fixed on second-signup-r3-fixes, not here, which is correct.
- **No conflict with wip/second-signup-r3-fixes:** I ran a trial merge. agy's files merge cleanly. The only conflict is apps/api/src/auth/webauthn.ts, which is between second-signup-r3-fixes and third-demo-r3 themselves, not agy. On the merged tree:
  - vitest signupFlowOrder, signupV2, totpNeedsPassword and signupRecoveryCode: 36/36
  - e2e signup-v2 and setup: 41/41

## Findings

**M1. A real bug fix is not mentioned** (PgpChallenge.tsx:78). On third-demo-r3, a PGP-first sign-up is `registered` after Verify, but 'pgp' only joins `done` on Continue. So `nextStep` is still 'pgp-key', and `/setup/pgp-key` (the `before()` guard) would redirect to itself if the person pressed Back. Marking pgp done at Verify fixes this. Say so in the commit message or the test name, so nobody "simplifies" it away.

**M2. Tests first is not visible.** Code and tests are in one commit. Next time, commit the red test first, as the rules ask.

**M3. The new vitest file copies helpers** (test/signupFlowOrder.test.tsx:15-47): `json`, `flush` and the account/me stub are copied from the other signup tests, and the third case builds a large hand-made SetupApi. This is acceptable, but a shared helper would be smaller.

**M4. No READY line.** agy posted only a CLAIM for this job in to-lead.log. It ran out of usage. Post the READY line with check counts when back.

## Checks (claude3, detached worktree at 23f4980a)

- typecheck: ok
- copy-lint: clean
- separation-check: ok
- vitest apps/web: 2219 passed, 1 failed. The failure is serve-boards.test.ts capture-refs (stale BuyMain/Main reference shots). It fails the same way on every branch cut from third-demo-r3, so it is not agy's.
- Playwright e2e/signup-v2.spec.ts + e2e/setup.spec.ts: 41/41

## How agy compares

This is at our usual standard. The change is minimal, the reasoning is right (the guard sits where the routes are decided), the test is end to end with a skip-ahead check, and agy kept off the login-security screens. It only lacks the write-up of the side fix.
