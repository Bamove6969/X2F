# X2F LEAD HANDOFF, 6 Nov 2026 06:35 PT. Read after CLOUD-START.md.

You are the X2F lead. The owner only answers questions. Your job: review, security, keeping everyone on task, landing to main, delegating. Standards: confidence, quality, leadership; correct bold moves on technical calls; rules, money, security and wording go to the owner with a recommendation. Batch questions.

## State
- Main = GitHub main = 55bc70f9. Landed: selection, fold, form limit, SonarQube workflow (off until configured), offers v2, traded + past-rep.
- Lead stays on the PC (owner). Workers and design run in the cloud. Room: Jetpost note 9zodbbc8va, read and write in its chat. X2F Claude2 session_01MytcQrHxBCXa7BmJYyP43w (bnkxfers, Pro), X2F Claude3 session_015QmjJ2AUna9XQC4GaQJ2iW (totalcarerx4u, Pro), design session_01XZAz2tn1YbpoyEtNYuAJim (bamove, shows as Design Cloud Session). All in the room. Pro accounts hit their 5-hour limit in about an hour with 5 helpers: cap at 3.
- The room doesn't wake idle sessions. From a machine with the account logins: CLAUDE_CONFIG_DIR=~/.claude-account2 claude -p "msg" --cloud <id>, run from a real terminal such as tmux. Otherwise the owner nudges from the phone. Jetpost wake_settings to a routine is untested.
- Landing: merge to main yourself, push HEAD:claude/compassionate-johnson-k95ssr HEAD:main, announce in the room. Check needs typecheck, copy-lint, separation-check, all vitest projects, semgrep, Playwright (from apps/web: -c e2e/playwright.config.ts --workers=1). npm test failing stops the rest; run-check's exit=0 is unreliable, read the counts. npm audit could not reach its service and has not run on any landing tonight: rerun it. Known load flake: password.test.ts Argon2 slots.
- downloads.getmonero.org is allowed on all three cloud environments, by the owner.

## Landing queue
1. Proof batch: claude/reviews-sensitive-text-pf40mh @7a2acd87 (wip/lead-batch4 + tripwire fix: proof core, envelope, smart check, flaky test fixes). Playwright 454, api 1608. Waiting for Monero project counts from claude3. Lead approved core @210fdf53; M4 and re-merges rely on the check.
2. wip/second-fold-followups: needs full test result and a reviewer.
3. Task 15 @1d870dac. Task 4 + staff split: fix I-1, M-1, M-3 first (review-p4-final-lead-2026-11-06.md), rebuild any database that ran old migration 202. Task 5 minors. Task 7 (disabled_at, endAllSessions, taps/start checks the intent's perm).
4. results, sessions, vendor, hold v3: claude2 was merging main; vendor and hold v3 need the lead's security review.
5. cap-dispute @286c6654, price feeds, Task 34 API + web @488a5a71: wait on owner answers. Pop-ups wait on design's review, then a re-merge.
Hold: Task 9 I/O (reverted a55abfc7, NOT in main), 9-view, Task 10. Branches kept.

## Owner
Snapshot: owner-answers-page-2026-11-06.md. Don't send answers out until the owner says done. Answers that change built work include: buyer dispute wait 60 minutes, paused in maintenance; timing per payment type; 3 bands and 5 payment types; instructions and method/currency pairing rethought; granular team groups; owner refused on the trader site. Research for follow-ups: owner-followups-2026-11-06.md. Q19 was the lead's error, nothing needed.
SonarQube Cloud still needs the owner: import, Automatic Analysis off, SONAR_TOKEN, then two repo variables. Vault token stays off cloud sessions. Keep secrets out of comms and Jetpost.
- 2026-11-06 22:55:20: restart. Cloud workers: claude2 session_01MytcQrHxBCXa7BmJYyP43w, claude3 session_015QmjHzzi8jS7CRJGhR7RVw. Reports by READY:/BLOCKED: commits. Relays closed by the PC restart.
- 2026-11-06 23:05:50: cloud lead notes saved in cloud-lead-session/. Its opening prompt and the Lead (PC) message came from the PC lead. No owner product answers were given there. Progress page: https://claude.ai/artifact/DJEw7edpK4bbQuocnDmei1. npm audit: 7 issues on main, 1 high (follow-redirects): needs a fix task.
