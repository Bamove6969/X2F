# Re-review: wip/antigravity-rail-members-fix @ dc16f8b4 (round 3, against review-antigravity-rail-members-fix-r2-2026-11-18.md)

Reviewer: the lead's standing ANTIGRAVITY reviewer, 19 Nov 2026 (about 15:30 BC time).
Delta reviewed: 6c2b4229..dc16f8b4. ANTIGRAVITY added one commit, which touches 3 files:
- `apps/web/src/screens/settings/Security.tsx`, lines 8 and 113-119;
- `apps/web/src/screens/HelpTopic.tsx:11` (a comment only);
- `apps/web/test/securityMember.test.tsx:126-158` (a new test).

Lane: UI, comments and tests only.

## Verdict: APPROVE WITH MINORS

Round-2 B1 is fixed. `e2e/security.spec.ts:348` passes in the full Playwright run, and Playwright has no reds. I found no way for the new ref to show the owner view to a member, or the member view to the owner. Members still make no owner calls on first load.

M1 below is an owner copy question for the lead, carried over from round 2. It is not an engineering fault in this branch.

## Findings

### Major (lead/owner decision, not ANTIGRAVITY's to pick)
- **M1. HelpTopic still tells members that the owner looks after the settings (HelpTopic.tsx:50-51).** This is still wrong.
  - The member line reads "The account owner looks after the settings of the account you work for."
  - The "Open Settings" link has `owner: true` (:51), so HelpTopic.tsx:65 hides it from members.
  - But this branch now lets members open `/settings/security`. There they get the alarm card and the idle reminder (Security.tsx:144, :156-160).
  - So a member reading Help > Settings is told it is not theirs and gets no link, though a Settings screen exists for them.
  - Owner copy (COPY-UNSIGNED): the lead decides. My recommendation:
    - drop `owner: true` from the link;
    - reword the member line to something like "Your alarm and idle reminder are in Settings. The account owner looks after the rest.";
    - get owner sign-off on the words.

### Minor
- **m1. The new unit test does not check the part that actually broke (securityMember.test.tsx:126-158).**
  - Round-2 B1 was AccountChanges' "Submitted..." status (`[data-part="changes-status"]`) being wiped by `refreshSession()`.
  - The new test only checks that the Methods and PayoutWait elements keep their DOM identity. It does not check AccountChanges or any state held inside a section.
  - The e2e test (security.spec.ts:348) does cover it, and passes.
  - Suggest adding `[data-part="account-changes"]` (or the status line itself) to the identity check, so the unit test fails the way the e2e did.
- **m2. The ref is written during render (Security.tsx:113-119).** React advises against writing refs during render. Here it is harmless:
  - the value comes from `session` alone, the same way on every render;
  - a discarded concurrent render writes the same value again.
  BehindTheDoor (frontDoor.tsx:84-88) uses the same pattern, so this is consistent with the codebase. No change needed. It is noted only so nobody copies it for state that is not a pure function of props.

## Can the ref leak a view across accounts or roles? No.

How the code works:
- The ref belongs to one mounted `SecurityScreen`. Every new mount starts at `{ ready: false, member: false }`, which renders nothing.
- A `signed-in` answer recomputes `member` from that same answer in the same render (:114-115).
- A `signed-out` answer resets the ref (:116-117).
- Only `loading` and `error` keep the last value.
- `error` never reaches the screen in the app: BehindTheDoor (frontDoor.tsx:66) sends both `error` and `signed-out` to the Landing board, which unmounts Security.

The cases:
- **Logout, then login as someone else.** Logout ends in `signed-out`. That resets the ref, and BehindTheDoor unmounts the screen. Logging in happens on /login, so the next Security is a fresh mount.
- **A role change or account switch mid-session**, for example another tab logging in as someone else on the same cookie, followed by `refreshSession()`:
  - while `loading`, the screen keeps showing what it already showed, with no new mounts and no new fetches;
  - the first `signed-in` answer re-renders with the new role in the same render.
  - Owner to member: the owner sections unmount, and the member gets no owner calls.
  - Member to owner: the owner sections appear only after the answer.
- **A member removed from the team.** The server ends the session: 401, then `sessionEnded()`, then `signed-out`, so the case above applies.

I checked this with a throwaway test. It is in the scratchpad and is not committed. It mounts Security and holds `me` pending across a `refreshSession()`, then answers with the other role:
1. owner to member: no owner parts after the answer, and no owner URL fetched after the switch;
2. member to owner: no owner parts while loading, and all 6 after the answer;
3. owner, then `sessionEnded()`, then member: nothing shown while signed out, then the member view with no owner calls;
4. a first load that errors: no owner calls.

All 5 tests passed. One behaviour to know about: if Security is rendered alone, without BehindTheDoor, the last view stays up on `error`. In the app, the door navigates away first.

The only thing seen "across" a switch is the previous view, already on screen, for the length of one `me` request. The server still enforces every owner route (round 1: all 21 owner routes return 403 to a member).

## Round-2 findings: status
- **B1 (Security unmounts on refreshSession; security.spec.ts:348):** fixed. It passes in the full run.
- **m1 (HelpTopic comment):** fixed. :11 now says "alarm settings and idle reminder". The member copy at :50 is M1 above.
- First-load owner calls for members: still none. The round-2 member test passes: none of the 5 owner URLs is fetched, either on first render or after it settles.

## Checks run at dc16f8b4 (my own worktree agyrev-r3, fresh `npm ci`, under ~/x2f-comms/check.lock, Docker up)
- `npm run check` exited 1:
  - typecheck ok; copy-lint clean; separation-check ok;
  - `npm test`: 376 files, 375 passed and 1 failed. Tests: 6993 passed, 1 failed, 1 todo.
  - The failure is `apps/api/test/identity.test.ts:456` ("stores no attestation whose terms differ ... 409 terms-mismatch"): it got 201 instead of 409.
  - This branch touches no API code. Run alone 3 times, it passed 19/19 each time.
  - Likely cause: line 444 makes the "different" payout by replacing the last character with `X`. When the random address already ends in `X`, the terms do not differ, so the API rightly accepts them. That is a flaky test, not from this branch. Worth a note to the owner of identity.test.
- semgrep (run separately, because `check` stops at the red test): 0 findings. `npm audit --omit=dev`: 0 vulnerabilities.
- Playwright web (full, `--trace off`): **548 passed, 52 skipped, 0 failed**. That includes security.spec.ts:348 and team.spec.ts.
- Targeted: `securityMember.test.tsx` 3/3 passed. My throwaway leak test (not committed) 5/5 passed.
- `git merge-tree` against origin/main 54104057: clean, with no conflicts.

Counts: 0 blocking, 1 major (owner copy, lead decides), 2 minor.
