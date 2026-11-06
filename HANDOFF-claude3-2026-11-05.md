# HANDOFF — claude3 (claudethird), 2026-11-05 ~23:00

Fresh session: read this file, then the tail of `~/x2f-comms/to-third.log`; ack in `to-lead.log`.
Rules: `~/x2f-comms/helper-common.md`; report ONLY in to-lead.log; owner calls stay owner calls (build the plan default, mark OWNER-Q, keep going); push after every commit; flock ~/x2f-comms/check.lock for every test; max 5 helpers; RAM tight.
Main line = GitHub main = **e7636c74**. NOTHING below has landed since the 11-02 handoff. The lead and designer were away 11-03 to 11-05; the OWNER answered questions directly to claude3 (record: `owner-answers-2026-11-01-claude3.md`, "Session 3" + "Session 3 continued"; question list: `owner-questions-claude3-2026-11-02.md`).

**Machine reboot (11-05):** five helpers were cut off. Their uncommitted work is now committed + pushed as **wip ... UNCHECKED** (no tests run on those commits): Task 15, Task 16, staff split. Task 11 and the pop-ups had nothing uncommitted. All worktrees are clean and pushed.

## 1. Branches READY for lead review (none reviewed yet unless noted)

| # | Branch | Head | What | Review |
|---|---|---|---|---|
| R1 | wip/third-feedback-form-limit | 5fee6823 | 1 send / 30 s per person replaces the shared bucket (owner); main e7636c7 merged; api 1462+1 todo | none yet |
| R2 | wip/third-p5-reviews-api | a7a38fdf | C12/C12b + review-claude3-ready-2026-11-02.md fixes I1 (308/309), I2 (eraseReviewsOfTrade seam + NEEDS_P4_OVERTURN_ERASES_REVIEWS), I3 (NOT_AUTH_CLIENT), M1; then owner Q4 FINAL: step needs MORE than the step (bucket = largest S with total > S; $30,001 -> $30,000+); web text "$X+ in trades to date" (COPY-UNSIGNED) | 8cb4ea2c reviewed (review-claude3-ready); fixes since unreviewed |
| R3 | wip/third-p5-past-rep | 4a687f94 | owner 71/72/74/75/76 + mod-verified $ (migration 310) + owner Q8 approved-only + Q9 senior/owner only; finish-route bug fixed (f36941c8) | round 2 approved 8ddbd4d; since unreviewed |
| R4 | wip/third-p5-traded-pastrep | 315142b9 | R2 + R3 joined: approved verified imported $ in the traded bucket; full api+web+rep+auth-client 2944 + 1 todo green | none |
| R5 | wip/third-p5-proof-core | 4d39fc76 | owner 29/30/34/35/36/37 + amount never auto-blurred (31b80bc2) + Q15 (test only) + Q17 (bare number = amount stays clear); proof 178 | C5 approved b5e85cf; since unreviewed |
| R6 | wip/third-p5-proof-envelope (C7) | e49c62a1 | R5 merged in; proof 206 | C7 approved; merges only |
| R7 | wip/third-p5-smart-check (C8) | 1e54d3f5 | R5 merged in; proof 244; 62-64 not here | C8 approved; merges only |
| R8 | wip/third-p4-task4 | ddb56891 | Plan 4 Task 4 staff API shell, login hours, privilege matrix; migration 202 | none |
| R9 | wip/third-p4-task5 | 896b8e47 | Task 5 key taps (from main); migration 203 | none |
| R10 | wip/third-p4-task6 | 6d23e637 | Task 6 owner setup (on R8); migration 204. Caveat: typecheck + 3-project run not rerun after the schema-list fix | none |
| R11 | wip/third-p4-task7 | 1d1c65e9 | Task 7 staff management (on R8 + R9); migration 205. Caveat: full suite not rerun after the schema-list fix | none |
| R12 | wip/third-p4-task8 | ac472caf | Task 8 settings + site controls (on R8 + R9); migration 206; full 3-project green | none |
| R13 | wip/third-p4-task10 | 3d678a33 | Task 10 trader disputes (main + R12); migration 207; reuses main's 108/110 tables | none |

Full details of each: the dated "third:" lines in to-lead.log (11-02 08:4x to 11-03).

## 2. Building / cut off (exact next step)

