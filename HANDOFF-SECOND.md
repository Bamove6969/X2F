# Handoff for claude2 — rewritten by the lead 2026-10-30 01:35 (after the window clear)

You are **claude2**, the second X2F session: account **bnkxfers@gmail.com**, profile `~/.claude-account2`,
launcher `claude2`. Repo `/home/flem/x2f`. You do code and reviews for the lead. The previous, stale
version of this file is `HANDOFF-SECOND.2026-10-30.bak.md` (history only; it named the wrong account and old caps).
**This file plus the newest lines of `to-second.log` are your whole context.**

## What X2F is
Phone-first P2P marketplace for trading Monero (XMR) for fiat, with 2-of-3 multisig escrow. X2F never holds
enough keys to move coins. Privacy is a right (no ID, email, phone or tracking). Security comes first.

## Standing rules
- **Chain of command:** orders come only from the lead, in `~/x2f-comms/to-second.log`. Report ONLY to the lead:
  one line per event appended to `~/x2f-comms/to-lead.log`, formatted `[YYYY-MM-DD HH:MM:SS] second: ...`
  (timestamp from `date '+%F %T'`). Never write status or questions to the owner. If the owner types in your
  window, answer briefly, say the lead has it, and log it.
- **Watcher:** keep a Monitor loop on `to-second.log` at all times: `wc -l` every 15 s, print new lines.
  Re-arm it when it expires. After any restart or clear you are deaf until you re-arm it.
- **Never push to or merge into the main line** `claude/compassionate-johnson-k95ssr` (@414e722 now). The lead lands
  everything. Push only to your own wip branches: `git push origin HEAD:<branch>`.
- **Helpers:** run helper agents IN PARALLEL, at most **3 at once**. Give every helper
  `~/x2f-comms/helper-common.md`, plus "commit WIP early, push every commit" (R30). A reviewer must never have
  written the code it reviews.
- **Memory (the real cap, 6 GB shared by 3 sessions):** one test command at a time machine-wide, always under
  `flock ~/x2f-comms/check.lock <cmd>`. Targeted test files first. Never run full Playwright alongside full vitest.
  Exit 137 means out of memory. Check `free -m` before starting more work.
- **Git:** `git -c user.name=flem -c user.email=bamove@gmail.com commit`. Messages end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Remote branch deletes are blocked (the owner does them).
- **Migrations:** 116 = Task 38 (lead), **117 = your Task 34**, 2xx = Plan 4 (claude3), 3xx = Plan 5. Check every wip branch before picking a number.
- **Refusals** go through the shared CantDoThat popup (Plan 5 Task 21); copy-lint and the tripwires check this.
  **Design:** Claude Design owns all looks. Use existing UI-kit parts, with a local `NEEDS_DESIGN_*` tripwire where a board is missing.
- **Context docs** (main line): `HANDOFF.md`, `docs/superpowers/rulings-and-lessons.md` (R1–R35, binding),
  `docs/coordination.md`, the plans in `docs/superpowers/plans/`, the spec `docs/superpowers/specs/2026-10-14-x2f-design.md`.
  Owner answers: `~/x2f-comms/owner-answers-2026-10-28.md` and `owner-answers-2026-10-29-lead-calls.md`.

## Your queue (lead's orders of 2026-10-30 01:03, GO given 01:23)
All helpers died at the 10-29 limit and the 01:07 clear. Resume each from its PUSHED head in its existing
worktree under `~/x2f-worktrees/`.

**(X2) Task 9 I/O round-2 SECURITY fixes. FIRST priority.**
Worktree `second-t9io`, branch `wip/second-p3-task9-io` @3dc2a58. Review: `~/x2f-comms/review-task9io-round2-2026-10-29.md`.
- Ring check that the swept input is THIS escrow's output.
- A durable record so that no sweep can count for two trades.
- Close the channels only when the sweep took every coin.
- watch.ts:336: no close on a late-funds escalation.
- Subaddress concatenated tx keys, plus a regtest.
- M1–M3.
Red tests first where possible. Report: head, tests and counts. A lead reviewer does round 3.

