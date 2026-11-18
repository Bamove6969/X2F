# Re-review: wip/antigravity-rail-members-fix @ 6c2b4229 (round 2, against review-antigravity-rail-members-fix-2026-11-18.md)

Reviewer: the lead's dedicated agy/ANTIGRAVITY reviewer, 18 Nov 2026 (about 15:05 BC time).
Delta reviewed: 1694031b..6c2b4229. ANTIGRAVITY added one commit, which touches 11 files: Security.tsx, Alerts.tsx, DesktopShell.tsx, App.tsx, four comment-only files, securityMember.test.tsx, wideShell.test.tsx and e2e/team.spec.ts.

Lane: UI, comments and tests only. Nothing is outside it.

## Verdict: CHANGES NEEDED

Every round-1 finding is addressed. But the M1 fix introduces a regression for the account owner, and an existing Playwright test catches it (B1).

## Findings

### Blocking
- **B1. Owner regression: Security unmounts its content on every session re-check, so `e2e/security.spec.ts:348` fails.** The failing test is "a staged change is a draft ... reviewed and submitted from Security". It fails in the full run and again when run alone, so it is deterministic. At 1694031b it passed.
  - The cause is at Security.tsx:113 and :120: `ready = session.status === 'signed-in'` and `{!ready ? null : ...}`.
  - `refreshSession()` puts every mounted `useSession` back to `loading` (useSession.ts:59-62). That drops the whole page body (Methods, AccountChanges and the rest) and then mounts it again from scratch.
  - AccountChanges calls `refreshSession()` right after it sets its result (HoldChanges.tsx:162-171). So the owner's "Submitted. Your changes take effect on ..." message (`[data-part="changes-status"]`) is wiped as soon as it appears. NewRecoveryCode's Done and its 404 path (NewRecoveryCode.tsx:49, :58) do the same.
  - BehindTheDoor (frontDoor.tsx:76-80) already solves this: it waits only on the **first** load, and keeps a screen it has already let in mounted through a re-check.
  - Fix: gate on "have we ever known who this is". Keep the last signed-in member value in a ref or state, and render from it while a re-check is `loading`. Hide everything only before the first answer.
  - Keep the member test that counts fetches, and add a unit test that `refreshSession()` on an owner's Security does not unmount Methods or AccountChanges.

### Minor
- **m1. The new HelpTopic comment is not quite accurate (HelpTopic.tsx:11).** It says a member gets "security alerts and idle reminder". A member sees the alarm (sound) card and the idle reminder, not the security alerts list, which is hidden for members. The member copy line at HelpTopic.tsx:50 ("The account owner looks after the settings...") is unchanged. That is owner copy, so the lead decides.

### Round-1 findings: status
- **B1 (e2e):** fixed. `/settings/security` is out of the CantDoThat loop. A new test checks that a member sees Security with no Methods and no Devices link, no CantDoThat, and the alarm card. It passes.
- **M1 (first-render flash and owner calls):** fixed for the first load. The unit test checks that none of the 5 owner URLs is fetched for a member. But the fix causes B1 above.
- **M2 (Blocked and Jabber):** fixed for now. The Blocked link and JabberAlerts are hidden for members. The owner/lead question stands: should members get Blocked and Jabber? That is an API change.
- **M3 (Session length):** fixed. The link and its bare string are removed.
- **m1 (tour replay):** the replay is hidden for members. The welcome-screen link stays.
- **m2:** gone with M3.
- **m3:** the stale comments are updated (see m1 above for the one inaccuracy).
- **m4:** fixed. DesktopRail and DesktopShell take only `wallets`, and App passes `mayViewWallets`.

### Info
- The full run had one other red: `packages/omemo/test/message.test.ts`, "preKeyId is optional". It checks that the hex output contains no `084d`, but a random 32-byte key can contain that string. Run alone it passes 5/5. It is a flaky test, not from this branch (omemo is not touched). Worth a note to whoever owns omemo.
- Merge with origin/main 5c937ab9: `git merge-tree` is clean, with no conflicts.

## Checks run at 6c2b4229 (worktree agyrev-code, under ~/x2f-comms/check.lock, Docker up)
- `npm run check` exited 1:
  - typecheck ok; copy-lint clean; separation-check ok;
  - `npm test`: 376 files, 375 passed and 1 failed. Tests: 6992 passed, 1 failed (the omemo flake, see Info), 1 todo. The omemo file then passed 5/5 on a rerun.
- semgrep and audit were run separately: 0 findings and 0 vulnerabilities.
- Playwright web (full, `--trace off`): 546 passed, 53 skipped, **1 failed** (security.spec.ts:348, B1). Rerun alone under the lock, it failed again.

Counts: 1 blocking, 1 minor.
