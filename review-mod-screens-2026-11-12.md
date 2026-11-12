# Review: wip/lead-mod-screens (Plan 4 Task 18, ModQueue and ModCase), 2026-11-12

Reviewer: independent security and code review (Claude helper). This file is not committed.

- Reviewed head: **5c2497e7** (`5c2497e7b465cffb7bd1409d1b5ef57627afed7c`), against base **wip/lead-rulings c9a5ad75**. The merge-base is c9a5ad75.
- History: I started on 493a9398, which was stacked on rulings 97e342c6. The builder then rebased to b3aeac5c on c9a5ad75, and later moved to 5c2497e7, which adds catalog method names. `git range-diff` shows the three original commits are patch-identical after the rebase. I read the later commits (cf799b01, 75271473, b3aeac5c, 3a6bdb0b, 7aa7057e, 5c2497e7) one by one.
- Scope: the diff c9a5ad75..5c2497e7, which covers 13 files: the staff-web screens, api.ts, the e2e spec and the small additions to the API staffRoutes. I also read the rulings code these screens rely on: `apps/api/src/disputes/rulings.ts`, `rulingDrafts.ts`, `packages/staff/src/dispute.ts` (propose, approve and send-back), StaffShell and KeyTapDialog.

## Verdict

**APPROVE. No blocking findings.** There are 3 minor findings and 5 info findings below. Every security property the brief asked about holds on the server. The client only hides buttons, which matches the brief's expectation.

## The brief's checks

| Check | Result | Where |
|---|---|---|
| A helper has no Disputes page | Holds. `NAV.helper` has no `disputes`, so StaffShell renders NothingForRole for `/disputes/*`, and the API matrix allows only owner, senior and mod (`apps/api/test/staff/routes.ts` rows 119-130). The test "a helper has no Disputes page" also checks that no `/staff/v1/disputes` call is made. | StaffShell.tsx, moderator.test.tsx |
| A moderator is never offered appeals | Holds. The client's `takeable()` offers an `appealed` row only to a senior or the owner. The server holds the same rule three ways: `/next` filters appeals by `isSeniorOrOwner`, the machine's `assign` calls `eligibleForAppeal`, which requires senior or owner, and `propose` in round 2 checks `eligibleForAppeal`. Tested on both sides (mod: no Take; senior: Take). | ModQueue.tsx, dispute.ts:448-475 |
| A moderator never sees the approval panel | Holds. `approving` requires `isApprover(role)`, and the approve and send-back routes are `rulings.approve`, which is owner and senior only in the matrix. Tested. | ModCase.tsx |
| Only the assignee can propose | Holds. The machine's `propose` rule requires `d.assignee !== by.id ⇒ wrong-party` (403 forbidden-case). The client shows ProposeForm only when `assignedToYou`. | dispute.ts:467 |
| The proposer can never approve | Holds on the server. The machine's `approve` and `send-back` rules both return `same-person` when `d.ruling.proposer === by.id` (409; tested in rulings.test.ts). `proposedByYou` is computed on the server from the stored `d.ruling.proposer === me.id` (staffRoutes.ts), and the new rulings.test assertion checks it is true for the senior proposer and false for the owner. The client only hides the panel. | dispute.ts:488, staffRoutes.ts |
| The ruling tap binds the reason SHA-256, the XMR amount, the outcome and the case | Holds, and the server enforces it. `consumeKeyTap` compares the tap against an intent the server rebuilds itself. For propose, that intent holds the body's outcome and reason, `trades.amount_atomic`, the dispute's round and the route's code. For approve, it holds the stored `d.ruling.outcome`, the stored draft reason and `trades.amount_atomic`. A client that signs anything else gets 403 `tap-invalid`, and nothing is written. On propose, the client captures the reason, outcome and rulingId once at submit and uses the same values for both the intent and the POST, so the dialog cannot sign one thing while the page posts another. I checked that the client's `@x2f/staff` sha256 matches node's `createHash` on UTF-8 multibyte text, emoji, CJK, CR/LF/tab and a 4000-character reason (scratchpad `rvms-sha.ts`, all match). | rulings.ts:111-121,197,241; modModel.ts |
| The API additions leak nothing | Holds. `settings: {firstResponseH, largeTradeLimitUsd}` is on the queue, `limitUsd` and `proposedByYou` are on the case, and `methodName` (the public catalog name) is on queue rows and the case escrow. All sit behind the existing `disputes.handle` routes, so only owner, senior and mod see them. None is about another person: `proposedByYou` is a boolean about the viewer, and the limit and reply hours are policy values that moderators already work under. No new route was added, so the route matrix needs no new row. | staffRoutes.ts |
| Nothing fetches chat | Holds. api.ts adds no chat call. ChatCard is static, and its button is disabled. The unit test and the e2e spec both assert that no request matches `/chat\b`. | ModCase.tsx, moderator.test.tsx, e2e/moderator.spec.ts |
| No test weakened; matrix rows complete | Holds. API tests only gain lines (staff.test +8 and a new methodName case, rulings.test +4). In the unit test, the only changed assertion is the case line, where `'zelle · …'` became `'Zelle · …'` with an added `not.toContain('ZELLE')`, so it is stronger. The route matrix is unchanged by this branch. The rulings base c9a5ad75 removed the `appeal-reviewers` row together with its route, and staff-web never calls that route. | |