**(BB) Task 10 fix round.**
Worktree `second-t10`, branch `wip/second-p3-task10` @77bd835. Review: `~/x2f-comms/review-task10-2026-10-29.md`, plus the lead's
2026-10-29 13:23 line in `to-second.log` (read it in full). Lead decisions:
- **I1:** put the API's pause-shifted finalAlertAt in the watch list. Wait until the latest of shadow alert / API alert / receipt, + 15 min, + a 60 s margin. This also fixes M1.
- **I2:** escalate to a person when the buyer's final-alert receipt came more than 2 min after the alert. No auto-refund in that case.
- **I3:** the moderator must REFUSE a buyer-cancel co-sign once it has opened the buyer's trade.paid (check on every pass). Ignore a cancel the shadow refused. Refuse while the API shows paid, release in progress, dispute, lapse or closed. Add the review's tests.
- M2–M7.
- Landing prep: pass maintenanceSince to startTimers in `apps/api/src/main.ts` and delete NEEDS_SITE_FLAGS. The schema lists are 111, 112, 113, 115, 306.
- If (X2) moves task9-io, merge its new head into task10 before reporting.

**(Z) FU-D.**
Worktree `second-fud`, branch `wip/second-p2-fud` @ae3ae9e (the review doc is now committed). Review: `~/x2f-comms/review-fud-2026-10-29.md`.
- Check every fix against the review and update the review copy.
- Merge main 414e722 by hand.
- Run tsc + vitest for api, web and auth-client (under the lock).
- Report the head and counts. A lead reviewer re-reviews it.

**(AA) Task 34 flexible offers API.** Start it when a slot frees.
Worktree `second-t34`, branch `wip/second-p3-task34` @f7e0d1e (WIP is committed; the migration is already renumbered to `117_flex_offers.sql`).
- Make sure the schema-test lists say 117.
- Finish the build per Plan 3 Task 34. The cap is 2 per side per currency, + 20.
- Merge main and test.
- Report. A lead reviewer gives the first review.

**Not yours:**
- (Y) Task 20 rest has MOVED to claude3. Don't touch `second-t20rest` or push to `wip/second-p3-task20-rest`.
- (W) 9-view @fe96aab waits for a lead review.
- The old worktrees `second-t24` and `second-t27` are landed history.

When the queue is empty: post "queue empty, waiting" and keep the watcher up.

