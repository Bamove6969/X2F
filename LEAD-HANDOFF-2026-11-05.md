# X2F LEAD HANDOFF, Thu 5 Nov 2026 ~23:00 PT (full clear)

Read this FIRST. Then `LEAD-HANDOFF-2026-11-02.md` (§0 rules, §3 owner decisions, §5 roadmap, §6 people still apply), then the worker handoffs: `HANDOFF-claude2-2026-11-05.md`, `HANDOFF-claude3-2026-11-05.md`, design's `docs/DESIGN-HANDOFF*` + `docs/to-lead.md` on wip/design-brief.

## 1. The one big problem: NOTHING HAS LANDED SINCE 2 NOV
Main line = GitHub main = **e7636c7**. Workers built a mountain (below); the lead hit limits and the machine rebooted on 5 Nov. **Job one is landing, not more building.** The owner wants strong leadership and everyone maxed.

## 2. How to run it (lead's plan)
- **Spread the quota.** On 2 Nov my 6 helpers all died together on the owner's 5-hour limit. Reviews should run on claude2's/claude3's accounts: claude2 helpers review claude3's branches and vice versa (independent, and costs the lead nothing). Lead keeps merges, final calls and security-sensitive reviews.
- **Landing by script, not by agent.** Use a dedicated worktree (e.g. ~/x2f-worktrees/lead-land, `npm ci` once; ~/x2f node_modules is stale): merge one branch, `~/x2f-comms/run-check.sh <log>`, push `HEAD:claude/compassionate-johnson-k95ssr HEAD:main` only when green, announce in to-second/to-third. Run in the background; stop on conflict or red.
- Every landing still needs an independent review first (owner rule). Security reviews before landing: vendor + ban list, hold v3, Plan 4 tasks 4-8/10/11, and anything touching keys.
- Worker sessions run on pts/2 (claude2) and pts/0 (claude3), no tmux since the reboot. They only see their logs when nudged: owner pastes "read ~/x2f-comms/to-<second|third>.log and your HANDOFF file, then report".
- Design: SendMessage to "Continuation" reaches it; replies arrive as cross-session messages and in docs/to-lead.md on wip/design-brief. Status showed "waiting on a human" on 5 Nov.

## 3. Landing queue (heads as of 5 Nov; check worker handoffs for newer)
| # | Branch | Head | Review state | Next |
|---|---|---|---|---|
| 1 | wip/lead-design-fold | e02c1e9 | all checks green (web 1205, api 1462, trade 328, PW 454); round-2 review DIED at the limit, no file | re-run review, land |
| 2 | wip/second-design-selection | 67336d4 | reviewed 2 Nov (I1 fixed). CHECK M1 inset shadow was done; PW 450 green | land |
| 3 | wip/third-feedback-form-limit | 5fee682 | UNREVIEWED; api 1462 green | review, land (5-a-day question open) |
| 4 | wip/second-api-cap-dispute | 0b76725 | reviewed at 83f814f. !! `git log` shows NO new commit of its own after the review, only merges: my M1 (maintenance pauses the 30-min wait), M2 (cap text from perSide) look NOT DONE, though claude2 said "no fixes needed". Ask claude2 | resolve, land |
| 5 | wip/third-p5-reviews-api | a7a38fd | round 1 APPROVED WITH CHANGES; fixes unreviewed | re-review, land |
| 6 | wip/third-p5-past-rep | 4a687f9 | fixes unreviewed | review, land |
| 7 | wip/third-p5-traded-pastrep | 315142b | after 5+6 | review, land |
| 8 | wip/third-p5-proof-core, -proof-envelope (C7), -smart-check (C8) | 4d39fc7, e49c62a, 1e54d3f | proof 178/206/244 green; final review needed | review, land in order |
| 9 | wip/third-p5-proof-popups | f2cce85 | items 63/64/65 on the kit (owner Q21); design must review | review, land |
| 10 | wip/second-price-feeds | f1dea13 | APPROVED WITH MINOR, fixed; owner calls OC1-OC6 open | land after owner OK |
| 11 | wip/second-design-offers-v2 | 8252e88 | APPROVED WITH MINOR, fixed | land; tell design about the kit 'info' tone + icon-button radius |
| 12 | wip/second-p3-task34 + -web | c2d1006 + 499a78b | API approved; WEB CHANGES REQUIRED (I1, I2) fix round was cut off 2 Nov. API + web land TOGETHER, on offers v2 | finish, re-review, land |
| 13 | Plan 4: third-p4-task4/5/6/7/8/10/11/15/16 (+ staff-trader-split) | see claude3's handoff | stacked, UNREVIEWED; task7+8 both add the same key-tap mount | security review bottom-up, land in order |
| 14 | wip/lead-design-results | 83f32fa | helper cut off before its checks | finish: web suite, PW, reshoot (steps in HANDOFF-lead-results), re-review |
| 15 | wip/lead-sessions | eb8b6f4 | helper cut off; no RESULT written. Keeps migration 307 | finish checks, review |
| 16 | wip/lead-vendor | 0930fa1 | helper cut off; main merged, no RESULT | finish checks, SECURITY review |
| 17 | wip/lead-hold-v3 | a8da2ea | WIP saved by me 5 Nov (19 files, UNCHECKED; was on deviceApproval failures); main not merged | finish tests, merge main, SECURITY review |
Migrations to reconcile at landing: hold v3 016, ban list 017, account type 198, Plan 4 202-207+, sessions 307, traded 308, overturn 309, past-rep 310.
Lead's own items: Plan 4 Tasks 13/14 (ruling gate + execution, with security review) and the screenshot pack to design after a landing batch.
Dirty old worktrees, not touched: lead-t29 (93), p3-task28 (46), rv-staff2 (71), rv-fold2 (1, leftover reviewer; can go). Look before deleting.

