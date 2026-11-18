# Review: wip/antigravity-rail-members-fix @ 1694031b (fixes review-agy-rail-members-2026-11-18.md M1-M4)

Reviewer: the lead's dedicated agy/ANTIGRAVITY reviewer, 18 Nov 2026 (review written about 13:20 BC time).
Base: wip/agy-rail-members eb30b47b. There is one ANTIGRAVITY commit, 1694031b, and it touches 10 files:
- App.tsx, Alerts.tsx, Security.tsx, member.ts, BottomNav.tsx and DesktopShell.tsx;
- the tests securityMember.test.tsx (new), task30-units, ui and wideShell.

Lane: UI and tests only. No API, money, key or login code is touched. Nothing is outside the lane.

## Verdict: CHANGES NEEDED

The security side holds. The API refuses a team member on every owner section that is now on the members' Settings page (the probe below checks 21 routes). But the branch is red: one Playwright test still expects the old refusal (B1). Several of the "member settings" now on the page do not work for a member (M1-M3).

## Findings

### Blocking
- **B1. Playwright is red: apps/web/e2e/team.spec.ts:490-501.** The test "a member opening /settings/security gets CantDoThat owner-only, never a blank screen" fails. It looks for `[data-part="cant-do-that"]` with `data-from="owner-only"`, and that element is gone now that Security.tsx no longer uses OwnerOnly. This is the intended M3 behaviour, so the test must change, not the code:
  - take `/settings/security` out of the loop (Wallets and Team stay in it);
  - add an e2e test: a member on /settings/security sees the Security screen with no owner sections, and no CantDoThat.
  ANTIGRAVITY's tests do not show this failure because they include no Playwright run.

### Major
- **M1. Owner sections still mount for a member on every visit (Security.tsx:110-111, Alerts.tsx:105).** `memberOf()` returns null while the session is `loading`. `useSession()` always starts in `loading`, even when the shared answer is already known (useSession.ts:56).
  - On a member's first render of Security, `member` is false, so HoldBanner, NewRecoveryCode, AccountChanges, Methods, PayoutWait, the Devices link, the Account type and Team links, and the Alerts list all mount. They unmount one tick later.
  - Their effects fire too. My probe pre-loaded the session, as BehindTheDoor does, then mounted Security as a member. These calls went out: `/v1/account/hold`, `/v1/account/methods`, `/v1/wallets/rule`, `/v1/account/jabber` and `/v1/account/alerts`. The server refused them, and they are wasted calls on every visit.
  - This is the M1 flash again, on the page M3 opened up. `mayViewWallets` handles it for the rail, but the screen itself does not.
  - Fix: treat `loading` as "not known yet". Render no owner section (or nothing below the title) until the status is `signed-in`, and pass `member` to Alerts only once it is known.
  - Add a test that counts fetches on the first render. The new securityMember.test.tsx misses this because it stubs 200s for the owner routes and checks only after `settle()`.
- **M2. "Blocked traders" is a dead end for a member (Security.tsx:136-140).** The API refuses a member on every blocks route: `GET/POST /v1/account/blocks`, the delete and the note use `requireSession({ kinds: ['trader'] })` with no `member` (nudge/routes.ts:381-388). Existing tests pin this as intended: blocks.test.ts:231-245 expects 403 owner-only.
  - A member who taps the link gets the Blocked screen's load-failed error.
  - Jabber is the same: every /v1/account/jabber route is owner-only (jabber/routes.ts:146-259; jabber.test.ts:596-609). JabberAlerts hides itself on the 403, so nothing breaks, but the member has no Jabber.
  - The brief's "members keep blocked, jabber" is therefore not true at the API. The earlier review's M3 made the same mistake: it read only the web wrappers.
  - Owner/lead question: should members have Blocked and Jabber? That is an API decision, outside ANTIGRAVITY's lane. Until it is decided, my recommendation is to hide the Blocked link for members.
- **M3. The new "Session length" link sends the member straight back out (Security.tsx:150-154).** `/session-length` is the after-login question. When the session already has a length, which is always true after login, SessionLengthScreen does `navigate(returnTo, { replace: true })` at once (SessionLength.tsx:100-103). So a member who taps it lands on the home screen.
  - The real place to change it is Devices, and Devices is OwnerOnly.
  - `PUT /v1/account/session/length` is member-allowed, so a member-usable field is possible. Where it goes is a lead/owner call. Recommendation: drop the link for now, or put SessionLengthField on the member's Security page.

