# Handoff for claude2, 2026-11-06 ~01:35 (supersedes the 11-05 file for state; its rules still apply)

Read this, then the newest lines of ~/x2f-comms/to-second.log. Report only in to-lead.log. The lead's queue only.
Helper model rule: sonnet only for mechanical jobs; opus for reviews, money, auth, migrations, conflicts, building.
Main line = GitHub main = 16f37629 (selection landed 00:48).

## State at the cut (every helper hit the 5-hour limit ~01:25; all worktrees saved, clean, = origin)

| Branch | Head | State | Next |
|---|---|---|---|
| wip/second-design-offers-v2 | a8724b19 | READY TO LAND (main merged; tsc, 79+1 tests, copy-lint green; claude3 r2 APPROVED) | lead lands |
| wip/second-api-cap-dispute | 286c6654 | I1 done; waits on owner B8/B9 | - |
| wip/second-p3-task34-web | 488a5a71 | fix round 2 done, all checks green (see to-lead 01:1x) | RESUME round-2 review: fresh opus reviewer, read-only, -> review-task34-web-round2-2026-11-06.md (old one cut off; its worktree ~/x2f-worktrees/rv-t34web2 may be removed and redone) |
| wip/second-p3-task34 (API) | c2d1006c | r2 APPROVED WITH MINOR (claude3) | lands with web, last |
| wip/second-price-feeds | f1dea13d | r2 APPROVED | waits on owner B4-B7 |
| wip/lead-design-results (now mine) | 83f32fac | not started (helper cut off before any commit) | merge main, handoff leftovers, double bell desktop Buy/Sell, full web suite, PW, reshoot -> READY for fresh reviewer |
| wip/lead-sessions (now mine) | eb8b6f4d | not started | merge main, keep mig 307 (clash check), prompt 2 min, coolingOff/auth-client/web/PW login+security -> READY |
| wip/lead-vendor (now mine) | 5978d27a | main merged, UNCHECKED | tsc + full check -> READY for lead's security review |
| wip/lead-hold-v3 (now mine) | a8da2eac | not started | finish tests, merge main -> lead security review |
| wip/third-p4-task4 (claude3's, my takeover) | eee547f2 | minors done, READY for review (claude3 helper or lead; not mine) | Task 7 disabled_at not on branch (stopped) |
| wip/third-p5-proof-core/envelope/smart-check/popups | 210fdf53 / 05567436 / 746133a3 / e5780990 | core APPROVED by lead; land after offers v2 + traded; popups wait for design | - |
| docs1030 e286489b, task9-io 7346fc00, task9-view 99ba09fc (worktree branch w2-t9view), task10 305124b7 | | owner hold / waiting on owner | - |

## Queue still to do (lead's order)
1. Resume the Task 34 web round-2 review.
2. Resume results, sessions, vendor (as above); then hold-v3.
3. Owner follow-ups F1-F4, research only, one opus helper -> ~/x2f-comms/owner-followups-2026-11-06.md (lead line 01:24:14 in to-second.log has the full brief).
4. Fold follow-up (m2 pick to URL on first input, m3 tabletop "where to send" when details null) on a new branch from main AFTER fold lands; opus.

## Files written today
- owner-questions-claude2-2026-11-06.md (10 BLOCKING, 37 LATER)
- reviews: review-{fold-round2, form-limit, form-limit-round2, traded-pastrep, traded-pastrep-round2, proof-trio, p4-task4-5, sonar-action}-2026-11-06.md

## UPDATE 02:15 — local claude2 stopped for the cloud move (owner order)
The full per-branch handover is in to-lead.log at the "STOPPED FOR THE CLOUD MOVE" line. Current heads (all = origin, all clean):
offers-v2 1e890b13 (READY TO LAND, main 1c400ea2 merged, checked) · task34-web 488a5a71 (r2 APPROVED WITH MINOR; N1 CSS waits for the lead's OK) ·
lead-design-results c74ebc41 · lead-sessions 1971a424 (last commit UNCHECKED) · lead-vendor 0ebd79bb · lead-hold-v3 38f5056c (no 1c400ea2 yet) ·
second-fold-followups 57e543f5 (UNCHECKED test edit only). The cloud copy (session_01MytcQrnjJQN6u4zQJv1ciV) replies via the Remote MCP send_message tool;
in the cloud, downloads.getmonero.org is blocked (403), so the regtest/escrow/node-proxy tests can't run there yet.
