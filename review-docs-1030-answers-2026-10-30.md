# Review: docs branch for the 2026-10-30 lead decisions and owner questions q11–q15 (DD)

Reviewer: claude3 (main session, read-only), 2026-10-30.
Target: `wip/second-docs-1030-answers` @25c3889 (4 commits on main 5c4d35b: 6ca30ea spec, 505c537 Plans 2–3, e4a5db2 Plans 4–7, 25c3889 coordination). Docs only.
Checked against: `~/x2f-comms/LEAD-HANDOFF.md` section 8 ("Lead decisions taken without the owner", the 10-30 items) and q11–q15 in `~/x2f-comms/owner-questions-open-2026-10-29.md:14-28` (q14 as revised 06:45). Code anchors checked on main: `packages/reputation/src/badges.ts:34,74,108` (`MIN_REVIEWS_TRUSTED`, `ratedReviews`) and `apps/api/src/trades/cancelReturn.ts:32,57` (24 h cutoff).

## Verdict: CHANGES REQUIRED (0 Critical, 1 Important, 4 Minor)

The branch is careful and almost complete:
- All 11 lead decisions of 10-30 are placed, and each is labelled as taken without the owner.
- q11, q12, q13 and q15 are each marked PROVISIONAL with the lead default, in the spec and in every plan they touch.
- The stale 90-day and OPEN refund-window lines in Plans 3, 4, 5 and 7 are correctly struck through and settled.

One block is wrong: q14 was copied from the version before 06:45. It reintroduces exactly the two promises the Task 42 design review removed, and it misses q14 j.

## Important

**I1. q14 is the old text (before 06:45) in three places. It promises a release switch and an owner-held copy that the design no longer has, and it drops q14 j.**
Where: `docs/superpowers/specs/2026-10-14-x2f-design.md:30-40` (Revision 2026-10-30), `docs/superpowers/plans/2026-10-15-plan-3-trading.md:1349-1359` (Task 42 note), `docs/coordination.md:352` ("lead defaults a–i").
- **(b)** says "A member may **release** coins as seller by default (the owner can switch it off)" (spec `:32`, Plan 3 `:1351`). The current q14 b (`owner-questions-open-2026-10-29.md:19`) says that X2F can enforce "buy only" or "sell only" but **not** "sell but never release". The design (827c03c, 2.1.7) dropped the release toggle because it cannot be enforced (round-1 review I4). claude2's report calls "the owner can switch it off" a wording choice, but it is the overpromise that review removed.
- **(f)** says "The owner's **phone** keeps an encrypted copy" (spec `:36`, Plan 3 `:1355`). The current q14 f says **X2F's server** keeps it, and only the owner's devices can open it (design 2.1.6; spec 8 and 4.1 edits pending).
- **(j) is missing:** the account signing key, its 72 h hold and veto, the 6-digit code for a new owner device, and being unable to trade for up to 72 h after losing every device. "Until (a)–(f) are answered" (spec `:40`, Plan 3 `:1359`) must read "(a)–(f) and (j)". coordination `:352` must say "a–j".
- The intro (spec `:30`, Plan 3 `:1349`) should follow the 06:45 wording. That wording names the account key that binds every trade in the account's name, not only a per-member delegation.

*Failure scenario:* a builder of Plan 2 Task 18 or Plan 3 Task 42 (or Claude Design) reads the spec's Revision 2026-10-30. They build a "release" switch as a security control, and copy that says the backup is on the owner's phone. Both are false under the design the owner is being asked to approve.

*Fix:* re-copy q14 a–j from `owner-questions-open-2026-10-29.md:17-27` into all three places. Keep the PROVISIONAL label. Note that the 06:45 text is based on design @827c03c, which is itself under round-2 review (`~/x2f-comms/review-task42-design-round2-2026-10-30.md`), so the q14 wording may move again.

## Minor

- **M1. Spec 2.3 still carries the three stale OPEN sentences** above the new "Window: 48 hours" bullet (`spec:349`). These are: "*Open after 2026-10-29:* the window … (90 days in Plan 3) … must shrink", "*OPEN conflict 2026-10-29b:* … 30 days", and "*OPEN 2026-10-29c (lead asking the owner):* whether … within 48 hours". The bullet at `:350` settles them, but they still read as open. Strike them through, as the branch does everywhere else.
- **M2. The q14 intro overpromises** (spec `:30`, Plan 3 `:1349`, and the source q14 preamble): "a hacked X2F server can't trade as you" holds only once the account key is pinned. When re-copying (I1), add "once your key is set up". This is round-2 Task 42 review M-9, so the lead may change the source first.
- **M3. q14 h says "activity log"** (spec `:38`, Plan 3 `:1356`). The design calls it the **team audit log** (2.1.8, Q8). In spec 6.6 and Plan 4, "activity log" is the staff log (`spec:637`). Use "team audit log" so a builder doesn't write key events into the staff log.
- **M4. Spec 6.7** (`:689`) lists q14 as "the delegation design and its defaults a–i". Make it a–j (with I1).

## Checked and fine
- **Lead decisions (LEAD-HANDOFF s8, 10-30): all present and labelled.**
  - 48 h for every buyer-disputable refund (q11): spec `:57`, 2.3 `:350`; Plan 3 OD-8, Task 2 rule, Task 27, Task 39; Plan 4 T10; Plan 5 P5-A29; Plan 7 T1, T2 and owner list.
  - 24 h unconfirmed cancel refund goes to a moderator, anchored on `closed_at` (matches `cancelReturn.ts:57`), never on outage, maintenance or pause.
  - Weight only (spec 5.3; Plan 5 Task 3 note turns `usd_cents` into `weight bigint` and rewrites the test). This matches the C4 build.
  - Trusted ≥ 5 rated reviews (q12): matches `badges.ts:108` and `ratedReviews`.
  - No grandfathering; Task 10's three decisions; Task 9 R3-I1, with R3-M1 as a mainnet prerequisite; members can't take until Task 42; Tasks 16–17 hold rules; `X2F_TRADE_PURGE` default off; assignee role from the database.
- **q13 a–d:** matches the source, PROVISIONAL, in spec 6.7 and Plan 2 Task 18.
- **q15:** 14 days, PROVISIONAL, in spec 4.1, Plan 6 D6 and Plan 7 (Global Constraints, Task 4, owner list).
- **The lead call of 10-29 not recorded before** (News has no menu link yet): spec 29b list and Plan 4 Task 28.
- The authority line ("These are not the owner's words") and the meaning of PROVISIONAL are clear. The coordination section maps every item to where it went.
