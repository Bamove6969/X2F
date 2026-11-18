# Review: wip/agy-web-tests @ d7016989 (Job 18, test coverage for thin web screens)

Reviewer: the lead's dedicated agy reviewer, 18 Nov 2026.
Base: wip/third-demo-r3 94337781 (the branch holds one agy commit on top of it).
Scope: 8 new test files under `apps/web/test/`, 1171 lines in all: feedbackScreen, helpTopicScreen, landingScreen, maintenanceScreen, myOfferDetailScreen, ownerOnlyScreen, payoutWaitScreen and recoveryCodesScreen. No source file is changed, and no existing test is edited, skipped or deleted.
Lane: test code only. This is within agy's lane.

## Verdict: CHANGES NEEDED

Two of the eight new files are broken at their own head. One breaks `npm run typecheck`, and four of agy's own new tests fail. They look as if they were never run.

## Findings

### Blocking
- **B1. The typecheck fails: 4 errors, all in `apps/web/test/maintenanceScreen.test.tsx`** (lines 12, 54, 75, 98). TS2741: `Property 'since' is missing ... but required in type 'SiteMaintenance'`. Every fixture needs `since`. `npm run check` stops at its first step.
- **B2. 4 of the 6 tests in `myOfferDetailScreen.test.tsx` fail at d7016989:**
  - "renders live offer ...": expected `'Selling Monero'`, but the pane says `'Selling XMR · USD'`;
  - "renders paused offer ...": expected status `'Paused'`, but the pane says `'Off · hidden from everyone'`;
  - "disables switch when busy is true": `aria-disabled` is null;
  - "disables switch ... when held is true": `aria-disabled` is null.

  The assertions describe a MyOfferDetail that does not exist on this base (wip/third-demo-r3 94337781). Write them against the component as it is. If a failure points at a real bug (for example, the switch really should be `aria-disabled` while busy), Job 18 says to fix it and say so. Do not assert behaviour the code does not have.

### Minor
- **M1. Conflict with agy's own Job 16 branch.** `helpTopicScreen.test.tsx` asserts the placeholder help bodies, for example `'Answers to common questions are coming here soon.'`, and also `host.querySelector('p')` being the body. wip/agy-help-pages (5b15fd80) replaces those placeholders with real help content and adds `helpPages.test.tsx`, so whichever lands second turns red. Either drop helpTopicScreen.test.tsx in favour of helpPages.test.tsx, or rebase it onto help-pages and assert structure, not placeholder strings. Say so in both READY lines. wip/lead-owner-ui also rewrote `HelpTopic.tsx`, with signed-out, owner and member lines per topic, so these placeholder assertions fail there as well. Main has no `HelpTopic.tsx` yet.
- **M2. The job target is not fully met, and the method is not reported.** Job 18 says "target the 10 thinnest screens first". There are 8 suites and no note of how the screens were picked. The choice itself is good: before this branch, MyOfferDetail, OwnerOnly and PayoutWait had no test at all, and HelpTopic and RecoveryCodes only had indirect coverage. Add the list and the method (for example "screens with no file in apps/web/test importing them") to the READY line, plus the 2 remaining screens or a reason.
- **M3. `as any` on mocked API results.** There are 5 (`payoutWaitScreen`, `recoveryCodesScreen`), plus `(abortErr as any).code`. Typed fixtures (`satisfies Awaited<ReturnType<typeof authApi.getWalletRule>>`) would turn red when the API shape changes. As written, the mocks can drift from the real types without anyone noticing.
- **M4.** `ownerOnlyScreen.test.tsx` "renders children when signed out" pins the current behaviour: the OwnerOnly guard lets a signed-out visitor through, and the session gate above it handles sign-in. That is fine as documentation, but add a one-line comment saying why it is safe, so nobody reads it as an endorsed hole.

### Info
- The tests use the repo's own `render`/`fire` helpers and happy-dom, as the existing suites do. They are behavioural: states, callbacks, disabled/aria states, error paths, the `?from` code on feedback, and unsafe `returnTo` falling back to /sell.
- No user-facing copy is added, so COPY-UNSIGNED does not apply. No "half".

## Checks run at d7016989 (under the shared lock)
- `npm run typecheck`: **FAIL**, 4 errors in `maintenanceScreen.test.tsx` (B1).
- `npm run copy-lint`: ok.
- `npm run separation-check`: ok.
- `npm test` (Docker up): 404 files: 402 passed, 2 failed. Tests: 7344 passed, 5 failed, 1 todo.
  - 4 failures are `myOfferDetailScreen.test.tsx` (B2).
  - 1 failure is `serve-boards.test.ts` capture-refs, the known baseline red.
  - The other 6 new files pass: feedback, helpTopic, landing, maintenance (at runtime; the typecheck still fails), ownerOnly, payoutWait and recoveryCodes.
- `npm run semgrep`: 0 findings.
- `npm run audit`: 0 vulnerabilities.
- Playwright: not run. The branch is test-only and changes no app source.

Counts: 2 blocking, 4 minor, 2 info.
