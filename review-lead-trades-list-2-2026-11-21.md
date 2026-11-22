# Review: wip/lead-trades-list-2 d5b673c0 (My trades D-005 ported onto main 2da4f93d), 21 Nov 2026

Independent security and code review. No code edits on the branch. Throwaway worktree
`.claude/worktrees/rev-trades-list` at d5b673c0 (`npm ci`); probe test files were scratch only and
never committed. Reviewed `git diff origin/main...d5b673c0` (37 files, +1973/-80, 5 commits:
23fc8bc1 port, ca68d7be RED and 3556b1ff for Plan 3 Task 42 `lastActedBy`, 5a720dce RED and
d5b673c0 for the blur-check per-part check).

## Verdict

**CHANGES NEEDED: one blocking item (B1), and it is a small fix.**

- **B1:** main's newer `GET /v1/trades/:code/ruling-statement` never got the per-part check. A
  member with See trade history only reads an open trade's signed ruling statement, and a member
  with See active trades only reads a closed one's. This is the same kind of route as the
  blur-check routes the port did fix.

Everything else holds:
- Someone else's trade is 404 on every trade route. That is true for a member holding every box,
  and also for a member whose box doesn't match that trade's part, so there is no 403-vs-404
  oracle.
- A member with neither trades box gets 403 on own and stranger trades alike.
- `lastActedBy` is owner-only, reads only this account's team log, and never shows the other
  side's team.
- The live stream filters by part and ends when the boxes change.
- Every approved fix (B1, M1, m1, m2, I1, B2, m3) is still present and still tested.

There are also four minors and one open question (the builder's): see below.

## Tests run

| Run | Result |
|---|---|
| api vitest: tradesList, team, blurCheck, frontDoor, take, events, teamAbilities, disputes (8 files, `nice -n 10`, no lock) | **296 passed**, 0 failed |
| api vitest: chat, disputes/staff, disputes/trader, disputes/rulings, disputes/appeals, identity (6 files) | **173 passed**, 0 failed |
| web vitest: tradesList, ui, wideShell, moderator-badge-scope, frontDoor (5 files) | **196 passed**, 0 failed |
| auth-client vitest: flows.test (NOT_AUTH_CLIENT row) | **15 passed**, 0 failed |
| `tsc --noEmit` apps/api, apps/web | exit 0, exit 0 |
| Playwright trades.spec, shell.spec, team.spec (under the lock, `--trace off`, production build) | **55 passed**, 0 failed |
| Reviewer probes (scratch, not committed) | see the findings |

**Not run: the full `npm run check`.** The reviewer rule asks for it before an APPROVED verdict.
This verdict is CHANGES NEEDED, so it should run on the fixed head.

## Findings

### B1 (blocking; per-part reads): `GET /v1/trades/:code/ruling-statement` has no part check

- **Where:** `apps/api/src/trades/identity.ts:106-114`. The guard is `requireTradesRead`
  (`member: TRADE_READ`, either box). `roleInTrade` already returns `closedAt` on this branch, but
  the route throws it away and never calls `assertMemberMay(req.auth, tradePartAbility(closedAt))`.
  The attestation route right below it (`:116-121`) does make that call.
- **Origin:** the route came to main in abb3dfb1 (Haveno review finding 2), after the approved
  head's base 6ebed537. So the port missed it, just as it would have missed the blur-check routes.
- **Probe:** I seeded a statement on an open trade.

  | Member | Trade | Answer |
  |---|---|---|
  | See trade history only | open | **200**, the statement body |
  | See active trades only | same trade after `closed_at` was set | **200**, the statement body |

  Both should be 403. Strangers still get 404.
- **What leaks:** a part the member's boxes don't allow: the moderator's signed ruling (who gets
  paid) on a trade they may not see.
- **Fix:** add `assertMemberMay(req.auth, tradePartAbility(closedAt))` after `roleInTrade` (so a
  stranger stays 404), and add a test of both directions plus a stranger case to team.test.ts next
  to "the attestation: open with See active trades…". Red first, as for 5a720dce.

