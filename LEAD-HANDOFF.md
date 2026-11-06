# Lead handoff — X2F (rewritten 2026-10-30 06:25, before a screen clear)

You are the **lead** Claude session for X2F, running in `~/x2f` on the owner's account
(bamove@gmail.com, profile `~/.claude`, launcher `lead`). You plan, assign, review, merge and are
the owner's single point of contact. Read this file top to bottom, then act. MEMORY.md loads itself.
Older versions: `LEAD-HANDOFF.2026-10-30-0620.bak.md` (the running notes of 10-30 01:00–04:30) and
`LEAD-HANDOFF.2026-10-29.bak.md`. History only; everything live is copied here.

## 0. RESUME HERE (2026-10-30 06:25)
- **What happened:** big night. 6 landings (below). Then at ~04:30–05:35 a network drop (EAI_AGAIN) killed
  ALL lead helpers mid-work, and both workers had hit their 5-hour limits (reset 05:30). Nothing was lost:
  every lead worktree is clean and pushed (checked 06:16).
- **Workers were restarted by the previous lead at ~06:25** (cleared, pointed at their handoff files, told GO).
  Check `to-lead.log` for their acks. If silent > 15 min, capture their panes (section 2) and nudge.
- **06:30 update:** both workers acked their RESUME sections (claude3 06:20: C4 + C5 helpers running; claude2 06:21: reported X3 @7346fc0, then BB2/W2/AA2). The owner then cleared both windows; the lead re-sent pointers ('check running helpers first, no duplicates'). Verify in `to-lead.log` that both re-acked and that claude3 did NOT start duplicate C4/C5 helpers (capture its pane).
- **06:35 (new lead session):** owner said "take control, lots of spawns". Lead helpers running (6): round-2 security review 16-17 → review-task16-17-round2; round-4 review Task 9 I/O @7346fc0 → review-task9io-round4; round-2 review staff core → review-p4-staff-core-round2; Task 20 full checks (lead-t20fix); Task 18 full checks (lead-p2-t18); Plan 7 finish tests (lead-p7-retention). New worker items: claude2 (DD) docs branch wip/second-docs-1030-answers (4th helper); claude3 (C6) Plan 5 Task 4 platform feedback wip/third-p5-feedback, mig 302. Board refreshed (v9). Watcher armed 06:24.
- **06:40:** the owner works in plain (non-tmux) windows for lead, claude2 and claude3. At the owner's request the lead KILLED the tmux sessions x2f-lead/x2f-claude2/x2f-claude3 (their helpers died mid-work; uncommitted WIP left on disk, listed in takeover-state-*.txt and the 06:40 lines of to-second/to-third.log). There is NO tmux now: tmux send-keys can't reach the workers; talk only through to-*.log, and the owner pastes restart pointers.
- **06:55:** Task 9 I/O APPROVED (round 4) → landing helper running. Task 20 APPROVED WITH MINOR (n1 fix helper). Staff core APPROVED WITH MINOR (N1-N4 fix helper). Task 18 green @6d6b8c8, claude2 reviewing (FF). Tasks 16-17 round 2 = CHANGES REQUIRED (1 Critical password-alone takeover + 4 I) → fix helper; lead decision: PGP-alone wallet add waits (owner's 14:12 ruling). Task 42 design revised @827c03c, q14 reworded (+j 72 h), claude2 round-2 review queued. Plan 7 @83fd652 first review running. Board v10.
- **08:00 OWNER HOLD on Tasks 9 I/O, 9-view, 10 (the watcher)**: owner finds the watcher idea "weird", wants to understand it before it lands; lead owes a clear explainer. All three are APPROVED (9 I/O round 4, 9-view verified @99ba09f, 10 round 4 @305124b). The prepared landing (merge + docs + 2 clash fixes, head 36e728a) is saved as wip/lead-land-t9io-held; ~/x2f local main reset to origin 5c4d35b. NOTE: wip/lead-p2-task17 contains that held merge (5193e11): before landing 16-17 ahead of 9, revert it (git revert -m 1 5193e11) or rebuild. New owner rules: surplus stays in escrow (automatic payouts pay set amounts only); network-fee choice A/B pending.
- **08:15 owner asleep.** OWNER RULE: no important calls without the owner (memory feedback-no-important-calls). Questions compiled (25 items): owner-questions-2026-10-30-morning.md; watcher explainer: watcher-explainer-2026-10-30.md. Ready to land, waiting on the owner's go: Task 20 @23c8104, Task 18 @6d6b8c8 (claude2 round-2 APPROVED WITH MINOR, 4 minors not yet sent), staff core @bfe1d9e, Plan 5 Task 4 feedback @db874b9. Running: 16-17 round-4 fix (class audit), claude2 Plan 7 round-2 tripwires, first reviews of C4 (Plan 5 Task 3 @558ff2b) and C5 (Task 7 @1489e79). Board v11.
- **08:35:** Tasks 16-17 APPROVED (round 5) + minors done @2a81522 (Task 9 merge reverted in a55abfc; api fully green 1327). READY TO LAND with owner's go, alongside Task 20 @23c8104, Task 18 @6d6b8c8 (+4 minors from claude2's FF review still to apply), staff @bfe1d9e, P5 Task 4 @db874b9, P5 Task 3 @2c5c294 (after owner items 26-28, 31). P5 Task 7 round-4 review running. Plan 7 round-2 fixes with claude2. Owner list now 34 items.
- **10:00:** workers silent since ~08:34 (limits?); lead TOOK OVER claude2's Plan 7 round 2 and claude3's C5 proof round 4 (logged in their to-*.log). Now: Plan 7 APPROVED (round 3) @24c7489, minors helper running; P5 Task 7 proof APPROVED (round 5), minors done @fb1af66 — READY. Task 18 minors done @0765d18 — READY. Owner list now 42 items (owner-questions-2026-10-30-morning.md). Ready to land on owner's go: 16-17 @2a81522, 20 @23c8104, 18 @0765d18, staff @bfe1d9e, P5 T4 @db874b9, P5 T3 @2c5c294 (after items 26-28/31), P5 T7 @fb1af66 (after items 29/30/34-37), Plan 7 (after minors + item 42). Held: Task 9 I/O, 9-view, 10 (watcher). Task 34 last.
- **11:30 (usage limit hit):** MAIN LINE = 3635fac: Tasks 16-17 (6a5dcc9) and Task 20 (ed6389e + clash fix 3635fac) LANDED. Task 18 landing STOPPED: resolved merge saved on wip/landing-p2-task18 @0365ed7; needs OWNER security call: team write routes (POST /v1/team/invites, PATCH/DELETE /v1/team/members/:id) during a 24 h hold — lead recommends refuse invite + role change during a hold, allow removal, all three re-check live session; plus replace tripwire NEEDS_TASKS_16_17_MEMBERS with member tests (member sessions count to device limit, never approve logins, count as strong). Then land Task 18, staff core @bfe1d9e, P5 Task 4 @db874b9. Owner answers today: owner-answers-2026-10-30-lead-window.md (compromised ticket = full lockout + Matrix/Tor Jabber; 2FA skips wait; fee option B; blurring = safety net; watcher doubted, stays held). Owner asked: how often do we update Claude Design with what's built? (answer pending: propose a screenshot pack after each landing batch). Workers silent since ~08:34.
- **31 Oct 00:xx, owner on a break.** Task 18 landing branch wip/landing-p2-task18 @fd894b6: security review CHANGES REQUIRED (review-task18-landing-2026-10-30.md): I1 weak session can invite self as member → owner items 47 (fix choice) + 48 (removal during hold; owner asked which hold / what triggers it). M1 (member first session strength 'strong'), M2, N1 technical. Do NOT land Task 18 / staff / feedback until 47-48 answered. Strong-login list (passkey alone?) still unanswered. Workers stalled again (claude2 since 11:17, claude3 no progress on C7 envelope).
- **31 Oct ~02:00:** Recovery-code rules (owner 30-31 Oct) built on wip/lead-p2-recovery-rules @03114fa: round-2 review APPROVED, minors m1-m4 fixed, all green. Migration 016 (Task 18 = 015, land 18 first). Waits on owner items 49-61 and a Claude Design "Block queued change" screen (don't ship the queue without it). Open nit: purged expired sessions drop queued rows without an alert (coordination.md).
- **FIRST, as lead:** arm the to-lead.log watcher (section 2), then restart YOUR queue in section 3 with fresh
  helpers (`~/x2f-comms/helper-common.md` + "commit WIP first, push every commit"). Max 8 helpers (owner rule);
  `free -m` first (3.8 GB available at 06:16).
- **Main line = 5c4d35b** on `origin/claude/compassionate-johnson-k95ssr`; `~/x2f` is clean at it.
- **Landed 2026-10-30 (in order):** d48033f Task 36 My offers; 27e96df test hygiene (profiles viewerId,
  schema race, view fee, attestation-flow); da2d3c9 FU-D login names as keyed tags (mig 012); 41acc5c Plan 5
  Tasks 1-2 @x2f/reputation core; f13f574 Task 40 foldables; 361762b+5c4d35b Tasks 38-39 cancel rules, warning
  sheets (role alertdialog), two-step I've paid, 48 h refund disputes (mig 116) + a fold.spec fix.
- **Owner was asleep from ~04:30.** Open owner questions are q5–q15 in `owner-questions-open-2026-10-29.md`
  (each has a lead default in brackets). Ask them in one short message when they're back; "defaults OK" is
  a valid answer.

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
- **claude2** = bnkxfers@gmail.com, profile `~/.claude-account2`, launcher `claude2`. Code + reviews. Max 3 helpers.
  Its handoff: `~/x2f-comms/HANDOFF-SECOND.md` (rewritten by the lead; it keeps an Update log at the bottom).
- **claude3** = totalcarerx4u@gmail.com, profile `~/.claude-account3`, launcher `claude3`, **Pro plan** (smaller
  limits; ≤ 2–3 helpers). Its handoff: `~/x2f-comms/LETTER-TO-THIRD.md` (+ its Update log at the bottom).
- Lead → worker: append one dated line to `~/x2f-comms/to-second.log` / `to-third.log`.
  Worker → lead: `~/x2f-comms/to-lead.log`. Timestamps from `date '+%F %T'` only.
- **Direct typing:** all three sessions run in tmux (`x2f-lead`, `x2f-claude2`, `x2f-claude3`). Check a worker
  is idle first: `tmux capture-pane -p -t x2f-claude2 | tail -30` (idle = empty `❯` prompt, no "esc to interrupt").
  Then: `tmux send-keys -t x2f-claude2 -l '<short pointer>' ; sleep 0.5; tmux send-keys -t x2f-claude2 Enter`.
  To clear a worker: send `/clear` + Enter, wait ~4 s, then type the pointer. **The owner never needs to paste
  anything:** the lead does all of this.
- **Restart pointer for a cleared worker** (what the lead typed at 06:25):
  claude2 → "You are claude2 on X2F (repo ~/x2f). Your window was just cleared. Read ~/x2f-comms/helper-common.md and ~/x2f-comms/HANDOFF-SECOND.md in full (esp. the 'RESUME 2026-10-30 06:25' section), then the newest lines of ~/x2f-comms/to-second.log. Act on them now. Report only to the lead in ~/x2f-comms/to-lead.log and keep a watcher on to-second.log."
  claude3 → same with LETTER-TO-THIRD.md ('RESUME 2026-10-30 06:25' section) + to-third.log.
- **Watcher:** Monitor polling loop on `to-lead.log` (count lines every 15 s with `wc -l`, print new ones cut to
  400 chars). It expires every 30 min: re-arm it and `tail -n 5` the log each time.
- Chain of command: workers report ONLY to the lead; the lead is the owner's single contact. Owner updates:
  short, lead with what's needed from them.
- Status board: https://claude.ai/artifact/3mx5a9ij6MYjQheusWxTqq (source `~/x2f-comms/x2f-board.html`); stale
  since 10-29 noon. The artifacts connector was failing at 06:20; refresh it when it works (low priority).

## 3. Lead's own queue (restart these; all helpers died in the 04:30–05:35 network drop)
| # | Item | Branch @ pushed head (worktree) | State and next step |
|---|---|---|---|
| L-1617 | **Plan 2 Tasks 16–17** device approval (013) + 24 h recovery hold (014) | `wip/lead-p2-task17` @b9b3ca6 (`lead-p2-t16`) | Fix round DONE (contains main 5c4d35b). Its **round-2 re-review died** before writing anything: start a FRESH security reviewer → `review-task16-17-round2-2026-10-30.md`. Brief: round-1 review `review-task16-17-2026-10-30.md` (C1/C2 takeover), the fix design (account_holds, gateChange on 9 routes, pending_change, started_methods, STRONG_COMBOS = owner 14:12 list, FINISH_OPEN_TRADES), lead decisions (M3 offers stay takeable during a hold; all sessions refused security changes during a hold; Terms ALLOWED during a hold; backup login starts the hold once), and LOOK HARD at the FU-D merge redesign of the login-name route (held change stores only {tag,keyId}; gap: same string as a display name during the hold). Then land. |
| L-staff | **Plan 4 Tasks 1–3** `@x2f/staff` + activity log (mig 201) — TAKEN OVER from claude3 | `wip/third-p4-staff-core` @21d1754 (`lead-p4-staff-fix`) | Fix round DONE (contains f13f574). Its **round-2 re-review died**: start a FRESH reviewer → `review-p4-staff-core-round2-2026-10-30.md` (round-1: `review-p4-staff-core-2026-10-30.md`; check the narrowed news tripwire NEEDS_PLAN4_STAFF_API and the 4 conservative calls the lead accepted). Merge main 5c4d35b at landing. |
| L-18 | **Plan 2 Task 18** team members (mig 015 + 199) | `wip/lead-p2-task18` @2a08210 (`lead-p2-t18`) | Fix round + e2e team.spec DONE and main 5c4d35b merged; the helper died after "API full green", before web + auth-client full runs. Next: run tsc + full web + auth-client vitest + Playwright team.spec (from apps/web: `-c e2e/playwright.config.ts --workers=1`), then a FRESH round-2 re-review (round-1 `review-task18-2026-10-30.md`; lead decision I2 = members can't take until Task 42). |
| L-20 | **Plan 3 Task 20 rest** (chat) — TAKEN OVER from claude3 | `wip/second-p3-task20-rest` @38bbb6c (`lead-t20fix`) | Round-2 fixes (I1 real chat in e2e, I2 wide-layout Chat, m1–m6) in 204780f + main 5c4d35b merged; helper died before re-running tests. Next: tsc + full vitest api/web/auth-client + Playwright chat, fold, dispute-room, refund, release; then a FRESH round-3 re-review of 204780f (round-2 review `review-task20rest-round2-2026-10-30.md`). Plan 7 seam: keep purgeChatsJob before purgeFeedbackForm and purgeTradesJob. |
| L-P7 | **Plan 7 Tasks 1–4** retention rule, whole-trade purge (mig 701), self-destruct date, Settings → Privacy | `wip/lead-p7-retention` @cbb29ac (`lead-p7-retention`); resolution-with-Task-20 branch `wip/lead-p7-retention-t20` @58c2d89 (stale: pre-5c4d35b) | cbb29ac merged main 5c4d35b, applied the Task 38 seams and added **X2F_TRADE_PURGE (default off)** (lead decision: no real purge until Plan 4 Task 32 ledger, Task 14 stats and Plan 5 reviews/proofs record a trade first). Helper died while writing the config/gate/awaiting tests ("Now tests: config test, job gate test, Task 38 awaiting test; retire the tripwire; docs"): finish those, run checks, then a FIRST review. Owed: purge of moderation's per-trade keystore rows. |
| L-42 | **Plan 3 Task 42 design** (member escrow keys) | `wip/lead-docs-task42-design` @d5484d3 (docs) | DONE (option A: owner-signed per-member-device delegation checked by the moderation service; encrypted owner copy for takeover; B only above limits; build 42a/b/c ~3k lines). Waits on owner q14 a–i, then a docs review, then the build. Members stay unable to take (Task 18 tripwire). |

**Reviews the lead owes the workers (start as each reports):**
- claude2 (X3) **Task 9 I/O round-3 fixes** @7346fc0 (both-parties rule R3-I1 + docs + main f13f574): DONE but NOT
  reported before claude2's limit. Start a FRESH round-4 security reviewer now (round-3 review
  `review-task9io-round3-2026-10-30.md`; check 86dade7 + 6c35f63 red tests; R3-M1 recorded owed as a mainnet prerequisite).
- claude2 (BB2) Task 10 round-2 fixes: in progress (see section 4) → round-3 review when reported.
- claude2 (W2) Task 9-view minors: lead lands without re-review if they match `review-task9view-2026-10-30.md`.
- claude2 (AA2) Task 34 fix round → round-2 review (I1 instructionsSha256 in AttestedTerms.deal is SECURITY).
- claude3 (C4) Plan 5 Task 3 reviews API, (C5) Plan 5 Task 7 @x2f/proof → first reviews.

**Landing order (updated 10-30 06:25):** 16+17 → Task 9 I/O → 9-view → Task 10 → Task 20 → 18 → staff core →
Plan 7 → Task 34 (LAST: it breaks tests on 9/9-view/10/17/18/20; it absorbs the fixes). Each landing: merge by
hand in `~/x2f` (main checkout, clean), then tsc + vitest api, web, auth-client (+ trade/moderation/staff if
touched) with REAL exit codes (never pipe vitest into tail inside `&&`), plus Playwright for touched specs
(**from apps/web with `-c e2e/playwright.config.ts --workers=1`, X2F_CHROMIUM_PATH=/usr/bin/chromium**), push
`git push origin HEAD:claude/compassionate-johnson-k95ssr`, one line to both worker logs.

**Next lead items when slots free:** Plan 3 Task 41 (LoginApprove/Devices/Login-Backup screens) after 16–17 land;
Plan 3 Task 35 (PostOffer tiers, web) after Task 34 lands (must use the tier max for multi-tier quotes and check
instructionsSha256); a docs branch to write the 10-30 owner answers + lead decisions into spec/plans; Plan 4
Task 23 purges = Plan 7's purgeTrades job (coordinate, don't duplicate).

