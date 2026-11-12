# Security review: wip/lead-appeals (Plan 4 Task 24: D-005, D-010, D-011), 12 Nov 2026

Reviewed: origin/wip/lead-appeals at 384a8803, base main 6ebed537 (15 files, +685/-13), in a detached
worktree of my own. I changed no code. At review time origin had no newer re-alert commit. The builder is
still working on one (a `appeals-realert-*` test log exists), so that commit is NOT covered here.

## Verdict

**Approve with must-fix: 1 must-fix (M1, an owner or lead call on who may read the reviewer list), 1
should-fix (S1), and minors.** I found no way for an involved senior to review their own case: R37 is
still enforced by the machine (`packages/staff/src/dispute.ts` lines 279 and 443, against
`round1.involved`). The new code only reads eligibility; it never decides who may act. The alert and the
push leak nothing beyond what earlier alerts already carry. The 48 h edge matches the machine exactly. No
test was weakened.

## Findings

### M1 (medium, must-fix or owner sign-off): the reviewer list shows the staff roster, and who was involved, to every senior, including the involved ones
`GET /staff/v1/disputes/:code/appeal-reviewers` (`apps/api/src/disputes/staffRoutes.ts` ~435) is gated by
`rulings.approve`, so the owner and every senior can call it, on any dispute code. Three problems:
- It returns the display names of every switched-on, live senior moderator and the owner. Today only the
  owner can list staff (`GET /staff/v1/members` needs `staff.manage`), so this is a new disclosure to seniors.
- Once an appeal is filed, the list is everyone minus round 1's `involved`. A senior can work out who was
  involved in round 1, and whether a colleague is switched off.
