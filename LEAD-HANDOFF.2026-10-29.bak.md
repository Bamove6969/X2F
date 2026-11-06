# Lead handoff — X2F (rewritten 2026-10-28 late evening, before a screen clear)

You are the **lead** Claude session for X2F, running in the CLI in `~/x2f` on the owner's account
(bamove@gmail.com, profile `~/.claude`, launcher `lead`). You plan, assign, review, merge, and are
the owner's single point of contact. Read this file top to bottom, then MEMORY.md (loads itself),
then act. The owner wants many agents in parallel (8+, within reason) and real merges, with short
updates that lead with what's needed from them.

## UPDATE 2026-10-29 05:45 (read first; supersedes the in-flight table below)
- Main line 1b2bb3a: Tasks 29, 28, docs (7c43bf0), Task 4 (d5b7fb9), Task 23 (1b2bb3a) merged 10-29.
- Lead helpers running (fresh, started 05:40): reviews of 28 r2 (@8d6d455), 23 r3 (@8fccd6f), 24 r3 (@6b60297),
  4 minors (@ed27ad3), Task 9 I/O (@dd55fcd), Task 20 rest (@f94acbe); builders on 27 (lead-t27) and 5 (lead-t5);
  docs helper writing owner answers into spec/plans on wip/lead-docs-owner-1029. Reports land in review-*-2026-10-29.md.
- claude2 queue (parallel): (U) FU-D rebuild -> wip/second-p2-fud, (V) Task 10 -> wip/second-p3-task10, (W) release-claim view field -> wip/second-p3-task9-view.
- New lead builders: Plan 5 Task 21 feedback + CantDoThat (wip/lead-p5-task21, migration 114). Plan 4 Task 28 News inbox STOPPED at the owner's 8-agent cap; restart it when a slot frees (115 reserved).
- Owner asked A-D (refund-dispute window, 6-month training copies, review disputes after 30 days, 1% on dispute payouts): answers go into docs as a follow-up.
- Landing order: 28 (after its re-review), 23 -> 24 -> 27, 4 -> 5, 9 I/O, 20 rest, docs.
- Old worktrees lead-t29 and p3-task28 hold superseded half-merges: don't use them (abort/remove later).
- Migration numbers: 112 = Task 5, 113 = Task 9 (release claim).
- Monitor: the tail -F watcher missed lines; use the polling loop (grep -c line count every 15 s).

## FIRST THING: usage limit
At ~23:00 on 10-28 the owner's weekly limit was hit and **every lead helper agent died mid-work**.
It resets **8am America/Vancouver**. Cause: claude2's window had been started with plain `claude`
(the owner's account), so it burned the owner's quota too. The owner now knows: claude2 must be
started with the `claude2` launcher (profile `~/.claude-account2`, bnkxfers@gmail.com, own quota);
claude3 with `claude3` (`~/.claude-account3`, totalcarerx4u@gmail.com). `/status` shows the email.
If your own calls fail with a 429, wait for the reset; don't spawn agents before it.

## What X2F is
Phone-first P2P marketplace for trading Monero (XMR) for fiat with 2-of-3 multisig escrow; X2F never
holds enough keys to move coins; privacy is a right (no ID, no email/phone, no tracking); security
first. Repo `github.com/bamove6969/x2f`. **Main line is `claude/compassionate-johnson-k95ssr`** (not
`main`). Your checkout `~/x2f` has it under the local name `compassionate-johnson-k95ssr`, so ALWAYS
push with `git push origin HEAD:claude/compassionate-johnson-k95ssr`. A bare `git push origin HEAD`
created a stray remote branch `compassionate-johnson-k95ssr`; the owner was asked to delete it
(`git -C ~/x2f push origin --delete compassionate-johnson-k95ssr`).
Source of truth: `HANDOFF.md`, spec `docs/superpowers/specs/2026-10-14-x2f-design.md`, plans in
`docs/superpowers/plans/` (Plan 7 draft added 10-28), rules R1–R35 in
`docs/superpowers/rulings-and-lessons.md`, `docs/coordination.md`, reviews in
`docs/superpowers/reviews/` and `~/x2f-comms/review-*.md`.

## Team and chain of command
- **claude2** = bnkxfers@gmail.com. Writes code and reviews. You write `~/x2f-comms/to-second.log`;
  it writes `~/x2f-comms/to-lead.log`. Its letter: `~/x2f-comms/LETTER-TO-SECOND.md` (rewritten 10-28).
- **claude3** = totalcarerx4u@gmail.com, **offline until 2026-10-29 7pm**. Its old queue (28, 29, 8-b)
  was taken by the lead. When it's back, write it a fresh queue in `to-third.log` (and refresh
  `LETTER-TO-THIRD.md`). Good candidates: FU-D rebuild, Task 10, design-canvas copy fixes.