## 4. What the workers are doing (restarted 06:25)
**claude2** (queue in HANDOFF-SECOND.md 'RESUME 2026-10-30 06:25'):
1. (X3) Task 9 I/O round 3 — DONE @7346fc0; it only has to REPORT it.
2. (BB2) Task 10 round-2 fixes on `wip/second-p3-task10` @481da0e (N1 done). Worktree `second-t10` has 3
   UNCOMMITTED files (moderation buyerCancel.ts, desk.ts, watcher.ts = N2 / shadow veto WIP): commit + push first.
   Left: N2 every-pass re-check, N3 deploy note, N4 distinct log reason, NTP note, shadow veto of 3 sweep kinds,
   merge task9-io 7346fc0 + main 5c4d35b. Review: `review-task10-round2-2026-10-30.md`.
3. (W2) Task 9-view minors M1–M5 (M5 = releaseClaimedAt null outside settling) + merge onto task9-io 7346fc0
   (`review-task9view-2026-10-30.md`).
4. (AA2) Task 34 fix round on `wip/second-p3-task34` @6056e26 (`review-task34-2026-10-30.md`): I1 instructionsSha256
   in AttestedTerms.deal; I2 refuse multi-tier until Task 35 + {minTrades}; M1–M7; M6 no grandfathering.