- It does not refuse a caller who is in `round1.involved`. An involved senior can learn exactly who will
  review the appeal of their own ruling. That breaks the spirit of R37 ("nobody involved takes part in its
  appeal") by opening a way to lobby the reviewer, even though the machine still stops them acting.

The plan (plan-4-staff.md line 703) names the route but sets no permission. The builder chose
`rulings.approve`. Recommendation for the owner/lead: make it owner-only (`staff.manage`). The owner is the
one who acts on D-011 by adding or switching on a reviewer. If seniors must keep it, then at least refuse
(403 `not-eligible`) any caller in `round1.involved`, and return only `waiting` and a count to seniors,
never names. Either way, add a test for an involved senior calling it.

### Audit logging of that route (no change needed)
Leaving it unlogged is correct and should stay that way. R37 counts any log entry on the trade as
involvement. A logged read before an appeal would make the reader involved and shrink the reviewer pool,
which could even cause the D-011 wait itself. The route returns no case content (no chat, evidence, ruling
or trader data), so the G37 "case.opened" rule does not apply. The only cost is that an involved senior's
probing leaves no trail. M1's fix (refusing involved callers) removes that case.

### S1 (should-fix, functional, owner call on the behaviour): a member with File an appeal but not Answer the moderator gets a button that leads to a 403
`appealUntil` on `GET /v1/trades/:code` is sent to a member when `hasAbility(abilities, 'disputes-appeal')`
(`apps/api/src/trades/routes.ts` ~114). This matches the appeal route's guard, so the answer to "only
people who can appeal" is yes. But `FileAppeal` links to `/trade/:code/dispute`, and the dispute page's
`GET /v1/trades/:code/dispute` needs `disputes-answer`. The two are separate grantable boxes
(`team/abilities.ts` rows 37 and 38). A member with only the appeal box sees "File appeal", opens the
dispute page and gets 403: they can never reach the form. Options:
- (a) send `appealUntil` only when the member holds both boxes;
- (b) let `disputes-appeal` read the dispute view;
- (c) put the appeal form behind the button directly.

Recommendation: (a) for now, since it changes nobody's access. This needs an owner or lead call because it
changes what a member can do. Related, and already on main (not introduced here):
`POST /v1/trades/:code/appeal` returns the full `DisputeView` (ruling reason, evidence, moderator name,
payout address end) to an appeal-only member who cannot read that view through GET. Worth a line in the
owner questions.

### Minors
- m1 (D-011 coverage): the owner alert is raised only at filing. If the last eligible reviewer is removed or
  switched off after filing, or an eligible assignee is switched off while holding the case, the appeal
  stalls with no alert. While it is assigned, `appealWaiting` stays false (`assignee !== null`). The
  `noReviewer` queue flag and `appealWaiting` are computed live, so the traders and the queue are right
  when nobody holds the case, but the owner gets no push. This may be what the re-alert commit is for;
  check it there.
- m2 (race at filing): `eligibleReviewers` reads `staff_members` inside the appeal transaction without a
  lock. A concurrent switch-off or removal can commit just after the read. The appeal then waits with no
  owner alert (it falls under m1). A concurrent switch-on gives a needless alert, which is harmless.
  Low impact; fixing m1 with a timer-based re-check covers it.
- m3 (UX): `appealUntil` does not consider the account hold. A held account's own session sees "File
  appeal" but the POST is refused (`refuseHeldTradeEvent`). This fails closed, so it is cosmetic.
- m4 (UX): live-event views carry no `appealUntil` (the documented default is null). The web gives
  `MemberRoom` and `ReadyRoom` the merged view, so the button may vanish until the next re-read. It fails
  closed. I did not check the web merge in depth.
- m5: `noReviewer` on queue rows is shown to plain moderators too (`disputes.handle`). It is a single
  boolean, so it is acceptable.

## Checked and fine
- **appealUntil exposure.** It is only on `GET /v1/trades/:code` (TRADE_READ, participants only: others
  get 404). Both parties may appeal (spec 2.3), so the other party seeing it is correct. It is null once
  either side has appealed (`not exists dispute_appeals`), null for round 2, null for a non-latest `seq`, and
  null at or after the deadline. The deadline is not secret: the dispute view already carries
  `ruling.appealUntil` for `disputes-answer` holders.
- **48 h edge.** The SQL uses `appeal_ends_at > now`, and the machine refuses at `now >= appealEndsAt`
  (`too-late`). These agree, and the test covers 47 h 59 min and 48 h. The window-closed timer
  (`appeal_ends_at <= now`) and the appeal both take the dispute row lock (`withDispute`), so they run one
  after the other. The `on conflict do nothing` with `rowCount !== 1` stops a second appeal. The web button
  compares against the server clock and re-renders at the deadline. A click at the edge gets 409 `too-late`,
  which is handled.
- **R37 eligibility.** `involved` = staff log entries on the trade before `appeal.opened` ∪ `seen`, frozen
  in `round1.involved`. Every id is an account id (log `actor_id` = `req.staff.accountId`; candidates use
  `staff_members.account_id`), so the sets match. `appealReviewers` drops `involved`, non-seniors and
  inactive staff, with no fallback. The `take`/`assign` and act checks in the machine are unchanged.
- **Alert and push contents.** The alert detail is `{ trade: code }`, the same as the existing
  `dispute-refund-after-ruling`, and goes to owner accounts only. The push is the fixed `alert` kind
  ("Something needs your attention"), with no detail. It is sent after commit, and a failure is swallowed.
  It fires once per dispute, because there is one appeal.
- **Matrix.** The new route is in `STAFF_ROUTE_ROWS` (owner and senior allowed, mod 403).
- **Tests not weakened.** The diff only adds test lines (no `-` lines in apps/api/test or apps/web/test).
  The COPY-UNSIGNED markers are present on the new strings.
- **Semgrep** (`--config auto`, all 15 changed files): 0 results, 0 errors.
- **Typecheck** (`tsc -p apps/api` and `tsc -p apps/web`, `--noEmit`): clean.

## Tests run (serialised runner, my worktree at 384a8803)
All passed (logs in the scratchpad's logs/rv-appeals-*):
- api disputes/appeals.test.ts: 9/9
- api disputes/trader.test.ts: 18/18
- api disputes/staff.test.ts: 27 passed, 1 todo (the todo is already on main)
- api staff/matrix.test.ts: 102/102
- api view.test.ts: 9/9
- web appeals.test.tsx: 8/8
- web dispute.test.tsx: 47/47

Docker was up the whole time. Gap: no test covers an involved senior calling the reviewer list (M1), a
member who has the appeal box without the answer box (S1), or a reviewer removed after filing (m1).

## Must-fix list
1. M1: decide who may read `appeal-reviewers`. Recommended: owner-only. Otherwise refuse callers in
   `round1.involved` and show seniors no names. Add a test for an involved senior calling it.

## Owner or lead questions
- M1 as above.
- S1: a member with File an appeal but not Answer the moderator. Recommended: (a), send the deadline only
  with both boxes. Also the existing over-disclosure of the appeal POST's response to such a member.
- m1: should the owner be alerted again when an appeal becomes unreviewable after filing? (Possibly the
  re-alert commit in progress, which needs its own review.)
