# Lead security re-review: Task 4 split, Task 5 minors, Task 7 fixes (head 494b6b0d)
No Critical. I-1, M-1, M-3, owner refused, Task 7 switch-off, taps/start perm, m9-m12 confirmed. T7 contains T4 and T5: land T7 in one step, never T4 and T5 separately. Full check on the PC: 4443 passed, 1 failed, Playwright 454, semgrep 0. Failure: apps/web test/cantDoThat-lint.test.ts: classify the new codes (tap-invalid and 5 more) in apps/web/src/ui/cantDoCodes.ts. Fix that first.
After T7 lands, new branch from main:
1. Owner and staff can't change their own login methods: PGP add, method removal and session list are trader-only (pgp.ts:896, methods.ts:436, routes/account.ts:400), and those sessions are now refused. A leaked or lost owner PGP key has no remedy. Build tapped staff-site method routes.
2. Owner alerts and push have no path: reading alerts is trader-only (routes/account.ts:447), migration 202's revoke fires 105_push.sql:40-42 and deletes the owner's push rows, re-subscribing needs a trader session, staff push is a stub (staff/app.ts:89). Build staff alerts and push routes.
3. Q60: senior moderators get feedback: roles.ts:47, NAV :70, staff/feedback.ts:35, routes.ts:68-69. Moderator and helper feedback checkboxes: GRANTABLE_PERMS roles.ts:39 and the 202:20 check.
4. m8: wire purgeKeyTaps (keyTap.ts:242) into the sweeper. The commit's "owner Q6" isn't an owner answer.
5. m11: store verified fields only. m12: open taps mustn't block the emergency stop.
6. Q54: API username is the public name; rename to displayName so a form can't publish the secret login name.
7. Task 8 at merge: site.ts:66 and settings.ts:148 consume without a sessionId; keep T7's keyTapRoutes mount.
Owner questions pending: Q51 (must mods hold all three, and which pairs log in?); taps on permanent delete (members.ts:221, ownerKeys.ts:94). Rebuild any database that ran an older 202 or 203.