**claude3** (queue in LETTER-TO-THIRD.md 'RESUME 2026-10-30 06:25'): (C4) Plan 5 Task 3 reviews API
(`wip/third-p5-reviews-api`, worktree third-p5-reviews; weight only, MIN_REVIEWS_TRUSTED=5 provisional, blind
reveal 5.3) and (C5) Plan 5 Task 7 `@x2f/proof` core (`wip/third-p5-proof-core`, worktree third-p5-proof). Neither
started yet. C1 (staff) and C3 (Task 20) belong to the LEAD now: claude3 must not touch them.
If a worker goes silent > 45 min: capture its pane, nudge it, check for 429s/limits.

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

## 7. Migration numbers (2026-10-30 06:25)
api: 001–012 main (012 = FU-D login tags, landed); **013 device approval, 014 account hold (Tasks 16–17, wip)**;
**015 team members + 199 (Task 18, wip)**; 101–113 main; 114 free; 115 news (main); 116 fund_started (main, Task 38);
**117 flex offers (Task 34, wip)**; **201 activity log (Plan 4 staff core, wip)**; 2xx rest = Plan 4; 3xx = Plan 5
(306 on main; claude3's C4 picks from Plan 5's names); **701 retention (Plan 7, wip)**. moderation: 001, 003,
004_signals (Task 10), 005_sweeps (Task 9). Before picking a new number, check every wip branch.