### m1 (minor; lead's call): a recovery or held owner session gets `lastActedBy`, but the team log refuses it

- **Where:** `apps/api/src/trades/list.ts:180` gates the field on `req.auth.memberId === null`
  only. The route guard (`list.ts:150`) is `FINISH_OPEN_TRADES`, which has `allowRecovery: true`
  and `allowHeld: true`.
- **The other team reads:** `GET /v1/team` and `GET /v1/team/audit` use
  `requireSession({ kinds: ['trader'] })` (`apps/api/src/routes/team.ts:243`), which refuses those
  sessions.
- **Probe:** with an owner recovery session, `GET /v1/trades?status=open` → 200 with
  `lastActedBy: { memberName: 'ProbeActor', at: … }`. `GET /v1/team/audit` → 403
  `recovery-session`, and `GET /v1/team` → 403.
- **Impact:** low. It is the owner's own team, and only names and times on open trades. But a
  session that may not read the team log can read part of it here.
- **Recommendation:** send the field only to sessions that may read `GET /v1/team/audit` (a full
  session that is not held), and pin it with a test. Whether recovery sessions should see it is a
  lead or owner call, so I'm listing it as a question rather than a defect.

### m2 (minor; test gap): no test pins "404 before 403" when a member's box doesn't match the stranger trade's part

- **Guard-revert G06:** I moved the room's `assertMemberMay(…tradePartAbility…)` above the
  `roleOf … 404` check in `apps/api/src/trades/routes.ts:130-133`. tradesList.test.ts stayed
  **green (8/8)**. With that order, a See-active-only member would get 403 for a stranger's closed
  trade and 404 for an unknown code: an existence oracle.
- **Why nothing caught it:** the stranger cases use a member with **both** boxes
  (`tradesList.test.ts:257-258`) or a stranger's open trade for an active-only member
  (`blurCheck.test.ts` new case). Either way the part check passes first, so the order is never
  tested.