## Findings

### Minor

**M1. Evidence lines are not bound by the ruling tap.** This is in rulings c9a5ad75, not in this diff, but these screens build on it. The intent binds `reasonSha256`, but not the evidence array that is published to both traders next to the reason (`dispute_rulings.evidence`). A script on the staff page with the session and one genuine tap could post different evidence from what the moderator saw, and the tap would still verify. The approver's tap does not bind the evidence either. Because the evidence is published trader-visible text in a legal-style decision, it arguably deserves the same binding as the reason. Recommendation: add `evidenceSha256` to the ruling intent, computed as the SHA-256 of canonical JSON of the lines. This changes the KeyTapIntent shape and the moderation gate's re-verification (Task 13), so it is a lead or owner decision and not a change for this branch.

**M2. In an appeal, a senior who took part in round 1 is still shown "Approve ruling" and "Take this case".** In ModCase, `approving` is `awaiting-approval && isApprover && !proposedByYou`, and `takeable()` looks only at role and status. Neither checks R37 involvement. The server refuses both (`not-eligible` returns 403 forbidden-case). The withDispute transaction rolls back, so the tap is not consumed, and `rulingFault` shows "You took part in this case before…". So nothing is unsafe, but the page offers an action the API will refuse, which goes against the page's own stated rule ("never offers what the API would refuse"). The case answer already has `mayWork`, which is false for a round-1 participant in round 2. Recommendation: add `&& (c.round === 1 || c.mayWork)` to `approving`, and apply the same gate to the Take button on the case page. The queue row has no involvement flag, so the queue's Take would stay as it is.

**M3. A test gap: proposer-cannot-approve is only covered client-side through a mod.** The test "the proposer then sees the case waiting" uses `role: 'mod'` with `proposedByYou: true`. A mod is already excluded by `isApprover`, so the `!c.proposedByYou` branch is never what hides the panel in any test. A senior or owner fixture with `proposedByYou: true` should assert that `part('approve')` is null. The server side is well covered (rulings.test "same-person" and the new `proposedByYou` assertions), so this is minor.

### Info

**I1.** The tap dialog's own text names only the outcome ("…sign this ruling: Release to buyer."). The amount, the case code and the reason are on the page behind the sheet, not in the dialog. The server-side binding makes this safe. A designer may still want the dialog to restate the amount and the case (DESIGNER-REVIEW, copy).

**I2.** The maintenance refusals (`dispute-paused`, `trading-paused`) are explained only after the moderator has tapped, because the page does not know about the pause in advance. Per c9a5ad75 the tap stays unused, so the cost is one wasted tap. This could later be shown before the tap if the case answer carries the pause.

**I3.** `Disputes.tsx` calls `GET /staff/v1/me` a second time, after the shell has already read it, to get the role. If that call fails with something other than a 401, the page stays on the loading spinner and shows no message. Passing the role down from the shell would remove both the extra call and the dead end.

**I4.** `limitUsd: Number(limitUsdCents / 100n)` truncates to whole dollars. This is fine as long as the setting is always whole dollars, which `largeTradeLimitUsd` is today. `overLimit` still compares in cents, so a fractional limit would only change the wording.

**I5.** In the new staff.test methodName case, `mod.b.get(url(code))` is called twice, and only the first call's status is asserted. This is harmless.

## Tests run (on 5c2497e7, through the serialised runner, single files)

- `apps/staff-web/test/moderator.test.tsx`: 15/15 passed
- `apps/staff-web/test/shell.test.tsx`: 13/13 passed
- `apps/api/test/disputes/staff.test.ts`: 28 passed, 1 todo
- `apps/api/test/disputes/rulings.test.ts`: 16/16 passed
- `apps/api/test/staff/matrix.test.ts`: 103/103 passed
- `tsc --noEmit` for apps/staff-web and apps/api: clean
- Client SHA-256 against node `createHash` (scratchpad `rvms-sha.ts`): 5/5 match

Not run: Playwright `e2e/moderator.spec.ts`, because the brief did not ask for Playwright. The builder reports it at 2/2 on b3aeac5c. The spec changed again in 7aa7057e, and I read it but did not run it.

## Cleanup

The detached worktree `.claude/worktrees/rv-modscreens` and its node_modules were removed after the run.