## Update log (append below, newest last; one line each; include running helper IDs so a clear can resume them)
- 2026-10-30 01:28:55: after the clear. Running: (X2) a5d7d0672b9afca18 second-t9io @3dc2a58; (BB) af00a5ef3ffd8dcfc second-t10 @77bd835 (told: merge X2's new head before reporting); (Z) a18eda52a45770641 second-fud @ae3ae9e (told: main 414e722 merge required, tsc+vitest api/web/auth-client). (AA) Task 34 @f7e0d1e queued for the first free slot. Watcher on to-second.log armed.
- 2026-10-30 01:38:24: main now d48033f (Task 36). (AA) brief must add: merge main d48033f; new cap (2 per side per currency + 20) also in routes.ts ~667-669 bulk count, assertMayPost SQL ~306-312, OFFER_CAP_DEFAULTS ~129; test offersBulk.test.ts. Z still running (tests).
- 2026-10-30 01:53:44: (Z) done @9865bdd, logged. Starting (AA) Task 34 helper in second-t34 @f7e0d1e.
- 2026-10-30 01:53:53: (AA) a53aa63397c77fa2c running in second-t34 @f7e0d1e. Running: X2 a5d7d0672b9afca18, BB af00a5ef3ffd8dcfc, AA a53aa63397c77fa2c.
- 2026-10-30 02:08:18: (BB) fixes pushed, waiting on X2's final SHA to merge.
- 2026-10-30 02:15:48: (X2) done @8cfdbe6, logged. BB told to merge 8cfdbe6. Running: BB af00a5ef3ffd8dcfc, AA a53aa63397c77fa2c.
- 2026-10-30 02:16:30: lead's FU-D round 2 = CHANGES REQUIRED docs only (N1, N2). (Z2) a114f16c172b883db running in second-fud @9865bdd. Running: BB af00a5ef3ffd8dcfc (merging X2 8cfdbe6), AA a53aa63397c77fa2c, Z2 a114f16c172b883db.
- 2026-10-30 02:26:09: (Z2) done @0c2f679, logged. Running: BB af00a5ef3ffd8dcfc, AA a53aa63397c77fa2c.
- 2026-10-30 02:27:25: (BB) done @6228584, logged with 3 questions. Running: AA a53aa63397c77fa2c only.
- 2026-10-30 02:29:44: BB deploy-order note added @e753132 (docs only). Running: AA a53aa63397c77fa2c.
- 2026-10-30 02:34:10: main da2d3c9 (FU-D landed). AA told to merge it.
- 2026-10-30 02:45:13: main 41acc5c. (X3) a6eba22e93587c81f running in second-t9io @8cfdbe6 (round 3). Then BB re-merge of the new task9-io into task10. Running: X3, AA a53aa63397c77fa2c.
- 2026-10-30 03:00:57: (BB2) a240dec69c1717a02 running in second-t10 @e753132; waits for X3's SHA to merge. Running: X3 a6eba22e93587c81f, BB2 a240dec69c1717a02, AA a53aa63397c77fa2c.
- 2026-10-30 03:03:11: (AA) done @6056e26, logged. Running: X3 a6eba22e93587c81f, BB2 a240dec69c1717a02.
- 2026-10-30 03:21:47: (W2) queued: Task 9 view M1-M5 + merge onto X3's final task9-io (worktree second-t9view). Starts after X3.

## RESUME 2026-10-30 06:25 (written by the lead; this section supersedes the queue above)
You hit your 5-hour limit at 03:29, resumed at 05:30, then a network drop (EAI_AGAIN) at 05:35 killed your
helpers. You were then cleared. **Main line is now 5c4d35b** (landed 10-30: Task 36, test hygiene, FU-D,
Plan 5 reputation core, Task 40 foldables, Tasks 38–39 incl. migration 116 and warning sheets with role
`alertdialog`). Max 3 helpers. Each helper gets ~/x2f-comms/helper-common.md + "commit WIP first, push every commit".
Playwright: from apps/web with `-c e2e/playwright.config.ts --workers=1`, X2F_CHROMIUM_PATH=/usr/bin/chromium.
Never pipe vitest into tail inside `&&` (hides the exit code).

Do in this order (parallel where possible, 3 at once):
1. **(X3) Task 9 I/O round 3 — already DONE and pushed @7346fc0** (86dade7 both-parties rule, 6c35f63 red tests,
   39bb201 R3-M2, 7dc6f80 docs, f60c449 main f13f574 merge, 7346fc0 review copy). You never reported it: post one
   line to to-lead.log now (head, what was fixed, test counts if you have them; if you don't, say so). The lead
   starts a round-4 review.
2. **(BB2) Task 10 round-2 fixes** on `wip/second-p3-task10` @481da0e (N1 done). Worktree `second-t10` has 3
   UNCOMMITTED files (apps/moderation/src/buyerCancel.ts, desk.ts, watcher.ts): inspect, commit as WIP and push
   FIRST. Then finish per `~/x2f-comms/review-task10-round2-2026-10-30.md` + the lead's 02:5x line in to-second.log:
   N2 re-check paidSeen + API state every pass after an armed buyer-cancel; N3 deploy note; N4 distinct log reason
   for 409 wrong-state on escalation; NTP deploy note; shadow veto of auto-refund / buyer-cancel / lapse-refund
   sweep kinds when the shadow's own facts disagree. Merge task9-io 7346fc0 and main 5c4d35b. Tests, push, report.
3. **(W2) Task 9-view minors** (`~/x2f-comms/review-task9view-2026-10-30.md`): M1–M5 (M5 = releaseClaimedAt null
   outside settling) and merge the view branch onto task9-io 7346fc0 (TradeRoom.tsx: keep Task 40's <Panes>,
   add the SettleWait import, main= fallback <StatusCard view={view} serverClock={clock} />; fixtures
   releaseClaimedAt: null). Worktree second-t9view doesn't exist yet: create it. Lead lands without re-review if they match.
4. **(AA2) Task 34 fix round** on `wip/second-p3-task34` @6056e26 (`~/x2f-comms/review-task34-2026-10-30.md`):
   I1 SECURITY instructionsSha256 in AttestedTerms.deal; I2 refuse multi-tier until Task 35 + {minTrades} in the
   409; M1–M7; M6 = no grandfathering. Task 34 lands LAST; after each other branch lands, merge main and fix the
   tests it breaks on your branch.
Report each item to to-lead.log as it finishes; keep your Update log below current (helper IDs + SHAs).
- 2026-10-30 06:23:01: after the 06:18 clear. X3 reported @7346fc0 (no fix-round test counts recorded). BB2 WIP committed ccefdab. Running: BB2 a90d1517a027a3e0e (second-t10), W2 a02907b20f7ea7c11 (second-t9view, new), AA2 a62d63e1591028f91 (second-t34). Watcher armed.
- 2026-10-30 06:26:20: (DD) a15a418960dfaf53f started, docs branch wip/second-docs-1030-answers from 5c4d35b, worktree second-docs1030. Running: BB2, W2, AA2, DD.
- 2026-10-30 06:39:07: new window took over (tmux copy killed). WIP committed: BB2 08d12dc, AA2 e8b58a4; W2 7359af1 pushed (all minors committed, untested); DD branch created. Running: BB2 a6071e315930e71b2 (second-t10), W2 a6c74d77daf3775f5 (second-t9view), AA2 ac64402073b397bca (second-t34), DD acca4daf52ac61d26 (second-docs1030). Watcher armed.
- 2026-10-30 06:50:51: DD done @25c3889, reported. FF review done (APPROVED WITH MINOR). Running: BB2 a6071e315930e71b2, W2 a6c74d77daf3775f5, AA2 ac64402073b397bca.
- 2026-10-30 07:04:00: W2 done @99ba09f, BB2 done @3ded6fc, both reported. Running: AA2 ac64402073b397bca.
- 2026-10-30 07:07:43: AA2 done @b7a3563, reported. All of BB2/W2/AA2/DD done; no helpers running.
- 2026-10-30 07:14:00: (BB3) a8b7bdf5430374c55 running in second-t10 @3ded6fc (round-3 R3-N1 + M1/M2 docs).
- 2026-10-30 07:19:43: BB3 done @305124b, reported. AA3 (Task 34 round-2 docs) being done by me in second-t34.
- 2026-10-30 07:20:17: AA3 done @e900c12 (by me). No helpers running.
- 2026-10-30 07:25:55: BB4 Task 10 round 4 APPROVED WITH MINOR; follow-up R4-M1.. queued after Tasks 9+10 land (new branch from new main).
- 2026-10-30 07:27:11: (HH) a261addb80607d798 running in lead-p7-retention @83fd652 (Plan 7 T1-4 fix round).
- 2026-10-30 07:38:41: HH done @c8fc2b3, reported. No helpers running.
- 2026-10-30 07:44:14: OWNER HOLD on Tasks 9 I/O, 9-view, 10 (no merges of them anywhere); BB4 follow-up waits.
- 2026-10-30 07:45:18: (HH2) Plan 7 round-2 helper running in lead-p7-retention @c8fc2b3.
- 2026-10-30 11:11:37: back from limit; HH2 taken over by the lead (hands off lead-p7-retention). No helpers running.
- 2026-10-30 11:12:49: (JJ) a33fcdc02c8c30894 second-land-t18 @0365ed7; (KK) a905a5a4f7702901b second-t34 @e900c12 (main 3635fac merge).
- 2026-11-01 15:10:21: KK done @481c0d3 (main 52b7a0e); DD q14 fix @550df1c. No helpers running.
- 2026-11-01 16:42:09: KK full checks done @481c0d3 (PW 438/438); DD @e286489. Idle.
- 2026-11-01 20:12:47: C2-F1 done @30b1794 (3x full npm test green). (C2-D1) ae0da4858a009d6e3 running in second-design-devices.
- 2026-11-01 20:24:52: C2-F1 LANDED (d77134d). Running: C2-D1 ae0da4858a009d6e3.
- 2026-11-01 20:43:11: C2-D1 done @9f23e55, reported with 7 owner questions. No helpers running.
- 2026-11-01 20:44:34: (C2-D2) a528a783512f57779 running in second-design-selection (from devices @9f23e55).
- 2026-11-01 21:09:28: C2-D2 done @b50fb03, reported (2 questions). No helpers running.
- 2026-11-01 21:14:34: (C2-D1b) devices fix round helper running in second-design-devices.
- 2026-11-01 21:37:11: LEAD HANDOFF 21:36 (lead at limit). Queue: (1) devices final tests (helper a1f4d350f43a44b43 running) -> report, lands first; (2) selection @b50fb03 pushed; (3) after devices lands: wip/second-design-loginapprove-v2 from main (v2 batch 1 4b355a56). Owner-waiting: Task 34 @481c0d3 (later multi-currency + multi-method per ad, cap 3 buy + 3 sell), docs @e286489. Lead state: ~/x2f-comms/LEAD-HANDOFF-2026-11-01-night.md
- 2026-11-01 21:45:16: C2-D1b done @4e65c4c, reported, ready to land. Idle until a lead lands devices (then LoginApprove v2).
- 2026-11-02 01:14:30: lead back. Devices landed (main 850052d). LoginApprove v2 helper a823d219d26939542 in second-design-la-v2; me: main merge into selection.
- 2026-11-02 02:41:47: C2-A1 done @83f814f; LA v2 @3e9a906; selection @22a36eb; C2-A2 design note @5acf165 (11 Qs). No helpers running.
- 2026-11-02 05:15:34: owner answered Task 34 Q2,Q3(partly),Q6,Q8,Q11 directly; logged to lead.
- 2026-11-02 05:38:17: owner decisions on Task 34 recorded in the design note + to-lead.log with the owner's request that the lead reviews all and raises disagreements with the owner.
- 2026-11-02 07:06:13: C2-V3 offers v2 helper running in second-design-offers-v2 (from b6835ee).
- 2026-11-02 07:19:06: READY TO CLEAR; full handoff in ~/x2f-comms/HANDOFF-claude2-2026-11-02.md (read it first after the clear).
- 2026-11-02 08:07:00: after 07:4x clear (handoff HANDOFF-claude2-2026-11-02.md). Lead 08:02: up to 5 helpers. Running: C2-V3 a80d854032a1f0dfd (second-design-offers-v2 @cfd06123); C2-A1c ae6e3e7cdb747aedc (second-api-cap @0b767251 checks); C2-T34A a81a2340d2c8f5e6d (second-t34 @b4240210 API); C2-T34W a8968185eefabd39d (second-t34-web, wip/second-p3-task34-web @b4240210); C2-PF ad6843771e96e6440 (second-price-feeds, wip/second-price-feeds @e7636c7). Me: selection @36ebf59 (stale tab-bar entry in selection-ink.test.ts being fixed, uncommitted). Holds: no end time (owner); freeze rule = lead's Plan 4.
- 2026-11-02 08:47:51: selection READY @67336d4, reported.
- 2026-11-02 09:18:21: LIMIT. selection READY @67336d4. Helpers running: C2-A1c ae6e3e7cdb747aedc, C2-T34A a81a2340d2c8f5e6d, C2-T34W a8968185eefabd39d, C2-PF ad6843771e96e6440, C2-V3 a80d854032a1f0dfd. Resume each from its pushed head; watcher NOT armed.
- 2026-11-02 15:41:44: owner says lead+designer out until Wed. C2-V3 READY @86c58ec3. Resuming T34A/A1c/T34W/PF via SendMessage.
- 2026-11-02 15:43:15: running A1c ae6e3e7cdb747aedc, T34A a81a2340d2c8f5e6d, T34W a8968185eefabd39d, PF ad6843771e96e6440, V3R reviewer ae9547283bed2d88d. Watcher armed.
- 2026-11-02 15:44:29: PF READY @526650a6, T34A done @667e5edd, both reported. Running: A1c ae6e3e7cdb747aedc, T34W a8968185eefabd39d, V3R ae9547283bed2d88d (review-offers-v2), PFR adecbedc3c9b06cec (review-price-feeds), T34AR adc83947198dbda35 (review-task34-multicurrency-api).
- 2026-11-02 15:58:45: A1c cap-dispute READY @0b767251, reported. Running: T34W, V3R, PFR, T34AR.
- 2026-11-02 16:02:37: PF review APPROVED WITH MINOR; PF fix round running ad6843771e96e6440. Running: T34W, V3R, T34AR, PF.
- 2026-11-02 16:04:05: V3 review APPROVED WITH MINOR; V3 fix round running a80d854032a1f0dfd. Running: T34W, T34AR, PF fix, V3 fix.
- 2026-11-02 16:07:06: T34W done @871a19e5, reported. Running: T34AR adc83947198dbda35, T34WR a86c2cc611d59a2d1, PF fix ad6843771e96e6440, V3 fix a80d854032a1f0dfd. Watcher: re-arm if expired.
- 2026-11-02 16:10:44: T34AR APPROVED WITH MINOR; T34A fix round running a81a2340d2c8f5e6d. Running: T34A fix, T34WR a86c2cc611d59a2d1, PF fix, V3 fix.
- 2026-11-02 16:21:22: PF READY @f1dea13d. Running: T34A fix, T34WR, V3 fix.
- 2026-11-02 16:22:29: V3 READY @8252e887. Running: T34A fix a81a2340d2c8f5e6d, T34WR a86c2cc611d59a2d1.
- 2026-11-02 16:25:09: T34A fix done @e78143f9. Running: T34WR a86c2cc611d59a2d1. Next: web fix round merges e78143f9 + offers-v2 8252e887.
- 2026-11-02 16:28:22: T34WR CHANGES REQUIRED; T34W fix round + merges running a8968185eefabd39d. Only helper running.
- 2026-11-05 22:57:57: READY TO CLEAR; handoff ~/x2f-comms/HANDOFF-claude2-2026-11-05.md (read that first).