## 8. Owner questions
Open list (the ONLY list): `~/x2f-comms/owner-questions-open-2026-10-29.md`. Items 1–4 answered; still open (q11–q15 added 10-30: 48 h refund-dispute window for all refunds; Trusted needs ≥ 5 reviews; Task 18 member defaults incl. members can't take until Task 42; Task 42 a–i; 14-day backups):
5 forgot to clock out (pay to last activity? [yes]); 6 ordinary moderators' per-dispute pay [owner's call];
7 separate payroll wallet [yes]; 8 no fee on repayment trades [no fee]; 9 team-member fee flat 1.15% or tiered [flat];
10 "Disputes: N won, M lost" on profiles [yes]. Lawyer items: `~/x2f-comms/lawyer-questions.md` (canary, I2P research).
All answers so far: `owner-answers-2026-10-28.md` (incl. bottom sections) and `owner-answers-2026-10-29-lead-calls.md`.
Write new answers into spec/plans via a docs branch + docs review before builders rely on them.

**Lead decisions taken without the owner** (tell them if asked): trades with null addresses wait (Task 8); Terms may be accepted during a 24 h hold; offers stay takeable during a hold (10-30); 48 h refund-dispute window for all buyer-disputable refunds (10-30, q11); reviews store weight only, never amounts (10-30); Trusted needs >= 5 reviews provisional (q12); 24 h unconfirmed cancel-refund escalates to a moderator (10-30);
`trade-closed` returns the runtime to `idle`; Task 23's `paidRecorded` + Task 12 `intentKind`; `.x2f-method-name`
is 44px; PHONE_VIEWPORTS is the single phone-size standard; Task 27 owns the buyer's `refunded` slot;
Task 10 I2 = escalate to a person when the final-alert receipt is > 2 min late; buyer cancel = option B
(owner chose); 10-30: 48 h refund-dispute window for all buyer-disputable refunds (q11); 24 h unconfirmed cancel-refund escalates to a moderator (skips outages/maintenance/pauses); reviews store a weight only, never amounts; Trusted needs ≥ 5 reviews (provisional, q12); no grandfathering over the new offer cap; Task 10: no buyer-cancel co-sign after an escalation, deploy the API first, NTP on both hosts; Task 9 R3-I1 both-parties rule (closes R2-M1; R3-M1 owed to Plan 4 as a mainnet prerequisite); Task 18 members can't take until Task 42; Tasks 16–17: offers stay takeable during a hold, Terms allowed during a hold, every session refused security changes during a hold; Plan 7 purge behind X2F_TRADE_PURGE (default off); staff core: assignee role always from the DB; the 10-29 calls in `owner-answers-2026-10-29-lead-calls.md`.

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
- (10-30) Never pipe vitest into `tail` inside an `&&` chain: it hides the exit code. Write to a log, then grep.
- (10-30) Playwright: run from `apps/web` with `-c e2e/playwright.config.ts` or it can't find a browser.
- (10-30) Landing two approved branches can still clash semantically (Task 38's alertdialog broke Task 40's
  fold tests): always run the Playwright specs BOTH branches touch on the merged tree.