## 4. Owner decisions since the 2 Nov handoff
`owner-answers-2026-11-02-lead.md` (market ± % only, whole-unit bands, mod-verified $, freeze only as a separate later action when a dispute/ruling is ignored, no end time, person messages the mods who verify and lift; blur add-only, auto-blur never hides the amount, warning on the uploader's own blur; prompt 2 min) and `owner-answers-2026-11-01-claude3.md` Session 3 (senior mods + owner enter the $ figure, approved claims only; bucket strictly MORE than a step; separate staff and trader logins; one open support ticket per person; disputes aim for 24 h; disputes kept 90 days; items 63/64/65 built now on the kit). claude2: band 200-500 covers 200.00-500.99.
Lead still owes the owner a review of claude3's direct answers (standing rule).

## 5. Open with the owner
- Design: #1 member-permission presets (top), #10 template blanking, #12 SetupTerms "of 5/6", #7 incident ID; new: bans with an end date?, "On hover" vs "On tap" badges.
- claude3: Q1 keep the 5-a-day form cap?, Q5a funds move after the 48 h appeal window or at once with a lien?, Q7 overturned trade in totals, 10a combined line?, Q11/Q12, Q19a, Q22, Q23.
- claude2: wording/look list, Q1 XMR unit colour, Q2 Buy/Sell tab border, price feeds OC1-OC6, blank per-currency instructions (refuse or warn?), #30 bands, Task 34 gift-card Q2.
- Hold rules 13 Qs (HANDOFF-lead-hold-v3), sessions Qs 2-6, vendor 6 Qs, fold Q1-Q4, retention I1/I2 (review-p7-retention-2026-10-30.md:13,18).
- Machine: 5.8 GB RAM is the test bottleneck; offered to check WSL's memory setting, no answer yet.

## 6. Design's message, 6 Nov (read before assigning any screen work)
- BUILD REVIEW of the 4 packs on main: coming as docs/design-review-build-2026-11-05.md on wip/design-brief. Of the 9 shared problems: X1 orange + X2 CantDoThat shell PARTLY fixed; X3 focus ring, X4 native fieldset/select, X7 all-mono timers, X9 old hold wording STILL there; X5 dates partly. Ship-ready: 03, 06, 07, 08, 10, 32, 34, 61. Top five: (1) hold/Strong-login copy + missing RecoveryHold, TeamRefusal screens (04, 20); (2) one CantDoThat everywhere (33, 25); (3) ink accent/ring/focus, no native fieldset/select in shared CSS (19, 26, 61, 62); (4) DisputeRoom/Ruling hero, 6-decimal XMR, dated UTC times (58, 59); (5) MyOffers wide table + fold two panes + padding under the pinned footer (31w, 32w, 54, 34).
- Her packs predate the unlanded branches: selection (X1), hold v3 (X9, RecoveryHold), fold (54) and results (dates) may already cover some of this. Check against those branches before assigning fixes.
- COHESION PASS: 274 findings fixed on 126 boards + new Settings and FAQ boards; big commit + new canvas version due. HOLD copying these until that commit: Review/Reviews (merged form), BuyerPaidWaiting/SellerConfirm heroes, DisputeRuling, Lien-Notice, Team, MemberPermissions. Affects claude3's Task 15-18 screens.
- She still needs from the owner: ban end date (Ban-Notice), "On hover" vs "On tap" (BadgeSettings), presets, template blanking, SetupTerms step count, incident ID.

## 7. Handoff status
claude2 READY (HANDOFF-claude2-2026-11-05.md; new: owner note #2 method+currency pairing on the post screen needs a layout pick, claude2 recommends method-first). claude3 READY (HANDOFF-claude3-2026-11-05.md; 13 READY branches, 5 cut off). Design: review at docs/design-review-build-2026-11-05.md @9cd450c2; handoff will be docs/DESIGN-HANDOFF-2026-11-06.md, then "READY TO CLEAR" in docs/to-lead.md.
- 5 Nov 23:35: DESIGN READY TO CLEAR @88b90fa5 (cohesion pass on every board, Settings + FAQ boards, docs/DESIGN-HANDOFF-2026-11-06.md, build review docs/design-review-build-2026-11-05.md). ALL FOUR SESSIONS READY. Windows now run in tmux (x2f-lead/claude2/claude3) via the desktop shortcuts. Worker settings pinned to model=opus. After the clear: workers read their HANDOFF + log and wait for the lead's queue; lead's job one = LANDING (§2-3).
- 5 Nov 23:45: design final: wip/design-brief @bf1c4c9f, canvas v117. Two jobs stopped before starting, written up as §6 of docs/DESIGN-HANDOFF-2026-11-06.md: the last three board redesigns, and bringing the X2F design system artifact up to v2. Next design session starts there.
- 6 Nov 00:00: OWNER DECISION: wants SonarQube Cloud back on GitHub (reverses 'SonarQube local only' of 1 Nov; told code copy goes to SonarSource and a paid plan may be needed). Install needs the owner's browser: https://github.com/apps/sonarqubecloud/installations/new, X2F repo only, then import at sonarcloud.io. Keep local SonarQube until cloud scans are confirmed.
- 6 Nov 00:57: selection LANDED 16f3762. claude3 on usage limit until 03:40 (proof trio + Task 4 minors moved to claude2). Owner question page: https://claude.ai/artifact/KpYrkBkfXVpL8krirkiBR2 (answers in its db, collection 'answers'; read with ArtifactData). Batch 2 (fold, form limit, Sonar) in check on lead-land, log land-batch2-2026-11-06.log.
- 2026-11-06 01:33:08: owner may restart a computer. Batch 2 was unpushed on lead-land (selection is landed): fold + form limit + wip/lead-sonar-action, check log land-batch2-2026-11-06.log. If it died, redo: merge those three on main, full check + semgrep + Playwright, push both refs. Batch 3: offers v2 @a8724b1 + traded @1a99f7b. Then proof core/envelope/smart-check. Owner answers in artifact db, not yet sent to workers; follow-ups in owner-followups-2026-11-06.md. claude3 returns 03:40.
- 2026-11-06 01:36:09: PC RESTART. Batch 2 is committed locally on wip/lead-land @1c400ea2 (fold, form limit, Sonar), NOT pushed. vitest 3892 passed, 1 failed = password.test.ts Argon2 flake, passed 3/3 alone. Semgrep 0 findings. npm audit not run. Playwright NOT validly run (my command, from apps/web without the e2e config, ran vitest files; exit=1 is meaningless). Next: run Playwright properly, push HEAD:claude/compassionate-johnson-k95ssr HEAD:main, announce, then batch 3. After restart: re-arm the to-lead monitor, nudge workers.
- 2026-11-06 01:56:48: main = 1c400ea (fold, form limit, Sonar landed). CORRECTION: Task 9 I/O is NOT in main (reverted a55abfc7, 30 Oct). "merged" in git does not mean the code is present: check for reverts before calling a branch dead. Held branches restored. Offers v2 conflicts with fold; claude2 fixing. Traded @1a99f7b waits with it for batch 3.
- 2026-11-06 02:19:57: claude2 moved to cloud session_01MytcQrnjJQN6u4zQJv1ciV (branch claude/task-z23obx). Local claude2 = relay only. Trial: vitest 1.8 min, PW 4.8 min; monerod blocked until downloads.getmonero.org is allowed. Batch 3 on lead-land: offers v2 + traded.
- 2026-11-06 02:37:42: OWNER DECISION: build our own MCP message board for comms. Not Discord, not a rented server.
- [2026-11-06 02:59:35] lead: LANDED offers v2 and traded + past-rep -> main line = GitHub main = 55bc70f9. vitest 4051, PW 454, semgrep 0. Merge it before your next push.
