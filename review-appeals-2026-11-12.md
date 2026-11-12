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

## Re-verify (38e71072, 12 Nov 2026)

Reviewed 384a8803..38e71072 (10 files, +201/-42) in a fresh detached worktree. I changed no code. Docker
was up the whole time.

**Verdict: the M1, S1 and m1 fixes are correct, and m2 is covered. Approve.** One test-only should-fix
(R1) and two minors remain, none blocking.

### What I checked
- **Migration 520.** It adds one nullable `no_reviewer_alerted_at timestamptz`. No reader shows it. The
  schema test adds 520 to the three lists and changes nothing else (confirmed with a word diff).
- **`syncNoReviewerAlert`.** It is once per transition, and it cannot race.
  - It runs only inside `withDispute`, where the dispute row is held `FOR UPDATE`. That is true both in
    the appeal route and in the timer.
  - Reading the mark, writing the alert and setting the mark therefore happen one dispute at a time. A
    timer pass and an appeal on the same dispute run one after the other.
  - The timer's callback returns `d` unchanged. `withDispute` then commits without `saveDispute`, so the
    mark and the alert do commit, and nothing else on the case changes.
  - The push goes out after commit, at most once per timer pass. Its text is the same fixed one with no
    detail, so it leaks nothing.
  - Flapping a reviewer on and off alerts once per transition. That is what was asked, and it is
    owner-driven, not spam.
  - The timer skips paused (maintenance) disputes.
  - The tests cover each case: one alert across repeated passes, re-alerting after the reviewer comes
    back and is lost again, no second alert for an appeal already alerted at filing, and an assignee
    switched off.
- **M1 (reviewer list).**
  - Now `staff.manage` (owner only); the matrix row is updated.
  - It refuses (403 `forbidden-case`) anyone in `round1.involved` or in `seen`, or who has any staff log
    entry on the trade. Log trade codes are stored normalised (`append.ts`), so the plain equality is
    sound.
  - It stays unlogged: the involvement check is a plain select. The test asserts the trade's log count is
    unchanged for both the refused and the allowed read.
  - Consequence: in the main D-011 case, where the owner was involved in round 1, the owner cannot read
    the list. They still see `noReviewer` in the queue, and they get the alert. Acceptable, since the list
    would be empty anyway.
- **S1.**
  - `appealUntil` now needs both `disputes-appeal` and `disputes-answer`.
  - An appeal-only member's POST still files the appeal, then answers `204` with an empty body (tested).
    The response is chosen after commit, so the appeal, the alert and the push are unaffected.
  - The answer is decided from the session's member abilities, the same source as the guard.
- **Behaviour change.** `appealWaiting` and the queue's `noReviewer` no longer stop at `assignee !== null`.
  An eligible assignee is in the candidate list, so a live assignee never counts as waiting. One who is
  switched off, removed or disabled does. This matches the D-011 intent, and R37 is still enforced by the
  machine.

### The two edited tests (not weakened, one gap)
1. "A team member sees it only with...": renamed. All of the earlier assertions are kept: the member with
   both boxes gets the deadline, the member without the appeal box gets null and a 403 on POST. It adds
   the appeal-only member: null deadline, 403 on the dispute GET, 204 and an empty body on POST. This is
   stronger than before.
2. "A fresh senior moderator added later...": the two owner reads of the reviewer list are removed. The
   owner is involved in that test, so the list now refuses them, and the refusal is asserted in the new
   owner-only test.
   - **R1 (should-fix, test only):** those two lines were the only assertions on the list's *contents*.
     The first showed an involved owner left out (`reviewers: []`, `waiting: true`). The second showed the
     fresh senior named (`[{ name }]`, `waiting: false`).
   - The replacement only checks `arrayContaining({ name: any String })`, so no test now shows that an
     involved senior is absent from the names, or that `waiting` is right on this route.
   - Suggest: in the uninvolved-owner case, involve one senior and assert the exact name list (that senior
     absent, a fresh one present) plus `waiting: false`.

### Minors
- n1: the timer clears the mark only on rows still `appealed`. Suppose an eligible reviewer proposes a
  round-2 ruling within 30 s of the alert (status leaves `appealed` with the mark still set). If a
  send-back later returns the case to `appealed` with nobody eligible again, no fresh alert is sent. This is
  very unlikely. The fix would be to clear the mark whenever the sync sees a non-waiting state, including
  `syncNoReviewerAlert` on the round-2 ruling path.
- n2: every 30 s the timer takes a short `FOR UPDATE` on every appealed dispute and runs one
  candidate-list query each. That is fine at current volume. If appeals pile up, run the candidate query
  once per pass.

### Tests run (serialised runner, at 38e71072)
All passed:
- disputes/appeals: 11/11
- disputes/trader: 18/18
- disputes/staff: 27 passed, 1 todo (already on main)
- staff/matrix: 102/102
- schema: 77/77

Logs are in the scratchpad's `logs/rv-appeals2-*`.