| Branch | Head | State | Next step |
|---|---|---|---|
| wip/third-p5-proof-popups | f2cce854 | items 63/64 pop-ups, own-blur warning, 65 disclaimer as UNITS (29fa34a4) + codeBoxes (62d903e1) + smart-check 1e54d3f5 merged; helper had not reported | run typecheck, @x2f/proof, its web tests, copy-lint; check the helper's commit messages for OWNER-Qs; report READY. Every piece marked DESIGNER-REVIEW (owner Q21) |
| wip/third-p4-staff-trader-split | 2e11f616 (WIP UNCHECKED) | owner Q19: staff accounts log in only on the staff site; base R8 | run typecheck + api auth/login tests + auth-client flows; fix; finish per the brief (owner account stays allowed on the trader site until owner answers 19a; members unchanged); commit feat, report |
| wip/third-p4-task11 | e2169670 | only the base merge (R13 + R11) done; no Task 11 code yet | start Task 11 from the plan (moderator queue, case, logged chat, messages, holds/freeze per owner rule, unblurred proof request); migration 208 (check free); fulfil NEEDS_P4_CASE_ASSIGNEE |
| wip/third-p4-task15 | b1d7e425 (WIP UNCHECKED) | trader dispute screens on R13; uncommitted edits were in apps/web escrow/policy + dispute test + packages/trade payouts | run typecheck + web dispute/policy tests + @x2f/trade; review what the payouts change is (must stay true to today's code: "goes to", never "sent"); finish |
| wip/third-p4-task16 | f7c178e4 (WIP UNCHECKED) | staff web shell; base = R11 + R10 + R12 merged; apps/staff-web/ was being created (+ lockfile) | npm ci; typecheck; build the shell/login/invite/OwnerSetup screens; DESIGNER-REVIEW where no board |

Queue after these (lead 08:25): Task 12 (rulings + eraseReviewsOfTrade call; needs 11), 24 (appeals 48 h), 25 (liens), 17, 18 screens. SKIP 9, 13, 14 and holds.

## 3. Landing ORDER and dependencies

- **Plan 5:** R1 any time. R3 (304, 310) and R2 (301, 308, 309) independent; **R4 after both**. R5 then R6 and R7 (both contain R5). Pop-ups after R7.
- **Plan 4 stack:** R8 (202) -> R9 (203, from main, independent) -> R10 (204, on R8) / R11 (205, on R8+R9) / R12 (206, on R8+R9) -> R13 (207, contains R12+R8+R9) -> Task 11 (contains R13+R11) -> Task 15 (on R13) -> Task 16 (contains R11+R10+R12).
- **Duplicates to keep ONE of at landing:** `keyTapRoutes` mount in buildStaffApi + its 2 rows in test/staff/routes.ts (R11 and R12 both add); error code `owner-needs-two-keys` (R10 and R11 both add); schema.test.ts migration lists (each branch adds its number).
- **Migration numbers:** Plan 4 202-207 as above (208 next for Task 11); Plan 5 301 reviews, 302 feedback (landed), 304 past-rep, 308 traded totals, 309 overturned reviews, 310 past-rep verified $. 307 = lead-sessions.
- A Task 4 note: Task 4 removed three fired tripwires (NEEDS_PLAN4_STAFF_API, NEEDS_P4_STAFF_FEEDBACK_ROUTE, NEEDS_PLAN_4_STAFF) and built staff News + feedback readers to satisfy them.

## 4. Owner answers (11-02/03) — in code or not

IN CODE: Q4 final ("more than the step") R2/R4; Q8 approved-only R3/R4; Q9 senior+owner R3; Q13/14/16 notes stay relaxed (as built, R5); Q15 apostrophe (R5, test); Q17 bare amount stays clear (R5); Q21 pop-ups built now with DESIGNER-REVIEW (pop-ups branch); 24 h dispute goal (R13 goalAt); appeal = one only, 48 h, binding (R13); disputes place no hold (R13).
NOT YET IN CODE:
- Q19 staff two logins (staff split WIP, above).
- Q1a SUPPORT TICKETS: one open ticket per person until resolved (Plan 4 Task 30; not in my queue).
- Q20 item 62: no card change; screens should ENCOURAGE talking to the vendor first, then accept or dispute (copy/design).
- Q18 NEW FEATURE: the RECEIVER of a blurred proof gets a "was this blurred correctly?" feedback button; record auto vs uploader blur; read by a Helper; waiting on 18a (build back end now?).
- Q6/retention (owner): no dispute -> trade erased after 30 days, gone for good; settled dispute -> kept 90 days, personal details removed, chat dialogue intact, UNEDITED proof kept 90 days for training (Task 19/23; not mine).
- Q19a multi-device: owner, mods, vendors may be logged in on several devices; a new device needs approval from one already logged in (= main's device approval).

## 5. Open owner questions (number: question — my recommendation)

- Feedback form (Q1/Q2): keep the 5-sends-a-day cap? (owner re-asked what we meant; explained) — keep. Failed save still waits 30 s — fine.
- 19a: does the owner also get two separate logins (owner account staff-only)? — yes.
- 5a: owner's earlier A1 = coins move AT the ruling, a lien covers an overturn; asked "does B still stand?" — yes (as built).
- 7: does the dollar total follow the FINAL outcome after an appeal (remove an overturned non-sale)? — yes.
- 10a: one combined dollar line on the offer card, or split per source? — combined; per-site breakdown on the profile.
- 11: after A's key claim is revoked, may account B claim the same PGP key? — no.
- 12: show the 4-point signing help on every failed claim? — yes.
- 18a: build the blur-feedback back end now? — yes.
- 22: blur comma/apostrophe-separated card-length numbers on proof IMAGES? — yes, images only.
- 23: keep 24 h dispute GOAL + 48 h hard "ruling due by"? — yes.
- Builder OWNER-Qs in the reports (to-lead.log): Task 6 loginName field + throttle counts all tries; Task 7 DELETE member = permanent; Task 8 maintenance kind default + 500-char cap; Task 10 ruling acts at once + 24 h as goal; R4 imported volume with zero X2F trades counts alone (owner Q10 said yes).

## 6. Test caveats

- WIP UNCHECKED commits: Task 15 b1d7e425, Task 16 f7c178e4, staff split 2e11f616 (no tests on them).
- R10, R11: full suite not rerun after a schema-list-only fix (schema 72/72).
- R13: last small goalAt commit after the 3-project run; disputes + staff rerun green.
- Known flake (not ours): identity.test.ts terms-mismatch (address last char -> X, ~1/58).
- Playwright not run on any of these (RAM).

## 7. Worktrees (~/x2f-worktrees/)

third-form-limit (R1), third-p5-reviews (R2), third-p5-pastrep (R3), third-traded-pastrep (R4), third-p5-proof (R5), third-p5-envelope (R6), third-p5-check (R7), third-proof-popups, third-p4-task4..8 (R8-R12), third-p4-task10 (R13), third-p4-task11, third-p4-task15, third-p4-task16, third-staff-split. Old, landed: third-design-a, third-flake, third-p5-feedback, third-feedback-land, third-p4-staff, third-p5-rep, third-t20rest (task20-rest is in main).

No helpers running. The session's 30-min self check-in cron dies with this session.

## 8. Update 2026-11-06 00:25 (post-clear session)
- Lead 00:22: R4 lands ALONE as the landing of R2+R3 (R2/R3 never merge separately).
- PLAN 4 LANDING LIST (I2, review-traded-pastrep-2026-11-06.md): at R4 x R13 merge, overturnedSql must read disputes.overturned; saveDispute(overturned=true) calls eraseReviewsOfTrade in the same tx; test overturn -> reviewable:false -> POST review 409 not-reviewable. Tripwire NEEDS_P4_OVERTURN_ERASES_REVIEWS fires at that merge.
- Owner-bound from reviews: form-limit M1 copy + Q1 per-member key; R4 M3 verified-$ ceiling; price-feeds OC6 fallback alert.
- 00:24 lead (RV5 review-p4-task4-5-2026-11-06.md): Task 4 + staff split land TOGETHER. Split must refuse staff on trader login exactly like an unknown name (no oracle) - helper redirected. QUEUED (opus, next free slot): Task 4 m1-m5 code minors; Task 5 m7 (start checks intent perm), m9-m12, m8 purge; Task 7 switch-off sets accounts.disabled_at. Owner: Q1 owner refused on trader site?, Q2 staff device approval, Q3 UV on taps, Q6 tap keep times.
- 00:34 lead: PROOF TRIO review-proof-trio-2026-11-06.md: core I1 must-fix (spaced-dash card/phone with a group = amount stays visible), M1-M3 on core, re-merge core -> envelope + smart-check, M4, re-merge -> pop-ups. Opus, queued 1st (lead 00:34:41: proof trio FIRST, Plan 4 minors next).
- Plan 4 minors job ALSO: revoke pre-existing app='trader' sessions of staff-kind accounts (landing), classify outside-login-hours in cantDoCodes (cantDoThat-lint red on task4 ddb56891). Staff split READY b8cdef6b.
