# Lead handoff — X2F (rewritten 2026-10-30 01:05, before a screen clear)

You are the **lead** Claude session for X2F, running in `~/x2f` on the owner's account
(bamove@gmail.com, profile `~/.claude`, launcher `lead`). You plan, assign, review, merge and are
the owner's single point of contact. Read this file top to bottom, then act. MEMORY.md loads itself.
The previous version of this file is `~/x2f-comms/LEAD-HANDOFF.2026-10-29.bak.md` (history only;
everything still live is copied here).

## 0a. UPDATE 2026-10-30 01:25 (supersedes the FIRST step below)
- claude2/claude3 cleared + GO'd at 01:20; claude3 acked 01:24 (C1/C2/C3 running). Lead watcher armed on to-lead.log.
- Lead helpers running (fresh, 01:21): L3 Task 36 finish, L1 Tasks 38-39 fix round (+48 h no-show dispute), L2 Task 40 fix round, L4 review of 16-17 -> ~/x2f-comms/review-task16-17-2026-10-30.md. Next free slot: L5 Task 18, then worker reviews (section 3).
- 01:5x: **Task 36 LANDED, main = d48033f.** Known flakes under load (not 36's): api test/schema.test.ts name_keys race 'race.two' unhandled rejection (latent on main: fix the test's unawaited promise); web attestation-flow 'reload never calls settle again'. Workers' handoffs: claude2 = ~/x2f-comms/HANDOFF-SECOND.md (rewritten 01:35), claude3 = LETTER-TO-THIRD.md (state section + update log); point them there after any clear.
- 02:0x: Task 40 fix round DONE @c820fbc -> round-2 re-review running (-> review-task40-round2-2026-10-30.md). Main-line test hygiene helper on wip/lead-test-hygiene (worktree lead-test-hygiene): profiles.test.ts:111 viewerId RED on main (from Task 37), schema name_keys race, view.test fee flake. Land it right after 36 so later landings check green. Running: L1 38-39, L4 review 16-17, L5 Task 18, T40 re-review, hygiene (5).
- 02:1x: 16-17 review = CHANGES REQUIRED (2 Critical takeover holes C1/C2, I1-I7, M1-M9): review-task16-17-2026-10-30.md; fixer running on wip/lead-p2-task17 (rename to plan names, owner's explicit strong-combo list, plan text 'PGP alone: no hold' corrected on branch). FU-D DONE @9865bdd -> round-2 re-review running (review-fud-round2-2026-10-30.md). FU-D's 69fd967 fixes profiles.test viewerId; hygiene told to cherry-pick it. claude3 (C2) reputation core DONE @c259cd4: REVIEW OWED (next free slot). Running (6): L1 38-39, L5 18, T40 r2, hygiene, 16-17 fixer, FU-D r2.
- 02:2x: Tasks 38-39 fix round DONE @5f4eee2 (main d48033f merged) -> round-2 re-review running (review-task38-39-round2-2026-10-30.md). Reputation core review running (review-p5-reputation-core-2026-10-30.md). LEAD DECISIONS: 48 h refund-dispute window for ALL buyer-disputable refunds (owner q11 to confirm); accept M3 24 h unconfirmed-refund escalation. DOCS OWED: spec lines ~17/308 and HANDOFF.md ~256 still say the 48 h question is OPEN; fold into the next docs branch. Running (7): L5 18, T40 r2, hygiene, 16-17 fixer, FU-D r2, 38-39 r2, rep review.
- 02:3x: Task 40 round 2 = APPROVED WITH MINOR (review-task40-round2-2026-10-30.md); land-prep helper applying minors 1-4 + docs item 5 on wip/lead-p3-task40, then the lead lands it. claude2 (BB) Task 10 @1e3673e waits for X2's final task9-io head (3740ccd and moving). Running (7): L5 18, hygiene, 16-17 fixer, FU-D r2, 38-39 r2, rep review, T40 land-prep.
- FU-D r2 = CHANGES REQUIRED docs only (N1 pg_statistic keeps login names: ANALYZE + VACUUM FULL pg_statistic; N2 pg_wal sentence). Sent to claude2; lead checks wording vs review-fud-round2-2026-10-30.md and lands, no round 3.
- 02:4x: **test hygiene LANDED, main = 27e96df** (api vitest green on main). Reputation core = APPROVED WITH MINOR; minors + lead decisions (M1 store weight only; M4 Trusted min 5 reviews provisional = owner q12) sent to claude3; lead lands after checking, no round 3. Running (5): L5 18, 16-17 fixer, 38-39 r2, T40 land-prep, (free slots: Task 9-view review once 9 I/O final; Plan 7 Tasks 1-4; Plan 4 T23).
- 02:2x: Plan 7 Tasks 1-4 builder started (wip/lead-p7-retention, worktree lead-p7-retention). claude2 X2 Task 9 I/O DONE @8cfdbe6 -> round-3 SECURITY review running (review-task9io-round3-2026-10-30.md; key Q: R2-M1 forged-kind attack not closed by the ring check; does Task 10's shadow trade close it; can 9 land before 10). claude3 C1 staff core DONE @3f7e2e6 -> review running (review-p4-staff-core-2026-10-30.md; 10 decisions to confirm). claude2 running BB (merging 8cfdbe6), AA Task 34, Z2 FU-D docs. claude3 running C2 fix round, C3 Task 20. Lead running (7): L5 18, 16-17 fixer, 38-39 r2, T40 land-prep, P7 builder, T9 r3, staff review.
- 02:3x: Task 18 BUILT @e1c01f6 (main 27e96df merged, all green; no e2e team.spec.ts yet) -> review running (review-task18-2026-10-30.md); fix round must add the e2e. Owner q13 = Task 18 lead defaults. Lead running (7): 16-17 fixer, 38-39 r2, T40 land-prep, P7 builder, T9 r3, staff review, T18 review.
- 02:3x: FU-D docs fix @0c2f679 checked by lead, merged LOCALLY in ~/x2f as da2d3c9 (not pushed until full landing check bgcq94qo8 passes; log in lead scratchpad fud-land.log). Task 10 fix round DONE @6228584 -> round-2 re-review running (review-task10-round2-2026-10-30.md). Lead running (8 = cap): 16-17 fixer, 38-39 r2, T40 land-prep, P7, T9 r3, staff review, T18 review, T10 r2.
- QUEUED for next free lead slot: Task 20 rest re-review (claude3 C3 DONE @a22b20c, contains 27e96df; review-task20rest-2026-10-29.md). Task 10 head now e753132 (docs-only deploy-order bullet on top of 6228584).
- Tasks 38-39 round 2 = APPROVED WITH MINOR (N1-N5; review-task38-39-round2-2026-10-30.md); land-prep helper running on wip/lead-p3-task38. AT TASK 10 LANDING: its timers.ts:45 timer-loop query must include trades awaiting seller Confirm cancel (Task 38 tripwire NEEDS_TASK_9_TIMER_LOOP fires then). Lead running (8): 16-17 fixer, T40 land-prep, P7, T9 r3, staff review, T18 review, T10 r2, T38 land-prep. Next slot: Task 20 re-review.
- 02:4x: **FU-D LANDED, main = da2d3c9** (tsc 3 ok; api 1199+1todo, web 983, auth-client 70). Lesson: never pipe vitest into tail inside a && chain (masks the exit code).
- 02:5x: **Reputation core LANDED** (main updated). Task 9 round 3 = CHANGES REQUIRED: R3-I1 decoy-ring attack by another trade's seller (no API compromise) -> fix = both parties' sealed spend.info must name the tx for an import-only sweep; also closes R2-M1 (Task 10 does NOT close it; docs to correct). Sent to claude2 as (X3), before AA; Task 10 must re-merge task9-io after. claude3 C1 staff core re-merged @9585924 (review in flight on 3f7e2e6).
- Staff core review = CHANGES REQUIRED (I1 log-chain fork under RR/SERIALIZABLE -> unique prev_hash index; I2/I3 R37 round-1 involvement gaps; M1-M8); sent to claude3 with decision calls (4 = always require assignee role from DB; 8 after I1). 108 reconciliation recorded as owed, not done now. Then lead re-review. Task 20 r2 review running. Lead running (7): 16-17 fixer, T40 land-prep, P7, T18 review, T10 r2, T38 land-prep, T20 r2.
- 03:0x: **Task 40 LANDED** (main f13f574 pushed after full tsc + vitest web 998, auth-client 70, api 1199). Landings this session: 36, test hygiene, FU-D, reputation core, 40. Lead running (6): 16-17 fixer, P7, T18 review, T10 r2, T38 land-prep, T20 r2.
- 03:0x: claude3 HIT LIMIT 02:55 (resumes 5:30, only C3 Task 20). LEAD TOOK OVER C1 staff-core fix round: worktree lead-p4-staff-fix (detached, pushes HEAD:wip/third-p4-staff-core; claude3's WIP red tests committed as d6b2949). Task 18 review = CHANGES REQUIRED (I1 member tabs suppress owner pushes/stream slots; I2 member takes can't be funded -> LEAD: option (a) refuse member takes until Task 42; q13(d) updated); fix round + e2e team.spec running. Lead running (8): 16-17 fixer, P7, T10 r2, T38 land-prep, T20 r2, T9view review, staff fix, T18 fix.
- Task 10 round 2 = CHANGES REQUIRED (N1 late-receipt check uses max, must use min(shadow, API alert)+2 min; N2-N4; NTP deploy note; optional shadow veto of 3 sweep kinds). Sent to claude2 as (BB2), parallel with X3. Task 20 now e614c21 (contains f13f574; reviewer told to check its TradeRoom/App merges). Lead running (7): 16-17 fixer, P7, T38 land-prep, T20 r2, T9view review, staff fix, T18 fix.
- 03:0x: claude2 (AA) Task 34 DONE @6056e26 (drops offers.method_id/margin_bps: other branches may break) -> first review running (review-task34-2026-10-30.md). Then Plan 3 Task 35 (PostOffer tiers, web) becomes startable. Lead running (8): + T34 review.
- 03:2x: Tasks 38-39 merged LOCALLY in ~/x2f as 361762b on f13f574 (Sheet.tsx doc-comment conflict, both kept); unit checks green (trade 325, web 1022, auth 70, api 1212); Playwright re-run bom7gb4cy (first try lacked `-c e2e/playwright.config.ts`: ALWAYS pass it, from apps/web). Task 9-view = APPROVED WITH MINOR -> claude2 (W2) after X3, lead lands without re-review. Lead running (6): 16-17 fixer, P7, T20 r2, staff fix, T18 fix, T34 review.
- Task 20 round 2 = CHANGES REQUIRED (I1 chat e2e red after TradeRoom merge; I2 wide-layout Chat links dead; m1-m6). LEAD TOOK OVER (worktree lead-t20fix). P7 builder warned to keep purgeChatsJob. claude3 NEW QUEUE sent 03:2x: (C4) Plan 5 Task 3 Reviews API (+Task 20 running totals, weight only) on wip/third-p5-reviews-api; (C5) Plan 5 Task 7 @x2f/proof core on wip/third-p5-proof-core. Lead running (7): 16-17 fixer, P7, staff fix, T18 fix, T34 review, T20 fix + PW re-run for 38-39.
- 03:4x: Tasks 16-17 fix round DONE @71ac6d8 (account_holds + gateChange on 9 routes, pending_change, started_methods, STRONG_COMBOS explicit, renamed to plan names, attack tests). LEAD DECISIONS: M3 offers stay takeable during a hold; all sessions refused security changes during a hold (intended); Terms ALLOWED during a hold; backup-login hold accepted; spec 6.3 + R42 corrected. Same helper finishing these + main merge, then a FRESH round-2 re-review. 38-39: fold.spec semantic clash fixed locally (alertdialog warning sheet; tests find .x2f-sheet), re-running fold.spec (bk5okyu7w) before commit+push.
- 03:5x: **Tasks 38-39 LANDED** (merge 361762b + fold.spec fix). Landings this session: 36, test hygiene, FU-D, reputation core, 40, 38-39.
- Staff core fix round (lead takeover) DONE @21d1754 (main f13f574 merged) -> round-2 re-review running (review-p4-staff-core-round2-2026-10-30.md); news tripwire narrowed (check). Lead running (6): P7, T18 fix, T20 fix, T34 review, 16-17 finish, staff r2.
- Task 34 review = CHANGES REQUIRED (I1 SECURITY payment instructions unsigned -> instructionsSha256 in AttestedTerms.deal; I2 refuse multi-tier until Task 35; M1-M7; M6 no grandfathering). Sent to claude2 as (AA2) after X3/BB2/W2. Task 34 lands LAST of the current batch (breaks 9, 9-view, 10, 17, 18, 20 tests; it absorbs the fixes). Lead running (5): P7, T18 fix, T20 fix, 16-17 finish, staff r2.
- 04:0x: Tasks 16-17 finished @b9b3ca6 (contains main 5c4d35b; login-name held change stores tag only after FU-D merge) -> FRESH round-2 re-review running (review-task16-17-round2-2026-10-30.md). Task 42 member-escrow-keys DESIGN doc helper running (wip/lead-docs-task42-design). Lead running (6): P7, T18 fix, T20 fix, staff r2, T1617 r2, T42 design.
- Task 42 design DONE @d5484d3 (option A: owner-signed per-member-device delegation checked by moderation + encrypted owner copy for takeover; B only above limits; build 42a/b/c ~3k lines). Owner q14 a-i added. Needs a docs review before any build; members still can't take.
- Plan 7 Tasks 1-4 BUILT @7b6ac65 (+ resolution branch wip/lead-p7-retention-t20 @58c2d89 with Task 20). Builder resumed: merge main 5c4d35b + apply Task 38 seams; LEAD DECISION purge job gated by X2F_TRADE_PURGE (default off) until ledger/stats/Plan 5 record first. Then fresh review. Owner q15 = 14-day backups.

## 0. RESUME HERE (2026-10-30 01:05; workers PAUSED 01:07 for the clear: say "go" in their logs, or type into their panes, to start them)
- Paused cleanly 01:07: nothing lost. New pushed heads: FU-D wip/second-p2-fud @ae3ae9e (review doc committed), Task 34 wip/second-p3-task34 @f7e0d1e (WIP committed, migration already renumbered to 117). claude3 found its C1/C2 branches local-only at 414e722, and C3 Task 20 has 4 merge conflicts to resolve by hand (retentionJobs.ts, schema.test.ts, quote-tripwires.test.ts, coordination.md); M5 was already done. WSL memory raised to 6 GB (needs the wsl --shutdown the owner is doing).
- **FIRST after the restart:** the owner will NOT clear claude2/claude3; you do it. For each of x2f-claude2 and x2f-claude3: check the pane is idle (`tmux capture-pane -p -t <pane> | tail -20`), send `/clear` + Enter, wait a few seconds, then type the pointer: claude2 → "You are claude2 on X2F (repo ~/x2f). Your window was just cleared. Read ~/x2f-comms/helper-common.md, then the newest lines of ~/x2f-comms/to-second.log: that queue is now GO. Report only to the lead in ~/x2f-comms/to-lead.log and keep a watcher on to-second.log." claude3 → same with LETTER-TO-THIRD.md + to-third.log. Also append "lead: GO" lines to both logs. Then start your own section 3 helpers.
1. **Main line is 414e722** on `origin/claude/compassionate-johnson-k95ssr`, clean; `~/x2f` has nothing uncommitted.
2. **All of your own helper agents are dead** (usage limit 10-29 14:14, then a `wsl --shutdown` reboot
   at ~00:40 10-30). None are addressable. Restart each item in section 3 as a FRESH helper with
   `~/x2f-comms/helper-common.md` + "commit WIP first, push every commit". Every lead worktree is
   clean (no uncommitted work) except the two stale ones in section 6.
3. **claude2 and claude3 were given their queues at 01:05 10-30** (to-second.log / to-third.log, and typed
   into their windows). Expect acks in `to-lead.log`. Arm the watcher (section 2) FIRST.
4. The owner wants **everyone at full speed with many helpers**, limited by memory (section 5).

## 1. What X2F is
Phone-first P2P marketplace for trading Monero (XMR) for fiat with 2-of-3 multisig escrow; X2F never
holds enough keys to move coins; privacy is a right (no ID, no email/phone, no tracking); security
first. Repo `github.com/bamove6969/x2f`. **Main line is `claude/compassionate-johnson-k95ssr`** (not
`main`). `~/x2f` has it under the local name `compassionate-johnson-k95ssr`, so ALWAYS push with
`git push origin HEAD:claude/compassionate-johnson-k95ssr` (a bare `git push origin HEAD` once made a stray branch).
Source of truth: `HANDOFF.md`, spec `docs/superpowers/specs/2026-10-14-x2f-design.md`, plans in
`docs/superpowers/plans/` (Plans 1–7), rules R1–R35+ in `docs/superpowers/rulings-and-lessons.md`,
`docs/coordination.md` (per-task notes, decisions, seams), reviews in `docs/superpowers/reviews/` and
`~/x2f-comms/review-*.md`.

## 2. Team, comms and how to talk to the workers
- **claude2** = bnkxfers@gmail.com, profile `~/.claude-account2`, launcher `claude2`. Code + reviews.
- **claude3** = totalcarerx4u@gmail.com, profile `~/.claude-account3`, launcher `claude3`, **Claude Pro
  plan** (smaller limits than the others: don't overload it). Back online since 10-29 evening.
- Lead → worker: append one dated line to `~/x2f-comms/to-second.log` / `to-third.log`.
  Worker → lead: `~/x2f-comms/to-lead.log`. Timestamps from `date '+%F %T'` only.
- **Direct typing (new 2026-10-30):** all three sessions run in tmux (`x2f-lead`, `x2f-claude2`,
  `x2f-claude3`; see memory `x2f-ghostty-tmux-launchers`). If a worker is idle at its prompt (it can't
  see the log without a watcher), wake it by typing into its pane:
  `tmux send-keys -t x2f-claude2 -l 'lead: read the newest lines of ~/x2f-comms/to-second.log and act on them' && tmux send-keys -t x2f-claude2 Enter`
  Check first with `tmux capture-pane -p -t x2f-claude2 | tail -30` that it is idle at `❯` (don't type
  into a busy session mid-answer; keep typed text to short pointers to the log). The owner no longer
  needs to relay anything.
- Watch `to-lead.log` with Monitor as a polling loop (tail -F missed lines before):
  count lines every 15 s with `wc -l`, print new ones (cut to 400 chars). Re-arm every 30 min and
  `tail -n 5` the log each time you re-arm.
- Chain of command: workers report ONLY to the lead; the lead is the owner's single contact.
  Owner updates: short, lead with what's needed from them.
- Status board: https://claude.ai/artifact/3mx5a9ij6MYjQheusWxTqq (local source `~/x2f-comms/x2f-board.html`;
  republish with `url` set to that link). It's stale since 10-29 noon: refresh it once things move.

## 3. Lead's own queue — restart these (all died at the 10-29 14:14 limit)
| # | Item | Branch @ pushed head | Next step |
|---|---|---|---|
| L1 | **Plan 3 Tasks 38–39** cancel rules + warning popups + two-step "I've paid"; fix round of review-task38-39-2026-10-29.md, + owner: buyer may dispute a no-show refund within 48 h | wip/lead-p3-task38 @09164d3 (worktree `lead-p3-t38`, clean). **Owns migration 116_fund_started.sql** | Check what the fix round finished (git log vs the review's list), finish, merge main 414e722, tests, then a fresh re-review by a reviewer who didn't write it |
| L2 | **Plan 3 Task 40** foldables; fix round of review-task40-2026-10-29.md | wip/lead-p3-task40 @a824133 (`lead-p3-t40`) | Same: finish, merge main, test, re-review |
| L3 | **Plan 3 Task 36** My offers; converting its refusals to CantDoThat (Task 21) + round-2 m1–m3 | wip/lead-p3-task36 @a7705f1 (`lead-p3-t36`) | Round 2 was approved apart from the conversion: check copy-lint + tripwires pass, merge main, test, land. Task 34's cap (2 per side per currency + 20) must change in Task 36's bulk count loop too once 34 lands |
| L4 | **Plan 2 Tasks 16–17** new-device approval (013) and the 24-hour hold by login strength (014); REVIEW died. Owner: 2 factors required for "strong", PGP alone waits | wip/lead-p2-task16 @4310226, wip/lead-p2-task17 @747bcbb (17 contains 16; worktree `lead-p2-t16` is on task17) | Fresh review of task17 (covers both), then fix round, then land 16+17 together. Built before Task 21 landed: refusals must move to CantDoThat |
| L5 | **Plan 2 Task 18** team members (owner: launch scope) build, WIP | wip/lead-p2-task18 @4e82877 (`lead-p2-t18`), migration 015 | Resume the build (member logins with own 2FA, Offers/Trades roles, owner-only wallets/members, audit log). Completing trades waits on the member signing-key design (Plan 3 Task 42) |

Then, as slots free (good next lead items): **Plan 7 Tasks 1–4** (retention rule, whole-trade purge,
self-destruct date, Settings → Privacy; no longer blocked: owner answered retention, docs updated in
29/29b/29c) and **Plan 4 Task 23** purges (needs 108's restrict FKs: delete dispute_appeals, then
disputes, see coordination.md). **Plan 3 Task 41** (LoginApprove/Devices/Login-Backup screens) after 16–17 land.
**Plan 3 Task 35** (PostOffer tiers, web) after claude2's Task 34 lands. Plan 3 Task 42 after Task 18.

**Reviews you owe the workers** (start a lead reviewer as each reports; a reviewer must never have written the code):
- claude2 (X2) Task 9 I/O round-2 security fixes → round-3 re-review (security: ring check + one-sweep-per-trade record).
- claude2 (BB) Task 10 fix round → re-review (review-task10-2026-10-29.md).
- claude2 (Z) FU-D fix round → re-review (review-fud-2026-10-29.md).
- claude2 (AA) Task 34 → first review.
- claude2 (W) wip/second-p3-task9-view @fe96aab: READY for review since 10-29 12:13 (never started). Lands after Task 9 I/O.
- claude3 (Y) Task 20 rest fix round → re-review (review-task20rest-2026-10-29.md).
- claude3 Plan 4 Tasks 1–3 and Plan 5 Tasks 1–2 → reviews.

**Landing order (updated 10-30):** DONE 36, 40, 38/39, FU-D, rep core. NEXT: 16+17 → Task 9 I/O → 9-view → Task 10 → Task 20 → 18 → staff core → 34 (last; absorbs breakage) → Plan 7.
Each landing: merge by hand into a landing worktree, then tsc + vitest for api, web AND auth-client
(auth-client once caught a missed route), plus the e2e specs the branch touches; push with the full
ref; one-line note in coordination.md.

## 4. What the workers are doing (queues sent 2026-10-30 01:05)
**claude2** (keep to 3 helpers at once): (X2) Task 9 round-2 security fixes FIRST → (BB) Task 10 fix
round → (Z) FU-D: finish its test runs and report @de3191d+ → (AA) Task 34 flexible offers API: commit
its 11 uncommitted files in `second-t34` first, and **renumber its migration 116_flex_offers.sql to 117**
(116 belongs to Task 38). **(Y) Task 20 moved to claude3**: claude2 must not touch it.
**claude3** (Pro plan; 3 helpers at once max): (C1) Plan 4 Tasks 1–3, the `@x2f/staff` core package
(roles/permissions/login hours/key-tap intents; dispute state machine with the 10-29 revisions:
48 h appeals, liens, ban stages, 48 h dispute SLA; hash-chained activity log, migration 201) on
`wip/third-p4-staff-core`; (C2) Plan 5 Tasks 1–2, `@x2f/reputation` (review rules + stats maths with the
permanent-reviews revision, Task 20; badges) on `wip/third-p5-reputation-core`; (C3) took over (Y) Task 20
rest fix round on `wip/second-p3-task20-rest` from @5902d94 in a NEW worktree `third-t20rest`
(claude2's old `second-t20rest` stays untouched): review-task20rest-2026-10-29.md + the lead's
2026-10-29 13:27 block note in to-second.log + merge main 414e722.
If a worker goes silent > 45 min: capture its pane (section 2), nudge it, and check for 429s.

## 5. Machine, memory and tools
- **Memory is the real cap.** Windows has 7.7 GB; WSL gets 6 GB from 2026-10-30 (`C:\Users\flem\.wslconfig memory=`,
  8 GB swap). On 10-29 the machine hit out-of-memory (exit 137) and killed sessions. Rule: helper
  agents are cheap, **test runs are not**: one test command at a time machine-wide under
  `flock ~/x2f-comms/check.lock`; never full Playwright alongside full vitest. Budget: lead ≤ 4 helpers,
  claude2 ≤ 3, claude3 ≤ 3 (at 6 GB you may raise each by 1 if `free -m` stays above ~1.5 GB available). `free -m` before starting more.
- **Node and npm:** Node 24.22.1 (`export NVM_DIR=$HOME/.nvm; . $NVM_DIR/nvm.sh`); npm via `npx -y npm@11.21.0`.
- **Other tools:**
  - Docker: `sg docker -c '…'` if permission is denied.
  - Semgrep: `~/.local/semgrep-venv`.
  - Chromium: `/usr/bin/chromium` (`X2F_CHROMIUM_PATH`).
  - tmux 3.5a. There's no jq: use python3.
- **Locks:** targeted tests `flock ~/x2f-comms/check.lock <cmd>`; full check `~/x2f-comms/run-check.sh <log>`. Never nest flock.
- **Commits:** `git -c user.name=flem -c user.email=bamove@gmail.com commit`. There's no global identity. Messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. R30: push every commit.
- **Worktrees** live in `~/x2f-worktrees/`. Run `npm ci` after a merge that changes the lockfile.
- **Branch deletes:** remote deletes are blocked; the owner does them.
- **Every helper gets `~/x2f-comms/helper-common.md`** (toolchain, locks, git rules, memory rule, report format).
- Owner rule: max 8 lead helpers ever; stop finished helpers that linger (TaskStop).

## 6. Housekeeping
- Stale MID-MERGE worktrees `lead-t29` (93 files) and `p3-task28` (46 files) hold superseded half-merges
  of tasks already landed (29 and 28 are on the main line). Don't use them; `git merge --abort` and
  `git worktree remove` when convenient.
- `second-fud` has one untracked file (its review notes doc): claude2's to commit.
- Many old landed worktrees under `~/x2f-worktrees/` can be removed to save disk; low priority.
- ListAgents showed a second idle peer "x2f-b5" in tmux `x2f-lead` at 01:00; only 3 `claude -c`
  processes run (lead, claude2, claude3), so it's this lead seen twice. Ignore unless it acts.

## 7. Migration numbers (checked across every branch 2026-10-30)
api 001–012 main; **013 device approval, 014 cooling off (Tasks 16–17), 015 team members (Task 18)**;
101–113 main; **114 free**; 115 news (main); **116 fund_started (Task 38)**; **117 = Task 34 flex offers (assigned)**;
2xx = Plan 4 (201 activity log … 208 training, per Plan 4); 3xx = Plan 5 (306 feedback on main; 301–305 named in Plan 5);
moderation 001–004 (004 signals, Task 10). Before picking a new number, check every wip branch.

## 8. Owner questions
Open list (the ONLY list): `~/x2f-comms/owner-questions-open-2026-10-29.md`. Items 1–4 answered; still open:
5 forgot to clock out (pay to last activity? [yes]); 6 ordinary moderators' per-dispute pay [owner's call];
7 separate payroll wallet [yes]; 8 no fee on repayment trades [no fee]; 9 team-member fee flat 1.15% or tiered [flat];
10 "Disputes: N won, M lost" on profiles [yes]. Lawyer items: `~/x2f-comms/lawyer-questions.md` (canary, I2P research).
All answers so far: `owner-answers-2026-10-28.md` (incl. bottom sections) and `owner-answers-2026-10-29-lead-calls.md`.
Write new answers into spec/plans via a docs branch + docs review before builders rely on them.

**Lead decisions taken without the owner** (tell them if asked): trades with null addresses wait (Task 8); Terms may be accepted during a 24 h hold; offers stay takeable during a hold (10-30); 48 h refund-dispute window for all buyer-disputable refunds (10-30, q11); reviews store weight only, never amounts (10-30); Trusted needs >= 5 reviews provisional (q12); 24 h unconfirmed cancel-refund escalates to a moderator (10-30);
`trade-closed` returns the runtime to `idle`; Task 23's `paidRecorded` + Task 12 `intentKind`; `.x2f-method-name`
is 44px; PHONE_VIEWPORTS is the single phone-size standard; Task 27 owns the buyer's `refunded` slot;
Task 10 I2 = escalate to a person when the final-alert receipt is > 2 min late; buyer cancel = option B
(owner chose); the 10-29 calls in `owner-answers-2026-10-29-lead-calls.md`.

## 9. Design
Claude Design owns ALL aesthetics (owner). Builders do logic with existing UI-kit parts and a local
NEEDS_DESIGN_* tripwire until boards land. Brief sent to the owner: `~/x2f-comms/design-brief-2026-10-29.md`.

## 10. Dated chores
- **On or after 2026-11-01:** re-fetch FIDO MDS (expect serial > 291), `npm run refresh -w @x2f/fido-mds`, update
  the README's serial, date and SHA (the API logs a harmless stale-snapshot warning from 11-01 until then).
- **2026-11-02:** fast-uri override 3.1.9 / 4.2.3 (R33).
- **2026-11-05:** serialize-javascript 7.1.3 (R33).
- happy-dom GHSA-834v-8h66-3h79: bump when a fixed version is 14 days old.

## 11. Lessons (keep)
- Every branch needs a real review; most come back CHANGES REQUIRED. Re-review every fix round with a
  reviewer who didn't write it.
- Semantic merge clashes don't show as conflicts (renames broke FIDO's test and Task 27's parser).
  After every main-line merge: tsc + vitest for api, web and auth-client.
- Branches built before Task 21 landed must move their refusals into CantDoThat (copy-lint + tripwires catch it).
- Agents die at limits, network drops (EAI_AGAIN) and out-of-memory: brief them to commit WIP early and push every commit.
- A worker's watcher dies with its session: after any restart, a worker is idle until poked (section 2).
- Run `git fsck` early after a crash; repair from origin.
- Tripwires check the local tree only; no deliberately red test on the main line.
- If the desktop shortcuts or Ghostty break: memory `x2f-ghostty-tmux-launchers`.