- **The code is right today:** probe 2 (an active-only member on a stranger's closed trade, a
  history-only member on a stranger's open trade) got 404 on all ten trade routes: the room,
  attestation, confirmations, ruling-statement, dispute, blur-checks, blur answer, announce, events
  and appeal.
- **Fix:** add the two mismatched-box stranger cases for the room, and ideally for each per-part
  route.

### m3 (minor; test gap): three of the per-part publish sites are unpinned

- **Guard-reverts G19, G20 and G21 stayed green.** Each one dropped the part from a publish:
  - G19: the trade chat line, `apps/api/src/chat/routes.ts:473`;
  - G20: the dispute store, `apps/api/src/disputes/store.ts:302`;
  - G21: the staff dispute publisher, `apps/api/src/disputes/staffRoutes.ts:204`.

  I ran team, chat, disputes, disputes/staff, disputes/trader, rulings and appeals against them.
- **Impact if one regresses:** a publish with no part counts as the open part. A closed trade's
  event would then go to active-only members and skip history-only ones. It's low today, because
  disputed trades are mostly open, but nothing would notice.
- **Fix:** add one bus-spy assertion each, as "the trade event publisher says which part each event
  is" does for tradePublisher.

### m4 (minor; pre-existing pattern, now wider): the stream's re-check after attach doesn't re-read the boxes

- **Where:** `apps/api/src/events/routes.ts:70-97`. The stream takes `req.auth.memberAbilities` as
  `requireTrader` read them. The TOCTOU re-check after attach looks only at `sessions`
  (revoked and expiry).
- **The race:** a boxes change that commits between `requireTrader` and `bus.attach` closes
  nothing (`updateAbilities` → closeSession finds no stream yet). So the new stream carries the old
  parts until it reconnects or reaches `maxStreamMs`.
- **This was already on main:** the same window existed there for losing See active trades
  entirely (review M2). The branch widens it to "any trades box change".
- **Status:** narrow, found by reading the code only (I wrote no probe for it).
- **Fix:** re-read `team_members.abilities` in that re-check and end the stream if its parts
  differ.

### n1 (nit): the chat key's publish has no part

`apps/api/src/chat/routes.ts:505` (`POST /v1/chats/:chat/key`) publishes `{ type: 'chat' }` with
no part, so it counts as open. A key is made when a chat starts, so this is almost always correct.
For consistency, pass `{ closed: … }` the way line 472-474 does.

## The builder's open question: should `POST /v1/trades/:code/proofs/:proofId/blur-check` also need the part box?

**Recommendation: yes.** Add `assertMemberMay(req.auth, tradePartAbility(closedAt))` right after
`sideOf` (`apps/api/src/proof/blurCheck.ts:118`), before `isStoredProof`. That order keeps a
stranger at 404 and doesn't answer "is this a stored proof" to a member who can't see the part.

Why:
- **Start set members are affected, not only custom sets.** chat-reply is grantable and is in
  every preset, and the Start set (the boxes every new member gets) is `trades-see-history` plus
  `chat-reply`, with no See active trades. Probe: a history-plus-chat-reply member announced a
  proof on an **open** trade → 200 `{"ask":true}`. A chat-reply-only member did the same → 200.
- **It is an action on a trade.** It writes `blur_check_proofs` and `blur_check_asks` rows that
  both sides then see, and it moves the global counter. The 2026-11-09 m1 rule ("no acting on a
  trade one cannot see"), which m3 applied to events and appeal, covers it.
- **Practical impact is low.** The member needs a proof id their side stored, and every proof and
  chat route is owner-only (C-019, `waits-member-chat-key`). The value is consistency, and closing
  this before those boxes go live.
- **Separate lead call:** chat-reply and the proof boxes are `waits-member-chat-key` ("chat and
  proof stay hidden from members … every chat route stays owner-only"), yet this route, from main's
  PC1, takes chat-reply now. Making the announce owner-only until C-019 would also be consistent.
  That changes what members can do, so it is the lead's call. The part check above is the minimum
  either way.

## Guard reverts (each revert applied alone, the named suite run, then the file restored)

| # | Guard removed | Suite | Result |
|---|---|---|---|
| G01 | list `partsFor`: a member gets both parts | api tradesList | **red** (1 failed: the per-part member test) |
| G02 | `lastActedBy` also sent to member sessions | api tradesList | **red** (Task 42 test) |
| G03 | `team_audit` not filtered to this account | api tradesList | **red** (Task 42 test: the other side's member shows) |
| G04 | the lead's own rows (member null) counted | api tradesList | **red** (Task 42 test) |
| G05 | room `GET /v1/trades/:code` part check removed | api tradesList | **red** (review I1 room test) |
| G06 | room part check moved **before** the participant 404 | api tradesList | **green, survived** (m2) |
| G07 | `POST …/events` m3 part check removed | api team | **red** |
| G08 | confirmations part check removed | api team | **red** |
| G09 | attestation part check removed | api team | **red** |
| G10 | `GET …/dispute` part check removed | api team | **red** |
| G11 | `POST …/appeal` m3 part check removed | api team | **red** |
| G12 | `GET …/blur-checks` part check removed | api blurCheck | **red** |
| G13 | `POST …/blur-checks/:proofId` part check removed | api blurCheck | **red** |
| G14 | bus member-sink part filter removed | api team | **red** (2 failed) |
| G15 | a trades-box change no longer ends streams | api team | **red** |
| G16 | trade publisher drops `closed` | api team | **red** |
| G17 | cursor `realInstant` removed (approved M1) | api tradesList | **red** |
| G18 | `OWN_DATA_READS` row for `GET /v1/trades` removed (approved B1) | api frontDoor | **red** |
| G19 | chat line publish drops its part | api team + chat | **green, survived** (m3) |
| G20 | dispute store publish drops its part | api team, disputes, rulings, appeals | **green, survived** (m3) |
| G21 | staff dispute publisher drops its part | api team, disputes/staff, disputes/trader | **green, survived** (m3) |
| W1 | `mayReadTrades` true for any member (approved m1) | web ui + wideShell | **red** (2 failed) |
| W2 | trade-code format check in the parser removed (approved m2) | web tradesList | **red** |
| W3 | disputed chip tone changed off `caution` (approved B2) | web tradesList | **red** (2 failed) |
| W4 | `mayOpenLiveEvents` back to the Trades role only | web ui | **red** |
| W5 | owner's last-acted line not rendered | web tradesList | **red** |

**22 of 26 guard reverts go red** (corrected 22 Nov: the first version said 21). The 4 survivors are the test gaps in m2 and m3. Approved m3
(per-part writes) is G07 and G11; approved I1 is G05 and G08 to G10. The ruling-statement route
(B1) has no guard to revert.

## The checks requested

1. **Every trade route against the table:** the owner sees everything (tested). A member with See
   active trades only sees open trades only, and See trade history only sees closed trades only:
   the list, room, attestation, confirmations, dispute, events, appeal and both blur-check routes
   are tested. **The exception is ruling-statement (B1).** Neither box: 403 everywhere, the same
   for a stranger's trade (probe). Someone else's trade: 404 everywhere, including mismatched boxes
   (probe; untested, m2).
2. **`lastActedBy`:**
   - Owner sessions only, never members': pinned by G02.
   - Only this account's own log: pinned by G03, plus the `m.account_id = l.account_id` join.
   - The other side's team names: never present, pinned by G03.
   - No oracle: the extra query runs only for owner sessions, over codes already filtered to the
     caller's own trades, and takes no caller input beyond the page.
   - One caveat: recovery and held sessions get the field (m1).
3. **Live stream:** a member's sink carries only the parts their boxes allow (G14), and a change to
   either trades box ends the stream (G15). The narrow attach race is m4.
4. **Builder's question:** yes, add the part check (see above).
5. **Approved fixes:** B1 (G18), M1 (G17), m1 (W1), m2 (W2), I1 (G05, G08-G10), B2 (W3) and m3
   (G07, G11) are all present and red when reverted.

## Adaptation to main

- **NOT_AUTH_CLIENT:** the `GET /v1/trades` row and its reason were added in flows.test.ts, which
  passes 15/15.
- **Nav:** My trades sits after Trade in BottomNav and DesktopRail, gated by `mayReadTrades`. The
  ui, wideShell and e2e shell lists gained the entry; nothing was loosened.
- **Help:** helpLibrary only moves one source line (`App.tsx:280` → `:287`). The tour's pending
  stops now say what they wait for.
- **take.test.ts:** a one-line change, for the publish's new third argument.
- **No test was weakened.** The `isTrader` comment in App.tsx has a stray blank line above it
  (cosmetic).

## To land

1. **B1:** the part check on `GET /v1/trades/:code/ruling-statement`, with a red-first test.
2. **Recommended:** the part check on the blur-check announce (open question), and the tests in m2
   and m3.
3. **Lead's call:** m1 (whether recovery and held sessions see `lastActedBy`); whether the announce
   should be owner-only until C-019.
4. **Optional:** m4 (re-read the boxes in the stream's attach re-check) and n1.
5. Then a full `npm run check` under the lock on the fixed head.

---

## Addendum (22 Nov 2026): re-review of 6a4d0fed (`git diff d5b673c0 6a4d0fed`)

**Commits on the branch** (the lead's message named 5e6e1e09, d2fad13a and 2d68edfb for the first
three; the branch has these):

| Commit | What it does |
|---|---|
| 199ca353 (RED) | Tests for B1, m1, m4, n1 and the announce; pins for m2, G19, G20 and G21 |
| 0e7c888b | The fixes for the above |
| 527660e1 (RED) | Chat envelopes page by id as a number; the PC1 announce test follows the lead's part call |
| b5856b3a | The fix for the trader route's paging |
| a582cbcd (RED) | The staff chat read returns envelopes in numeric id order |
| 6a4d0fed | The fix for the staff read's ordering |

13 files changed, +272/-16. Only the API changed.

### Verdict: APPROVE WITH MINORS

Every finding is fixed at its cause. Each new test was red before its fix: I reverted each fix and
its test went red. The four guard reverts that survived last time are now red. No test was weakened.

The minors are info only and need no change on this branch. **The full `npm run check` was not run
(the lock queue is deep);** per the reviewer rule it must be green before this lands.

### Item by item

**B1: fixed.** `GET /v1/trades/:code/ruling-statement` now calls
`assertMemberMay(req.auth, tradePartAbility(closedAt))` after `roleInTrade`
(`apps/api/src/trades/identity.ts:109-111`), so a stranger stays 404. Tested in team.test.ts in
both directions plus the stranger case. Revert R1 turns it red.

**m1: fixed (lead's call).** `lastActedBy` goes only to `memberId === null && level === 'full'`
(`apps/api/src/trades/list.ts:183`).
- That excludes held sessions as well: a hold exists only on a recovery-level session
  (`apps/api/src/auth/sessions.ts:463`).
- So the field now has exactly the session set of `GET /v1/team/audit`.
- The test covers a recovery session and a held one, checks that the member's name appears nowhere
  in the body, and still pins the full owner case. Revert R2 turns it red.

**m2: pinned.** The new team.test.ts case sends a See-active-only member to a stranger's completed
trade, and a See-history-only member to a stranger's open one. Each holds the action boxes too, so
only the part check differs. All ten routes answer 404. G06 (moving the room's part check above the
participant 404) is now **red**.

**m3: pinned.**
- G19 (the trade chat line) is **red** in chat.test.ts. The test also pins that an offer chat's
  line has no part.
- G20 (the dispute store, via the appeal) is **red** in team.test.ts.
- G21 (the staff publisher: moderator-joined, the trade, the chat line) is **red** in
  disputes/staff.test.ts.

**m4: fixed.** After attach, the re-check now also re-reads the member's boxes and ends the stream
with 401 if the parts differ from those `requireTrader` read (`apps/api/src/events/routes.ts:98-105`).
- The read is `team_members where id = $1 and removed_at is null`, so a member removed in that
  window is also refused. The comparison uses the same `hasAbility` parts key as `updateAbilities`.
- The web client is not signed out by this 401. It uses EventSource, which never sees the status:
  the source closes and the client reconnects after about 1 s (`apps/web/src/api/events.ts:83-88`).
  The existing attach-window 401s take the same path.
- Tested in events.test.ts: gaining a box, swapping parts and losing both all end the stream; a
  change outside the trades boxes keeps it. Revert R3 turns it red.

**n1: fixed.** The chat key's publish carries the linked trade's part
(`apps/api/src/chat/routes.ts:505-507`), computed as the chat line's is. Tested open and completed
in chatKeyRecord.test.ts. Revert R4 turns it red.

**The announce (lead's call): fixed, in the place recommended.**
- `assertMemberMay(req.auth, tradePartAbility(closedAt))` sits after `sideOf` (under the trade row
  lock) and before `isStoredProof` (`apps/api/src/proof/blurCheck.ts:118-122`).
- The new test: a Start-set member (history plus chat-reply) is refused on an open trade, and no
  `blur_check_proofs` row is written. An active-plus-chat-reply member announces on an open trade
  but is refused once it closes. The history member then announces on the closed trade. A stranger
  gets 404 with an unstored id.
- Revert R5 turns two tests red.

**The existing test that changed.** Only one assertion changed, in PC1
("announcing a proof needs chat-reply…", `apps/api/test/blurCheck.test.ts:246-255`). The
chat-reply-only `poster` now expects **403** (it was 200), which is the lead's call. A new
`announcer` with chat-reply and See active trades takes over the 200 case. Nothing was loosened: a
refusal assertion was added. The other test edits fix those tests' own reference queries (chat.test
and disputes/staff.test), which had the same text ordering. Each now orders by
`chat_envelopes.id`. That is correct, and it is why R7 also turns the N11 (f) test red.

**Paging fix 1 (trader `GET /v1/chats/:chat/envelopes`): correct.**
- The query selected `id::text as id … order by id`. In Postgres, ORDER BY resolves a bare name to
  the output column first, so the page was sorted as text: "10000" before "9999". WHERE resolves to
  the input column, so `id > $2` was already numeric.
- Now both say `chat_envelopes.id` (`apps/api/src/chat/routes.ts:538`).
- The test moves the shared sequence forward only (never back) so this chat's ids cross from 4 to
  5 digits. It then checks the full page and an `after=` page against the numeric order. Revert R6
  turns it red.

**Paging fix 2 (staff chat read, review N11 (f)): correct.**
- Same cause, in `order by id desc limit` (`apps/api/src/disputes/staffRoutes.ts:563`). The newest
  `CHAT_READ_MAX` window was chosen by text, so near a digit boundary the staff read could show the
  wrong envelopes and set `olderNotShown` wrongly.
- Tested across the boundary. Revert R7 turns two tests red.

### Info (no change asked on this branch)

- **i1: the same pattern in the moderation app.** `apps/moderation/src/gate/registry.ts:611` has
  `select id::text as id … from activity_log … order by id`, so it sorts as text.
  - It is harmless today. `involvedIn` (`packages/staff/src/appealReviewers.ts:28-38`) compares ids
    as numbers (`logId`) and returns a set, so order doesn't matter there. The `reverse().find`
    for `appeal.opened` matters only with two appeals on one trade.
  - Worth the same one-word fix (`activity_log.id`) as cleanup, on main.
  - A repo-wide search for `X::text as X … order by X` found only these three sites.
- **i2: the shas in the lead's message don't match the branch.** See the commit table above.
  a582cbcd and 6a4d0fed match.

### Guard reverts at 6a4d0fed (each applied alone in a separate worktree, then restored)

| # | Guard removed | Suite | Result |
|---|---|---|---|
| G06 | room part check moved before the participant 404 | api team + tradesList | **red** (the m2 test) |
| G19 | chat line publish drops its part | api chat | **red** |
| G20 | dispute store publish drops its part | api team | **red** |
| G21 | staff dispute publisher drops its part | api disputes/staff | **red** |
| R1 | B1: ruling-statement part check | api team | **red** |
| R2 | m1: `level === 'full'` | api tradesList | **red** |
| R3 | m4: boxes re-read after attach | api events | **red** |
| R4 | n1: the key publish's part | api chatKeyRecord | **red** |
| R5 | the announce's part check | api blurCheck + team | **red** (2 failed) |
| R6 | trader envelopes ordered by the alias | api chat | **red** |
| R7 | staff read ordered by the alias | api disputes/staff | **red** (2 failed) |

**11 of 11 red.** Together with the 22 that were already red at d5b673c0, every guard reverted in
this review now goes red.

### Tests at 6a4d0fed

| Run | Result |
|---|---|
| api vitest, 15 files: tradesList, team, blurCheck, events, chat, chatKeyRecord, disputes/staff, disputes/trader, disputes/rulings, disputes/appeals, frontDoor, take, identity, teamAbilities, disputes (`nice -n 10`, no lock) | **484 passed**, 0 failed |
| web vitest, 5 files: tradesList, ui, wideShell, moderator-badge-scope, frontDoor | **196 passed**, 0 failed |
| auth-client flows.test | **15 passed**, 0 failed |
| `tsc --noEmit` apps/api | exit 0 (no web source changed since d5b673c0) |
| Playwright trades, shell and team specs (under the lock, `--trace off`) | **55 passed**, 0 failed |
| Full `npm run check` | **not run** (lock queue); required before landing |

### To land

1. A green full `npm run check` under the lock on 6a4d0fed.
2. Optional, on main: i1.