- (10-30) When a worker hits a limit, take over its in-flight fix rounds with lead helpers (commit its WIP first,
  log the takeover in its to-*.log so it doesn't redo them) and give it fresh work for when it resumes.
- (10-30) A network drop (EAI_AGAIN) kills every helper at once: brief helpers to push WIP at each step.

- 1 Nov 11:22: Plan 2 Task 18 team members LANDED as main 9b26423 (landing round 3 APPROVED WITH MINOR; review-task18-landing-round3-2026-11-01.md). Removal during hold refused + TODO until recovery-rules hold_changes lands. Owner 1 Nov decisions + login-strength table in owner-answers-2026-10-30-lead-window.md and x2f-login-strength.html (artifact 9J57ypxmiJXQUdsJTxLKhT). claude2 weekly limit until 1 pm. claude3: C7 envelope + C8 smart check approved (land with proof core after items 29-30,34-37); C9 Plan 5 Task 10 past rep in progress. Next: land staff core then feedback.
- 1 Nov 11:57: OWNER: "slow down on making claims on your own and bring them to me; finish everything we started, then move forward." No new tasks to anyone until started work is landed or parked by the owner. Lead's 1 Nov calls listed for the owner to rule on.
- 1 Nov 13:08: Staff core (Plan 4 T1-3) LANDED as main 52b7a0e. Feedback landing branch ready at wip/landing-p5-feedback @fa5542b (on staff landing; feedback.read perm owner-only, NAV 'feedback' before 'settings' = small default) but HELD: owner said NO feedback cap (code has FEEDBACK_GLOBAL_DAILY=5000) and item 10 (week vs day) + feedback-vs-reviews confusion pending. One flaky web test (attestation-flow buyerCancel) seen once under load.
- 1 Nov 19:49: Lead session was unreachable ~17:22 PT 1 Nov; the owner then decided many things DIRECTLY with the design session ("Continuation", cloud). Owner note via design: those decisions OVERRULE earlier ones. Record: wip/design-brief docs/OWNER-NOTE-2026-11-02-design-decisions-overrule.md + docs/design-hold-model-2026-11-02.md (latest a30e076). Highlights: Trader vs Vendor account types (vendor = switch, needs passkey/security key/PGP; only vendors post offers, have team members, pay 1% fee); granular per-member permissions with presets; no auto-accept ever; members don't count toward lead's 3 devices; lead approves member first logins; ban list = usernames, PGP fingerprints, Jabber accounts; session length chosen at every login (traders 2/4/6/12 h, vendors 2/6/12/24 h), extend at expiry with any login method, no absolute max; sensitive actions need passkey/security key/PGP (TOTP not enough); --team blue token. Owner requests pending lead+owner OK: update GitHub main (stale at ed96147) to main line; uninstall SonarQube Cloud GitHub app + run SonarQube Community locally. Build requests from design (device screens rebuild, review top 10) wait for owner go.
- 1 Nov 20:36: Owner via design (proofs): an encrypted UNBLURRED copy of every uploaded proof is kept automatically (moderator-only, openable only when a dispute exists; matches Plan 5 Task 8's mod-only proof.unblurred envelope). Deleted 48 h after trade end if no dispute; with a dispute, when the ruling's 48 h appeal window closes. Traders ARE told ("We should be honest"); line: "We keep an encrypted unblurred copy that only a moderator can open, and only if there's a dispute. It's deleted automatically when the trade is over." Same in privacy text and Terms. Blur-template DB (layouts only, private areas blanked, no real proofs); design recommends also blanking code/amount/time (owner OK pending). For the docs pass + Plan 5 Tasks 13-15 + Plan 7.
- 1 Nov 20:39: SonarQube Cloud GitHub app UNINSTALLED by the owner. Local SonarQube only (127.0.0.1:9000, tools/sonar-scan.sh).
- 1 Nov 21:13: Owner via design (hold model v3): a password-only CHANGE no longer logs anyone out or pauses trades; only the changes wait 24 h (banner "N changes take effect on <date>" + Review; anyone logged in can cancel them; ending early with pre-existing passkey/key/PGP discards them; owner notified on all channels). RECOVERY-CODE login still logs everyone out and pauses/cancels trades: unfunded cancelled; funded paused, partner told "<name>'s account has a temporary problem" (never hold/security/vendor); sold-waiting-fiat: ask if held account paid, if not cancel+refund. My offers "Paused · trading hold" = moderator trading hold (dispute/lien), not the 24 h hold. Design v2 visual rollout started (docs/design-visual-system-v2.md); owner left visual calls to design. Offers: multi payment types AND multi currencies per ad, buyer picks both at trade start (locked in); per-type rules come with the type; ad cap 3 per side (confirming).
- 1 Nov 21:28 STATE (owner warned of usage limit): main line + GitHub main = 0c0f9ac. In flight (all pushed or pushing):
  * claude2: wip/second-design-devices (devices review I1/M1/M2 fixes; lands FIRST), helper wip/second-design-selection (no orange for selection).
  * claude3: wip/third-design-fixes-a (cancel wording/flows, DisputeRuling copy, CantDoThat to v2 batch-2 dialog).
  * lead helpers: wip/lead-design-myoffers (54ab006+; design calls being added; then merge main + unify Switch/Notice onto devices kit), wip/lead-design-fold @a0552ee (review running: review-lead-design-fold-2026-11-01.md), wip/lead-design-results @661653a (review running; design calls + dispute-30-min being added).
  * Landing order: devices -> myoffers -> fold -> results -> claude3 fixes-a -> claude2 selection. Kit duplicates to unify at each landing.
  * Owner decisions tonight: offers multi-currency + multi-method per ad, buyer picks both, locked in; cap 3 buy + 3 sell; tiers converted to chosen currency; dispute available 30 MIN after "I've paid" (minimum). API follow-ups to build: cap rule, dispute-after-30-min rule, multi-currency ads.
  * Not started, waiting owner go: new behaviour from design (vendor accounts, member permissions, session length/extend, hold model v3, ban list).
  * Backups of stale dirty worktrees pushed: backup/{lead-t29,p3-task28,rv-staff2,rv-t16}-2026-11-01.
- 1 Nov 21:30: LEAD USAGE LIMIT reached. Next lead: read the STATE entry above; check reviews review-lead-design-fold-2026-11-01.md / review-lead-design-results-2026-11-01.md (may be finished), devices final test report in to-lead.log, then land in the stated order. Design v2 batches: 4b355a56 (login), 0955ab95 (CantDoThat etc.), 84aceaa9 (offers), 87b07ff6 (setup/account/Devices) on wip/design-brief.
- 1 Nov 21:36: FULL HANDOFF: LEAD-HANDOFF-2026-11-01-night.md (read first).
- 2 Nov 07:16: FULL HANDOFF for the context clear: LEAD-HANDOFF-2026-11-02.md (read FIRST; supersedes the 1 Nov night file).
