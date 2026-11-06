# Handoff: session length at every login + "Stay logged in?" (lead-sessions, 2 Nov 2026)

Branch: `wip/lead-sessions` (worktree `~/x2f-worktrees/lead-sessions`), head `12155184`, pushed.
Based on the main line `origin/claude/compassionate-johnson-k95ssr`. The main line at `b6835eef` (devices, My offers, C11) is merged in; the merge was clean.
Owner decisions: `origin/wip/design-brief` `docs/design-hold-model-2026-11-02.md` ("Sessions, revised"); boards SessionLength, SessionExtend, Devices.

## Done
- **packages/accounts**
  - `sessionLength.ts` replaces `logoutTimer.ts`. It has `sessionHoursFor('trader'|'vendor')` (2/4/6/12 and 2/6/12/24), `isSessionHours`, `UNCHOSEN_SESSION_HOURS = 2` and `SESSION_PROMPT_MS = 2 min`. `SESSION_PROMPT_MS` is the open owner question, drafted at 2 minutes.
  - New ConfirmAction `{ kind: 'extend-session' }`.
- **API**
  - Migration `307_session_length.sql`: adds `sessions.length_hours` (null until chosen) and `period_started_at`, and drops `accounts.idle_hours`.
  - `sessionPolicy(kind, level)` returns null for full trader sessions. Such a session ends at `expires_at`, and using it never moves that time. There is no idle limit and no 30-day cap.
  - Staff, owner and recovery sessions keep their old fixed rules.
  - A new full trader session lasts 2 h until a length is chosen.
  - `PUT /v1/account/session/length {hours}` (traders; members allowed for their own session):
    - With no length yet, the session lasts `hours` from the login.
    - Once a length is set, a shorter one applies now. A longer one never adds time; it applies from the next extend.
  - `POST /v1/account/session/extend {confirmToken}` checks the token through `requireConfirm({kind:'extend-session'})`, so any confirm route works: password (plus TOTP when the account has one), passkey, security key or PGP. The session then lasts its length again from now, and the cookie is set again with the same token. Members get `owner-only`.
  - Both routes are in `LIVE_SESSION_ROUTES` and use `requireLiveSessionInTx`; coolingOff has a row for each.
  - The length route is listed in the team-audit EXEMPT list.
  - `me.session = { lengthHours, choices, expiresAt, canExtend, serverNow } | null`.
  - The logout-timer routes, `PendingChange` apply, `SECURITY_CHANGE_ROUTES` entry and `applyLogoutTimer` are removed. A logout-timer change still stored in a hold is dropped (no-op) when the hold settles.
  - Tests:
    - New `apps/api/test/sessionLength.test.ts`.
    - Updated `sessions.test.ts`, `account.test.ts`, `schema.test.ts`, `team.test.ts` and `wallets.test.ts`.
    - In `coolingOff.test.ts`, the logout timer was replaced by `heldChange()` (One device at a time on, with a confirm token) as the held change.
- **auth-client:** `setSessionLength` and `extendSession`; the `SessionInfo` type; `getLogoutTimer` and `setLogoutTimer` removed; tests updated.
- **web**
  - `screens/auth/SessionLength.tsx`: the `/session-length?returnTo=` route and `SessionLengthField`. `afterLogin` sends a session with no length there first.
  - `screens/auth/SessionPrompt.tsx`: mounted in App and fed by `session/sessionWatch.ts`. It opens `SESSION_PROMPT_MS` before the end, reuses the new `ConfirmMethods` (extracted from ConfirmSheet), and logs out through `logOut(browserPushEnv())`.
  - Devices has a "Stay logged in for" field.
  - The logout-timer card is gone from Security.
  - Copy is in `screens/auth/sessionCopy.ts` (COPY-UNSIGNED, from the boards).
  - Tests: `apps/web/test/sessionLength.test.tsx`.
  - e2e: `security.spec` drops the timer tests, and `login.spec` has a new picker test.

## Test status (last runs)
- api + web + auth-client + accounts `tsc`: OK, run before the final logOut rename.
- API targeted run (sessionLength, sessions, account, schema, wallets, team): 245/248 passed. Fixes for all 3 failures were committed in cd5fb81e ("test(api): session length fixes"), but **not re-run yet**.
- Web, after the handoff was first written (head 12155184): web tsc OK; logout-tripwire and sessionLength pass (13/13); copy-lint clean. So the web project is now expected to be fully green; the full project has not been re-run since.
- Web unit (full project, earlier): 1164/1165 passed.
  - All of `sessionLength.test.tsx` passed.
  - The 1 failure was the L2 logout tripwire. It is fixed in head (the prompt now calls `logOut(env)`), but **not re-run yet**. A run was in flight when I stopped: tsc, logout-tripwire, sessionLength, copy-lint.
- **Not run yet:**
  - `coolingOff.test.ts`, which has the most changes (heldChange swap and new ROWS).
  - `password`, `confirm` and `actionInput` tests.
  - auth-client tests.
  - Playwright `login.spec` and `security.spec`.

## Exact next step
1. `cd ~/x2f-worktrees/lead-sessions`. Then run under `flock ~/x2f-comms/check.lock` with `sg docker -c`:

   `npx vitest run --project @x2f/api apps/api/test/{sessionLength,sessions,account,schema,wallets,team,coolingOff,password,confirm,actionInput}.test.ts`

   Then `--project @x2f/auth-client`, `--project @x2f/accounts` (check the project name in its vitest config) and `--project @x2f/web`.

   Project names are `@x2f/api` and `@x2f/web`, not `api`.
2. `npx tsx tools/copy-lint.ts`, then `tsc` for each workspace.
3. Run Playwright login and security: `X2F_CHROMIUM_PATH=/usr/bin/chromium npx playwright test -c apps/web/e2e/playwright.config.ts login.spec.ts security.spec.ts --workers=1`.
   - `block.spec.ts:105`, `team.spec.ts:553` and `design-shots.spec.ts:152` still stub the old logout-timer URL. The stubs are harmless, but you can remove them.
4. Design shot 13 (`design-shots.spec.ts`) is `test.skip`'d with a TODO. Re-shoot it with another held change, such as the One-device toggle on Devices.
5. Optionally update `docs/coordination.md` (route classification) and the logout-timer mention in `docs/superpowers/plans`.

## Design notes (safest defaults I picked, not owner policy)
- The prompt opens `SESSION_PROMPT_MS` **before** the end, so the session never runs past its chosen time without a fresh proof. The board copy still says "is up".
- A session whose length was never chosen lasts the shortest choice (2 h). Extending it adds 2 h.
- A longer length picked on Devices applies from the next extend ("A longer time starts the next time you confirm it's you." — my sentence, COPY-UNSIGNED). A shorter one applies now.
- Extending is allowed at any time while the session is live. It counts from now, so extensions cannot stack.
- Signup is not asked. The first session lasts 2 h until "Stay logged in".
- Team members choose their own length but cannot extend: the confirm routes check the owner's methods, so members are logged out at the end.
- Recovery, staff and owner sessions are unchanged.
- Live sessions at migration time keep their current deadline, but using them no longer moves it.

## Open owner questions
1. How long does the prompt wait before logout? It is the named constant `SESSION_PROMPT_MS`, drafted at 2 min.
2. Should the Devices setting change only this session (as built), or also something like a default? The board leaves the default undecided.
3. Should a longer length chosen mid-session add time at once (that would need a proof), or from the next confirm (as built)?
4. Should team members be able to extend with their own login methods?
5. Should signup ask for the session length too?
6. Should any idle logout remain on top of the session length? Today there is none.