- Watch `to-lead.log` with Monitor:
  `tail -n 0 -F ~/x2f-comms/to-lead.log | awk '{print substr($0,1,400); fflush()}'` (GNU cut has no
  --line-buffered; that failed). Re-arm every 30 min AND `tail -n 5` the log each time you re-arm:
  a report once landed between arms and sat unseen for an hour.
- Owner's rule: workers report ONLY to the lead. claude2 once published a status page for the owner
  on request (https://claude.ai/artifact/TvoHbXtujsgBT7TWybzwEN); yours is the official board.

## Machine and tools
- **Node and npm:** Node 24.22.1 (`export NVM_DIR=$HOME/.nvm; . $NVM_DIR/nvm.sh`); npm via `npx -y npm@11.21.0`.
- **Other tools:**
  - Docker: use `sg docker -c '…'` if permission is denied.
  - Semgrep: `~/.local/semgrep-venv`.
  - Chromium: `/usr/bin/chromium` (`X2F_CHROMIUM_PATH`).
- **Locks:** targeted tests `flock ~/x2f-comms/check.lock <cmd>`; full check `~/x2f-comms/run-check.sh <log>`.
- **Commits:** `git -c user.name=flem -c user.email=bamove@gmail.com commit`. There is no global identity, so a merge without these fails. Messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. R30: push every commit.
- **Worktrees** live in `~/x2f-worktrees/`. After a main-line merge, run `npm ci` before tests if the lockfile changed.
- **Branch deletes:** remote deletes are blocked for everyone; the owner does them.
- **Shared helper brief:** `~/x2f-comms/helper-common.md`. Tell every new helper agent to read it first; it has the toolchain, locks, git rules and report format.
- **Status board:** https://claude.ai/artifact/3mx5a9ij6MYjQheusWxTqq (v6). Local source is `~/x2f-comms/x2f-board.html`; republish with `url` set to that link.

## Main line now: 5dd43e2 (2026-10-28)
Merged on 10-28:
- Plan 7 and the plan revisions, docs only (44fa438)
- FIDO refresh (cb765d0)
- FU-A (059325d). The lead also fixed a FIDO test seed in that merge (`username` to `loginName`).
- accepted-phone.spec fix (9123b4f)
- **Task 22 landing** (648493b)
- **Task 8** (5dd43e2)

Plan 2 is done; FU-D still has to be rebuilt on FU-A.

**Plan 3: 20/33** merged: 1–3, 6–9, 11–19, 21, 22, 25, 26, 30, plus Task 20's pure parts.

Last numbers on the Task 8 branch, which contains the main line: api 966 + 1 todo, web 718, trade 301, moderation 9, auth-client 70.

## In flight — resume these (all lead helpers died at the limit)
Resume a helper with SendMessage to its agent ID if it's still addressable after the clear;
otherwise start a fresh helper with the brief and "commit any WIP first, then push". **Run
`git -C ~/x2f-worktrees/<wt> status` first: several died mid-merge with uncommitted work.**

| # | Task | Branch @ pushed head | Worktree at death | Next step | Agent |
|---|---|---|---|---|---|
| 1 | **Task 29** wallets: round-2 re-review APPROVED; minors M1–M4 done | wip/t3-p3-task29 @6eafc77 | `lead-t29` MID-MERGE of main 648493b (93 files) | Finish the merge by hand and typecheck. Then tsc web, vitest, Playwright wallets + parity; push. **Merge to the main line first of 28/29.** | a9617b76f5a724af4 |
| 2 | **Task 24** seller confirm: claude2's round 3 done. Security fix: a 'release asked' marker in localStorage, auto-sign only with it. Ported to Task 22; `.x2f-method-name` now 44px | wip/lead-p3-task24 @6b60297 | claude2's | **Fresh re-review by a LEAD reviewer** (claude2 wrote the fix). Inputs: review-task24-round2-2026-10-28.md and claude2's 05:36:31 line in to-lead.log. Then merge. | — |
| 3 | **Task 23** buyer pay: fix round done; its re-review died early | wip/lead-p3-task23 @9935936 | `lead-t23` clean | **claude2 (N) re-reviews it.** The lead provisionally accepted the new `paidRecorded` field in Task 12's runtime. | — |
| 4 | **Task 4** offers: fix round done; its re-review died before starting | wip/lead-p3-task4 @02bb5ba | `lead-t4` clean | **claude2 (O) re-reviews it.** Round 1 is in review-task4-2026-10-28.md. | — |
| 5 | **Task 28** getting started: fix round committed (I1, I2, M1–M9) | wip/t3-p3-task28 @651d84a | `p3-task28` MID-MERGE (46 files) | Finish the merge. Tests: tsc web, vitest, Playwright setup, login, parity-auth, quote, post, parity, shell. Push, re-review, then merge **after 29**. In the App.tsx route block keep 29's `/wallets → <Wallets />` plus 28's `/setup/*` and `/terms`. | a2c1994523181c703 |
| 6 | **Task 27** disputes: round 3; the lead owns it now. I1 (dispute identity `(code, seq)`) is committed | wip/lead-p3-task27 @405b9f7 | `lead-t27` 213 uncommitted (mid port/merge) | Commit the WIP. Finish I2: drop purgeDisputes, restrict FKs, guard on `trade.dispute`, NEEDS_PLAN_4_TASK_23 tripwire, neutral footer copy. Then M1, M3, the buyer's `refunded` slot, the Task 22 port, the main merge and tests; re-review. Brief: review-task27-round2-2026-10-28.md. | a6efae08e30fdeea1 |
| 7 | **Task 5** taking an offer: building on Task 4 | wip/lead-p3-task5 @35521e0 | `lead-t5` 47 uncommitted | Commit the WIP. Finish: race tests, the wallet route allowed once, 409 `price-changed`, offer-row lock with hold/pause re-check inside the transaction, `usdCentsOf`, FK `trades.offer_id`. Merge Task 4 @02bb5ba and the main line; then review. | aa69958d028749dad |
| 8 | claude2 (L): **Task 9 I/O wiring** | wip/second-p3-task9-io @1651b10 | claude2's | It keeps a NEEDS_SPEND_EVIDENCE seam; the lead must decide the spend-evidence gap when it reports. | — |
| 9 | claude2 (M): **Task 20 rest** (chat) | wip/second-p3-task20-rest @8566d21 | claude2's | `106_chat.sql`; every message stores its sender side. | — |

**Landing order:** 29 → 28; 23 → 24 → 27 (all three reuse Task 22's room); 4 → 5; then 9-I/O and 20.

**Migration numbers in use:** 009, 102 (Task 4), 105 push, 106 (Task 20 chat), 108 and 110 (Task 27), 109, 111 (Task 8). Before picking a new number, check every wip branch.

## Not started
- FU-D (`wip/lead-p2-fud` @a377c48): rebuild it on FU-A.
- Plan 3 Task 10 (auto-refund, signed terms, signals) and Tasks 31–33.
- Plan 7 Tasks 1–4 and Plan 4 Task 23: wait for the owner's answer to Q1.
- Design-canvas copy fixes, for the owner or design: SetupWallet's 24-hour copy, and the SetupTerms Fees placeholder on extra XMR.

## Owner questions: ANSWERED 2026-10-29 ~01:00-02:00 -> ~/x2f-comms/owner-answers-2026-10-28.md (READ IT)
All 16 + the 7 lead decisions answered, with big changes: 30-day self-destruct / 90 days for disputes from the
dispute button / 48 h dispute SLA; permanent ratings+reviews with review disputes; staff ban stages; news inbox;
user blocks; flexible offers (tiers + multi-method, cap 2 per side per currency); feedback link on every 'can't'
popup; lost disputes still count; appeals with lien + 72 h; warning popups; battery option; OMEMO Jabber alerts.
Open: I2P (research + testing first), canary (~/x2f-comms/lawyer-questions.md). Plans/spec must be updated
from that file before anyone touches retention, Task 27/4 dispute-count contract, or offers caps.
(Original list: ~/x2f-comms/owner-approval-list-2026-10-28.md.)

| # | Question |
|---|---|
| 1 | Retention: A, B or C (recommend B) |
| 2 | Short self-delete times on refunded trades |
| 3 | A bare record kept after a whole-trade delete |
| 4 | Our own F-Droid repository |
| 5 | I2P fallback |
| 6 | Nostr alerts first |
| 7–11 | Comparison gaps: delete account, full block, helper tickets, pause all offers, warrant canary |
| 12 | Old Titan U2F keys unsupported |
| 13 | YubiKey Bio for staff? |
| 14 | Offer caps of 3 per market and 20 total (already built as defaults) |
| 15 | Emergency stop hides the lists (built) |
| 16 | Lost disputes drop completedTrades and stage (contract recorded for Tasks 27 and 4) |

Stray remote branch deleted by the owner 2026-10-29.

**Lead decisions taken without the owner** (tell them if asked):
- Trades with null addresses wait (Task 8).
- Task 8 uses migration 111.
- `trade-closed` returns the runtime to `idle`.
- Task 23's `paidRecorded` field (provisional).
- Shared `.x2f-method-name` is 44px.
- PHONE_VIEWPORTS is the single phone-size standard.
- Task 27 owns the buyer's `refunded` slot.

## Dated chores
- FIDO is done and merged. On or after **2026-11-01**, re-fetch MDS (expect serial > 291), run
  `npm run refresh -w @x2f/fido-mds`, and update the README's serial, date and SHA. Until then the
  API logs a harmless stale-snapshot warning from 11-01.
- **2026-11-02:** fast-uri override 3.1.9 / 4.2.3 (R33).
- **2026-11-05:** serialize-javascript 7.1.3 (R33).
- happy-dom advisory GHSA-834v-8h66-3h79: bump when a fixed version is 14 days old.

## Lessons (keep)
- Every branch needs a real review; most come back CHANGES REQUIRED. Re-review every fix round
  with a reviewer who didn't write it.
- Semantic merge clashes don't show as conflicts. FU-A's `username` rename broke FIDO's test and
  Task 27's parser. After every main-line merge, run tsc and vitest for api, web and auth-client.
- Agents die at limits: brief them to commit WIP and push every commit.
- Run `git fsck` early after a cutoff; repair from origin.
- Tripwires check the local tree only; no deliberately red test on the main line.

## Follow-ups queue (Task 23 m1 + Task 28 m2 assigned 10-29 07:05 to a lead builder: wip/lead-followups-1029)
- Task 28 r2 m2: Terms.tsx:88-94 + :156, terms changing at accept shows "read again" + "Reload" with tick disabled; e2e setup.spec.ts:707 never tests a real version change.
- Task 9: trade view field for releaseClaimedAt (claude2 (W) running).
- Owner rule 2026-10-29: at most 8 lead helper agents at once.
- Design brief for Claude Design: ~/x2f-comms/design-brief-2026-10-29.md (19 new screens + waiting fixes), sent to the owner to paste into the X2F App canvas. Owner: Claude Design owns ALL aesthetics; builders do logic with existing UI-kit parts and a NEEDS_DESIGN_* local tripwire until boards land.
- Task 23 r3 APPROVED WITH MINOR (review-task23-round3-2026-10-29.md). Lead accepts paidRecorded and the new Task 12 field intentKind. Follow-up: BuyerPay.tsx:637-661 cancelling screen never shows escrow.refusal (show refusalText + test). Task 12 trade.paid resend still open.
- claude2 OUT until 9am 10-29 (owner). Its in-flight: (X) Task 9 security fixes (uncommitted in its worktree second-t9io; don't take over), (Y) Task 20 fixes, (U) FU-D @590a1bf (maybe done: review when a slot frees), (V) Task 10 WIP @c7e90d1, (W) @5bb387c. Status request sent; answer comes after 9am.
- Lead calls of 10-29 in ~/x2f-comms/owner-answers-2026-10-29-lead-calls.md

## RESUME HERE (2026-10-29 08:44, written before a possible limit until ~9:50)
- Main line origin: 047b4f3 (News landed 10:25 10-29, after the limit).
- Approved, waiting to land: wip/lead-followups-1029 @5d5caff (review-followups-1029.md, 5 minors for later). Port fix: release.spec now 4322 (on main via 990affe).
- In review (lead reviewers; resume each with SendMessage if alive, else fresh): Task 5 round 2 @c7e49d2; Task 37 round 2 @6e02e10; Task 36 round 2 @c802e66. Builder: Task 21 last round (wip/lead-p5-task21, then land; no re-review needed for the small items). Docs: wip/lead-docs-design-1029 (Claude Design update + owner answers) -> needs a docs review, then merge.
- Landing order after News: followups, 21, 5, 37, 36 (each: merge by hand, tsc + vitest api/web/AUTH-CLIENT (don't skip it: it caught a missed route) + the e2e specs touched).
- claude2 back 9am: its queue in to-second.log: (X) Task 9 security fixes FIRST, (Z) FU-D fixes (review-fud-2026-10-29.md), (Y) Task 20 fixes, plus status on (U)(V)(W). Check to-lead.log on resume; nudge it if silent.
- OWNER STILL TO ANSWER: buyer cancel A or B (lead recommends B); team members yes/no. Owner answers so far: ~/x2f-comms/owner-answers-2026-10-28.md (bottom sections) and lead calls in owner-answers-2026-10-29-lead-calls.md.
- Rules: max 8 lead helpers; stop finished helpers that linger with TaskStop; timestamps from the clock only.
- Open owner questions list: ~/x2f-comms/owner-questions-open-2026-10-29.md
- 10:23 resumed after the limit: helpers resumed (Task 5 rr, 37 rr, 36 rr, 21 last round, docs-design review); new: Task 9 I/O re-review (@3dc2a58), Task 10 review (@77bd835). claude2 queue: (Z) FU-D fixes, (Y) Task 20 fixes, (AA) Plan 3 Task 34 flexible offers API.

## STATE 2026-10-29 13:56
- Main line 414e722: today landed Tasks 29, 28, 4, 23, 24, 27, 5, 37, News (P4 T28), feedback (P5 T21), follow-ups, docs 29/29b/29c.
- In review: Tasks 38-39 cancel/warnings (wip/lead-p3-task38 @f96b5c6), Task 40 foldables (@012aafc), Plan 2 Tasks 16-17 (@4310226/@747bcbb). Fixing for CantDoThat: Task 36 My offers. Building: Plan 2 Task 18 team members.
- Branches built before Task 21 landed must move refusals into CantDoThat (36, 38, 16/17): copy-lint + tripwires catch it.
- claude2 silent since 12:20 (probably killed by the out-of-memory crash); owner asked to restart it. Its queue: (X2) Task 9 round-2 security, (BB) Task 10 fixes, (Z) FU-D, (Y) Task 20, (AA) Task 34.
- Memory: 3.9 GB until the owner restarts WSL (needs a coordinated wsl --shutdown; also set firewall=true). Keep ~5 lead helpers.
- Owner questions open: ~/x2f-comms/owner-questions-open-2026-10-29.md + no-show refund dispute, unclocked shifts, ordinary-moderator pay, payroll wallet, repayment-trade fee, PGP-alone strength.

## RESUME HERE (2026-10-29 14:14, usage limit hit)
- Main line 414e722 (clean, nothing uncommitted in ~/x2f).
- Running at the limit (resume with SendMessage; they push every commit): Task 38-39 fix round (wip/lead-p3-task38; + owner: no-show refund dispute 48 h), Task 40 fix round (wip/lead-p3-task40), Task 36 CantDoThat conversion (wip/lead-p3-task36), Plan 2 Tasks 16-17 review (+ owner: 2 factors required, PGP alone waits), Plan 2 Task 18 team members build.
- claude2: silent since 12:20; owner asked to restart it. Queue in to-second.log.
- Owner questions left: ~/x2f-comms/owner-questions-open-2026-10-29.md items 5-10.