### Minor
- **m1. The member's Help card replays the owner tour (Security.tsx:49, :173).** "Take the tour again" starts `FIRST_TRADE_TOUR`. Members have their own tour (`memberTour`, tour/memberSteps.ts:106, which WelcomeGate.tsx:32 starts). Recommendation: for a member, start `memberTour(abilities)`, or hide the replay row.
- **m2. The new string is not in a copy file and has no marker (Security.tsx:152).** The literal "Session length" has no `COPY-UNSIGNED` marker and is not in SESSION_COPY. copy-lint passes, but the helper rule asks for the marker. If M3 removes the link, this goes too.
- **m3. Comments and copy that say members have no Settings are now stale:**
  - HelpTopic.tsx:11, and its member copy at :50 ("The account owner looks after the settings...");
  - SessionLength.tsx:152 ("members have no Security screen");
  - IdleReminderSettings.tsx:5;
  - tour/memberSteps.ts:98 ("members have no Settings › Help to replay it from yet").
  The copy line is owner copy, so the lead decides. The comments are ANTIGRAVITY's to fix.
- **m4. DesktopRail has two props that overlap (DesktopShell.tsx:95-102).** It takes both `member` and `wallets`, and `member` only matters when `wallets` is undefined. App.tsx passes both. Pick one, `wallets`, so the props cannot disagree.

### Checked and fine
- **Security (API, the real enforcement).** I added a probe to my copy of apps/api/test/team.test.ts; it was not committed and has been removed. A member with offers, trades and hold-end got 403 `owner-only` on all 21 owner routes the Security page and its links call:
  - methods: GET methods, DELETE methods/:type/:id, PUT password;
  - adding a login: pgp start and finish, webauthn start and finish, totp start and finish;
  - recovery: POST recovery-codes, POST recovery-code/reveal;
  - holds: POST hold/changes/submit;
  - payout wait and devices: GET wallets/rule, GET security/devices, PUT security/one-device, GET sessions;
  - account type, team and alerts: PUT account/type, GET team, GET team/audit, GET alerts, POST alerts/:id/seen.
  1 test passed. `GET /v1/account/hold` lets any member read, by design (holdReader, `member: 'any'`), and approve and cancel need the grantable hold-end and hold-cancel boxes (owner p4-8). No hole.
- **Deep links.** /settings/devices, /settings/account-type and /wallets keep OwnerOnly. /settings/team and /settings/changes were never wrapped, and their APIs refuse or gate the member. There are no /settings/security/* sub-routes, and unknown paths fall to the front door. A member reaches nothing owner-only through the new page.
- **Idle reminder.** It works for members: `PUT /v1/account/idle-reminder` is `member: 'any'`.
- **Previous M1 (rail).** `mayViewWallets` is false while loading, and there is a unit test. Fixed.
- **Previous M2 (phone).** BottomNav drops Wallets when `wallets` is false, and there is a unit test. Fixed.
- **Previous M4.** Nothing to do.
- **Merge with origin/main 5c937ab9.** `git merge-tree` is clean, with no conflicts. Main also changed App.tsx (Plan 5 profile, badges and record routes, /help) and Alerts.tsx (the wallet-restored kind), and both auto-merge. Note for the lead: main's new /settings/badges and /settings/record are not linked from Security, and that is outside this branch.

## Checks run at 1694031b (worktree agyrev-code, under ~/x2f-comms/check.lock, Docker up)
- `npm run check` exited 0:
  - typecheck ok; copy-lint clean; separation-check ok;
  - `npm test`: 376 files passed, and 6993 tests passed with 1 todo and 0 failed;
  - semgrep: 0 findings; audit: 0 vulnerabilities.
- Playwright web (full, `--trace off`): 547 passed, 52 skipped, **1 failed** (team.spec.ts:491 for /settings/security, see B1).
- Probes: the API member-refusal probe passed (1/1, 21 routes), and the web first-render probe confirmed M1 (5 calls). Neither probe is committed.

Counts: 1 blocking, 3 major, 4 minor.
